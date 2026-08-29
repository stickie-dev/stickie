import { useEffect, useRef } from 'react'
import { useReview } from '../store'
import { ActivityPanel } from './ActivityPanel'
import { CommentsPanel } from './CommentsPanel'
import { CommitsPanel } from './CommitsPanel'
import { FileTree } from './FileTree'
import { FileView } from './FileView'
import { SearchOverlay } from './SearchOverlay'
import { SidePane } from './SidePane'
import { StatusBar } from './StatusBar'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'
import { UsagesPanel } from './UsagesPanel'
import { FindBar } from './FindBar'

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
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-lg border border-accent bg-panel px-3 py-2 text-xs shadow-xl">
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
 * tab set. It is mounted on the first visit to a review address and then
 * stays mounted for the rest of the session, with the other pages drawn over
 * it, so coming back lands the reader exactly where they left.
 *
 * `active` is false while a page covers it: `inert` takes the covered tree out
 * of focus and the accessibility tree, and anything listening on `window`
 * checks `reviewActive` for itself.
 */
export function Workspace({ active }: { active: boolean }) {
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const activityOpen = useReview((s) => s.activityOpen)
  const openFind = useReview((s) => s.openFind)
  useAutoRepin()

  /**
   * ⌘F finds in the review you are reading; ⌘⇧F searches every repository.
   *
   * ⌘F used to do the second of those, which is a different question — and
   * inside an editor it fell through to Monaco's own find, which searches that
   * one file, so on a twenty-file diff it searched a twentieth of the screen.
   * It is taken everywhere in the review now, including inside an editor, since
   * that is where a reader's hand goes and the answer they want is the whole
   * diff. The workspace search keeps ⌘⇧F and the Search button.
   */
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key !== 'f' && event.key !== 'F') return
      event.preventDefault()
      if (event.shiftKey) setSearchOpen(true)
      else openFind(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, setSearchOpen, openFind])

  return (
    <div className="flex h-full min-h-0 flex-col" inert={!active}>
      <TopBar />
      <div className="flex min-h-0 grow flex-col">
        <div className="flex min-h-0 grow">
          <aside className="flex w-64 shrink-0 flex-col border-r border-edge">
            <div className="min-h-0 grow">
              <FileTree />
            </div>
            <CommitsPanel />
          </aside>
          <main className="relative flex min-w-0 grow flex-col">
            <TabBar />
            <div className="min-h-0 grow">
              <FileView />
            </div>
            {/*
              Gated like the others: the find bar is `absolute z-40` and the
              page layer drawn over the workspace is z-30, so an open find bar
              stayed on top of settings — visible, and unclickable, because
              `inert` had taken the whole covered tree out. Its state lives in
              the store, so it comes back exactly as it was.
            */}
            {active && <FindBar />}
          </main>
          <SidePane />
          {commentsOpen && <CommentsPanel />}
          {activityOpen && <ActivityPanel />}
        </div>
        <UsagesPanel />
        <StatusBar />
      </div>
      {active && <DraftPill />}
      {active && <SearchOverlay />}
    </div>
  )
}
