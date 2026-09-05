import { Link } from 'react-router'
import type { ReviewSource } from '@stickie/shared'
import { api } from '../api'
import { ask } from '../confirm'
import { formatRoute } from '../routes'
import { Search, Send, Sliders } from '../icons'
import { btn, button_on, field, icon_button, title_bar } from '../ui'
import { ThemeToggle } from './ThemeToggle'
import { useReview } from '../store'

function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.slice(-2).join('/')
}

export function TopBar() {
  const repos = useReview((s) => s.repos)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const targets = useReview((s) => s.targets)
  const source = useReview((s) => s.source)
  const setSource = useReview((s) => s.setSource)
  const session = useReview((s) => s.session)
  const baseRef = useReview((s) => s.baseRef)
  const setBase = useReview((s) => s.setBase)
  const repin = useReview((s) => s.repin)
  const undoBase = useReview((s) => s.undoBase)
  const importMr = useReview((s) => s.importMr)
  const connected = useReview((s) => s.connected)
  const threads = useReview((s) => s.threads)
  const submitReview = useReview((s) => s.submitReview)
  const toggleComments = useReview((s) => s.toggleComments)
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const toggleActivity = useReview((s) => s.toggleActivity)
  const commentsOpen = useReview((s) => s.commentsOpen)
  const activityOpen = useReview((s) => s.activityOpen)
  const open_threads = threads.filter((t) => t.status === 'open').length
  const pending_count = threads.filter(
    (t) => t.pending && t.status === 'open',
  ).length

  const source_key = (s: ReviewSource) => `${s.kind}:${s.value}`
  const parse_source = (key: string): ReviewSource => {
    const idx = key.indexOf(':')
    return {
      kind: key.slice(0, idx) as ReviewSource['kind'],
      value: key.slice(idx + 1),
    }
  }

  /**
   * What a source or a base is, as a ref, for the question below. A worktree
   * is the branch it has checked out — a path is not something git can compare
   * histories with, and the branch is what the notes were written against.
   */
  const asRef = (target: ReviewSource | null): string | null => {
    if (target === null) return null
    if (target.kind === 'ref') return target.value
    return (
      targets?.worktrees.find((wt) => wt.path === target.value)?.branch ?? null
    )
  }

  /**
   * Changing the source moves to a *different* review: a review is of a
   * branch, and another branch is other work. The notes stay in the review
   * they were written in, which is right — walking away from them silently is
   * not, so this asks first.
   *
   * It does not ask when the new ref already contains the old one. There the
   * code the notes were written against is still present, the notes will
   * re-anchor onto it, and moving forward onto a branch that has your work in
   * it is not leaving anything behind.
   *
   * The *base* is not this question: it is a lens on the same branch and it
   * slides, taking the notes with it. See `changeBase`.
   */
  const leavingNotes = async (next: ReviewSource | null): Promise<boolean> => {
    const notes = threads.length
    if (notes === 0 || activeRepoId === null) return true
    const from = asRef(source)
    const to = asRef(next)
    if (from !== null && to !== null && from !== to) {
      const answer = await api
        .ancestor(activeRepoId, from, to)
        .catch(() => ({ ancestor: false }))
      if (answer.ancestor) return true
    }
    if (from !== null && to !== null && from === to) return true
    return ask({
      title: `Leave ${String(notes)} ${notes === 1 ? 'note' : 'notes'} behind?`,
      detail:
        `They stay with ${from ?? 'this review'} — another branch is another ` +
        'review, with its own notes. Nothing is deleted.',
      confirmLabel: 'Switch anyway',
    })
  }

  // A review is a worktree or a branch. Looking at one commit against its
  // parent is a way of reading that review, not a review of its own — the
  // commits list opens it in its own tab without minting anything.
  const changeSource = (key: string) => {
    const next = parse_source(key)
    void (async () => {
      if (await leavingNotes(next)) await setSource(next, undefined)
    })()
  }

  /**
   * The base slides: the same review of the same branch, read against
   * something else. Nothing is left behind and nothing is forked, so there is
   * no question to ask — except when the new base is on another line of
   * history, where the notes' code is not in it and they will detach. That is
   * worth a word before it happens; the move is undoable either way.
   */
  const changeBase = (value: string) => {
    void (async () => {
      const next = value === 'auto' ? undefined : value
      const from = baseRef ?? session?.baseRef ?? null
      const notes = threads.length
      if (notes > 0 && activeRepoId !== null && from !== null && next != null) {
        const answer = await api
          .ancestor(activeRepoId, from, next)
          .catch(() => ({ ancestor: false }))
        if (
          !answer.ancestor &&
          !(await ask({
            title: `${String(notes)} ${notes === 1 ? 'note' : 'notes'} may lose ${notes === 1 ? 'its' : 'their'} anchor`,
            detail:
              `They were written against ${from}, and ${next} is not on that ` +
              'line of history. They stay in this review either way, and the ' +
              'base can be moved back.',
            confirmLabel: `Read against ${next}`,
          }))
        ) {
          return
        }
      }
      await setBase(next)
    })()
  }

  const select_classes = `${field} py-0.5`

  const warning_button =
    'bg-amber-500/15 text-amber-700 ring-amber-500/40 hover:bg-amber-500/25 dark:text-amber-300'

  /**
   * Re-pinning onto a line of history the notes were not written against. It
   * is a reviewer's call and never a setting's, so this is the only way it
   * happens — and it asks first, since what follows is notes re-anchored
   * against unrelated code.
   */
  const moveBaseAnyway = async () => {
    if (session === null) return
    const notes = threads.length
    const sure = await ask({
      title: 'Move the base onto a different line of history?',
      detail:
        `The source does not have ${session.baseSha.slice(0, 8)} in its ` +
        'history — it was branched from an older commit, rebased, or reset. ' +
        (notes === 0
          ? 'Re-pinning measures this review against the new base instead.'
          : `Re-pinning re-anchors ${String(notes)} ` +
            `${notes === 1 ? 'note' : 'notes'} against code they were not ` +
            'written on; any that cannot be found turn detached. Nothing is ' +
            'deleted.'),
      confirmLabel: 'Re-pin anyway',
      danger: true,
    })
    if (sure) await repin()
  }

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
      <span
        className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-faint'}`}
        title={connected ? 'live updates on' : 'not connected'}
      />

      <span
        className="max-w-40 truncate font-medium text-ink"
        title="active repository — click any file in the tree to switch"
      >
        {repos.find((r) => r.id === activeRepoId)?.name ?? ''}
      </span>

      <label className="text-faint">source</label>
      <select
        className={`min-w-24 max-w-72 shrink ${select_classes}`}
        value={source === null ? '' : source_key(source)}
        onChange={(e) => changeSource(e.target.value)}
      >
        {targets !== null && (
          <>
            <optgroup label="worktrees (working tree)">
              {targets.worktrees.map((wt) => (
                <option key={wt.path} value={`worktree:${wt.path}`}>
                  {shortPath(wt.path)}
                  {wt.branch !== null ? ` (${wt.branch})` : ' (detached)'}
                </option>
              ))}
            </optgroup>
            <optgroup label="branches">
              {targets.branches.map((branch) => (
                <option key={branch.name} value={`ref:${branch.name}`}>
                  {branch.name}
                </option>
              ))}
            </optgroup>
          </>
        )}
      </select>

      <label className="text-faint">base</label>
      <select
        className={`min-w-20 max-w-52 shrink ${select_classes}`}
        value={baseRef ?? 'auto'}
        onChange={(e) => changeBase(e.target.value)}
      >
        <option value="auto">
          auto{session !== null ? ` (${session.baseRef})` : ''}
        </option>
        <option value="HEAD">HEAD</option>
        {targets?.branches.map((branch) => (
          <option key={branch.name} value={branch.name}>
            {branch.name}
          </option>
        ))}
      </select>

      {session?.prevBaseRef != null && (
        <button
          className={btn('outline')}
          title={`read against ${session.prevBaseRef} again — the base is a lens on this branch, not another review`}
          onClick={() => void undoBase()}
        >
          ↩ {session.prevBaseRef}
        </button>
      )}

      {session !== null && (
        <span className="text-faint">@ {session.baseSha.slice(0, 8)}</span>
      )}
      {session?.baseStale === true && (
        <button
          className={btn('outline', warning_button)}
          title="the base moved on past the pinned commit; re-pin and carry open notes forward"
          onClick={() => void repin()}
        >
          base moved — re-pin
        </button>
      )}
      {/*
        A different thing from a base that moved on, and it says so: the source
        is on a line of history this base is not in — a branch cut from an
        older commit, a rebase, a reset. Nothing re-pins it on its own; the
        offer is here, and it asks, because the notes were written against code
        this source does not have.
      */}
      {session?.baseDiverged === true && (
        <button
          className={btn('outline', warning_button)}
          title="the source does not have the pinned base in its history"
          onClick={() => void moveBaseAnyway()}
        >
          source moved off this base
        </button>
      )}

      <span className="grow" />
      <button
        className={`shrink-0 inline-flex items-center gap-1.5 ${btn()}`}
        title="search all repos (⌘F / ⌘⇧F)"
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
      <button
        className={`shrink-0 ${btn()}`}
        title="import unresolved GitLab MR discussions (needs GITLAB_TOKEN on the server)"
        disabled={session === null}
        onClick={() => {
          const mr = window.prompt('MR iid, !iid, or full URL')
          if (mr !== null && mr.trim() !== '') void importMr(mr)
        }}
      >
        Import MR
      </button>
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
