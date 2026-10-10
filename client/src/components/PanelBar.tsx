import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Page } from '../routes'
import { formatRoute } from '../routes'
import { useReview } from '../store'
import type { LowerPanel } from '../store'
import { Comment, Commit, Files, History, Search, Sliders } from '../icons'
import { bar_button, bar_button_on } from '../ui'

function Place({
  title,
  label,
  on,
  onClick,
  children,
  badge,
}: {
  title: string
  label: string
  on: boolean
  onClick: () => void
  children: ReactNode
  badge?: number
}) {
  return (
    <button
      className={`relative ${on ? bar_button_on : bar_button}`}
      title={title}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-amber-500/90 px-1 text-[9px] leading-3.5 font-medium text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/**
 * Where every panel lives, down the left edge.
 *
 * Panels were words in the top bar — Search, Comments, Activity — beside the
 * controls for how the diff is drawn, and the commits list had no button at
 * all, only a strip squeezed under the tree. A reader had to know each one was
 * there to find it. Here each has a place that is always on screen, lit while
 * it is open, and a second click puts it away again.
 *
 * The icons are grouped by where they open, a rule between each group, so
 * the bar is also a map: Files, in the upper left; Commits and Activity, which
 * take turns in the one slot below the files, so lighting one puts the other
 * away; Search, over everything; Comments, on the right, beside the code it is
 * about. Panels are meant to become movable; until then this is where each
 * one sits.
 */
/** Between two groups of places: what is on either side opens somewhere else. */
function Rule() {
  return <span className="my-0.5 h-px w-5 shrink-0 bg-edge" aria-hidden="true" />
}

export function PanelBar({ page }: { page: Page }) {
  const filesOpen = useReview((s) => s.filesOpen)
  const toggleFiles = useReview((s) => s.toggleFiles)
  const lowerPanel = useReview((s) => s.lowerPanel)
  const toggleLower = useReview((s) => s.toggleLower)
  const searchOpen = useReview((s) => s.searchOpen)
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const toggleComments = useReview((s) => s.toggleComments)
  const threads = useReview((s) => s.threads)
  const unresolved = threads.filter((t) => t.status === 'open').length
  const settingsTab = useReview((s) => s.settingsTab)

  const lower = (panel: LowerPanel) => ({
    on: lowerPanel === panel,
    onClick: () => toggleLower(panel),
  })

  return (
    <nav
      aria-label="panels"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-edge bg-surface py-1.5"
    >
      <Place
        label="files"
        title={'files — every open repository\nupper left'}
        on={filesOpen}
        onClick={toggleFiles}
      >
        <Files />
      </Place>
      <Rule />
      <Place
        label="commits"
        title={'commits of this review — click one, ⌘-click to add, shift-click for a span\nbelow the files'}
        {...lower('commits')}
      >
        <Commit />
      </Place>
      <Place
        label="activity"
        title={'what has happened in this review, and who did it\nbelow the files, in place of commits'}
        {...lower('activity')}
      >
        <History />
      </Place>
      <Rule />
      <Place
        label="search"
        title={'search every repository\nshortcut: ⌘⇧F, or press Shift twice'}
        on={searchOpen}
        onClick={() => setSearchOpen(true)}
      >
        <Search />
      </Place>
      <Rule />
      <Place
        label="comments"
        title={`comments on this review — ${String(unresolved)} unresolved\non the right`}
        on={commentsOpen}
        onClick={toggleComments}
        badge={unresolved}
      >
        <Comment />
      </Place>
      <span className="grow" />
      <Link
        className={page.kind === 'settings' ? bar_button_on : bar_button}
        title="settings"
        aria-label="settings"
        to={formatRoute({ kind: 'settings', section: settingsTab ?? 'identity' })}
      >
        <Sliders />
      </Link>
    </nav>
  )
}
