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

export interface TargetOptions {
  worktrees: WorktreeInfo[]
  branches: BranchInfo[]
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

export type Author = 'user' | 'agent'

export interface ThreadMessage {
  id: number
  author: Author
  body: string
  createdAt: string
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
  messages: ThreadMessage[]
}

export interface FsEvent {
  type: 'fs'
  repoPath: string
  paths: string[]
}
