import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import type { ClientEvent, Thread } from '@stickie/shared'
import { api } from './api'
import './monacoSetup'
import { AddRepo } from './components/AddRepo'
import { OverviewPage } from './components/OverviewPage'
import { OverviewSkeleton } from './components/OverviewSkeleton'
import { SettingsPage } from './components/settings/SettingsPage'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Toasts } from './components/Toasts'
import { Workspace } from './components/Workspace'
import type { Page, TabRef } from './routes'
import { rememberPlace } from './lastPlace'
import { formatRoute, isReviewRoute, parseRoute, sameTab } from './routes'
import type { Tab } from './store'
import { useReview } from './store'

/** Where the store currently is, in the terms an address is written in. */
interface Here {
  reviewId: number
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
  const repoSessions = useReview((s) => s.repoSessions)
  return useMemo(() => {
    const tab = tabs.find((entry) => entry.id === activeTabId)
    if (tab === undefined) return null
    const ref = tabRef(tab)
    // a tab belongs to a repository; which of that repository's reviews it is
    // showing is whichever one it currently has open, so the address follows
    // the source and base pickers without them knowing about addresses
    const reviewId = repoSessions[tab.repoId]?.sessionId
    return ref === null || reviewId === undefined
      ? null
      : { reviewId, tab: ref }
  }, [tabs, activeTabId, repoSessions])
}

function signature(here: Here | null): string {
  if (here === null) return ''
  const path = here.tab.kind === 'file' ? here.tab.path : ''
  return `${here.reviewId}|${here.tab.kind}|${path}`
}

/**
 * Keeps the address and the store in step, in whichever direction moved last:
 * the address wins on a load or a back/forward, the store wins when something
 * in the app opened a different tab. One effect and one record of what was
 * last synced, because two independent effects on the same pair ping-pong.
 */
