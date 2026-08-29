import { create } from 'zustand'
import type {
  ChangedFile,
  FileContent,
  RepoInfo,
  ReviewSource,
  Session,
  Side,
  TargetOptions,
  Thread,
} from '@stickie/shared'
import { api } from './api'
import type {
  CommitBetween,
  NavHit,
  NoteDefault,
  RemoveMode,
  RepinMode,
  SubmitKey,
} from './api'
import { cachedFile, prefetchFile } from './fileCache'
import { flowReveal } from './flowNav'
import type { Haystack, Match } from './find'
import { findMatches as scanForMatches } from './find'
import type { TabRef } from './routes'
import {
  previous_tabs,
  restoredDrafts,
  storeDrafts,
  storeTabs,
} from './persistence'

export interface Draft {
  id: number
  repoId: number
  sessionId: number
  path: string
  side: Side
  startLine: number
  endLine: number
  body: string
}

export interface Tab {
  id: number
  kind: 'flow' | 'file' | 'commits'
  repoId: number
  /** file tabs only */
  path?: string
}

let tab_seq = 0

export interface CommitView {
  repoId: number
  /** oldest first, so columns read left to right in time */
  shas: string[]
  files: { path: string; shas: string[] }[]
}

export interface NavEntry {
  repoId: number
  path: string
  line: number
}

const nav_history_cap = 50
let nav_restoring = false

let draft_seq = 0

export type Theme = 'dark' | 'light'

export interface Toast {
  id: number
  kind: 'error' | 'info'
  text: string
}

let toast_seq = 0

