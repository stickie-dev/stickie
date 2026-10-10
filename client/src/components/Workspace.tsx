import { useCallback, useEffect, useRef } from 'react'
import { paneWidth } from '../panes'
import type { Page } from '../routes'
import { glass } from '../ui'
import { useReview } from '../store'
import { ActivityPanel } from './ActivityPanel'
import { CommentsPanel } from './CommentsPanel'
import { CommitsPanel } from './CommitsPanel'
import { FileTree } from './FileTree'
import { FileView } from './FileView'
import { PageArea } from './PageArea'
import { SearchOverlay } from './SearchOverlay'
import { SidePane } from './SidePane'
import { StatusBar } from './StatusBar'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'
import { UsagesPanel } from './UsagesPanel'
import { FindBar } from './FindBar'
import { PaneResizer } from './PaneResizer'

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
  const resumeDraft = useReview((s) => s.resumeDraft)
  const cancelDraft = useReview((s) => s.cancelDraft)

  const active = drafts.find((d) => d.id === activeDraftId) ?? drafts.at(-1)
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
    <div className={`fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg px-3 py-2 text-xs ring-1 ring-accent ${glass}`}>
      <span className="text-soft">
        {drafts.length > 1
          ? `${drafts.length} notes in progress; active on`
          : 'note in progress on'}{' '}
        <span className="font-mono text-ink">
          {cross_repo && repo_name !== undefined ? `${repo_name}:` : ''}
          {active.path}:L{active.startLine}
        </span>{' '}
        — “+ ref” on a selection here adds a reference to it
      </span>
      <button
        className="rounded bg-accent px-2 py-1 font-medium text-white hover:bg-accent-strong"
        onClick={() => void resumeDraft(active.id)}
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

/**
 * Moves the base pin when it goes stale, if the setting says stickie should.
 *
 * The server reports staleness and never acts on it: a GET that quietly writes
 * is worse than a policy living where the reviewer is. Tried once per stale
 * base, so a re-pin that fails leaves the banner rather than retrying forever.
 */
function useAutoRepin(): void {
  const session = useReview((s) => s.session)
  const threads = useReview((s) => s.threads)
  const mode = useReview((s) => s.repinMode)
  const repin = useReview((s) => s.repin)
  const tried = useRef('')

  // `baseStale` is only ever true for a base that moved *on*: a source that
  // moved off this base is reported as diverged and left alone, because a
  // setting is not permission to point a review at other work
  const stale = session?.baseStale === true
  // notes still with an agent, or still being written, are the reason to wait
  const busy = threads.some((t) => t.status !== 'resolved')

  useEffect(() => {
    // null means the setting has not been read yet, which is not permission
    if (!stale || session === null || mode === null || mode === 'never') return
    if (mode === 'when-clear' && busy) return
    const attempt = `${String(session.id)}:${session.baseSha}`
    if (tried.current === attempt) return
    tried.current = attempt
    void repin(true)
  }, [stale, busy, mode, session, repin])
}

/**
 * The review surface: everything whose state is expensive to rebuild —
 * mounted Monaco editors, the flow's scroll position and section heights, the
 * tab set. It is the one frame every view is drawn in, mounted for the whole
 * session: Home and Settings are tabs in it, shown in the main area over the
 * review, so the tree, the tabs and the footer never move and coming back to
 * the review lands the reader exactly where they left.
 *
 * `page` says what is in front. While it is Home or Settings, only the review
 * underneath them is `inert` — the tree, the tab strip and the footer are
 * still the reader's — and anything listening on `window` checks
 * `reviewActive` for itself.
 */
export function Workspace({ page }: { page: Page }) {
  const active = page.kind !== 'home' && page.kind !== 'settings'
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const activityOpen = useReview((s) => s.activityOpen)
  const openFind = useReview((s) => s.openFind)
  useAutoRepin()

  /**
   * ⌘F finds in what the tab in front shows — every file in the diff tab, the
   * one file in a file tab; ⌘⇧F searches every repository.
   *
   * Taken in the capture phase, before anything under the window sees it. A
   * Monaco editor with focus answers ⌘F itself, with a find for that one
   * editor, and stops the key there — so listening after it meant ⌘F found
   * across the diff or in one file depending on whether the reader had last
   * clicked into the code, which is the whole of why it was confusing. Now
   * there is one find, and the tab decides what it covers.
   */
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key !== 'f' && event.key !== 'F') return
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) setSearchOpen(true)
      else openFind(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, setSearchOpen, openFind])

  const row = useRef<HTMLDivElement>(null)
  const bounds = useCallback(() => {
    const el = row.current
    if (el === null) return null
    const box = el.getBoundingClientRect()
    return { left: box.left, width: box.width }
  }, [])

  const treeRatio = useReview((s) => s.paneRatios.tree)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar />
      <div className="flex min-h-0 grow flex-col">
        {/* the row the pane fractions are of; measured here rather than from
            the window, since that is what they are fractions of */}
        <div className="flex min-h-0 grow" ref={row}>
          <aside
            className="flex shrink-0 flex-col"
            style={{ width: paneWidth('tree', treeRatio) }}
          >
            <div className="min-h-0 grow">
              <FileTree />
            </div>
            <CommitsPanel />
          </aside>
          <PaneResizer pane="tree" side="left" bounds={bounds} />
          <main className="relative flex min-w-0 grow flex-col">
            <TabBar page={page} />
            <div className="relative min-h-0 grow">
              <div className="h-full" inert={!active}>
                <FileView />
              </div>
              {!active && (
                <div className="stickie-scroll absolute inset-0 z-20 overflow-auto bg-surface">
                  <PageArea page={page} />
                </div>
              )}
            </div>
            {/*
              Only over the review: the find bar searches the diff, and drawn
              over Home or Settings it would float over a page it cannot find
              anything in. Its state lives in the store, so it comes back
              exactly as it was.
            */}
            {active && <FindBar />}
          </main>
          <SidePane />
          {commentsOpen && (
            <>
              <PaneResizer pane="comments" side="right" bounds={bounds} />
              <CommentsPanel />
            </>
          )}
          {activityOpen && <ActivityPanel />}
        </div>
        <UsagesPanel />
        <StatusBar reviewInFront={active} />
      </div>
      {/* nothing covers the frame any more, so these are the reader's on
          every tab: a note still being written, and search across everything */}
      <DraftPill />
      <SearchOverlay />
    </div>
  )
}
