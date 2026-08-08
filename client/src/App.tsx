import { useEffect } from 'react'
import type { FsEvent } from '@stickie/shared'
import './monacoSetup'
import { AddRepo } from './components/AddRepo'
import { FileList } from './components/FileList'
import { FileView } from './components/FileView'
import { TopBar } from './components/TopBar'
import { useReview } from './store'

export function App() {
  const init = useReview((s) => s.init)
  const repos = useReview((s) => s.repos)
  const error = useReview((s) => s.error)
  const refresh = useReview((s) => s.refresh)
  const setConnected = useReview((s) => s.setConnected)

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
    <div className="flex h-screen flex-col bg-zinc-900 text-zinc-100">
      <TopBar />
      {error !== null && (
        <div className="border-b border-rose-900 bg-rose-950 px-3 py-1.5 text-xs text-rose-300">
          {error}
        </div>
      )}
      {repos.length === 0 ? (
        <AddRepo />
      ) : (
        <div className="flex min-h-0 grow">
          <aside className="w-72 shrink-0 border-r border-zinc-800">
            <FileList />
          </aside>
          <main className="min-w-0 grow">
            <FileView />
          </main>
        </div>
      )}
    </div>
  )
}