function useRouteSync(
  page: Page | null,
  here: Here | null,
  noteHere: Here | null,
): void {
  const location = useLocation()
  const navigate = useNavigate()
  const repos = useReview((s) => s.repos)
  const openAddress = useReview((s) => s.openAddress)
  const clearNoteHighlight = useReview((s) => s.clearNoteHighlight)
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
  /** The note address the reader has actually arrived at; see below. */
  const at_note = useRef('')

  const address = `${location.pathname}${location.search}`

  useEffect(() => {
    if (repos.length === 0) return
    const last = synced.current
    if (address !== last.address) {
      synced.current = { address, here: signature(here) }
      owed.current =
        page?.kind === 'review'
          ? { reviewId: page.reviewId, tab: page.tab }
          : null
      asked.current = ''
    }

    // A note address is opened by `useNoteAddress`, not from here, and it keeps
    // its address while the reader is on it. Two things must not happen: the
    // store writing over the link before the note has been read, and the
    // address still claiming to be a note once the reader has moved on. So
    // nothing is mirrored until the store is at the note, and after that any
    // move away turns the address into the file it moved to.
    if (page?.kind === 'note' || page?.kind === 'note-by-id') {
      if (noteHere === null) return
      if (signature(here) === signature(noteHere)) {
        at_note.current = address
        synced.current = { address, here: signature(here) }
        return
      }
      if (at_note.current !== address) return
      synced.current = { address, here: signature(here) }
      clearNoteHighlight()
      if (here !== null) navigate(formatRoute({ kind: 'review', ...here }))
      return
    }

    const wanted = owed.current
    if (wanted !== null) {
      const arrived =
        here !== null &&
        here.reviewId === wanted.reviewId &&
        sameTab(here.tab, wanted.tab)
      if (!arrived) {
        const key = signature(wanted)
        if (asked.current !== key) {
          asked.current = key
          void openAddress(wanted.reviewId, wanted.tab).then((opened) => {
            // the review is gone — a deleted repository, or a link from
            // another machine's database
            if (!opened) {
              owed.current = null
              navigate('/', { replace: true })
            }
          })
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
  }, [
    address,
    page,
    here,
    noteHere,
    repos,
    openAddress,
    clearNoteHighlight,
    navigate,
  ])
}

/** The tab a note reads on: its own file and line, or the diff if it has none. */
function noteTab(note: Thread): TabRef {
  return note.startLine > 0 && note.path !== ''
    ? { kind: 'file', path: note.path, line: note.startLine, side: note.side }
    : { kind: 'diff' }
}

/**
 * Lands a note address, and answers with where it landed so `useRouteSync`
 * knows when the reader has moved off it.
 *
 * `/r/631/n/3` opens the file note 3 sits on and marks the note. The server
 * re-anchors before answering, so it lands on the code rather than on the line
 * the note was written against. The address stays: a note link goes on reading
 * as one until the reader moves.
 *
 * `/t/34` names a note by row id — global, so no review is needed to find it —
 * and replaces itself with that note's number form, which is the address worth
 * having. Note links in prompts sent before this carry an id, some of them
 * under `/r/<repo>/t/34`, and both still resolve.
 */
function useNoteAddress(page: Page | null, address: string): Here | null {
  const navigate = useNavigate()
  const pushToast = useReview((s) => s.pushToast)
  const openNote = useReview((s) => s.openNote)
  const [landed, setLanded] = useState<{ address: string; here: Here } | null>(
    null,
  )
  const resolving = useRef('')

  useEffect(() => {
    if (page === null) return
    if (page.kind === 'note-by-id') {
      const key = `id:${String(page.threadId)}`
      if (resolving.current === key) return
      resolving.current = key
      void (async () => {
        try {
          const note = await api.thread(page.threadId)
          navigate(
            formatRoute({
              kind: 'note',
              reviewId: note.sessionId,
              note: note.number,
            }),
            { replace: true },
          )
        } catch {
          pushToast('error', `no note ${String(page.threadId)}`)
          navigate('/', { replace: true })
        }
      })()
      return
    }
    if (page.kind !== 'note') return
    if (resolving.current === address) return
    resolving.current = address
    const { reviewId, note: number } = page
    void (async () => {
      const note = await openNote(reviewId, number)
      if (note === null) {
        pushToast(
          'error',
          `no note ${String(number)} in review ${String(reviewId)}`,
        )
        navigate('/', { replace: true })
        return
      }
      setLanded({ address, here: { reviewId, tab: noteTab(note) } })
    })()
  }, [page, address, openNote, navigate, pushToast])

  return landed?.address === address ? landed.here : null
}

/**
 * What a non-review address shows. Drawn over the workspace rather than in
 * place of it, so the review surface behind keeps its editors and its scroll.
 */
function PageLayer({ page }: { page: Page | null }) {
  const repos = useReview((s) => s.repos)
  const reposLoaded = useReview((s) => s.reposLoaded)

  if (page === null) return <Navigate to="/" replace />

  if (page.kind === 'settings') return <SettingsPage section={page.section} />

  // the root is the overview, and the way in to a workspace with no repos yet.
  // "No repositories" is an answer, so it waits to be sure of it rather than
  // offering to add the first one every time a cold load takes a moment
  if (page.kind === 'home') {
    if (!reposLoaded) return <OverviewSkeleton />
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
  const fontScale = useReview((s) => s.fontScale)

  // a fresh object every render would re-run the sync effect every render
  const page = useMemo(
    () => parseRoute(location.pathname, location.search),
    [location.pathname, location.search],
  )
  const here = useHere()
  const on_review = isReviewRoute(page)
  const address = `${location.pathname}${location.search}`
  const note_here = useNoteAddress(page, address)
  useRouteSync(page, here, note_here)

  // the workspace is expensive to build and cheap to keep, so it mounts on
  // the first review address and is never taken down again
  const [workspaceMounted, setWorkspaceMounted] = useState(on_review)
  useEffect(() => {
    if (on_review) setWorkspaceMounted(true)
  }, [on_review])

  useEffect(() => {
    setReviewActive(on_review)
  }, [on_review, setReviewActive])

  // where settings' "back" returns to: the last address that was not settings,
  // since settings' own sections are addresses and history walks those first
  useEffect(() => {
    if (page !== null && page.kind !== 'settings') rememberPlace(address)
  }, [page, address])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.font = fontScale
  }, [fontScale])

  // the address is part of the starting state: `init` gets what it asked for
  // so restoring tabs does not settle somewhere else first
  const start = useRef(
    page?.kind === 'review'
      ? { reviewId: page.reviewId, tab: page.tab }
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
          <div className="stickie-scroll absolute inset-0 z-30 overflow-auto bg-surface">
            <PageLayer page={page} />
          </div>
        )}
      </div>
      <Toasts />
      <ConfirmDialog />
    </div>
  )
}
