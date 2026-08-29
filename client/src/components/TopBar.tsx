import { Link } from 'react-router'
import type { ReviewSource } from '@stickie/shared'
import { api } from '../api'
import { formatRoute } from '../routes'
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
  const importMr = useReview((s) => s.importMr)
  const copyPrompt = useReview((s) => s.copyPrompt)
  const promptCopied = useReview((s) => s.promptCopied)
  const connected = useReview((s) => s.connected)
  const threads = useReview((s) => s.threads)
  const navBack = useReview((s) => s.navBack)
  const navForward = useReview((s) => s.navForward)
  const canBack = useReview((s) => s.navIndex > 0)
  const canForward = useReview(
    (s) => s.navIndex < s.navHistory.length - 1,
  )

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
   * Changing the source or the base opens a *different* review: which pair is
   * being compared is what a review is. The notes stay with the review they
   * were written in, which is right — but walking away from them silently is
   * not, so this asks first.
   *
   * It does not ask when the new ref already contains the old one. There the
   * code the notes were written against is still present, the notes will
   * re-anchor onto it, and moving forward onto a branch that has your work in
   * it is not leaving anything behind.
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
    return window.confirm(
      `This review has ${String(notes)} ${notes === 1 ? 'note' : 'notes'}. ` +
        `They stay with ${from ?? 'it'} — comparing something else opens a ` +
        'different review, with its own notes. Continue?',
    )
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

  const changeBase = (value: string) => {
    void (async () => {
      // the base moving is the same question with the same answer: a base that
      // already contains the old one leaves the notes' code where it was
      const next = value === 'auto' ? undefined : value
      const from = baseRef ?? session?.baseRef ?? null
      const notes = threads.length
      if (notes > 0 && activeRepoId !== null && from !== null && next != null) {
        const answer = await api
          .ancestor(activeRepoId, from, next)
          .catch(() => ({ ancestor: false }))
        if (
          !answer.ancestor &&
          !window.confirm(
            `This review has ${String(notes)} ${notes === 1 ? 'note' : 'notes'} ` +
              `against ${from}. Comparing to ${next} instead opens a ` +
              'different review, with its own notes. Continue?',
          )
        ) {
          return
        }
      }
      await setBase(next)
    })()
  }

  const select_classes =
    'rounded border border-edge bg-overlay px-1.5 py-1 text-ink'

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-edge px-3 py-2 text-xs">
      <Link
        to="/"
        className="flex items-center gap-2"
        title="every review, across every repository"
      >
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-bold tracking-wide text-ink">stickie</span>
      </Link>
      <span
        className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-faint'}`}
        title={connected ? 'live updates on' : 'not connected'}
      />

      <button
        className="rounded border border-edge px-1.5 py-1 text-soft hover:text-ink disabled:opacity-40"
        title="back ( [ )"
        disabled={!canBack}
        onClick={() => void navBack()}
      >
        ‹
      </button>
      <button
        className="rounded border border-edge px-1.5 py-1 text-soft hover:text-ink disabled:opacity-40"
        title="forward ( ] )"
        disabled={!canForward}
        onClick={() => void navForward()}
      >
        ›
      </button>

      <span
        className="max-w-40 truncate font-semibold text-ink"
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

      {session !== null && (
        <span className="text-faint">@ {session.baseSha.slice(0, 8)}</span>
      )}
      {session?.baseStale === true && (
        <button
          className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
          title="HEAD moved past the pinned base; re-pin and carry open notes forward"
          onClick={() => void repin()}
        >
          base moved — re-pin
        </button>
      )}

      <span className="grow" />
      <button
        className="shrink-0 rounded border border-edge px-2 py-1 text-soft hover:text-ink"
        title="search all repos (⌘F / ⌘⇧F)"
        onClick={() => setSearchOpen(true)}
      >
        Search
      </button>
      <button
        className={`shrink-0 rounded border px-2 py-1 ${commentsOpen ? 'border-accent text-accent' : 'border-edge text-soft hover:text-ink'}`}
        title="toggle the all-comments panel"
        onClick={toggleComments}
      >
        Comments ({open_threads})
      </button>
      <button
        className={`shrink-0 rounded border px-2 py-1 ${activityOpen ? 'border-accent text-accent' : 'border-edge text-soft hover:text-ink'}`}
        title="what has happened in this review, and who did it"
        onClick={toggleActivity}
      >
        Activity
      </button>
      {pending_count > 0 && (
        <button
          className="shrink-0 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500"
          title="send every draft note so agents can see them"
          onClick={() => void submitReview()}
        >
          Submit review ({pending_count})
        </button>
      )}
      <button
        className="shrink-0 rounded border border-edge px-2 py-1 text-soft hover:text-ink"
        title="import unresolved GitLab MR discussions (needs GITLAB_TOKEN on the server)"
        disabled={session === null}
        onClick={() => {
          const mr = window.prompt('MR iid, !iid, or full URL')
          if (mr !== null && mr.trim() !== '') void importMr(mr)
        }}
      >
        Import MR
      </button>
      <Link
        className="shrink-0 rounded border border-edge px-2 py-1 text-soft hover:text-ink"
        title="settings"
        to={formatRoute({ kind: 'settings', section: 'identity' })}
      >
        ⚙
      </Link>
      <button
        className="shrink-0 rounded bg-accent px-2.5 py-1 font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        disabled={session === null}
        onClick={() => void copyPrompt()}
      >
        {promptCopied ? 'copied ✓' : 'Copy prompt'}
      </button>
    </header>
  )
}
