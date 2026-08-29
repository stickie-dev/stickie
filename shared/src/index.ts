export interface GitStatus {
  repoPath: string
  branch: string
  changedFiles: number
  clean: boolean
}

export interface RepoInfo {
  id: number
  path: string
  name: string
  branch: string
  clean: boolean
}

export type SourceKind = 'worktree' | 'ref'

export interface ReviewSource {
  kind: SourceKind
  /** worktree: absolute path of the worktree; ref: branch name or commit */
  value: string
}

export interface WorktreeInfo {
  path: string
  branch: string | null
  head: string
  isMain: boolean
}

export interface BranchInfo {
  name: string
  lastCommitAt: string
}

export interface CommitInfo {
  sha: string
  shortSha: string
  subject: string
}

export interface TargetOptions {
  worktrees: WorktreeInfo[]
  branches: BranchInfo[]
  recentCommits: CommitInfo[]
  defaultBranch: string
}

export interface Session {
  id: number
  repoId: number
  repoPath: string
  source: ReviewSource
  baseRef: string
  baseSha: string
  /** true when baseRef is symbolic (HEAD) and has moved past baseSha */
  baseStale?: boolean
}

export type FileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export interface ChangedFile {
  path: string
  oldPath?: string
  status: FileChangeStatus
}

export type Side = 'base' | 'source'

export interface FileContent {
  path: string
  side: Side
  /** null when the file does not exist on this side */
  content: string | null
  blobSha: string | null
  binary: boolean
}

export type ThreadStatus = 'open' | 'resolved' | 'detached'

/**
 * The *role* a message was written in, which is what decides whether a new
 * note starts out pending, whether it may be edited, and how the export labels
 * it. Not a name — see `actorName` for who.
 */
export type Author = 'user' | 'agent'

export type ActorKind = 'human' | 'agent'

/**
 * Who did something. There is no authentication: a human's name comes from
 * git config (or Settings), an agent names itself when it posts. So an actor
 * is a label on the record, not a verified identity.
 */
export interface Actor {
  id: number
  kind: ActorKind
  name: string
  /** from git config, for humans; agents have none */
  email: string | null
}

export interface ThreadMessage {
  id: number
  author: Author
  body: string
  createdAt: string
  /** null on anything written before there were actors, or imported */
  actorName: string | null
}

export interface Thread {
  id: number
  sessionId: number
  path: string
  side: Side
  startLine: number
  endLine: number
  snippet: string
  status: ThreadStatus
  /** pending notes are drafts of a review batch, invisible to agents */
  pending: boolean
  /** e.g. "gitlab" for imported threads */
  origin: string | null
  createdAt: string
  /** who raised the note; null for imported and pre-actor threads */
  actorName: string | null
  messages: ThreadMessage[]
}

/**
 * One thing that happened, from the append-only record. `subject` and `action`
 * are two fields rather than one string so a reader can ask for all of a kind;
 * `detail` is whatever the route knew at the time, kept so a row still says
 * something once the note it points at has been deleted.
 */
export interface ActivityEntry {
  id: number
  at: string
  subject: 'note' | 'review' | 'file'
  action: string
  /** null for rows recorded before there were actors */
  actorName: string | null
  repoId: number | null
  sessionId: number | null
  threadId: number | null
  messageId: number | null
  detail: Record<string, unknown> | null
}

export interface FsEvent {
  type: 'fs'
  repoPath: string
  paths: string[]
}

/** A note changed server-side, e.g. an agent replied or resolved. */
export interface ThreadEvent {
  type: 'thread'
  action: 'created' | 'updated' | 'deleted'
  sessionId: number
  /** absent when a whole batch changed at once (review submit, import) */
  threadId?: number
}

export type ClientEvent = FsEvent | ThreadEvent
