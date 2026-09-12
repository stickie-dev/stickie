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

/**
 * An open merge request, as much of one as a review needs to name it.
 *
 * Stickie attaches to a merge request rather than importing from it: the MR is
 * the thing a review is *about*, and its discussion belongs to the people
 * having it. Copying those discussions in made them stickie threads, which meant
 * a reply here went nowhere near GitLab and the conversation forked without
 * saying so.
 */
export interface MergeRequest {
  iid: number
  projectPath: string
  title: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  state: string
}

interface GitLabMr {
  iid?: number
  title?: string
  web_url?: string
  source_branch?: string
  target_branch?: string
  state?: string
  references?: { full?: string }
}

function mrFromApi(raw: GitLabMr, projectPath: string): MergeRequest | null {
  if (raw.iid === undefined) return null
  return {
    iid: raw.iid,
    projectPath,
    title: raw.title ?? '',
    webUrl: raw.web_url ?? '',
    sourceBranch: raw.source_branch ?? '',
    targetBranch: raw.target_branch ?? '',
    state: raw.state ?? 'opened',
  }
}

async function gitlabJson<T>(
  config: GitLabConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${config.url}/api/v4${path}`, {
    ...init,
    headers: {
      'PRIVATE-TOKEN': config.token,
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`GitLab responded ${String(response.status)} for ${path}`)
  }
  return (await response.json()) as T
}

/**
 * The open merge request for a branch, if there is one.
 *
 * Asked by source branch, and narrowed by target when the review has one, so
 * a branch with an MR to `master` and another to a release branch answers with
 * the one this review is actually reading against. More than one match with no
 * way to choose is no answer: attaching the wrong conversation to a review is
 * worse than attaching none.
 */
export async function findOpenMr(
  config: GitLabConfig,
  projectPath: string,
  sourceBranch: string,
  targetBranch: string | null,
): Promise<MergeRequest | null> {
  const found = await gitlabJson<GitLabMr[]>(
    config,
    `/projects/${encodeURIComponent(projectPath)}/merge_requests` +
      `?state=opened&source_branch=${encodeURIComponent(sourceBranch)}&per_page=20`,
  )
  const open = found.flatMap((raw) => {
    const mr = mrFromApi(raw, projectPath)
    return mr === null ? [] : [mr]
  })
  if (open.length <= 1) return open[0] ?? null
  const targeted = open.filter((mr) => mr.targetBranch === targetBranch)
  return targeted.length === 1 ? targeted[0] ?? null : null
}

/** One merge request by its iid, for attaching one by hand. */
export async function fetchMr(
  config: GitLabConfig,
  projectPath: string,
  iid: number,
): Promise<MergeRequest | null> {
  const raw = await gitlabJson<GitLabMr>(
    config,
    `/projects/${encodeURIComponent(projectPath)}/merge_requests/${String(iid)}`,
  )
  return mrFromApi(raw, projectPath)
}

/**
 * One discussion on an attached MR, as stickie shows it: whose it is, what was
 * said, and where in the diff — read, not owned.
 */
export interface MrThread {
  id: string
  /** where it hangs in the diff, when it hangs anywhere */
  path: string | null
  side: 'base' | 'source'
  line: number | null
  resolved: boolean
  resolvable: boolean
  messages: { author: string; body: string; createdAt: string | null }[]
}

interface GitLabNoteFull extends GitLabNote {
  id?: number
  created_at?: string
}

interface GitLabDiscussionFull {
  id?: string
  notes?: GitLabNoteFull[]
}

/** Every discussion on the MR, resolved ones included — the tab shows them all. */
export function discussionsToThreads(
  discussions: GitLabDiscussionFull[],
): MrThread[] {
  const threads: MrThread[] = []
  for (const discussion of discussions) {
    const notes = (discussion.notes ?? []).filter((n) => n.system !== true)
    const first = notes[0]
    if (discussion.id === undefined || first === undefined) continue
    const position = first.position
    const side: 'base' | 'source' =
      position?.new_line != null ? 'source' : 'base'
    const path =
      position == null
        ? null
        : ((side === 'source' ? position.new_path : position.old_path) ??
          position.new_path ??
          position.old_path ??
          null)
    threads.push({
      id: discussion.id,
      path,
      side,
      line: position?.new_line ?? position?.old_line ?? null,
      resolved: first.resolved === true,
      resolvable: first.resolvable === true,
      messages: notes.map((n) => ({
        author: n.author?.username ?? 'someone',
        body: n.body ?? '',
        createdAt: n.created_at ?? null,
      })),
    })
  }
  return threads
}

export async function fetchMrThreads(
  config: GitLabConfig,
  projectPath: string,
  iid: number,
): Promise<MrThread[]> {
  const discussions: GitLabDiscussionFull[] = []
  let page = '1'
  while (page !== '') {
    const response = await fetch(
      `${config.url}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${String(iid)}/discussions?per_page=100&page=${page}`,
      { headers: { 'PRIVATE-TOKEN': config.token } },
    )
    if (!response.ok) {
      throw new Error(
        `GitLab responded ${String(response.status)} for ${projectPath}!${String(iid)}`,
      )
    }
    discussions.push(...((await response.json()) as GitLabDiscussionFull[]))
    page = response.headers.get('x-next-page') ?? ''
  }
  return discussionsToThreads(discussions)
}

/**
 * How a reply written in stickie signs itself on GitLab.
 *
 * A reply that reaches the MR is read by people who were not here, so it has
 * to say where it came from — and an agent's has to say that it is an agent's.
 * Anything else is stickie putting words in a person's mouth on someone else's
 * system.
 */
export function signReply(body: string, author: 'user' | 'agent', actor: string | null): string {
  const who = author === 'agent' ? `🤖 ${actor ?? 'agent'}` : (actor ?? 'via stickie')
  const trailer = author === 'agent' ? ' — replied by an agent, via stickie' : ' — via stickie'
  return `**${who}**${trailer}\n\n${body.trim()}`
}

export async function replyToMrThread(
  config: GitLabConfig,
  projectPath: string,
  iid: number,
  discussionId: string,
  body: string,
): Promise<void> {
  await gitlabJson(
    config,
    `/projects/${encodeURIComponent(projectPath)}/merge_requests/${String(iid)}/discussions/${encodeURIComponent(discussionId)}/notes`,
    { method: 'POST', body: JSON.stringify({ body }) },
  )
}
