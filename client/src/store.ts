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

export interface Draft {
  id: number
  path: string
  side: Side
  startLine: number
  endLine: number
  body: string
}

let draft_seq = 0

export type Theme = 'dark' | 'light'

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
  drafts: Draft[]
  activeDraftId: number | null
  error: string | null
  connected: boolean
  promptCopied: boolean
  theme: Theme
  reveal: { path: string; line: number } | null

  openRef: (path: string, line: number) => Promise<void>
  clearReveal: () => void
  toggleTheme: () => void
  init: () => Promise<void>
  addRepo: (path: string) => Promise<void>
  selectRepo: (repoId: number) => Promise<void>
  setSource: (source: ReviewSource) => Promise<void>
  setBase: (baseRef: string | undefined) => Promise<void>
  openFile: (path: string, status?: ChangedFile['status'] | 'unchanged') => Promise<void>
  setShowAll: (showAll: boolean) => Promise<void>
  startDraft: (side: Side, startLine: number, endLine: number) => void
  updateDraftBody: (id: number, body: string) => void
  insertDraftRef: (path: string, startLine: number, endLine: number) => void
  setActiveDraft: (id: number) => void
  cancelDraft: (id: number) => void
  submitDraft: (id: number) => Promise<void>
  reply: (threadId: number, body: string) => Promise<void>
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

export const useReview = create<ReviewState>((set, get) => {
  async function startSession(): Promise<void> {
    const { activeRepoId, source, baseRef } = get()
    if (activeRepoId === null || source === null) return
    try {
      const session = await api.createSession(activeRepoId, source, baseRef)
      const [files, threads] = await Promise.all([
        api.diff(session.id),
        api.threads(session.id),
      ])
      set({
        session,
        files,
        threads,
        allFiles: null,
        selectedPath: null,
        baseContent: null,
        sourceContent: null,
        drafts: [],
        activeDraftId: null,
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
    drafts: [],
    activeDraftId: null,
    error: null,
    connected: false,
    promptCopied: false,
    theme: initialTheme(),
    reveal: null,

    openRef: async (path, line) => {
      await get().openFile(path)
      set({ reveal: { path, line } })
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
      const main = targets.worktrees.find((wt) => wt.isMain)
      const source: ReviewSource | null =
        main !== undefined
          ? { kind: 'worktree', value: main.path }
          : { kind: 'ref', value: targets.defaultBranch }
      set({
        activeRepoId: repoId,
        targets,
        source,
        baseRef: undefined,
        showAll: false,
      })
      await startSession()
    },

    setSource: async (source) => {
      set({ source, baseRef: undefined })
      await startSession()
    },

    setBase: async (baseRef) => {
      set({ baseRef })
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
    },

    setShowAll: async (showAll) => {
      const { session, allFiles } = get()
      set({ showAll })
      if (showAll && allFiles === null && session !== null) {
        set({ allFiles: await api.tree(session.id) })
      }
    },

    startDraft: (side, startLine, endLine) => {
      const { selectedPath, drafts } = get()
      if (selectedPath === null) return
      draft_seq += 1
      const draft: Draft = {
        id: draft_seq,
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
      const { drafts, activeDraftId } = get()
      const target =
        drafts.find((d) => d.id === activeDraftId) ?? drafts.at(-1)
      if (target === undefined) return
      const ref =
        startLine === endLine
          ? `@${path}:L${startLine}`
          : `@${path}:L${startLine}-L${endLine}`
      const body =
        target.body === '' || /\s$/.test(target.body)
          ? `${target.body}${ref} `
          : `${target.body} ${ref} `
      set({
        drafts: get().drafts.map((d) =>
          d.id === target.id ? { ...d, body } : d,
        ),
      })
    },

    setActiveDraft: (id) => {
      if (get().drafts.some((d) => d.id === id)) {
        set({ activeDraftId: id })
      }
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
      const { session, drafts } = get()
      const draft = drafts.find((d) => d.id === id)
      if (session === null || draft === undefined) return
      const body = draft.body.trim()
      if (body === '') return
      const thread = await api.createThread(session.id, {
        path: draft.path,
        side: draft.side,
        startLine: draft.startLine,
        endLine: draft.endLine,
        body,
      })
      const remaining = get().drafts.filter((d) => d.id !== id)
      set({
        threads: [...get().threads, thread],
        drafts: remaining,
        activeDraftId:
          get().activeDraftId === id
            ? (remaining.at(-1)?.id ?? null)
            : get().activeDraftId,
      })
    },

    reply: async (threadId, body) => {
      const updated = await api.reply(threadId, 'user', body)
      set({
        threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
      })
    },

    resolveThread: async (threadId) => {
      const updated = await api.resolve(threadId)
      set({
        threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
      })
    },

    reopenThread: async (threadId) => {
      const updated = await api.reopen(threadId)
      set({
        threads: get().threads.map((t) => (t.id === threadId ? updated : t)),
      })
    },

    copyPrompt: async () => {
      const { session } = get()
      if (session === null) return
      await navigator.clipboard.writeText(await api.prompt(session.id))
      set({ promptCopied: true })
      setTimeout(() => set({ promptCopied: false }), 2000)
    },

    refresh: async (repoPath) => {
      const { session, selectedPath, selectedStatus } = get()
      if (session === null) return
      const watched =
        session.source.kind === 'worktree'
          ? session.source.value
          : session.repoPath
      if (watched !== repoPath) return
      const [files, threads] = await Promise.all([
        api.diff(session.id),
        api.threads(session.id),
      ])
      set({ files, threads })
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
