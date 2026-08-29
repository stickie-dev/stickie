import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import type { ClientEvent } from '@stickie/shared'
import { api } from './api'
import './monacoSetup'
import { AddRepo } from './components/AddRepo'
import { OverviewPage } from './components/OverviewPage'
import { SettingsPage } from './components/settings/SettingsPage'
import { Toasts } from './components/Toasts'
import { Workspace } from './components/Workspace'
import type { Page, TabRef } from './routes'
import { formatRoute, isReviewRoute, parseRoute, sameTab } from './routes'
import type { Tab } from './store'
import { useReview } from './store'

/** Where the store currently is, in the terms an address is written in. */
interface Here {
  repoId: number
  tab: TabRef
}

/** The store's internal name for the continuous scroll is `flow`; an address
 * calls it what the tab bar does. */
function tabRef(tab: Tab): TabRef | null {
  if (tab.kind === 'flow') return { kind: 'diff' }
  if (tab.kind === 'commits') return { kind: 'commits' }
  return tab.path === undefined ? null : { kind: 'file', path: tab.path }
}

function useHere(): Here | null {
  const tabs = useReview((s) => s.tabs)
  const activeTabId = useReview((s) => s.activeTabId)
  return useMemo(() => {
    const tab = tabs.find((entry) => entry.id === activeTabId)
    if (tab === undefined) return null
    const ref = tabRef(tab)
    return ref === null ? null : { repoId: tab.repoId, tab: ref }
  }, [tabs, activeTabId])
}

function signature(here: Here | null): string {
  if (here === null) return ''
  const path = here.tab.kind === 'file' ? here.tab.path : ''
  return `${here.repoId}|${here.tab.kind}|${path}`
}

/**
 * Keeps the address and the store in step, in whichever direction moved last:
 * the address wins on a load or a back/forward, the store wins when something
 * in the app opened a different tab. One effect and one record of what was
 * last synced, because two independent effects on the same pair ping-pong.
 */
function useRouteSync(page: Page | null, here: Here | null): void {
  const location = useLocation()
  const navigate = useNavigate()
  const repos = useReview((s) => s.repos)
  const openAddress = useReview((s) => s.openAddress)
  const synced = useRef<{ address: string; here: string }>({
    address: '',
    here: '',
  })
  /**
   * What the address asked for and has not been given yet. Until it is, the
   * store is not allowed to write the address back — otherwise a still-loading
   * `init` settling somewhere else silently rewrites the link just followed.
   */
  const owed = useRef<Here | null>(null)
  /** The last thing asked of the store, so an in-flight open is not re-asked. */
  const asked = useRef('')

  const address = `${location.pathname}${location.search}`

  useEffect(() => {
    if (repos.length === 0) return
    const last = synced.current
    if (address !== last.address) {
      synced.current = { address, here: signature(here) }
      owed.current =
        page?.kind === 'review' ? { repoId: page.repoId, tab: page.tab } : null
      asked.current = ''
    }

    const wanted = owed.current
    if (wanted !== null) {
      if (!repos.some((repo) => repo.id === wanted.repoId)) {
        owed.current = null
        navigate('/', { replace: true })
        return
      }
      const arrived =
        here !== null &&
        here.repoId === wanted.repoId &&
        sameTab(here.tab, wanted.tab)
      if (!arrived) {
        const key = signature(wanted)
        if (asked.current !== key) {
          asked.current = key
          void openAddress(wanted.repoId, wanted.tab)
        }
        return
      }
      owed.current = null
      synced.current = { address, here: signature(here) }
      return
    }

    // the store moved on its own: mirror it, and push so back walks the tabs.
    // Only while the review is the page on screen — the workspace stays mounted
    // and keeps settling underneath, and that must not drag the reader off a
    // settings address they loaded directly.
    if (page?.kind !== 'review') return
    if (signature(here) !== last.here) {
      synced.current = { address, here: signature(here) }
      if (here !== null) navigate(formatRoute({ kind: 'review', ...here }))
    }
  }, [address, page, here, repos, openAddress, navigate])
}