function initialTheme(): Theme {
  const stored = localStorage.getItem('stickie-theme')
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

interface ReviewState {
  repos: RepoInfo[]
  /**
   * Whether the repository list has been read yet. An empty list means "this
   * workspace has no repositories", which is a different thing from "nobody
   * has looked" — and the root page acts on it, offering to add the first one.
   * Without this it offers that on every cold load, for as long as the fetch
   * takes.
   */
  reposLoaded: boolean
  activeRepoId: number | null
  targets: TargetOptions | null
  source: ReviewSource | null
  baseRef: string | undefined
  session: Session | null
  allFiles: string[] | null
  showAll: boolean
  selectedPath: string | null
  selectedStatus: ChangedFile['status'] | 'unchanged' | null
  baseContent: FileContent | null
  sourceContent: FileContent | null
  /** a newer file is on its way; the previous one stays on screen until then */
  fileLoading: boolean
  threads: Thread[]
  viewed: Set<string>
  drafts: Draft[]
  activeDraftId: number | null
  replyDrafts: Record<number, string>
  activeReplyId: number | null
  activeReplyRepoId: number | null
  error: string | null
  connected: boolean
  promptCopied: boolean
  theme: Theme
  /**
   * Where the next editor to mount should go. `column` and `length` come from
   * a find match, so the match itself is selected rather than the line being
   * centred and the reader left to spot it.
   */
  reveal: {
    path: string
    line: number
    side?: Side
    column?: number
    length?: number
  } | null
  /**
   * The note a note address asked for, by row id, marked until the reader
   * moves. Landing on its line is not enough on its own: a line can carry
   * several notes, and a whole-file note has no line at all.
   */
  noteHighlight: number | null
  usages: { name: string; scope: 'repo' | 'workspace'; hits: NavHit[] } | null
  toasts: Toast[]
  navHistory: NavEntry[]
  navIndex: number
  sidePane: { repoId: number; repoName: string; path: string; line: number } | null
  searchOpen: boolean
  /**
   * Whether the review workspace is the page on screen. It stays mounted
   * under the other pages, so anything listening on `window` has to ask:
   * `inert` withholds focus from a subtree, not events from `window`.
   */
  reviewActive: boolean
  /** flow = continuous GitLab-style scroll of every changed file */
  viewMode: 'flow' | 'file' | 'commits'
  /**
   * The commit timeline: one tab per repo showing the selected commits as
   * columns of the same file. Selecting commits never moves the review
   * target — that stays the source/base pickers' job.
   */
  /** commits between base and source, newest first; shared by the sidebar
   * list and the timeline that reads their subjects */
  commits: CommitBetween[]
  loadCommits: () => Promise<void>
  commitView: CommitView | null
  selectCommits: (shas: string[]) => Promise<void>
  tabs: Tab[]
  activeTabId: number | null
  /** bumped when watched files change so flow sections refetch content */
  contentEpoch: number
  /**
   * What the workspace holds per registered repository — the tree shows all of
   * them, so each needs its own review and its own changed files. `files` here
   * is the *only* copy, including for the repository being reviewed; read it
   * through `repoFiles` / `activeFiles` rather than caching it a second time.
   */
  repoSessions: Record<
    number,
    {
      sessionId: number
      files: ChangedFile[]
      openCount: number
      allFiles: string[] | null
      showAll: boolean
      expanded: boolean
    }
  >
  perRepo: Record<number, { source: ReviewSource; baseRef?: string; selectedPath?: string }>

  pushToast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
  openUsages: (name: string, scope: 'repo' | 'workspace') => Promise<void>
  closeUsages: () => void
  openHit: (hit: NavHit) => Promise<void>
  openRef: (path: string, line: number) => Promise<void>
  openRefTarget: (
    repoName: string | null,
    path: string,
    line: number,
  ) => Promise<void>
  navBack: () => Promise<void>
  navForward: () => Promise<void>
  /**
   * Lands on what an address names. Nothing here reads the address itself —
   * the shell hands over the review and the tab it asked for. False when that
   * review no longer exists, which is the shell's cue to send the reader home.
   */
  openAddress: (reviewId: number, tab: TabRef) => Promise<boolean>
  /**
   * Lands on one note of a review, by the number it carries there, and marks
   * it so the reader can see which note the link meant. Answers with the note,
   * so the shell knows which tab the address settled on.
   */
  openNote: (reviewId: number, note: number) => Promise<Thread | null>
  clearNoteHighlight: () => void
  openFileInRepo: (
    repoId: number,
    path: string,
    status?: ChangedFile['status'] | 'unchanged',
  ) => Promise<void>
  flowSelect: (path: string) => void
  setViewMode: (mode: 'flow' | 'file') => Promise<void>
  activateTab: (id: number) => Promise<void>
  closeTab: (id: number) => void
  toggleRepoExpanded: (repoId: number) => void
  toggleRepoShowAll: (repoId: number) => Promise<void>
  openSide: (repoId: number, path: string, line: number) => void
  openHitSide: (hit: NavHit) => void
  closeSide: () => void
  setSearchOpen: (open: boolean) => void
  setReviewActive: (active: boolean) => void
  clearReveal: () => void
  toggleTheme: () => void
  /**
   * `start` is what the address asked for, so restoring tabs settles there
   * instead of fighting the router for it.
   */
  init: (start?: { reviewId: number; tab: TabRef }) => Promise<void>
  addRepo: (path: string) => Promise<void>
  removeRepo: (
    repoId: number,
    mode: RemoveMode,
  ) => Promise<{ deleted: boolean; notes: number }>
  selectRepo: (repoId: number) => Promise<void>
  setSource: (source: ReviewSource, baseRef?: string) => Promise<void>
  setBase: (baseRef: string | undefined) => Promise<void>
  openFile: (path: string, status?: ChangedFile['status'] | 'unchanged') => Promise<void>
  setShowAll: (showAll: boolean) => Promise<void>
  startDraft: (side: Side, startLine: number, endLine: number) => void
  updateDraftBody: (id: number, body: string) => void
  /** the lines a note is anchored to, corrected by hand after a selection */
  setDraftRange: (id: number, startLine: number, endLine: number) => void
  insertDraftRef: (
    path: string,
    startLine: number,
    endLine: number,
    captureRepoId?: number,
  ) => void
  setActiveDraft: (id: number) => void
  /**
   * Which draft has its send-menu open, if any. In the store rather than in the
   * component because a form inside a Monaco view zone does not keep state of
   * its own — the same reason the draft body and the reply text live here.
   */
  splitMenuFor: string | null
  setSplitMenu: (key: string | null) => void
  /**
   * How a diff is drawn. Both used to be state inside the file view, which put
   * them out of reach of anything else and lost them on every tab switch —
   * they are choices about reading, and they belong to the reader, not to
   * whichever file happens to be open.
   *
   * `sideBySide` is null until it is chosen, and then the window's width
   * decides: wide enough for two columns, or not.
   */
  sideBySide: boolean | null
  setSideBySide: (side: boolean | null) => void
  /**
   * Find, in the review that is open. `matches` is every occurrence across the
   * diff's files, so the count is a real count and every editor can highlight
   * its own — Monaco's find is per editor, and a diff is many.
   */
  findOpen: boolean
  findQuery: string
  findCase: boolean
  findMatches: Match[]
  findAt: number
  findCapped: boolean
  findBusy: boolean
  openFind: (open: boolean) => void
  setFindQuery: (query: string) => Promise<void>
  setFindCase: (on: boolean) => Promise<void>
  stepFind: (delta: number) => Promise<void>
  goToMatch: (index: number) => Promise<void>
  collapseUnchanged: boolean
  setCollapseUnchanged: (collapse: boolean) => void
  setActiveReply: (threadId: number | null) => void
  updateReplyDraft: (threadId: number, body: string) => void
  cancelDraft: (id: number) => void
  submitDraft: (id: number, as?: NoteDefault) => Promise<void>
  repin: (automatic?: boolean) => Promise<void>
  importMr: (mr: string) => Promise<void>
  submitReview: () => Promise<void>
  postThread: (threadId: number) => Promise<void>
  toggleViewed: (path: string) => Promise<void>
  reply: (threadId: number, body: string) => Promise<void>
  editMessage: (threadId: number, messageId: number, body: string) => Promise<void>
  deleteThread: (threadId: number) => Promise<void>
  deleteMessage: (threadId: number, messageId: number) => Promise<void>
  commentsOpen: boolean
  toggleComments: () => void
  activityOpen: boolean
  toggleActivity: () => void
  resolveThread: (threadId: number) => Promise<void>
  reopenThread: (threadId: number) => Promise<void>
  copyPrompt: () => Promise<void>
  /** notes with no code anchor: on the open file, or on the review itself */
  /**
   * A note with no code under it — on a file, or on the review. It takes the
   * same draft-or-comment choice as one written on a line: it went out as
   * whatever the server defaulted to, which made the panel the one place in the
   * app where that setting did not apply.
   */
  addNote: (
    scope: 'review' | 'file',
    body: string,
    as?: NoteDefault,
  ) => Promise<void>
  /** the order Copy prompt uses; ids not listed follow by age */
  promptOrder: number[]
  moveInPromptOrder: (threadId: number, delta: number) => void
  /** comma-separated extensions that open soft-wrapped, from settings */
  wrapExtensions: string
  setWrapExtensions: (extensions: string) => void
  /**
   * Who moves a review's base pin when it goes stale. Null until the settings
   * have been read: this one decides whether to act, so it must not carry a
   * default that acts before the stored answer has arrived.
   */
  repinMode: RepinMode | null
  setRepinMode: (mode: RepinMode) => void
  /**
   * What removing a repository does to the reviews in it. Null until the
   * settings have been read, for the same reason: what the user is asked to
   * confirm has to be what will happen, so nothing may offer the choice while
   * the stored answer is still on its way.
   */
  removeMode: RemoveMode | null
  /** whether Enter posts a comment or only ⌘/ctrl+Enter does, from settings */
  submitKey: SubmitKey
  setSubmitKey: (key: SubmitKey) => void
  /**
   * Whether a new note is a draft or goes to the agent at once. Draft unless
   * told otherwise: a draft can still be posted, where a posted note cannot be
   * taken back.
   */
  noteDefault: NoteDefault
  setNoteDefault: (value: NoteDefault) => void
  /** takes the choice and stores it, so the button keeps saying it */
  rememberNoteDefault: (value: NoteDefault) => Promise<void>
  /** per-file wrap decisions taken from the editor's context menu */
  wrapOverrides: Record<string, boolean>
  toggleWrap: (path: string) => void
  /**
   * One decision for every file on screen. The per-file toggle stays, and this
   * simply writes the same override across the flow — otherwise a reader who
   * wants prose wrapped everywhere has to say so once per file.
   */
  setWrapAll: (paths: string[], wrap: boolean) => void
  /** ask the tree to expand and show a folder (the status bar's path) */
  revealDir: { repoId: number; dir: string } | null
  openDir: (repoId: number, dir: string) => Promise<void>
  clearRevealDir: () => void
  refresh: (repoPath: string) => Promise<void>
  syncThreads: (sessionId: number) => Promise<void>
  setConnected: (connected: boolean) => void
}

function statusOf(
  files: ChangedFile[],
  path: string,
): ChangedFile['status'] | 'unchanged' {
  return files.find((f) => f.path === path)?.status ?? 'unchanged'
}

/** One identity, so a selector falling back to it does not force a render. */
const no_files: ChangedFile[] = []

/**
 * What has changed in one repository. It is held per repository because the
 * tree shows every registered one, not only the one being reviewed — and it is
 * held *there only*. The active repo used to keep a second copy at the root of
 * the store, which is what let the tree read "no changes" beside a diff full of
 * files: `refresh` and `repin` wrote the root copy and left the per-repo one
 * where it was.
 */
export function repoFiles(
  state: ReviewState,
  repoId: number | null,
): ChangedFile[] {
  if (repoId === null) return no_files
  return state.repoSessions[repoId]?.files ?? no_files
}

/** The changed files of the repository under review. */
export function activeFiles(state: ReviewState): ChangedFile[] {
  return repoFiles(state, state.activeRepoId)
}

/** Kept in step with the server's own default until settings are read. */
const default_wrap_extensions = 'md,markdown,txt,rst,csv,log,json'

/** Whether a file opens soft-wrapped: the file's own choice, else its type. */
export function wrapFor(
  path: string,
  extensions: string,
  overrides: Record<string, boolean>,
): boolean {
  const chosen = overrides[path]
  if (chosen !== undefined) return chosen
  const name = (path.split('/').at(-1) ?? '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  const ext = name.slice(dot + 1)
  return extensions
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, ''))
    .includes(ext)
}

/**
 * The prompt order as ids: whatever the user arranged, then anything newer
 * that has not been placed yet.
 */
