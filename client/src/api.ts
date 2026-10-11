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

/** An open merge request, as much of one as a review needs to name it. */
export interface MergeRequest {
  iid: number
  projectPath: string
  title: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  state: string
}

/**
 * One discussion on the attached merge request. Read from GitLab rather than
 * copied here — it is someone else's conversation, shown.
 */
export interface MrThread {
  id: string
  path: string | null
  side: 'base' | 'source'
  line: number | null
  resolved: boolean
  resolvable: boolean
  messages: { author: string; body: string; createdAt: string | null }[]
}

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
 * Where a resolved note goes. `folded` leaves it in the diff as one line that
 * opens; `gutter` takes it out of the code entirely and marks its line, so a
 * file that has been worked through reads as code again.
 */
/** The whole note, a line or two of it, or only a mark in the gutter. */
export type ResolvedNotes = 'shown' | 'folded' | 'gutter'

/**
 * What removing a repository does to the reviews in it: delete them with it,
 * or keep them and let re-adding the path bring them back.
 */
export type RemoveMode = 'delete' | 'unregister'

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
  collapsedFiles: string
  resolvedNotes: ResolvedNotes
  defaultCollapsedFiles: string
  /** the command that points an MCP client at this server */
  mcpCommand: string
  repinMode: RepinMode
  removeMode: RemoveMode
  submitKey: SubmitKey
  noteDefault: NoteDefault
  /** days left alone before a review is archived; null is never */
  archiveAfterDays: number | null
  /** days left alone before a review is deleted; null is never */
  deleteAfterDays: number | null
  /** days the activity record is kept; null is for ever */
  activityKeepDays: number | null
  /** the port stickie starts on, the one it is on now, and whether env decides */
  port: { configured: number; running: number; fromEnv: boolean }
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
  return request(url, 'POST', body)
}

function request(url: string, method: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  repos: () => fetch('/api/repos').then(toJson<RepoInfo[]>),

  addRepo: (path: string) =>
    post(`/api/repos?${as_user}`, { path }).then(
      toJson<{ id: number; path: string }>,
    ),

  /**
   * Takes a repository out of the workspace. The mode is passed rather than
   * left to the server so that what the user was asked to confirm and what
   * happens cannot come apart.
   */
  removeRepo: (repoId: number, mode: RemoveMode) =>
    fetch(`/api/repos/${String(repoId)}?mode=${mode}&${as_user}`, {
      method: 'DELETE',
    }).then(toJson<{ ok: boolean; deleted: boolean; notes: number }>),

  /** whether `older` is in `newer`'s history; false for anything unresolvable */
  ancestor: (repoId: number, older: string, newer: string) =>
    fetch(
      `/api/repos/${String(repoId)}/ancestor?older=${encodeURIComponent(older)}&newer=${encodeURIComponent(newer)}`,
    ).then(toJson<{ ancestor: boolean }>),

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

  /** Puts the base back where it was before the last move. One step. */
  undoBase: (sessionId: number) =>
    post(`/api/sessions/${sessionId}/base/undo`, {}).then(toJson<Session>),

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
      /** the merge-request discussion it was started from, if it was */
      mrDiscussion?: string
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

  /** The record across every repository and review, newest first. */
  workspaceActivity: (limit?: number) =>
    fetch(
      `/api/activity${limit === undefined ? '' : `?limit=${String(limit)}`}`,
    ).then(toJson<ActivityEntry[]>),

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
    collapsedFiles?: string
    resolvedNotes?: ResolvedNotes
    databaseUrl?: string
    actorName?: string
    repinMode?: RepinMode
    removeMode?: RemoveMode
    submitKey?: SubmitKey
    noteDefault?: NoteDefault
    archiveAfterDays?: number | null
    deleteAfterDays?: number | null
    activityKeepDays?: number | null
    port?: number | null
  }) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(toJson<{ ok: boolean; restartRequired: boolean }>),

  /** What there is to attach, if anything; attaching is a separate act. */
  mrCandidate: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/mr/candidate`).then(
      toJson<{ candidate: MergeRequest | null }>,
    ),

  /** Put a review away from the overview, or bring it back. Deletes nothing. */
  setArchived: (sessionId: number, archived: boolean) =>
    request(`/api/sessions/${sessionId}/archived`, 'PUT', { archived }).then(
      toJson<Session>,
    ),

  /** Keep a review from expiring, or let it go again. */
  setKept: (sessionId: number, kept: boolean) =>
    request(`/api/sessions/${sessionId}/kept`, 'PUT', { kept }).then(
      toJson<Session>,
    ),

  /** The whole order this review's notes go into the prompt in. */
  setPromptOrder: (sessionId: number, ids: number[]) =>
    request(`/api/sessions/${sessionId}/prompt-order`, 'PUT', { ids }).then(
      toJson<{ ok: boolean }>,
    ),

  /** Attach a merge request to this review, or pass null to take it off. */
  attachMr: (sessionId: number, iid: number | null) =>
    request(`/api/sessions/${sessionId}/mr`, 'PUT', { iid }).then(
      toJson<Session>,
    ),

  mrThreads: (sessionId: number) =>
    fetch(`/api/sessions/${sessionId}/mr/threads`).then(
      toJson<{ mr: MergeRequest | null; threads: MrThread[] }>,
    ),

  replyToMr: (sessionId: number, discussion: string, body: string) =>
    post(
      `/api/sessions/${sessionId}/mr/threads/${encodeURIComponent(discussion)}/reply?author=user`,
      { body },
    ).then(toJson<{ ok: boolean }>),

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
