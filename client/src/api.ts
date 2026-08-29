import type {
  ActivityEntry,
  Author,
  Overview,
  ChangedFile,
  FileContent,
  RepoInfo,
  ReviewSource,
  Session,
  Side,
  TargetOptions,
  Thread,
} from '@stickie/shared'

/** Who moves a review's base pin when it goes stale. */
export type RepinMode = 'always' | 'when-clear' | 'never'

/** Which keystroke posts a comment; the other one makes a new line. */
export type SubmitKey = 'enter' | 'mod-enter'

/**
 * What a new note is by default. A draft joins the review batch and no agent
 * sees it until the review is sent; a comment goes to the agent at once.
 */
export type NoteDefault = 'draft' | 'comment'

/**
 * Everything this client does, a person did. The routes that change something
 * cannot tell an agent from a reviewer, and now record no actor rather than
 * guessing at one — so every call from the UI says which it is.
 */
const as_user = 'author=user'

export interface SettingsState {
  gitlabUrl: string | null
  gitlabTokenEnv: string | null
  hasStoredToken: boolean
  effectiveUrl: string | null
  tokenSource: string | null
  promptInstructions: string
  defaultPromptInstructions: string
  /** comma-separated extensions that open soft-wrapped */
  wrapExtensions: string
  /** the command that points an MCP client at this server */
  mcpCommand: string
  repinMode: RepinMode
  submitKey: SubmitKey
  noteDefault: NoteDefault
  identity: {
    chosenName: string
    perRepo: {
      repoId: number
      repoName: string
      name: string
      email: string | null
      source: string
    }[]
    fallback: { name: string; email: string | null; source: string }
  }
  storage: {
    active: string
    databaseUrl: string | null
    fromEnv: boolean
  }
}

export interface CommitBetween {
  sha: string
  shortSha: string
  parentSha: string
  subject: string
}

export interface NavHit {
  repoPath: string
  path: string
  line: number
  preview: string
}

async function toJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? response.statusText,
    )
  }
  return response.json() as Promise<T>
}

