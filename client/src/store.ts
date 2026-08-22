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
import type { NavHit } from './api'

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
  activeRepoId: number | null
  targets: TargetOptions | null
  source: ReviewSource | null
  baseRef: string | undefined
  session: Session | null
  files: ChangedFile[]
  allFiles: string[] | null
  showAll: boolean
  selectedPath: string | null
  selectedStatus: ChangedFile['status'] | 'unchanged' | null
  baseContent: FileContent | null
  sourceContent: FileContent | null
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
  reveal: { path: string; line: number } | null
  usages: { name: string; scope: 'repo' | 'workspace'; hits: NavHit[] } | null
  toasts: Toast[]
  navHistory: NavEntry[]
  navIndex: number
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
  clearReveal: () => void
  toggleTheme: () => void
  init: () => Promise<void>
  addRepo: (path: string) => Promise<void>
  selectRepo: (repoId: number) => Promise<void>
  setSource: (source: ReviewSource, baseRef?: string) => Promise<void>
  setBase: (baseRef: string | undefined) => Promise<void>
  openFile: (path: string, status?: ChangedFile['status'] | 'unchanged') => Promise<void>
  setShowAll: (showAll: boolean) => Promise<void>
  startDraft: (side: Side, startLine: number, endLine: number) => void
  updateDraftBody: (id: number, body: string) => void
  insertDraftRef: (path: string, startLine: number, endLine: number) => void
  setActiveDraft: (id: number) => void
  setActiveReply: (threadId: number | null) => void
  updateReplyDraft: (threadId: number, body: string) => void
  cancelDraft: (id: number) => void
  submitDraft: (id: number) => Promise<void>
  repin: () => Promise<void>
  importMr: (mr: string) => Promise<void>
  submitReview: () => Promise<void>
  postThread: (threadId: number) => Promise<void>
  toggleViewed: (path: string) => Promise<void>
  reply: (threadId: number, body: string) => Promise<void>
  editMessage: (threadId: number, messageId: number, body: string) => Promise<void>
  commentsOpen: boolean
  toggleComments: () => void
  resolveThread: (threadId: number) => Promise<void>
  reopenThread: (threadId: number) => Promise<void>
  copyPrompt: () => Promise<void>
  refresh: (repoPath: string) => Promise<void>
  setConnected: (connected: boolean) => void
}

function statusOf(
  files: ChangedFile[],
  path: string,
): ChangedFile['status'] | 'unchanged' {
  return files.find((f) => f.path === path)?.status ?? 'unchanged'
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
      set({
        session,
        files,
        threads,
        viewed: new Set(viewed),
        allFiles: null,
        selectedPath: null,
        baseContent: null,
        sourceContent: null,
        error: null,
      })
      const first = files[0]
      if (first !== undefined) {
        await get().openFile(first.path, first.status)
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
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
    activeRepoId: null,
    targets: null,
    source: null,
    baseRef: undefined,
    session: null,
    files: [],
    allFiles: null,
    showAll: false,
    selectedPath: null,
    selectedStatus: null,
    baseContent: null,
    sourceContent: null,
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
    usages: null,
    toasts: [],
    navHistory: [],
    navIndex: -1,
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

    init: async () => {
      try {
        const repos = await api.repos()
        set({ repos })
        const first = repos[0]
        if (first !== undefined) {
          await get().selectRepo(first.id)
        }
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
      }
    },

    addRepo: async (path) => {
      await api.addRepo(path)
      const repos = await api.repos()
      set({ repos })
      const added = repos.find((r) => path.startsWith(r.path))
      if (added !== undefined) await get().selectRepo(added.id)
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
      const { session, files } = get()
      if (session === null) return
      const resolved = status ?? statusOf(files, path)
      // the draft survives navigation so other files can be browsed and
      // referenced while composing
      set({
        selectedPath: path,
        selectedStatus: resolved,
        baseContent: null,
        sourceContent: null,
      })
      const oldPath =
        files.find((f) => f.path === path)?.oldPath ?? path
      const wantBase = resolved !== 'added' && resolved !== 'untracked'
      const wantSource = resolved !== 'deleted'
      const [base, source] = await Promise.all([
        wantBase ? api.file(session.id, oldPath, 'base') : Promise.resolve(null),
        wantSource ? api.file(session.id, path, 'source') : Promise.resolve(null),
      ])
      // ignore stale responses after a quick file switch
      if (get().selectedPath !== path) return
      set({ baseContent: base, sourceContent: source })
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

    insertDraftRef: (path, startLine, endLine) => {
      const {
        drafts,
        activeDraftId,
        activeReplyId,
        activeReplyRepoId,
        replyDrafts,
        activeRepoId,
        repos,
      } = get()
      // captures from a different repo than the note's home get a repo
      // prefix so the agent (and chips) can resolve them
      const refFor = (homeRepoId: number | null) => {
        const cross =
          homeRepoId !== null &&
          activeRepoId !== null &&
          homeRepoId !== activeRepoId
        const prefix = cross
          ? `${repos.find((r) => r.id === activeRepoId)?.name ?? ''}:`
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
      })
    },

    submitDraft: async (id) => {
      const { session, drafts, activeRepoId, repos } = get()
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

    copyPrompt: async () => {
      const { session } = get()
      if (session === null) return
      try {
        await navigator.clipboard.writeText(await api.prompt(session.id))
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

    repin: async () => {
      const { session, selectedPath } = get()
      if (session === null) return
      try {
        const next = await api.repin(session.id)
        const [files, threads, viewed] = await Promise.all([
          api.diff(next.id),
          api.threads(next.id, true),
          api.viewed(next.id),
        ])
        set({ session: next, files, threads, viewed: new Set(viewed) })
        get().pushToast('info', `base re-pinned to ${next.baseSha.slice(0, 8)}`)
        if (selectedPath !== null) {
          await get().openFile(selectedPath)
        }
      } catch (error) {
        get().pushToast('error', `re-pin: ${message(error)}`)
      }
    },

    refresh: async (repoPath) => {
      const { session, selectedPath, selectedStatus } = get()
      if (session === null) return
      const watched =
        session.source.kind === 'worktree'
          ? session.source.value
          : session.repoPath
      if (watched !== repoPath) return
      const [files, threads, fresh] = await Promise.all([
        api.diff(session.id),
        api.threads(session.id, true),
        api.session(session.id).catch(() => null),
      ])
      set({ files, threads })
      if (fresh !== null && get().session?.id === session.id) {
        set({ session: fresh })
      }
      if (selectedPath !== null) {
        const status = statusOf(files, selectedPath)
        if (status !== selectedStatus || status !== 'unchanged') {
          const wantSource = status !== 'deleted'
          const source = wantSource
            ? await api.file(session.id, selectedPath, 'source')
            : null
          if (get().selectedPath === selectedPath) {
            set({ sourceContent: source, selectedStatus: status })
          }
        }
      }
    },

    setConnected: (connected) => set({ connected }),
  }
})