export function orderedThreadIds(
  threads: Thread[],
  order: number[],
): number[] {
  const known = new Set(threads.map((t) => t.id))
  const placed = order.filter((id) => known.has(id))
  const rest = threads
    .map((t) => t.id)
    .filter((id) => !placed.includes(id))
  return [...placed, ...rest]
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useReview = create<ReviewState>((set, get) => {
  async function startSession(): Promise<void> {
    const { activeRepoId, source, baseRef } = get()
    if (activeRepoId === null || source === null) return
    try {
      const session = await api.createSession(activeRepoId, source, baseRef)
      const [files, threads, viewed] = await Promise.all([
        api.diff(session.id),
        api.threads(session.id, true),
        api.viewed(session.id),
      ])
      const entry = get().repoSessions[activeRepoId]
      set({
        session,
        threads,
        viewed: new Set(viewed),
        allFiles: null,
        selectedPath: null,
        baseContent: null,
        sourceContent: null,
        error: null,
        repoSessions: {
          ...get().repoSessions,
          [activeRepoId]: {
            sessionId: session.id,
            files,
            openCount: threads.filter((t) => t.status === 'open').length,
            allFiles: entry?.allFiles ?? null,
            showAll: entry?.showAll ?? false,
            expanded: entry?.expanded ?? true,
          },
        },
      })
      const flow_tab = ensureFlowTab(activeRepoId)
      if (get().viewMode === 'flow') {
        set({ activeTabId: flow_tab.id })
      }
      const first = files[0]
      if (first !== undefined) {
        if (get().viewMode === 'flow') {
          get().flowSelect(first.path)
        } else {
          await get().openFile(first.path, first.status)
        }
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Patches what the workspace holds for one repository. Everything that
   * re-reads a diff goes through here, so the tree and the diff cannot end up
   * describing different states of the same repository.
   */
  function updateRepoSession(
    repoId: number,
    patch: Partial<ReviewState['repoSessions'][number]>,
  ): void {
    const entry = get().repoSessions[repoId]
    if (entry === undefined) return
    set({
      repoSessions: { ...get().repoSessions, [repoId]: { ...entry, ...patch } },
    })
  }

  async function ensureRepoSession(repoId: number): Promise<void> {
    try {
      const targets = await api.targets(repoId)
      const cached = get().perRepo[repoId]
      const main = targets.worktrees.find((wt) => wt.isMain)
      const source: ReviewSource =
        cached?.source ??
        (main !== undefined
          ? { kind: 'worktree', value: main.path }
          : { kind: 'ref', value: targets.defaultBranch })
      const session = await api.createSession(repoId, source, cached?.baseRef)
      const [files, threads] = await Promise.all([
        api.diff(session.id),
        api.threads(session.id, true),
      ])
      const existing = get().repoSessions[repoId]
      set({
        perRepo: { ...get().perRepo, [repoId]: { ...cached, source } },
        repoSessions: {
          ...get().repoSessions,
          [repoId]: {
            sessionId: session.id,
            files,
            openCount: threads.filter((t) => t.status === 'open').length,
            allFiles: existing?.allFiles ?? null,
            showAll: existing?.showAll ?? false,
            expanded: existing?.expanded ?? true,
          },
        },
      })
    } catch (error) {
      get().pushToast('error', `workspace: ${message(error)}`)
    }
  }

  /**
   * Points a repository at one particular review, named by id, and answers
   * with it. An address names the review, so following a link has to be able
   * to move a repo onto a (source, base) pair the reader was not on — the
   * pickers' choice is remembered in `perRepo`, and this is what overrides it.
   *
   * `createSession` inside `selectRepo` is get-or-create keyed on exactly that
   * pair, so it finds this review again rather than starting another.
   */
  async function openReview(reviewId: number): Promise<Session | null> {
    const already = get().session
    if (already?.id === reviewId) return already
    let review: Session
    try {
      review = await api.session(reviewId)
    } catch {
      return null
    }
    set({
      perRepo: {
        ...get().perRepo,
        [review.repoId]: {
          ...get().perRepo[review.repoId],
          source: review.source,
          baseRef: review.baseRef,
        },
      },
    })
    await get().selectRepo(review.repoId)
    return get().session
  }

  /** Brings back notes that were being written when the page went away. */
  function restoreDrafts(repos: RepoInfo[]): void {
    const drafts = restoredDrafts(
      repos,
      (repoId) => get().repoSessions[repoId]?.sessionId,
      () => {
        draft_seq += 1
        return draft_seq
      },
    )
    if (drafts.length === 0) return
    set({ drafts, activeDraftId: drafts.at(-1)?.id ?? null })
  }

  /**
   * Reopens the tabs of the previous session and lands on one of them; false
   * when there was nothing to reopen and no address to honour. An address wins
   * over the tab that was last active, and can name a tab the stored set does
   * not have — following a link has to work on a machine that has never opened
   * that file.
   */
  async function restoreTabs(
    repos: RepoInfo[],
    addressed?: { reviewId: number; tab: TabRef },
  ): Promise<boolean> {
    const stored = previous_tabs
    const restored: Tab[] = []
    for (const entry of stored?.tabs ?? []) {
      const repo = repos.find((r) => r.path === entry.repo)
      if (repo === undefined) continue
      if (entry.kind === 'file' && entry.path === undefined) continue
      tab_seq += 1
      restored.push({
        id: tab_seq,
        kind: entry.kind,
        repoId: repo.id,
        ...(entry.path === undefined ? {} : { path: entry.path }),
      })
    }
    if (restored.length > 0) set({ tabs: restored })
    if (addressed !== undefined) {
      // false only if that review is gone, in which case fall through to the
      // tabs that were open, rather than landing on nothing
      if (await get().openAddress(addressed.reviewId, addressed.tab)) return true
    }
    const wanted = restored[stored?.active ?? 0] ?? restored[0]
    if (wanted === undefined) return false
    await get().activateTab(wanted.id)
    return true
  }

  /**
   * Runs the current query over the review's files.
   *
   * It reads the same contents the diff is built from, through the same cache,
   * so a file already on screen costs nothing and a file further down costs one
   * read that the diff would have made anyway. Source side, because that is
   * what is being reviewed; a file that only exists on the base side (deleted)
   * is searched there instead, or it could not be found at all.
   */
  async function runFind(): Promise<void> {
    const { session, findQuery, findCase, contentEpoch } = get()
    const files = activeFiles(get())
    const query = findQuery
    if (session === null || query === '') {
      set({ findMatches: [], findAt: 0, findCapped: false, findBusy: false })
      return
    }
    set({ findBusy: true })
    const haystacks: Haystack[] = []
    for (const file of files) {
      const side: Side = file.status === 'deleted' ? 'base' : 'source'
      try {
        const content = await cachedFile(
          session.id,
          contentEpoch,
          file.path,
          side,
        )
        if (content.content !== null && !content.binary) {
          haystacks.push({ path: file.path, side, content: content.content })
        }
      } catch {
        // an unreadable file is not a reason to have no results
      }
    }
    // the query may have moved on while those reads were in flight
    if (get().findQuery !== query || get().findCase !== findCase) return
    const { matches, capped } = scanForMatches(haystacks, query, findCase)
    set({
      findMatches: matches,
      findAt: 0,
      findCapped: capped,
      findBusy: false,
    })
    if (matches.length > 0) await get().goToMatch(0)
  }

  /** Keeps the files either side of the open one warm, so j/k lands instantly. */
  function prefetchNeighbours(path: string): void {
    const { session, contentEpoch } = get()
    if (session === null) return
    const files = activeFiles(get())
    const index = files.findIndex((f) => f.path === path)
    if (index === -1) return
    for (const step of [1, -1]) {
      const neighbour = files[index + step]
      if (neighbour === undefined) continue
      if (neighbour.status !== 'added' && neighbour.status !== 'untracked') {
        prefetchFile(
          session.id,
          contentEpoch,
          neighbour.oldPath ?? neighbour.path,
          'base',
        )
      }
      if (neighbour.status !== 'deleted') {
        prefetchFile(session.id, contentEpoch, neighbour.path, 'source')
      }
    }
  }

  function ensureFlowTab(repoId: number): Tab {
    const existing = get().tabs.find(
      (t) => t.kind === 'flow' && t.repoId === repoId,
    )
    if (existing !== undefined) return existing
    tab_seq += 1
    const tab: Tab = { id: tab_seq, kind: 'flow', repoId }
    set({ tabs: [...get().tabs, tab] })
    return tab
  }

  function ensureCommitsTab(repoId: number): Tab {
    const existing = get().tabs.find(
      (t) => t.kind === 'commits' && t.repoId === repoId,
    )
    if (existing !== undefined) return existing
    tab_seq += 1
    const tab: Tab = { id: tab_seq, kind: 'commits', repoId }
    set({ tabs: [...get().tabs, tab] })
    return tab
  }

  function ensureFileTab(repoId: number, path: string): Tab {
    const existing = get().tabs.find(
      (t) => t.kind === 'file' && t.repoId === repoId && t.path === path,
    )
    if (existing !== undefined) return existing
    tab_seq += 1
    const tab: Tab = { id: tab_seq, kind: 'file', repoId, path }
    set({ tabs: [...get().tabs, tab] })
    return tab
  }

  function recordNav(path: string, line: number): void {
    if (nav_restoring) return
    const { activeRepoId, navHistory, navIndex } = get()
    if (activeRepoId === null) return
    const current = navHistory[navIndex]
    if (
      current !== undefined &&
      current.repoId === activeRepoId &&
      current.path === path &&
      current.line === line
    ) {
      return
    }
    const entries = [
      ...navHistory.slice(0, navIndex + 1),
      { repoId: activeRepoId, path, line },
    ].slice(-nav_history_cap)
    set({ navHistory: entries, navIndex: entries.length - 1 })
  }

  async function restoreNav(
    entry: NavEntry | undefined,
    index: number,
  ): Promise<void> {
    if (entry === undefined) return
    nav_restoring = true
    try {
      if (entry.repoId !== get().activeRepoId) {
        await get().selectRepo(entry.repoId)
      }
      await get().openFile(entry.path)
      set({ reveal: { path: entry.path, line: entry.line }, navIndex: index })
    } finally {
      nav_restoring = false
    }
  }

  return {
    repos: [],
    reposLoaded: false,
    activeRepoId: null,
    targets: null,
    source: null,
    baseRef: undefined,
    session: null,
    allFiles: null,
    showAll: false,
    selectedPath: null,
    selectedStatus: null,
    baseContent: null,
    sourceContent: null,
    fileLoading: false,
    threads: [],
    viewed: new Set<string>(),
    drafts: [],
    activeDraftId: null,
    replyDrafts: {},
    activeReplyId: null,
    activeReplyRepoId: null,
    error: null,
    connected: false,
    promptCopied: false,
    theme: initialTheme(),
    reveal: null,
    noteHighlight: null,
    splitMenuFor: null,
    sideBySide: null,
    collapseUnchanged: true,
    findOpen: false,
    findQuery: '',
    findCase: false,
    findMatches: [],
    findAt: 0,
    findCapped: false,
    findBusy: false,
    usages: null,
    toasts: [],
    navHistory: [],
    navIndex: -1,
    sidePane: null,
    searchOpen: false,
    reviewActive: false,
    activityOpen: false,
    viewMode: 'flow',
    commits: [],
    commitView: null,
    tabs: [],
    activeTabId: null,
    contentEpoch: 0,
    revealDir: null,
    wrapExtensions: default_wrap_extensions,
    repinMode: null,
    removeMode: null,
    submitKey: 'enter',
    noteDefault: 'draft',
    wrapOverrides: {},
    repoSessions: {},
    perRepo: {},

    pushToast: (kind, text) => {
      toast_seq += 1
      const toast: Toast = { id: toast_seq, kind, text }
      set({ toasts: [...get().toasts, toast] })
      setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== toast.id) })
      }, 5000)
    },

    dismissToast: (id) => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    },

    openUsages: async (name, scope) => {
      const { session } = get()
      if (session === null) return
      try {
        const hits = await api.references(session.id, name, scope)
        set({ usages: { name, scope, hits } })
      } catch (error) {
        get().pushToast('error', `usages: ${message(error)}`)
      }
    },

    closeUsages: () => set({ usages: null }),

    openHit: async (hit) => {
      const { session, repos } = get()
      const active_root =
        session === null
          ? null
          : session.source.kind === 'worktree'
            ? session.source.value
            : session.repoPath
      if (session !== null && hit.repoPath !== active_root) {
        const target =
          repos.find((r) => r.path === hit.repoPath) ??
          repos.find((r) => hit.repoPath.startsWith(r.path))
        if (target === undefined) return
        await get().selectRepo(target.id)
      }
      await get().openRef(hit.path, hit.line)
    },

    openRef: async (path, line) => {
      await get().openFile(path)
      set({ reveal: { path, line } })
      recordNav(path, line)
    },

    openRefTarget: async (repoName, path, line) => {
      const { repos, activeRepoId } = get()
      if (repoName !== null) {
        const target = repos.find((r) => r.name === repoName)
        if (target === undefined) {
          get().pushToast('error', `unknown repo in reference: ${repoName}`)
          return
        }
        if (target.id !== activeRepoId) {
          await get().selectRepo(target.id)
        }
      }
      await get().openRef(path, line)
    },

    openSide: (repoId, path, line) => {
      const name = get().repos.find((r) => r.id === repoId)?.name ?? ''
      set({ sidePane: { repoId, repoName: name, path, line } })
    },

    closeSide: () => set({ sidePane: null }),

    openHitSide: (hit) => {
      const { repos, activeRepoId } = get()
      const repo =
        repos.find((r) => r.path === hit.repoPath) ??
        repos.find((r) => hit.repoPath.startsWith(r.path + '/')) ??
        repos.find((r) => r.id === activeRepoId)
      if (repo === undefined) return
      get().openSide(repo.id, hit.path, hit.line)
    },

    setSearchOpen: (open) => set({ searchOpen: open }),
    setWrapExtensions: (extensions) => set({ wrapExtensions: extensions }),
    setRepinMode: (mode) => set({ repinMode: mode }),
    setSubmitKey: (key) => set({ submitKey: key }),
    setNoteDefault: (value) => set({ noteDefault: value }),

    rememberNoteDefault: async (value) => {
      set({ noteDefault: value })
      try {
        await api.saveSettings({ noteDefault: value })
      } catch (error) {
        // the choice still applies to this note; only the memory of it failed
        get().pushToast('error', `settings: ${message(error)}`)
      }
    },
    setReviewActive: (active) => set({ reviewActive: active }),

    navBack: async () => {
      const { navHistory, navIndex } = get()
      if (navIndex <= 0) return
      await restoreNav(navHistory[navIndex - 1], navIndex - 1)
    },

    navForward: async () => {
      const { navHistory, navIndex } = get()
      if (navIndex >= navHistory.length - 1) return
      await restoreNav(navHistory[navIndex + 1], navIndex + 1)
    },

    clearReveal: () => set({ reveal: null }),

    toggleTheme: () => {
      const theme = get().theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('stickie-theme', theme)
      set({ theme })
    },

    init: async (start) => {
      try {
        void api
          .settings()
          .then((settings) =>
            set({
              wrapExtensions: settings.wrapExtensions,
              repinMode: settings.repinMode,
              removeMode: settings.removeMode,
              submitKey: settings.submitKey,
              noteDefault: settings.noteDefault,
            }),
          )
          .catch(() => undefined)
        const repos = await api.repos()
        set({ repos, reposLoaded: true })
        await Promise.all(repos.map((r) => ensureRepoSession(r.id)))
        restoreDrafts(repos)
        if (await restoreTabs(repos, start)) return
        const first = repos[0]
        if (first !== undefined) {
          await get().selectRepo(first.id)
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    openAddress: async (reviewId, tab) => {
      const review = await openReview(reviewId)
      if (review === null) return false
      const repoId = review.repoId
      if (tab.kind === 'diff') {
        set({ viewMode: 'flow', activeTabId: ensureFlowTab(repoId).id })
        return true
      }
      if (tab.kind === 'commits') {
        // an address names the commits tab, never which commits are in it:
        // that stays the sidebar's choice
        set({ viewMode: 'commits', activeTabId: ensureCommitsTab(repoId).id })
        return true
      }
      try {
        await get().openFile(tab.path)
      } catch (error) {
        // a pasted link can name a file this review does not have
        get().pushToast('error', `${tab.path}: ${message(error)}`)
        return true
      }
      if (tab.line !== undefined) {
        set({
          reveal: {
            path: tab.path,
            line: tab.line,
            ...(tab.side === undefined ? {} : { side: tab.side }),
          },
        })
      }
      return true
    },

    openNote: async (reviewId, number) => {
      const review = await openReview(reviewId)
      if (review === null) return null
      let note: Thread
      try {
        note = await api.noteByNumber(reviewId, number)
      } catch {
        return null
      }
      // a note with no code anchor belongs to the whole file or the whole
      // review; there is no line to land on, so the diff is where it reads
      if (note.startLine === 0 || note.path === '') {
        set({
          viewMode: 'flow',
          activeTabId: ensureFlowTab(review.repoId).id,
          noteHighlight: note.id,
        })
        return note
      }
      try {
        await get().openFile(note.path)
      } catch (error) {
        get().pushToast('error', `${note.path}: ${message(error)}`)
        return note
      }
      set({
        reveal: { path: note.path, line: note.startLine, side: note.side },
        noteHighlight: note.id,
      })
      return note
    },

    clearNoteHighlight: () => {
      if (get().noteHighlight !== null) set({ noteHighlight: null })
    },

    openFileInRepo: async (repoId, path, status) => {
      if (repoId !== get().activeRepoId) {
        await get().selectRepo(repoId)
      }
      // changed files review in the continuous flow; anything else (all-files
      // browsing, unchanged refs) opens the single-file view
      const changed = activeFiles(get()).some((f) => f.path === path)
      if (get().viewMode === 'flow' && changed) {
        get().flowSelect(path)
      } else {
        await get().openFile(path, status)
      }
    },

    flowSelect: (path) => {
      const { activeRepoId } = get()
      const files = activeFiles(get())
      const flow_tab =
        activeRepoId === null ? null : ensureFlowTab(activeRepoId)
      set({
        viewMode: 'flow',
        selectedPath: path,
        selectedStatus: statusOf(files, path),
        activeTabId: flow_tab?.id ?? get().activeTabId,
      })
      recordNav(path, 1)
      if (activeRepoId !== null) {
        const perRepo = get().perRepo
        const entry = perRepo[activeRepoId]
        if (entry !== undefined) {
          set({
            perRepo: {
              ...perRepo,
              [activeRepoId]: { ...entry, selectedPath: path },
            },
          })
        }
      }
    },

    loadCommits: async () => {
      const { session } = get()
      if (session === null) {
        set({ commits: [] })
        return
      }
      try {
        const commits = await api.commits(session.id)
        if (get().session?.id === session.id) set({ commits })
      } catch {
        set({ commits: [] })
      }
    },

    selectCommits: async (shas) => {
      const repoId = get().activeRepoId
      if (repoId === null) return
      if (shas.length === 0) {
        set({ commitView: null })
        return
      }
      set({
        commitView: { repoId, shas, files: [] },
        viewMode: 'commits',
        activeTabId: ensureCommitsTab(repoId).id,
      })
      let files: { path: string; shas: string[] }[]
      try {
        files = await api.commitFiles(repoId, shas)
      } catch (error) {
        get().pushToast('error', `commits: ${message(error)}`)
        return
      }
      const view = get().commitView
      if (view === null || view.shas !== shas) return
      set({ commitView: { ...view, files } })
    },

    activateTab: async (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (tab === undefined) return
      if (tab.repoId !== get().activeRepoId) {
        await get().selectRepo(tab.repoId)
      }
      if (tab.kind === 'flow') {
        set({ viewMode: 'flow', activeTabId: tab.id })
      } else if (tab.kind === 'commits') {
        set({ viewMode: 'commits', activeTabId: tab.id })
      } else if (tab.path !== undefined) {
        await get().openFile(tab.path)
      }
    },

    closeTab: (id) => {
      const { tabs, activeTabId } = get()
      const closing = tabs.find((t) => t.id === id)
      if (closing === undefined) return
      const remaining = tabs.filter((t) => t.id !== id)
      set({
        tabs: remaining,
        ...(closing.kind === 'commits' ? { commitView: null } : {}),
      })
      if (activeTabId === id) {
        const fallback =
          remaining.find(
            (t) => t.kind === 'flow' && t.repoId === closing.repoId,
          ) ?? remaining.at(-1)
        if (fallback !== undefined) {
          void get().activateTab(fallback.id)
        } else {
          set({ activeTabId: null })
        }
      }
    },

    setViewMode: async (mode) => {
      set({ viewMode: mode })
      const { selectedPath } = get()
      if (mode === 'file' && selectedPath !== null) {
        await get().openFile(selectedPath)
      }
    },

    toggleRepoExpanded: (repoId) => {
      const entry = get().repoSessions[repoId]
      if (entry === undefined) return
      set({
        repoSessions: {
          ...get().repoSessions,
          [repoId]: { ...entry, expanded: !entry.expanded },
        },
      })
    },

    toggleRepoShowAll: async (repoId) => {
      const entry = get().repoSessions[repoId]
      if (entry === undefined) return
      const showAll = !entry.showAll
      let allFiles = entry.allFiles
      if (showAll && allFiles === null) {
        allFiles = await api.tree(entry.sessionId).catch(() => [])
      }
      set({
        repoSessions: {
          ...get().repoSessions,
          [repoId]: { ...entry, showAll, allFiles },
        },
      })
    },

    addRepo: async (path) => {
      const created = await api.addRepo(path)
      const repos = await api.repos()
      set({ repos, reposLoaded: true })
      await ensureRepoSession(created.id)
      await get().selectRepo(created.id)
    },

    /**
     * Takes a repository out of the workspace and drops everything the
     * workspace was holding for it: its tabs, its session, its per-repo
     * choices. Reviews of it are gone from the server either way — deleted, or
     * kept but out of reach until the path is added back — so a tab pointing
     * at one would fail on its next read.
     */
    removeRepo: async (repoId, mode) => {
      const answer = await api.removeRepo(repoId, mode)
      const repos = await api.repos()
      const tabs = get().tabs.filter((tab) => tab.repoId !== repoId)
      const sessions = { ...get().repoSessions }
      const per_repo = { ...get().perRepo }
      delete sessions[repoId]
      delete per_repo[repoId]
      const active = get().activeTabId
      set({
        repos,
        tabs,
        repoSessions: sessions,
        perRepo: per_repo,
        activeTabId: tabs.some((tab) => tab.id === active)
          ? active
          : (tabs[0]?.id ?? null),
        ...(get().activeRepoId === repoId
          ? { activeRepoId: null, session: null, threads: [] }
          : {}),
      })
      return answer
    },

    selectRepo: async (repoId) => {
      const targets = await api.targets(repoId)
      const cached = get().perRepo[repoId]
      const main = targets.worktrees.find((wt) => wt.isMain)
      const source: ReviewSource =
        cached?.source ??
        (main !== undefined
          ? { kind: 'worktree', value: main.path }
          : { kind: 'ref', value: targets.defaultBranch })
      set({
        activeRepoId: repoId,
        targets,
        source,
        baseRef: cached?.baseRef,
        showAll: false,
        perRepo: {
          ...get().perRepo,
          [repoId]: { ...cached, source, baseRef: cached?.baseRef },
        },
      })
      await startSession()
      const remembered = get().perRepo[repoId]?.selectedPath
      if (remembered !== undefined && remembered !== get().selectedPath) {
        await get().openFile(remembered).catch(() => undefined)
      }
    },

    setSource: async (source, baseRef) => {
      const repoId = get().activeRepoId
      set({ source, baseRef })
      if (repoId !== null) {
        set({
          perRepo: {
            ...get().perRepo,
            [repoId]: { ...get().perRepo[repoId], source, baseRef },
          },
        })
      }
      await startSession()
    },

    setBase: async (baseRef) => {
      const { activeRepoId, source } = get()
      set({ baseRef })
      if (activeRepoId !== null && source !== null) {
        set({
          perRepo: {
            ...get().perRepo,
            [activeRepoId]: { ...get().perRepo[activeRepoId], source, baseRef },
          },
        })
      }
      await startSession()
    },

    openFile: async (path, status) => {
      const { session, contentEpoch } = get()
      if (session === null) return
      const files = activeFiles(get())
      const resolved = status ?? statusOf(files, path)
      // the draft survives navigation so other files can be browsed and
      // referenced while composing
      const repo_for_tab = get().activeRepoId
      set({
        selectedPath: path,
        selectedStatus: resolved,
        fileLoading: true,
        viewMode: 'file',
        activeTabId:
          repo_for_tab === null
            ? get().activeTabId
            : ensureFileTab(repo_for_tab, path).id,
      })
      const oldPath =
        files.find((f) => f.path === path)?.oldPath ?? path
      const wantBase = resolved !== 'added' && resolved !== 'untracked'
      const wantSource = resolved !== 'deleted'
      const [base, source] = await Promise.all([
        wantBase
          ? cachedFile(session.id, contentEpoch, oldPath, 'base')
          : Promise.resolve(null),
        wantSource
          ? cachedFile(session.id, contentEpoch, path, 'source')
          : Promise.resolve(null),
      ])
      // ignore stale responses after a quick file switch
      if (get().selectedPath !== path) return
      set({ baseContent: base, sourceContent: source, fileLoading: false })
      prefetchNeighbours(path)
      recordNav(path, 1)
      const repoId = get().activeRepoId
      if (repoId !== null) {
        const perRepo = get().perRepo
        const entry = perRepo[repoId]
        if (entry !== undefined) {
          set({ perRepo: { ...perRepo, [repoId]: { ...entry, selectedPath: path } } })
        }
      }
    },

    setShowAll: async (showAll) => {
      const { session, allFiles } = get()
      set({ showAll })
      if (showAll && allFiles === null && session !== null) {
        set({ allFiles: await api.tree(session.id) })
      }
    },

    startDraft: (side, startLine, endLine) => {
      const { selectedPath, drafts, activeRepoId, session } = get()
      if (selectedPath === null || activeRepoId === null || session === null) {
        return
      }
      draft_seq += 1
      const draft: Draft = {
        id: draft_seq,
        repoId: activeRepoId,
        sessionId: session.id,
        path: selectedPath,
        side,
        startLine,
        endLine,
        body: '',
      }
      set({ drafts: [...drafts, draft], activeDraftId: draft.id })
    },

    updateDraftBody: (id, body) => {
      set({
        drafts: get().drafts.map((d) => (d.id === id ? { ...d, body } : d)),
      })
    },

    setDraftRange: (id, startLine, endLine) => {
      // a range typed by hand can arrive half-finished; the server extracts the
      // snippet from these lines at submit, so only sane ones are worth keeping
      const start = Math.max(1, Math.trunc(startLine))
      const end = Math.max(start, Math.trunc(endLine))
      set({
        drafts: get().drafts.map((d) =>
          d.id === id ? { ...d, startLine: start, endLine: end } : d,
        ),
      })
    },

    insertDraftRef: (path, startLine, endLine, captureRepoId) => {
      const {
        drafts,
        activeDraftId,
        activeReplyId,
        activeReplyRepoId,
        replyDrafts,
        activeRepoId,
        repos,
      } = get()
      const capture_repo = captureRepoId ?? activeRepoId
      // captures from a different repo than the note's home get a repo
      // prefix so the agent (and chips) can resolve them
      const refFor = (homeRepoId: number | null) => {
        const cross =
          homeRepoId !== null &&
          capture_repo !== null &&
          homeRepoId !== capture_repo
        const prefix = cross
          ? `${repos.find((r) => r.id === capture_repo)?.name ?? ''}:`
          : ''
        return startLine === endLine
          ? `@${prefix}${path}:L${startLine}`
          : `@${prefix}${path}:L${startLine}-L${endLine}`
      }
      const append = (body: string, ref: string) =>
        body === '' || /\s$/.test(body) ? `${body}${ref} ` : `${body} ${ref} `
      // a focused reply box takes precedence over draft blocks
      if (activeReplyId !== null) {
        const ref = refFor(activeReplyRepoId)
        set({
          replyDrafts: {
            ...replyDrafts,
            [activeReplyId]: append(replyDrafts[activeReplyId] ?? '', ref),
          },
        })
        return
      }
      const target =
        drafts.find((d) => d.id === activeDraftId) ?? drafts.at(-1)
      if (target === undefined) return
      const ref = refFor(target.repoId)
      set({
        drafts: get().drafts.map((d) =>
          d.id === target.id ? { ...d, body: append(d.body, ref) } : d,
        ),
      })
    },

    setSplitMenu: (key) => set({ splitMenuFor: key }),

    setSideBySide: (side) => set({ sideBySide: side }),

    openFind: (open) => {
      set({ findOpen: open })
      // the query survives closing: reopening to look for the same thing again
      // is the common case, and it costs nothing to remember
      if (!open) set({ findAt: 0 })
    },

    setFindQuery: async (query) => {
      set({ findQuery: query })
      await runFind()
    },

    setFindCase: async (on) => {
      set({ findCase: on })
      await runFind()
    },

    stepFind: async (delta) => {
      const { findMatches: found, findAt } = get()
      if (found.length === 0) return
      // wraps both ways: a find that stops at the end is a find you have to
      // close and reopen to use again
      const next = (findAt + delta + found.length) % found.length
      await get().goToMatch(next)
    },

    goToMatch: async (index) => {
      const match = get().findMatches[index]
      if (match === undefined) return
      set({ findAt: index })
      const select = { column: match.column, length: match.length }
      if (get().viewMode === 'flow') {
        // the flow scrolls itself and its editors are its own, so it reveals
        // through flowNav rather than through the single view's `reveal`
        if (match.path !== get().selectedPath) get().flowSelect(match.path)
        flowReveal(match.path, match.line, select)
        return
      }
      if (match.path !== get().selectedPath) {
        await get().openFile(match.path).catch(() => undefined)
      }
      set({
        reveal: {
          path: match.path,
          line: match.line,
          side: match.side,
          ...select,
        },
      })
    },

    setCollapseUnchanged: (collapse) => set({ collapseUnchanged: collapse }),

    setActiveDraft: (id) => {
      if (get().drafts.some((d) => d.id === id)) {
        set({ activeDraftId: id, activeReplyId: null })
      }
    },

    setActiveReply: (threadId) => {
      set({
        activeReplyId: threadId,
        activeReplyRepoId: threadId === null ? null : get().activeRepoId,
      })
    },

    updateReplyDraft: (threadId, body) => {
      set({ replyDrafts: { ...get().replyDrafts, [threadId]: body } })
    },

    cancelDraft: (id) => {
      const drafts = get().drafts.filter((d) => d.id !== id)
      set({
        drafts,
        activeDraftId:
          get().activeDraftId === id
            ? (drafts.at(-1)?.id ?? null)
            : get().activeDraftId,
        // a menu belonging to a draft that no longer exists
        ...(get().splitMenuFor === `draft:${String(id)}`
          ? { splitMenuFor: null }
          : {}),
      })
    },

    submitDraft: async (id, as) => {
      const { session, drafts, activeRepoId, repos, noteDefault } = get()
      const posting = (as ?? noteDefault) === 'comment'
      const draft = drafts.find((d) => d.id === id)
      if (session === null || draft === undefined) return
      const body = draft.body.trim()
      if (body === '') return
      const same_repo = draft.repoId === activeRepoId
      const target_session = same_repo ? session.id : draft.sessionId
      let thread: Thread
      try {
        thread = await api.createThread(target_session, {
          path: draft.path,
          side: draft.side,
          startLine: draft.startLine,
          endLine: draft.endLine,
          body,
          // the server defaults a user's note to the batch; say it either way
          // so the button and the note agree
          pending: !posting,
        })
      } catch (error) {
        get().pushToast('error', `note: ${message(error)}`)
        return
      }
      if (!same_repo) {
        const repo_name =
          repos.find((r) => r.id === draft.repoId)?.name ?? 'other repo'
        get().pushToast('info', `note posted to ${repo_name}`)
      }
      const remaining = get().drafts.filter((d) => d.id !== id)
      set({
        threads: same_repo ? [...get().threads, thread] : get().threads,
        drafts: remaining,
        activeDraftId:
          get().activeDraftId === id
            ? (remaining.at(-1)?.id ?? null)
            : get().activeDraftId,
      })
    },

    commentsOpen: false,

    toggleComments: () => set({ commentsOpen: !get().commentsOpen }),
    toggleActivity: () => set({ activityOpen: !get().activityOpen }),

    deleteThread: async (threadId) => {
      try {
        await api.deleteThread(threadId)
        set({ threads: get().threads.filter((t) => t.id !== threadId) })
      } catch (error) {
        get().pushToast('error', `delete: ${message(error)}`)
      }
    },

    deleteMessage: async (threadId, messageId) => {
      try {
        const result = await api.deleteMessage(messageId)
        if (result.deletedThread || result.thread === null) {
          set({ threads: get().threads.filter((t) => t.id !== threadId) })
        } else {
          const thread = result.thread
          set({
            threads: get().threads.map((t) => (t.id === threadId ? thread : t)),
          })
        }
      } catch (error) {
        get().pushToast('error', `delete: ${message(error)}`)
      }
    },

    editMessage: async (threadId, messageId, body) => {
      try {
        const updated = await api.editMessage(messageId, body)
        set({
          threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
        })
      } catch (error) {
        get().pushToast('error', `edit: ${message(error)}`)
      }
    },

    reply: async (threadId, body) => {
      try {
        const updated = await api.reply(threadId, 'user', body)
        const drafts = { ...get().replyDrafts }
        delete drafts[threadId]
        set({
          threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
          replyDrafts: drafts,
          activeReplyId:
            get().activeReplyId === threadId ? null : get().activeReplyId,
        })
      } catch (error) {
        get().pushToast('error', `reply: ${message(error)}`)
      }
    },

    resolveThread: async (threadId) => {
      try {
        const updated = await api.resolve(threadId)
        set({
          threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
        })
      } catch (error) {
        get().pushToast('error', `resolve: ${message(error)}`)
      }
    },

    reopenThread: async (threadId) => {
      try {
        const updated = await api.reopen(threadId)
        set({
          threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
        })
      } catch (error) {
        get().pushToast('error', `reopen: ${message(error)}`)
      }
    },

    promptOrder: [],

    addNote: async (scope, body, as) => {
      const { session, selectedPath, noteDefault } = get()
      if (session === null) return
      const path = scope === 'file' ? (selectedPath ?? '') : ''
      try {
        const thread = await api.createThread(session.id, {
          path,
          side: 'source',
          startLine: 0,
          endLine: 0,
          body,
          pending: (as ?? noteDefault) === 'draft',
        })
        set({ threads: [...get().threads, thread] })
      } catch (error) {
        get().pushToast('error', `note: ${message(error)}`)
      }
    },

    moveInPromptOrder: (threadId, delta) => {
      const current = orderedThreadIds(get().threads, get().promptOrder)
      const from = current.indexOf(threadId)
      const to = from + delta
      if (from === -1 || to < 0 || to >= current.length) return
      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (moved === undefined) return
      next.splice(to, 0, moved)
      set({ promptOrder: next })
    },

    copyPrompt: async () => {
      const { session } = get()
      if (session === null) return
      try {
        await navigator.clipboard.writeText(
          await api.prompt(
            session.id,
            orderedThreadIds(get().threads, get().promptOrder),
          ),
        )
        set({ promptCopied: true })
        setTimeout(() => set({ promptCopied: false }), 2000)
      } catch (error) {
        get().pushToast('error', `copy prompt: ${message(error)}`)
      }
    },

    importMr: async (mr) => {
      const { session } = get()
      if (session === null) return
      try {
        const result = await api.importMr(session.id, mr)
        set({ threads: await api.threads(session.id, true) })
        get().pushToast(
          'info',
          `MR import: ${result.imported} thread${result.imported === 1 ? '' : 's'} imported, ${result.skipped} skipped`,
        )
      } catch (error) {
        get().pushToast('error', `MR import: ${message(error)}`)
      }
    },

    submitReview: async () => {
      const { session } = get()
      if (session === null) return
      try {
        const { posted } = await api.submitReview(session.id)
        set({ threads: await api.threads(session.id, true) })
        get().pushToast('info', `review submitted — ${posted} note${posted === 1 ? '' : 's'} posted`)
      } catch (error) {
        get().pushToast('error', `submit review: ${message(error)}`)
      }
    },

    postThread: async (threadId) => {
      try {
        const updated = await api.postThread(threadId)
        set({
          threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
        })
      } catch (error) {
        get().pushToast('error', `post note: ${message(error)}`)
      }
    },

    toggleViewed: async (path) => {
      const { session, viewed } = get()
      if (session === null) return
      const next = new Set(viewed)
      const now_viewed = !next.has(path)
      if (now_viewed) next.add(path)
      else next.delete(path)
      set({ viewed: next })
      try {
        await api.setViewed(session.id, path, now_viewed)
      } catch (error) {
        get().pushToast('error', `viewed: ${message(error)}`)
      }
    },

    repin: async (automatic = false) => {
      const { session, selectedPath, threads: before } = get()
      if (session === null) return
      try {
        const next = await api.repin(session.id, automatic)
        const [files, threads, viewed] = await Promise.all([
          api.diff(next.id),
          api.threads(next.id, true),
          api.viewed(next.id),
        ])
        set({ session: next, threads, viewed: new Set(viewed) })
        const repoId = get().activeRepoId
        if (repoId !== null) {
          updateRepoSession(repoId, { sessionId: next.id, files })
        }
        // moving the base can leave a note without the code it was written
        // against, and a pin that moved on its own must not do that quietly
        const detached = (list: Thread[]) =>
          list.filter((t) => t.status === 'detached').length
        const lost = detached(threads) - detached(before)
        const sha = next.baseSha.slice(0, 8)
        get().pushToast(
          lost > 0 ? 'error' : 'info',
          lost > 0
            ? `base ${automatic ? 'moved to' : 're-pinned to'} ${sha} — ${String(lost)} ${lost === 1 ? 'note' : 'notes'} lost its anchor`
            : `base ${automatic ? 'moved to' : 're-pinned to'} ${sha}`,
        )
        if (selectedPath !== null) {
          await get().openFile(selectedPath)
        }
      } catch (error) {
        get().pushToast('error', `re-pin: ${message(error)}`)
      }
    },

    refresh: async (repoPath) => {
      const { session, selectedPath, selectedStatus, repos } = get()
      if (session === null) return
      const watched =
        session.source.kind === 'worktree'
          ? session.source.value
          : session.repoPath
      if (watched !== repoPath) {
        // a background repo changed: refresh its tree entry only
        const other = repos.find(
          (r) => r.path === repoPath || repoPath.startsWith(r.path + '/'),
        )
        if (other !== undefined && get().repoSessions[other.id] !== undefined) {
          await ensureRepoSession(other.id)
        }
        return
      }
      const [files, threads, fresh] = await Promise.all([
        api.diff(session.id),
        api.threads(session.id, true),
        api.session(session.id).catch(() => null),
      ])
      set({ threads, contentEpoch: get().contentEpoch + 1 })
      const repoId = get().activeRepoId
      if (repoId !== null) updateRepoSession(repoId, { files })
      if (fresh !== null && get().session?.id === session.id) {
        set({ session: fresh })
      }
      if (selectedPath !== null) {
        const status = statusOf(files, selectedPath)
        if (status !== selectedStatus || status !== 'unchanged') {
          const wantSource = status !== 'deleted'
          const source = wantSource
            ? await cachedFile(
                session.id,
                get().contentEpoch,
                selectedPath,
                'source',
              )
            : null
          if (get().selectedPath === selectedPath) {
            set({ sourceContent: source, selectedStatus: status })
          }
        }
      }
    },

    // a note changed on the server (an agent replied, resolved, or added one)
    syncThreads: async (sessionId) => {
      const { session, repoSessions } = get()
      const owner = Object.entries(repoSessions).find(
        ([, entry]) => entry.sessionId === sessionId,
      )
      if (session?.id !== sessionId && owner === undefined) return
      let threads: Thread[]
      try {
        threads = await api.threads(sessionId, true)
      } catch {
        return
      }
      if (get().session?.id === sessionId) set({ threads })
      const current = get().repoSessions
      const entry = Object.entries(current).find(
        ([, value]) => value.sessionId === sessionId,
      )
      if (entry !== undefined) {
        const [repoId, value] = entry
        set({
          repoSessions: {
            ...current,
            [repoId]: {
              ...value,
              openCount: threads.filter((t) => t.status === 'open').length,
            },
          },
        })
      }
    },

    openDir: async (repoId, dir) => {
      if (repoId !== get().activeRepoId) await get().selectRepo(repoId)
      const entry = get().repoSessions[repoId]
      // a folder with nothing changed in it only exists in the all-files tree
      const changed = repoFiles(get(), repoId).some((f) =>
        f.path.startsWith(`${dir}/`),
      )
      if (entry !== undefined && !changed && !entry.showAll) {
        await get().toggleRepoShowAll(repoId)
      }
      set({ revealDir: { repoId, dir } })
    },

    clearRevealDir: () => set({ revealDir: null }),

    toggleWrap: (path) => {
      const { wrapExtensions, wrapOverrides } = get()
      set({
        wrapOverrides: {
          ...wrapOverrides,
          [path]: !wrapFor(path, wrapExtensions, wrapOverrides),
        },
      })
    },

    setWrapAll: (paths, wrap) => {
      set({
        wrapOverrides: {
          ...get().wrapOverrides,
          ...Object.fromEntries(paths.map((path) => [path, wrap])),
        },
      })
    },

    setConnected: (connected) => set({ connected }),
  }
})

// both snapshots are written on every change rather than from each action
// that touches them, so no path can forget to persist
let written_tabs = ''
let written_drafts = ''
useReview.subscribe((state) => {
  const tabs = storeTabs(state.tabs, state.activeTabId, state.repos)
  if (tabs !== written_tabs) written_tabs = tabs
  const drafts = storeDrafts(state.drafts, state.repos)
  if (drafts !== written_drafts) written_drafts = drafts
})
