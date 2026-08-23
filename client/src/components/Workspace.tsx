import { useEffect } from 'react'
import { useReview } from '../store'
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

  // cmd+shift+F always opens workspace search; plain cmd+F only outside
  // editors and inputs so Monaco's in-file find keeps working
  useEffect(() => {
    if (!active) return
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
  }, [active, setSearchOpen])

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
      {active && <DraftPill />}
      {active && <SearchOverlay />}
    </div>
  )
}
