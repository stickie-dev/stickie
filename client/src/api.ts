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

  diff: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/diff`).then(toJson<ChangedFile[]>),

  tree: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/tree`).then(toJson<string[]>),

  file: (sessionId: number, path: string, side: Side) =>
    fetch(
      `/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}&side=${side}`,
    ).then(toJson<FileContent>),

  threads: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/threads`).then(toJson<Thread[]>),

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

  prompt: async (sessionId: number) => {
    const response = await fetch(`/api/sessions/${sessionId}/prompt`)
    if (!response.ok) throw new Error(response.statusText)
    return response.text()
  },
}
