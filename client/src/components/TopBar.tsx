import { Link } from 'react-router'
import { formatRoute } from '../routes'
import {
  Check,
  Clipboard,
  NavBack,
  NavForward,
  Search,
  Send,
  Sliders,
} from '../icons'
import { btn, button_on, icon_button, title_bar } from '../ui'
import { ThemeToggle } from './ThemeToggle'
import { ViewToggles } from './ViewToggles'
import { useReview } from '../store'

export function TopBar() {
  const threads = useReview((s) => s.threads)
  const submitReview = useReview((s) => s.submitReview)
  const toggleComments = useReview((s) => s.toggleComments)
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const toggleActivity = useReview((s) => s.toggleActivity)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const activityOpen = useReview((s) => s.activityOpen)
  const session = useReview((s) => s.session)
  const copyPrompt = useReview((s) => s.copyPrompt)
  const promptCopied = useReview((s) => s.promptCopied)
  const navBack = useReview((s) => s.navBack)
  const navForward = useReview((s) => s.navForward)
  const canBack = useReview((s) => s.navIndex > 0)
  const canForward = useReview((s) => s.navIndex < s.navHistory.length - 1)
  const open_threads = threads.filter((t) => t.status === 'open').length
  const pending_count = threads.filter(
    (t) => t.pending && t.status === 'open',
  ).length

  // the overview's and settings' bar, on the review: the same surface, the same
  // rhythm and the same buttons, so moving between the three pages does not
  // feel like moving between three applications. The one division under the
  // chrome is the tab strip's, below this.
  return (
    <header
      className={`stickie-titlebar-pad flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2 text-xs ${title_bar}`}
    >
      <Link
        to="/"
        className="flex items-center gap-2"
        title="every review, across every repository"
      >
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-semibold tracking-tight text-ink">stickie</span>
      </Link>
      {/*
        Where you have been crosses tabs and reviews, so it walks from the app's
        bar rather than from beside the tabs, where two chevrons read as
        scrolling them.
      */}
      <div className="ml-2 flex shrink-0 items-center">
        <button
          className={icon_button}
          title={'back to where you were reading\nshortcut: ['}
          aria-label="back"
          disabled={!canBack}
          onClick={() => void navBack()}
        >
          <NavBack />
        </button>
        <button
          className={icon_button}
          title={'forward again\nshortcut: ]'}
          aria-label="forward"
          disabled={!canForward}
          onClick={() => void navForward()}
        >
          <NavForward />
        </button>
      </div>
      <span className="grow" />
      <button
        className={`shrink-0 inline-flex items-center gap-1.5 ${btn()}`}
        title={'search every repository\nshortcut: ⌘⇧F, or press Shift twice'}
        onClick={() => setSearchOpen(true)}
      >
        <Search />
        Search
      </button>
      <button
        className={`shrink-0 ${commentsOpen ? button_on : btn()}`}
        title="toggle the all-comments panel"
        onClick={toggleComments}
      >
        Comments ({open_threads})
      </button>
      <button
        className={`shrink-0 ${activityOpen ? button_on : btn()}`}
        title="what has happened in this review, and who did it"
        onClick={toggleActivity}
      >
        Activity
      </button>
      {pending_count > 0 && (
        <button
          className={`shrink-0 inline-flex items-center gap-1.5 ${btn('secondary', 'px-2.5')}`}
          title="send every draft note so agents can see them"
          onClick={() => void submitReview()}
        >
          <Send />
          Submit review ({pending_count})
        </button>
      )}
      {/*
        Beside sending, since it is the other way a review's notes reach an
        agent: as text on the clipboard rather than through the server.
      */}
      <button
        className={`shrink-0 ${icon_button}`}
        title={
          promptCopied
            ? 'copied'
            : 'copy every unresolved note as a prompt, to paste into any agent'
        }
        aria-label="copy this review as a prompt"
        disabled={session === null}
        onClick={() => void copyPrompt()}
      >
        {promptCopied ? <Check /> : <Clipboard />}
      </button>
      <span className="ml-1.5" />
      <ViewToggles />
      <ThemeToggle />
      <Link
        className={`shrink-0 ${icon_button}`}
        title="settings"
        aria-label="settings"
        to={formatRoute({ kind: 'settings', section: 'identity' })}
      >
        <Sliders />
      </Link>
    </header>
  )
}
