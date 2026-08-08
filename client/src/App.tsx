import { useEffect } from 'react'
import type { FsEvent } from '@stickie/shared'
import './monacoSetup'
import { AddRepo } from './components/AddRepo'
import { FileTree } from './components/FileTree'
import { FileView } from './components/FileView'
import { TopBar } from './components/TopBar'
import { useReview } from './store'

/** Shown while the active draft belongs to a file other than the open one. */
function DraftPill() {
  const drafts = useReview((s) => s.drafts)
  const activeDraftId = useReview((s) => s.activeDraftId)
  const selectedPath = useReview((s) => s.selectedPath)
  const openFile = useReview((s) => s.openFile)
  const cancelDraft = useReview((s) => s.cancelDraft)

  const active =
    drafts.find((d) => d.id === activeDraftId) ?? drafts.at(-1)
  if (active === undefined || active.path === selectedPath) return null

  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-accent bg-panel px-3 py-2 text-xs shadow-xl">
      <span className="text-soft">
        {drafts.length > 1 ? `${drafts.length} notes in progress; active on` : 'note in progress on'}{' '}
        <span className="font-mono text-ink">
          {active.path}:L{active.startLine}
        </span>{' '}
        — “+ ref” on a selection here adds a reference to it
      </span>
      <button
        className="rounded bg-accent px-2 py-1 font-medium text-white hover:bg-accent-strong"
        onClick={() => void openFile(active.path)}
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
  const setConnected = useReview((s) => s.setConnected)
  const theme = useReview((s) => s.theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

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
          const event = JSON.parse(message.data as string) as FsEvent
          if (event.type === 'fs') void refresh(event.repoPath)
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
  }, [refresh, setConnected])

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
        <div className="flex min-h-0 grow">
          <aside className="w-64 shrink-0 border-r border-edge">
            <FileTree />
          </aside>
          <main className="min-w-0 grow">
            <FileView />
          </main>
        </div>
      )}
      <DraftPill />
    </div>
  )
}