/**
 * Turns `/r/1/t/7` into the address of wherever that note is now, and replaces
 * it — so a link to a note is a permalink and the view it lands on has one
 * address, not two. The server re-anchors before answering, so a note whose
 * code has moved lands on the code, not on the line it used to be at.
 */
function useNotePermalink(page: Page | null): void {
  const navigate = useNavigate()
  const pushToast = useReview((s) => s.pushToast)
  const resolving = useRef('')

  useEffect(() => {
    if (page?.kind !== 'note') return
    const key = `${String(page.repoId)}:${String(page.threadId)}`
    if (resolving.current === key) return
    resolving.current = key
    void (async () => {
      try {
        const note = await api.thread(page.threadId)
        navigate(
          formatRoute({
            kind: 'review',
            repoId: page.repoId,
            tab:
              note.startLine > 0 && note.path !== ''
                ? {
                    kind: 'file',
                    path: note.path,
                    line: note.startLine,
                    side: note.side,
                  }
                : { kind: 'diff' },
          }),
          { replace: true },
        )
      } catch {
        pushToast('error', `no note ${String(page.threadId)}`)
        navigate(
          formatRoute({
            kind: 'review',
            repoId: page.repoId,
            tab: { kind: 'diff' },
          }),
          { replace: true },
        )
      }
    })()
  }, [page, navigate, pushToast])
}

/**
 * What a non-review address shows. Drawn over the workspace rather than in
 * place of it, so the review surface behind keeps its editors and its scroll.
 */
function PageLayer({ page }: { page: Page | null }) {
  const repos = useReview((s) => s.repos)

  if (page === null) return <Navigate to="/" replace />

  if (page.kind === 'settings') return <SettingsPage section={page.section} />

  // the root is the overview, and the way in to a workspace with no repos yet
  if (page.kind === 'home') {
    return repos.length === 0 ? <AddRepo /> : <OverviewPage />
  }

  return null
}

export function App() {
  const location = useLocation()
  const init = useReview((s) => s.init)
  const error = useReview((s) => s.error)
  const refresh = useReview((s) => s.refresh)
  const syncThreads = useReview((s) => s.syncThreads)
  const setConnected = useReview((s) => s.setConnected)
  const setReviewActive = useReview((s) => s.setReviewActive)
  const theme = useReview((s) => s.theme)

  // a fresh object every render would re-run the sync effect every render
  const page = useMemo(
    () => parseRoute(location.pathname, location.search),
    [location.pathname, location.search],
  )
  const here = useHere()
  const on_review = isReviewRoute(page)
  useRouteSync(page, here)
  useNotePermalink(page)

  // the workspace is expensive to build and cheap to keep, so it mounts on
  // the first review address and is never taken down again
  const [workspaceMounted, setWorkspaceMounted] = useState(on_review)
  useEffect(() => {
    if (on_review) setWorkspaceMounted(true)
  }, [on_review])

  useEffect(() => {
    setReviewActive(on_review)
  }, [on_review, setReviewActive])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // the address is part of the starting state: `init` gets what it asked for
  // so restoring tabs does not settle somewhere else first
  const start = useRef(
    page?.kind === 'review'
      ? { repoId: page.repoId, tab: page.tab }
      : undefined,
  )
  useEffect(() => {
    void init(start.current)
  }, [init])

  useEffect(() => {
    let socket: WebSocket | null = null
    let closed = false
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`)
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
      {error !== null && (
        <div className="border-b border-rose-300 bg-rose-100 px-3 py-1.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}
      <div className="relative min-h-0 grow">
        {workspaceMounted && <Workspace active={on_review} />}
        {!on_review && (
          <div className="absolute inset-0 z-30 overflow-auto bg-surface">
            <PageLayer page={page} />
          </div>
        )}
      </div>
      <Toasts />
    </div>
  )
}
