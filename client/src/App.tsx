import { useEffect } from 'react'
import type { ClientEvent } from '@stickie/shared'
import './monacoSetup'
import { AddRepo } from './components/AddRepo'
import { CommentsPanel } from './components/CommentsPanel'
import { CommitsPanel } from './components/CommitsPanel'
import { FileTree } from './components/FileTree'
import { FileView } from './components/FileView'
import { SearchOverlay } from './components/SearchOverlay'
import { SidePane } from './components/SidePane'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { UsagesPanel } from './components/UsagesPanel'
import { useReview } from './store'

/**
 * Shown while the active draft belongs to a file other than the open one —
 * only with the comments panel closed, since the panel keeps every note in
 * progress editable in place.
 */
function DraftPill() {
  const drafts = useReview((s) => s.drafts)
  const activeDraftId = useReview((s) => s.activeDraftId)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const selectedPath = useReview((s) => s.selectedPath)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const repos = useReview((s) => s.repos)
  const selectRepo = useReview((s) => s.selectRepo)
  const openFile = useReview((s) => s.openFile)
  const cancelDraft = useReview((s) => s.cancelDraft)

  const active =
    drafts.find((d) => d.id === activeDraftId) ?? drafts.at(-1)
  if (
    commentsOpen ||
    active === undefined ||
    (active.path === selectedPath && active.repoId === activeRepoId)
  ) {
    return null
  }
  const cross_repo = active.repoId !== activeRepoId
  const repo_name = repos.find((r) => r.id === active.repoId)?.name

  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-accent bg-panel px-3 py-2 text-xs shadow-xl">
      <span className="text-soft">
        {drafts.length > 1 ? `${drafts.length} notes in progress; active on` : 'note in progress on'}{' '}
        <span className="font-mono text-ink">
          {cross_repo && repo_name !== undefined ? `${repo_name}:` : ''}
          {active.path}:L{active.startLine}
        </span>{' '}
        — “+ ref” on a selection here adds a reference to it
      </span>
      <button
        className="rounded bg-accent px-2 py-1 font-medium text-white hover:bg-accent-strong"
        onClick={() => {
          void (async () => {
            if (cross_repo) await selectRepo(active.repoId)
            await openFile(active.path)
          })()
        }}
      >
        back to note
      </button>
      <button
        className="text-soft hover:text-ink"
        onClick={() => cancelDraft(active.id)}
      >
        discard
      </button>
    </div>
  )
}

export function App() {
  const init = useReview((s) => s.init)
  const repos = useReview((s) => s.repos)
  const error = useReview((s) => s.error)
  const refresh = useReview((s) => s.refresh)
  const syncThreads = useReview((s) => s.syncThreads)
  const setConnected = useReview((s) => s.setConnected)
  const theme = useReview((s) => s.theme)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const setSearchOpen = useReview((s) => s.setSearchOpen)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // cmd+shift+F always opens workspace search; plain cmd+F only outside
  // editors and inputs so Monaco's in-file find keeps working
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key !== 'f' && event.key !== 'F') return
      if (event.shiftKey) {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      const target = event.target as HTMLElement | null
      const in_editor =
        target !== null &&
        (target.closest('.monaco-editor') !== null ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA')
      if (!in_editor) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    let socket: WebSocket | null = null
    let closed = false
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${location.host}/ws`)
      socket.onopen = () => setConnected(true)
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as ClientEvent
          if (event.type === 'fs') void refresh(event.repoPath)
          else if (event.type === 'thread') void syncThreads(event.sessionId)
        } catch {
          // ignore malformed frames
        }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      closed = true
      socket?.close()
    }
  }, [refresh, syncThreads, setConnected])

  return (
    <div className="flex h-screen flex-col bg-surface text-ink">
      <TopBar />
      {error !== null && (
        <div className="border-b border-rose-300 bg-rose-100 px-3 py-1.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}
      {repos.length === 0 ? (
        <AddRepo />
      ) : (
        <div className="flex min-h-0 grow flex-col">
          <div className="flex min-h-0 grow">
            <aside className="flex w-64 shrink-0 flex-col border-r border-edge">
              <div className="min-h-0 grow">
                <FileTree />
              </div>
              <CommitsPanel />
            </aside>
            <main className="flex min-w-0 grow flex-col">
              <TabBar />
              <div className="min-h-0 grow">
                <FileView />
              </div>
            </main>
            <SidePane />
            {commentsOpen && <CommentsPanel />}
          </div>
          <UsagesPanel />
          <StatusBar />
        </div>
      )}
      <DraftPill />
      <SearchOverlay />
      <Toasts />
    </div>
  )
}
