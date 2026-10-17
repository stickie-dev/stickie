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
  changedFiles: number
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
  /**
   * The branch under review — what identifies it, together with the repo.
   *
   * The *source* says where to read the files: a working tree, or the branch
   * itself when nothing has it checked out. That is a location and it moves —
   * a branch reviewed in a worktree and later checked out in the main clone is
   * the same work, and the same review. The branch is the work.
   */
  branch: string
  source: ReviewSource
  baseRef: string
  baseSha: string
  /**
   * The base this review had before the current one, so sliding the base is
   * one click to undo. Null when it has never moved.
   */
  prevBaseRef?: string | null
  /**
   * The merge request this review is of — at most one, and attached by hand.
   * Its discussion is read from GitLab and shown beside the review; it is not
   * copied in, because a copy forks the conversation the moment anyone
   * replies to either side of it.
   */
  mr?: { iid: number; projectPath: string } | null
  /**
   * When the review was archived: put away from the overview and from the
   * list agents are given, with every note kept. Null when it is not.
   */
  archivedAt?: string | null
  /**
   * When the reviewer said to keep it: it is then never archived or deleted
   * for being left alone. Null when it is not kept.
   */
  keptAt?: string | null
  /** the base ref has moved on from baseSha, and the pin can follow it */
  baseStale?: boolean
  /**
   * The base ref resolves to a commit that does not have baseSha in its
   * history: the source is on another line of work — a branch cut from an
   * older point, a rebase, a reset — rather than ahead of this one. Never
   * re-pinned automatically, because the notes' code is not there.
   */
  baseDiverged?: boolean
  /**
   * What this review is of is no longer in the repository: its worktree has
   * been removed, or its branch deleted. The review keeps pointing at it — the
   * notes on it were written about that work — and says so, rather than
   * quietly becoming a review of whatever is checked out now.
   */
  sourceGone?: boolean
  /**
   * The source tip is already contained in the base: everything this review is
   * of has landed. True of a merged branch, and of a review of the checkout
   * that *is* the base branch, which never had anything to review.
   */
  merged?: boolean
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
  /**
   * Which note this is inside its review — the first one is 0. This is the
   * handle the export and the MCP tools hand an agent, since a row id in the
   * thousands says nothing about which review it belongs to. Assigned once and
   * never reused, so deleting note 1 leaves 0, 2, 3 rather than moving a number
   * an agent has already been told to act on.
   */
  number: number
  path: string
  side: Side
  startLine: number
  endLine: number
  snippet: string
  /** the git blob the snippet was read from; null for an unanchored note */
  blobSha: string | null
  status: ThreadStatus
  /** pending notes are drafts of a review batch, invisible to agents */
  pending: boolean
  /** e.g. "gitlab" for imported threads */
  origin: string | null
  /**
   * The merge-request discussion this note was started from, when it was.
   * One note per discussion: the point of starting one is to have somewhere
   * to iterate, and a second one beside it is two places to look.
   */
  mrDiscussion?: string | null
  /**
   * Where the note goes in the prompt, as the reviewer arranged it. Null for
   * a note never placed; those follow the placed ones, oldest first.
   */
  promptPosition?: number | null
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
  subject: 'note' | 'review' | 'file' | 'repo'
  action: string
  /** null for rows recorded before there were actors */
  actorName: string | null
  repoId: number | null
  sessionId: number | null
  threadId: number | null
  messageId: number | null
  detail: Record<string, unknown> | null
}

export interface NoteCounts {
  total: number
  /** unresolved and submitted: the pile that is actually waiting on somebody */
  open: number
  /** written but not submitted, so no agent can see them yet */
  pending: number
  resolved: number
  /** the code the note was written against is gone */
  detached: number
}

/**
 * One review, as the overview needs it. Everything here comes from the
 * database: nothing runs git per review, or a page listing thirty reviews
 * would shell out thirty times. Changed-file counts and base staleness stay on
 * the review itself, which already knows them.
 */
export interface RevLabel {
  /** what to show: a branch name, "working tree", or a short sha */
  name: string
  /** the commit subject, truncated; null when there is no single commit to name */
  subject: string | null
}

export interface ReviewOverview {
  sessionId: number
  repoId: number
  repoName: string
  source: ReviewSource
  baseRef: string
  baseSha: string
  /** what this review compares, already in the words to show */
  comparing: { source: RevLabel; base: RevLabel }
  /** its worktree or branch is not in the repository any more */
  sourceGone?: boolean
  /** its branch is already contained in the base: the work has landed */
  merged?: boolean
  /** when it was put away from the overview; null when it is not */
  archivedAt?: string | null
  /** when it was kept from expiring; null when it is not */
  keptAt?: string | null
  /**
   * When it will be archived, and when deleted, if nothing happens in it
   * before then. Null when that will not happen: it is kept, the setting is
   * off, or (for archiving) it already is.
   */
  archivesAt?: string | null
  deletesAt?: string | null
  notes: NoteCounts
  /** how many files were opened and marked read */
  filesRead: number
  /** replies from an agent — the round-trip count */
  agentReplies: number
  lastActivityAt: string | null
  /** e.g. "note.replied", so a reader can see what moved last */
  lastAction: string | null
  lastActorName: string | null
  /**
   * Who the open notes are sitting with: 'you' when an agent has answered and
   * nobody has looked, 'agent' when the ball is in its court, null when there
   * is nothing open.
   */
  awaiting: 'you' | 'agent' | null
}

export interface RepoOverview {
  id: number
  name: string
  path: string
  branch: string
  clean: boolean
  changedFiles: number
  /** the newest review of this repo, if it has one */
  latestSessionId: number | null
  /**
   * What a review of this repository compares against by default — from
   * `origin/HEAD`, then a local master or main. The overview says so on the
   * row, since clicking it starts that review.
   */
  defaultBranch: string
}

export interface Overview {
  repos: RepoOverview[]
  /** newest review first */
  reviews: ReviewOverview[]
}

export interface FsEvent {
  type: 'fs'
  repoPath: string
  paths: string[]
}

/**
 * A repository's refs moved — a commit, a pull, a fetch, a checkout — which
 * changes what a review reads against without touching a file in it. Keyed
 * by the repository's own root, since every checkout of it shares the refs.
 */
export interface RefsEvent {
  type: 'refs'
  repoPath: string
}

/**
 * A local branch beside the branch it tracks, as of the last fetch: stickie does
 * not fetch to find out, so this is what the remote looked like then.
 */
export interface Tracking {
  branch: string
  /** e.g. origin/main */
  upstream: string
  /** commits on the branch the upstream does not have */
  ahead: number
  /** commits on the upstream the branch does not have */
  behind: number
}

export interface UpstreamState {
  base: Tracking | null
  source: Tracking | null
  /** when this repository last fetched, from any tool; null if never */
  fetchedAt: string | null
}

/** A note changed server-side, e.g. an agent replied or resolved. */
export interface ThreadEvent {
  type: 'thread'
  action: 'created' | 'updated' | 'deleted'
  sessionId: number
  /** absent when a whole batch changed at once (review submit, import) */
  threadId?: number
}

export type ClientEvent = FsEvent | ThreadEvent | RefsEvent
