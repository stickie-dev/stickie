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
import { PanelBar } from './PanelBar'
import { SearchOverlay } from './SearchOverlay'
import { SidePane } from './SidePane'
import { StandInBanner } from './StandInBanner'
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
/** The second Shift has to come this soon after the first to count as a pair. */
const double_shift_ms = 350

export function Workspace({ page }: { page: Page }) {
  const active = page.kind !== 'home' && page.kind !== 'settings'
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const filesOpen = useReview((s) => s.filesOpen)
  const lowerPanel = useReview((s) => s.lowerPanel)
  const openFind = useReview((s) => s.openFind)
  const flipFindScope = useReview((s) => s.flipFindScope)
  useAutoRepin()

  /**
   * ⌘F finds in what the tab shows — every file in the diff tab, the one file
   * in a file tab — and ⌘F again, while find is open, flips between the two:
   * the file you are in, or the whole diff. ⌘⇧F searches every repository, as
   * it always has, and so does Shift twice.
   *
   * Taken in the capture phase, before anything under the window sees it. A
   * Monaco editor with focus answers ⌘F itself, with a find for that one
   * editor, and stops the key there — so listening after it made the find you
   * got depend on where you had last clicked.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key !== 'f' && event.key !== 'F') return
      // on Home and Settings plain ⌘F is the page's own find, which is what a
      // page of text wants; ⌘⇧F searches everything from anywhere
      if (!event.shiftKey && !active) return
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) setSearchOpen(true)
      else if (useReview.getState().findOpen) void flipFindScope()
      else openFind(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, openFind, flipFindScope, setSearchOpen])

  /*
   * Shift twice, with nothing between: search everywhere. Any other key in
   * between — the capital letters of a sentence being typed — starts the count
   * again, so it cannot go off while someone is writing a note.
   */
  useEffect(() => {
    let last = 0
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') {
        last = 0
        return
      }
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const now = performance.now()
      if (now - last < double_shift_ms) {
        last = 0
        setSearchOpen(true)
      } else {
        last = now
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setSearchOpen])

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
        {/* the bar sits outside the measured row: the pane fractions are of
            what the panels can use, and counting the bar would put every
            drag of the tree's edge a bar's width off the pointer */}
        <div className="flex min-h-0 grow">
        <PanelBar page={page} />
        {/* `min-w-0`, because beside the bar the row is a flex item laid out
            sideways, and a flex item will not shrink below what its content
            asks for: a long tab strip or a wide line of code made the whole
            window scroll sideways and took the comments off its right edge */}
        <div className="flex min-h-0 min-w-0 grow" ref={row}>
          {(filesOpen || lowerPanel !== null) && (
            <>
              <aside
                className="flex shrink-0 flex-col"
                style={{ width: paneWidth('tree', treeRatio) }}
              >
                {filesOpen && (
                  <div className="min-h-0 grow">
                    <FileTree />
                  </div>
                )}
                {/* below the files and as tall as it needs, up to a little
                    under half; the whole column when the files are put away */}
                {lowerPanel !== null && (
                  <div
                    className={`flex min-h-0 flex-col ${
                      filesOpen ? 'max-h-[45%] shrink-0 border-t border-edge' : 'grow'
                    }`}
                  >
                    {lowerPanel === 'commits' ? <CommitsPanel /> : <ActivityPanel />}
                  </div>
                )}
              </aside>
              <PaneResizer pane="tree" side="left" bounds={bounds} />
            </>
          )}
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
        </div>
        </div>
        <UsagesPanel />
        <StandInBanner />
        <StatusBar reviewInFront={active} />
      </div>
      {/* nothing covers the frame any more, so these are the reader's on
          every tab: a note still being written, and search across everything */}
      <DraftPill />
      <SearchOverlay />
    </div>
  )
}