function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  repos: () => fetch('/api/repos').then(toJson<RepoInfo[]>),

  addRepo: (path: string) =>
    post('/api/repos', { path }).then(toJson<{ id: number; path: string }>),

  targets: (repoId: number) =>
    fetch(`/api/repos/${repoId}/targets`).then(toJson<TargetOptions>),

  createSession: (repoId: number, source: ReviewSource, baseRef?: string) =>
    post('/api/sessions', { repoId, source, baseRef }).then(toJson<Session>),

  session: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}`).then(toJson<Session>),

  thread: (threadId: number) =>
    fetch(`/api/threads/${String(threadId)}`).then(toJson<Thread>),

  /** A note by the number it carries in its review, re-anchored server-side. */
  noteByNumber: (reviewId: number, note: number) =>
    fetch(`/api/reviews/${String(reviewId)}/notes/${String(note)}`).then(
      toJson<Thread>,
    ),

  repin: (sessionId: number, automatic = false) =>
    post(
      `/api/sessions/${sessionId}/repin${automatic ? '?automatic=1' : ''}`,
      {},
    ).then(toJson<Session>),

  commits: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/commits`).then(toJson<CommitBetween[]>),

  diff: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/diff`).then(toJson<ChangedFile[]>),

  tree: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/tree`).then(toJson<string[]>),

  file: (sessionId: number, path: string, side: Side) =>
    fetch(
      `/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}&side=${side}`,
    ).then(toJson<FileContent>),

  threads: (sessionId: number, includePending = false) =>
    fetch(
      `/api/sessions/${sessionId}/threads${includePending ? '?include_pending=1' : ''}`,
    ).then(toJson<Thread[]>),

  submitReview: (sessionId: number) =>
    post(`/api/sessions/${sessionId}/submit-review?${as_user}`, {}).then(
      toJson<{ posted: number }>,
    ),

  postThread: (threadId: number) =>
    post(`/api/threads/${threadId}/post?${as_user}`, {}).then(toJson<Thread>),

  viewed: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/viewed`).then(toJson<string[]>),

  setViewed: (sessionId: number, path: string, viewed: boolean) =>
    post(`/api/sessions/${sessionId}/viewed?${as_user}`, { path, viewed }).then(
      toJson<{ ok: boolean }>,
    ),

  createThread: (
    sessionId: number,
    input: {
      path: string
      side: Side
      startLine: number
      endLine: number
      body: string
      author?: Author
      /** false sends it to the agent at once; true keeps it in the batch */
      pending?: boolean
    },
  ) => post(`/api/sessions/${sessionId}/threads`, input).then(toJson<Thread>),

  reply: (threadId: number, author: Author, body: string) =>
    post(`/api/threads/${threadId}/reply`, { author, body }).then(
      toJson<Thread>,
    ),

  editMessage: (messageId: number, body: string) =>
    fetch(`/api/messages/${messageId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    }).then(toJson<Thread>),

  deleteThread: (threadId: number) =>
    fetch(`/api/threads/${threadId}?${as_user}`, { method: 'DELETE' }).then(
      toJson<{ ok: boolean }>,
    ),

  deleteMessage: (messageId: number) =>
    fetch(`/api/messages/${messageId}`, { method: 'DELETE' }).then(
      toJson<{ deletedThread: boolean; thread: Thread | null }>,
    ),

  resolve: (threadId: number) =>
    post(`/api/threads/${threadId}/resolve?${as_user}`, {}).then(
      toJson<Thread>,
    ),

  reopen: (threadId: number) =>
    post(`/api/threads/${threadId}/reopen?${as_user}`, {}).then(
      toJson<Thread>,
    ),

  activity: (sessionId: number, limit?: number) =>
    fetch(
      `/api/sessions/${String(sessionId)}/activity${limit === undefined ? '' : `?limit=${String(limit)}`}`,
    ).then(toJson<ActivityEntry[]>),

  overview: () => fetch('/api/overview').then(toJson<Overview>),

  settings: () => fetch('/api/settings').then(toJson<SettingsState>),

  saveSettings: (body: {
    gitlabUrl?: string
    gitlabToken?: string
    gitlabTokenEnv?: string
    promptInstructions?: string
    wrapExtensions?: string
    databaseUrl?: string
    actorName?: string
    repinMode?: RepinMode
    submitKey?: SubmitKey
    noteDefault?: NoteDefault
  }) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(toJson<{ ok: boolean; restartRequired: boolean }>),

  importMr: (sessionId: number, mr: string) =>
    post(`/api/sessions/${sessionId}/import-mr`, { mr }).then(
      toJson<{ imported: number; skipped: number }>,
    ),

  definitions: (
    sessionId: number,
    name: string,
    language: string,
    scope: 'repo' | 'workspace' = 'repo',
  ) =>
    fetch(
      `/api/sessions/${sessionId}/nav/definitions?name=${encodeURIComponent(name)}&language=${encodeURIComponent(language)}&scope=${scope}`,
    ).then(toJson<NavHit[]>),

  search: (sessionId: number, q: string, scope: 'repo' | 'workspace' = 'workspace') =>
    fetch(
      `/api/sessions/${sessionId}/nav/search?q=${encodeURIComponent(q)}&scope=${scope}`,
    ).then(toJson<NavHit[]>),

  commitFiles: (repoId: number, shas: string[]) =>
    fetch(
      `/api/repos/${repoId}/commit-files?shas=${shas.join(',')}`,
    ).then(toJson<{ path: string; shas: string[] }[]>),

  repoFile: (repoId: number, path: string, rev?: string) =>
    fetch(
      `/api/repos/${repoId}/file?path=${encodeURIComponent(path)}${
        rev === undefined ? '' : `&rev=${encodeURIComponent(rev)}`
      }`,
    ).then(
      toJson<{ path: string; content: string | null; binary: boolean }>,
    ),

  references: (sessionId: number, name: string, scope: 'repo' | 'workspace') =>
    fetch(
      `/api/sessions/${sessionId}/nav/references?name=${encodeURIComponent(name)}&scope=${scope}`,
    ).then(toJson<NavHit[]>),

  prompt: async (sessionId: number, order: number[] = []) => {
    const query =
      order.length === 0 ? `?${as_user}` : `?${as_user}&order=${order.join(',')}`
    const response = await fetch(`/api/sessions/${sessionId}/prompt${query}`)
    if (!response.ok) throw new Error(response.statusText)
    return response.text()
  },
}
