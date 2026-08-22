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

  resolve: (threadId: number) =>
    post(`/api/threads/${threadId}/resolve`, {}).then(toJson<Thread>),

  reopen: (threadId: number) =>
    post(`/api/threads/${threadId}/reopen`, {}).then(toJson<Thread>),

  settings: () => fetch('/api/settings').then(toJson<SettingsState>),

  saveSettings: (body: {
    gitlabUrl?: string
    gitlabToken?: string
    gitlabTokenEnv?: string
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

  references: (sessionId: number, name: string, scope: 'repo' | 'workspace') =>
    fetch(
      `/api/sessions/${sessionId}/nav/references?name=${encodeURIComponent(name)}&scope=${scope}`,
    ).then(toJson<NavHit[]>),

  prompt: async (sessionId: number) => {
    const response = await fetch(`/api/sessions/${sessionId}/prompt`)
    if (!response.ok) throw new Error(response.statusText)
    return response.text()
  },
}
