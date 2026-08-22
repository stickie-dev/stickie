import type {
  Author,
  ChangedFile,
  FileContent,
  RepoInfo,
  ReviewSource,
  Session,
  Side,
  TargetOptions,
  Thread,
} from '@stickie/shared'

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

  repin: (sessionId: number) =>
    post(`/api/sessions/${sessionId}/repin`, {}).then(toJson<Session>),

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
    post(`/api/sessions/${sessionId}/submit-review`, {}).then(
      toJson<{ posted: number }>,
    ),

  postThread: (threadId: number) =>
    post(`/api/threads/${threadId}/post`, {}).then(toJson<Thread>),

  viewed: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/viewed`).then(toJson<string[]>),

  setViewed: (sessionId: number, path: string, viewed: boolean) =>
    post(`/api/sessions/${sessionId}/viewed`, { path, viewed }).then(
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
    fetch(`/api/threads/${threadId}`, { method: 'DELETE' }).then(
      toJson<{ ok: boolean }>,
    ),

  deleteMessage: (messageId: number) =>
    fetch(`/api/messages/${messageId}`, { method: 'DELETE' }).then(
      toJson<{ deletedThread: boolean; thread: Thread | null }>,
    ),

  resolve: (threadId: number) =>
    post(`/api/threads/${threadId}/resolve`, {}).then(toJson<Thread>),

  reopen: (threadId: number) =>
    post(`/api/threads/${threadId}/reopen`, {}).then(toJson<Thread>),

  settings: () => fetch('/api/settings').then(toJson<SettingsState>),

  saveSettings: (body: {
    gitlabUrl?: string
    gitlabToken?: string
    gitlabTokenEnv?: string
    promptInstructions?: string
    wrapExtensions?: string
  }) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(toJson<{ ok: boolean }>),

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
    const query = order.length === 0 ? '' : `?order=${order.join(',')}`
    const response = await fetch(`/api/sessions/${sessionId}/prompt${query}`)
    if (!response.ok) throw new Error(response.statusText)
    return response.text()
  },
}
