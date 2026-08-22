export interface GitLabConfig {
  url: string
  token: string
  /** where the token came from, for display in settings */
  tokenSource: 'settings' | `env:${string}`
}

export interface GitLabSettings {
  url?: string | null
  token?: string | null
  tokenEnv?: string | null
}

/**
 * Token resolution order: raw token from settings, then the env var named
 * in settings, then GITLAB_TOKEN. URL: settings, then GITLAB_URL, then
 * gitlab.com.
 */
export function gitlabConfig(settings: GitLabSettings = {}): GitLabConfig | null {
  const url = (
    settings.url ??
    process.env.GITLAB_URL ??
    'https://gitlab.com'
  ).replace(/\/$/, '')
  if (settings.token != null && settings.token !== '') {
    return { url, token: settings.token, tokenSource: 'settings' }
  }
  const env_name = settings.tokenEnv
  if (env_name != null && env_name !== '') {
    const from_named = process.env[env_name]
    if (from_named !== undefined && from_named !== '') {
      return { url, token: from_named, tokenSource: `env:${env_name}` }
    }
  }
  const fallback = process.env.GITLAB_TOKEN
  if (fallback !== undefined && fallback !== '') {
    return { url, token: fallback, tokenSource: 'env:GITLAB_TOKEN' }
  }
  return null
}

/** group/project from an ssh or https git remote URL. */
export function projectFromRemote(remote: string): string | null {
  const ssh = /^(?:ssh:\/\/)?git@[^:/]+[:/](.+?)(?:\.git)?$/.exec(remote.trim())
  if (ssh?.[1] !== undefined) return ssh[1].replace(/^\//, '')
  try {
    const url = new URL(remote.trim())
    const path = url.pathname.replace(/^\//, '').replace(/\.git$/, '')
    return path === '' ? null : path
  } catch {
    return null
  }
}

export interface MrRef {
  iid: number
  projectPath: string | null
}

/** Accepts "123", "!123", or a full merge-request URL. */
export function parseMrRef(input: string): MrRef | null {
  const trimmed = input.trim()
  const bare = /^!?(\d+)$/.exec(trimmed)
  if (bare?.[1] !== undefined) {
    return { iid: Number(bare[1]), projectPath: null }
  }
  const url = /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/.exec(trimmed)
  if (url?.[1] !== undefined && url[2] !== undefined) {
    return { iid: Number(url[2]), projectPath: url[1] }
  }
  return null
}

export interface ImportedNote {
  externalId: string
  path: string
  side: 'base' | 'source'
  line: number
  messages: string[]
}

interface GitLabNote {
  system?: boolean
  resolvable?: boolean
  resolved?: boolean
  body?: string
  author?: { username?: string }
  position?: {
    new_path?: string | null
    old_path?: string | null
    new_line?: number | null
    old_line?: number | null
  }
}

interface GitLabDiscussion {
  id?: string
  notes?: GitLabNote[]
}

export function discussionsToNotes(
  discussions: GitLabDiscussion[],
): ImportedNote[] {
  const imported: ImportedNote[] = []
  for (const discussion of discussions) {
    const notes = (discussion.notes ?? []).filter((n) => n.system !== true)
    const first = notes[0]
    if (discussion.id === undefined || first === undefined) continue
    // only unresolved diff discussions carry work for the agent
    if (first.resolvable !== true || first.resolved === true) continue
    const position = first.position
    if (position == null) continue
    const side = position.new_line != null ? 'source' : 'base'
    const path =
      (side === 'source' ? position.new_path : position.old_path) ??
      position.new_path ??
      position.old_path
    const line = position.new_line ?? position.old_line
    if (path == null || line == null) continue
    imported.push({
      externalId: discussion.id,
      path,
      side,
      line,
      messages: notes.map(
        (n) => `${n.author?.username ?? 'someone'}: ${n.body ?? ''}`,
      ),
    })
  }
  return imported
}

export async function fetchMrDiscussions(
  config: GitLabConfig,
  projectPath: string,
  iid: number,
): Promise<ImportedNote[]> {
  const discussions: GitLabDiscussion[] = []
  let page = '1'
  while (page !== '') {
    const response = await fetch(
      `${config.url}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${iid}/discussions?per_page=100&page=${page}`,
      { headers: { 'PRIVATE-TOKEN': config.token } },
    )
    if (!response.ok) {
      throw new Error(
        `GitLab responded ${response.status} for ${projectPath}!${iid}`,
      )
    }
    discussions.push(...((await response.json()) as GitLabDiscussion[]))
    page = response.headers.get('x-next-page') ?? ''
  }
  return discussionsToNotes(discussions)
}
