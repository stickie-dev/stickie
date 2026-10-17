import { Link } from 'react-router'
import { formatRoute } from '../routes'
import {
  Check,
  CopyPrompt,
  NavBack,
  NavForward,
  Refresh,
  Send,
} from '../icons'
import { btn, icon_button, title_bar } from '../ui'
import { ThemeToggle } from './ThemeToggle'
import { ViewToggles } from './ViewToggles'
import { useReview } from '../store'

export function TopBar() {
  const threads = useReview((s) => s.threads)
  const submitReview = useReview((s) => s.submitReview)
  const session = useReview((s) => s.session)
  const copyPrompt = useReview((s) => s.copyPrompt)
  const promptCopied = useReview((s) => s.promptCopied)
  const navBack = useReview((s) => s.navBack)
  const navForward = useReview((s) => s.navForward)
  const reloadAll = useReview((s) => s.reloadAll)
  const canBack = useReview((s) => s.navIndex > 0)
  const canForward = useReview((s) => s.navIndex < s.navHistory.length - 1)
  const pending_count = threads.filter(
    (t) => t.pending && t.status === 'open',
  ).length

  // the app's bar, the same on every tab: where you have been, sending, and how
  // every diff is drawn. The panels moved to the bar down the left edge, where
  // each has a place that stays on screen.
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
        {/*
          With the arrows, since it is about where you are rather than what to
          do there. Refs are watched, so this is for what stickie missed — a
          change on a network drive, a watch the system dropped — and for
          not having to wonder.
        */}
        <button
          className={icon_button}
          title={'read every open repository again — the diff, the notes, the branches\nnothing is fetched from a remote'}
          aria-label="reload"
          onClick={() => void reloadAll()}
        >
          <Refresh />
        </button>
      </div>
      <span className="grow" />
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
        {promptCopied ? <Check /> : <CopyPrompt />}
      </button>
      <span className="ml-1.5" />
      <ViewToggles />
      <ThemeToggle />
    </header>
  )
}
