import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type {
  NoteCounts,
  Overview,
  RepoOverview,
  ReviewOverview,
} from '@stickie/shared'
import { api } from '../api'
import { formatRoute } from '../routes'
import { timeValue } from '../time'
import { TimeAgo } from './TimeAgo'
import { useReview } from '../store'
import { Loading, Skeleton, SkeletonRows } from './Skeleton'
import { ask } from '../confirm'
import { badge, btn, card, enter, field, page, row, th } from '../ui'

/**
 * The landing page: every review across every registered repository, and what
 * each one is waiting for. This is the view the single-repo workspace could
 * never give — a pending batch or an unread agent answer in another repo was
 * invisible until you happened to switch to it.
 *
 * One table rather than a section per state: four headed groups of one row each
 * is more chrome than content, and a status column can be scanned where four
 * identical-looking headings cannot.
 */

const actions: Record<string, string> = {
  'note.created': 'raised a note',
  'note.replied': 'replied',
  'note.edited': 'edited a note',
  'note.resolved': 'resolved a note',
  'note.reopened': 'reopened a note',
  'note.deleted': 'deleted a note',
  'note.posted': 'sent a note to the agent',
  'review.opened': 'opened the review',
  'review.submitted': 'sent the review',
  'review.repinned': 're-pinned the base',
  'review.imported': 'imported notes',
  'review.exported': 'took the notes to an agent',
  'file.viewed': 'marked a file read',
  'file.unviewed': 'unmarked a file',
  'repo.added': 'added a repository',
  'repo.removed': 'removed a repository, and its reviews with it',
  'repo.unregistered': 'took a repository out of the workspace',
}

/** Reviews sort by how much they want from you, not by age. */
type Status = 'needs-you' | 'with-agent' | 'draft' | 'clear'

const status_rank: Record<Status, number> = {
  'needs-you': 0,
  'with-agent': 1,
  draft: 2,
  clear: 3,
}

const status_label: Record<Status, string> = {
  'needs-you': 'needs you',
  'with-agent': 'with agent',
  draft: 'draft',
  clear: 'clear',
}

const status_why: Record<Status, string> = {
  'needs-you': 'an agent has answered and nobody has looked yet',
  'with-agent': 'notes are with an agent, unanswered',
  draft: 'notes are still drafts — no agent can see them until you send them',
  clear: 'nothing unresolved',
}

const status_classes: Record<Status, string> = {
  'needs-you': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'with-agent': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  draft: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  clear: 'bg-overlay text-faint',
}

function statusOf(row: ReviewRow): Status {
  if (row.awaiting === 'you') return 'needs-you'
  if (row.awaiting === 'agent') return 'with-agent'
  return row.notes.pending > 0 ? 'draft' : 'clear'
}

/**
 * A row, and the reason there is a grouping step at all.
 *
 * The server has one entry per *session*, and a session's identity includes the
 * base commit it was pinned to. So reviewing a working tree against master,
 * then reviewing it again after master moves, is two sessions — two rows that
 * read identically apart from a base subject nobody would know was the thing
 * telling them apart.
 *
 * What a person means by "a review" is the thing being reviewed: this
 * repository's working tree, this branch, this one commit. That is
 * (repo, source), which is what a row is here. The bases it has been pinned to
 * are its history, and its counts are the whole history's.
 */
interface ReviewRow {
  key: string
  repoId: number
  repoName: string
  /** the newest session: what this review is pinned to now */
  current: ReviewOverview
  /** how many bases it has been pinned to, this one included */
  bases: number
  notes: NoteCounts
  agentReplies: number
  lastActivityAt: string | null
  lastAction: string | null
  lastActorName: string | null
  awaiting: 'you' | 'agent' | null
}

/** `reviews` arrives newest first, so the first session of a group is current. */
function rows(reviews: ReviewOverview[]): ReviewRow[] {
  const groups = new Map<string, ReviewOverview[]>()
  for (const review of reviews) {
    const key = `${String(review.repoId)}|${review.source.kind}|${review.source.value}`
    groups.set(key, [...(groups.get(key) ?? []), review])
  }
  return [...groups].flatMap(([key, sessions]) => {
    const current = sessions[0]
    if (current === undefined) return []
    const sum = (pick: (r: ReviewOverview) => number) =>
      sessions.reduce((n, r) => n + pick(r), 0)
    // by timestamp, not by session age: going back to an older base and
    // adding a note there is the most recent thing that happened
    const latest = sessions.reduce(
      (best, r) =>
        timeValue(r.lastActivityAt) > timeValue(best.lastActivityAt) ? r : best,
      current,
    )
    return [
      {
        key,
        repoId: current.repoId,
        repoName: current.repoName,
        current,
        bases: sessions.length,
        notes: {
          total: sum((r) => r.notes.total),
          open: sum((r) => r.notes.open),
          pending: sum((r) => r.notes.pending),
          resolved: sum((r) => r.notes.resolved),
          detached: sum((r) => r.notes.detached),
        },
        agentReplies: sum((r) => r.agentReplies),
        lastActivityAt: latest.lastActivityAt,
        lastAction: latest.lastAction,
        lastActorName: latest.lastActorName,
        // any session of the group wanting you is the whole review wanting you
        awaiting: sessions.some((r) => r.awaiting === 'you')
          ? 'you'
          : sessions.some((r) => r.awaiting === 'agent')
            ? 'agent'
            : null,
      },
    ]
  })
}

/**
 * Whether a row earns its place. Opening a commit against its parent creates a
 * review, and the commits sidebar does that on every click, so a workspace
 * accumulates one-off inspections nobody wrote anything in.
 */
function worthListing(row: ReviewRow): boolean {
  return row.notes.total > 0
}

/**
 * On the default branch there is nothing to compare a branch against, so
 * "against the default branch" and "what is not committed" are the same review
 * and only one of them is worth offering.
 */
function on_default(repo: RepoOverview): boolean {
  return repo.branch === repo.defaultBranch
}

/**
 * What this review compares, on two lines. The server has already turned each
 * side into a name and a commit subject, because a forty-character sha tells a
 * reader nothing and only git knows what it stands for.
 */
function Comparing({ row }: { row: ReviewRow }) {
  const { source, base } = row.current.comparing
  return (
    <td
      className="max-w-md px-2 py-2"
      title={`pinned at ${row.current.baseSha}`}
    >
      <div className="truncate">
        <span className="font-mono text-ink">{source.name}</span>
        {source.subject !== null && (
          <span className="ml-2 text-[11px] text-faint">{source.subject}</span>
        )}
      </div>
      <div className="truncate text-faint">
        <span className="font-mono">vs {base.name}</span>
        {base.subject !== null && <span className="ml-2">{base.subject}</span>}
        {row.bases > 1 && (
          <span
            className="ml-2"
            title="this review has been pinned to more than one base as the branch moved; the counts cover all of them"
          >
            (+{row.bases - 1} earlier {row.bases === 2 ? 'base' : 'bases'})
          </span>
        )}
      </div>
    </td>
  )
}

/**
 * What an activity row points at. A note event has a path; a review event has
 * none, and without something here four commit inspections in a row read as
 * the same line repeated.
 */
function where(detail: Record<string, unknown> | null): string {
  if (detail === null) return ''
  if (typeof detail.path === 'string' && detail.path !== '') {
    const line =
      typeof detail.startLine === 'number' && detail.startLine > 0
        ? `:L${String(detail.startLine)}`
        : ''
    return `${detail.path}${line}`
  }
  if (typeof detail.baseSha === 'string') return detail.baseSha.slice(0, 8)
  if (typeof detail.toBaseSha === 'string') return detail.toBaseSha.slice(0, 8)
  return ''
}

/** A zero is a dash, so a column of numbers can be read down. */
function Num({ value }: { value: number }) {
  return (
    <td
      className={`px-2 py-2 text-right tabular-nums ${value === 0 ? 'text-faint' : 'text-ink'}`}
    >
      {value === 0 ? '—' : value}
    </td>
  )
}

function Th({
  children,
  align,
  hint,
}: {
  children: React.ReactNode
  align?: 'right'
  hint?: string
}) {
  return (
    <th
      title={hint}
      className={`${th} ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function ReviewsTable({
  reviews,
  loading,
}: {
  reviews: ReviewRow[]
  loading: boolean
}) {
  const navigate = useNavigate()
  const sorted = [...reviews].sort((a, b) => {
    const by_status = status_rank[statusOf(a)] - status_rank[statusOf(b)]
    if (by_status !== 0) return by_status
    return timeValue(b.lastActivityAt) - timeValue(a.lastActivityAt)
  })

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-edge">
          <Th>Status</Th>
          <Th>Repository</Th>
          <Th>Comparing</Th>
          <Th align="right" hint="notes an agent still has to answer or you still have to close">
            Unresolved
          </Th>
          <Th align="right" hint="notes still drafts — written, but not sent to any agent">
            Drafts
          </Th>
          <Th align="right">Resolved</Th>
          <Th align="right" hint="notes whose code no longer exists">
            Detached
          </Th>
          <Th align="right" hint="how many times an agent has answered a note">
            Replies
          </Th>
          <Th>Last activity</Th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <SkeletonRows
            rows={3}
            columns={[
              'w-16',
              'w-24',
              'w-48',
              'w-6',
              'w-6',
              'w-6',
              'w-6',
              'w-6',
              'w-40',
            ]}
          />
        )}
        {sorted.map((review) => {
          const status = statusOf(review)
          // the newest session of the group: the base this review is pinned
          // to now. Its own address, so following it cannot land in a
          // different review of the same repository
          const to = formatRoute({
            kind: 'review',
            reviewId: review.current.sessionId,
            tab: { kind: 'diff' },
          })
          return (
            // the whole row opens the review; the repository name stays a real
            // link so ⌘-click, middle-click and the keyboard all still work,
            // which a click handler on its own would take away
            <tr
              key={review.key}
              className={`cursor-pointer ${row}`}
              onClick={() => void navigate(to)}
            >
              <td className="px-2 py-2.5">
                <span
                  title={status_why[status]}
                  className={`${badge} whitespace-nowrap ${status_classes[status]}`}
                >
                  {status_label[status]}
                </span>
              </td>
              <td className="px-2 py-2.5 font-medium whitespace-nowrap text-ink">
                <Link
                  className="hover:underline"
                  to={to}
                  onClick={(e) => e.stopPropagation()}
                >
                  {review.repoName}
                </Link>
              </td>
              <Comparing row={review} />
              <Num value={review.notes.open} />
              <Num value={review.notes.pending} />
              <Num value={review.notes.resolved} />
              <Num value={review.notes.detached} />
              <Num value={review.agentReplies} />
              <td className="px-2 py-2 text-faint">
                {review.lastAction === null ? (
                  '—'
                ) : (
                  <>
                    <TimeAgo at={review.lastActivityAt} /> ·{' '}
                    {review.lastActorName ?? 'someone'}{' '}
                    {actions[review.lastAction] ?? review.lastAction}
                  </>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function OverviewPage() {
  const navigate = useNavigate()
  const repos_in_store = useReview((s) => s.repos)
  const addRepoToWorkspace = useReview((s) => s.addRepo)
  const removeRepoFromWorkspace = useReview((s) => s.removeRepo)
  const removeMode = useReview((s) => s.removeMode)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showIdle, setShowIdle] = useState(false)
  const [newPath, setNewPath] = useState('')

  const load = useCallback(async () => {
    try {
      setOverview(await api.overview())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const addRepo = useCallback(async () => {
    const path = newPath.trim()
    if (path === '') return
    try {
      await addRepoToWorkspace(path)
      setNewPath('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [newPath, addRepoToWorkspace])

  /**
   * Removing asks first, and what it asks depends on the setting, because the
   * two answers are not comparable: one deletes a review history, the other
   * puts it out of sight. The count comes from the reviews already on this
   * page, so the dialog can say what is at stake rather than "are you sure".
   */
  const removeRepo = useCallback(
    async (repo: RepoOverview) => {
      if (removeMode === null) return
      const notes = (overview?.reviews ?? [])
        .filter((review) => review.repoId === repo.id)
        .reduce((n, review) => n + review.notes.total, 0)
      const keeping = removeMode === 'unregister' && notes > 0
      const counted =
        notes === 0
          ? 'It has no notes to lose.'
          : `${String(notes)} ${notes === 1 ? 'note goes' : 'notes go'} with it.`
      if (
        !(await ask({
          title: keeping
            ? `Take ${repo.name} out of the workspace?`
            : `Remove ${repo.name} and delete its reviews?`,
          detail: keeping
            ? `Its ${String(notes)} ${
                notes === 1 ? 'note is' : 'notes are'
              } kept — adding the path back brings them again.`
            : `${counted} This cannot be undone.`,
          confirmLabel: keeping ? 'Take it out' : 'Delete',
          danger: !keeping,
        }))
      ) {
        return
      }
      try {
        await removeRepoFromWorkspace(repo.id, removeMode)
        await load()
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [overview, removeMode, removeRepoFromWorkspace, load],
  )

  /**
   * What clicking a repository does: review its working tree against the
   * default branch — every commit on the branch you are on plus whatever is
   * not committed yet, which is what "what have I done here" means. On the
   * default branch itself that resolves to the working tree against HEAD,
   * which is browsing rather than reviewing, and is the right answer there.
   *
   * No base is passed: the server's own default is the merge-base with the
   * default branch, which is what a merge request compares. Naming the branch
   * outright would pin its *tip* instead, so anything that landed on it since
   * you branched would read as your change, backwards.
   *
   * `base` names one explicitly instead: `HEAD` is the working tree against
   * the last commit, which is the uncommitted work on its own. That is a
   * different review from the one against the default branch, with its own
   * notes, and both are worth being able to start from here — the row used to
   * reopen whichever of them this workspace happened to remember, which is not
   * something a reader can see or choose.
   *
   * Resolved on the click rather than being a link, because the review may not
   * exist yet and an address names one that does. `POST /api/sessions` is
   * get-or-create, so a second visit lands in the same review with the same
   * notes.
   */
  const openRepo = useCallback(
    async (repo: RepoOverview, base?: string) => {
      try {
        const review = await api.createSession(
          repo.id,
          { kind: 'worktree', value: repo.path },
          base,
        )
        await navigate(
          formatRoute({
            kind: 'review',
            reviewId: review.id,
            tab: { kind: 'diff' },
          }),
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [navigate],
  )

  useEffect(() => {
    void load()
  }, [load, repos_in_store])

  const repos = overview?.repos ?? []
  const all_rows = rows(overview?.reviews ?? [])
  const substantial = all_rows.filter(worthListing)
  const idle = all_rows.filter((r) => !worthListing(r))
  const listed = showIdle ? all_rows : substantial
  const repo_names = new Map(repos.map((repo) => [repo.id, repo.name]))
  const needs_you = all_rows.filter((r) => statusOf(r) === 'needs-you').length
  const drafts = all_rows.reduce((n, r) => n + r.notes.pending, 0)

  const loading = overview === null

  const headline =
    overview === null
      ? ''
      : needs_you > 0
        ? `${String(needs_you)} ${needs_you === 1 ? 'review has' : 'reviews have'} an agent answer nobody has read yet.`
        : substantial.length === 0
          ? 'No reviews with notes yet. Open a repository below to start one.'
          : 'Nothing is waiting on you.'

  return (
    <div className="min-h-full">
      {/*
        The bars stay full width — they belong to the window. What is read sits
        in a column with a ceiling on it and centred, because on a wide screen
        a table pinned to the left edge leaves the reader's eyes travelling
        across empty space to reach the numbers on the right.
      */}
      <header className="sticky top-0 z-10 bg-surface py-2.5 text-xs">
        <div className={`flex items-center gap-2.5 ${page}`}>
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-semibold tracking-tight text-ink">stickie</span>
        <span className="text-faint">overview</span>
        <span className="grow" />
        <button className={btn()} onClick={() => void load()}>
          reload
        </button>
        <Link
          className={btn()}
          to={formatRoute({ kind: 'settings', section: 'identity' })}
          title="settings"
        >
          settings
        </Link>
        </div>
      </header>

      <div>
        <div className={`${page} pt-2 pb-10 ${enter}`}>
        {error !== null && (
          <p className="mb-4 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}

        {loading ? (
          <Loading what="the overview">
            <div className="mb-6 space-y-2">
              <Skeleton w="w-80" h="h-4" />
              <Skeleton w="w-56" h="h-3" />
            </div>
          </Loading>
        ) : (
          <>
            <p className="mb-1 text-[15px] leading-snug font-medium text-ink">
              {headline}
            </p>
            <p className="mb-6 text-xs text-faint">
              {drafts > 0
                ? `${String(drafts)} ${drafts === 1 ? 'note is still a draft' : 'notes are still drafts'}, so no agent can see ${drafts === 1 ? 'it' : 'them'} yet.`
                : 'Every note you have written has been sent.'}
            </p>
          </>
        )}

        {(listed.length > 0 || loading) && (
          <section className="mb-10">
            <h2 className="mb-2 text-[13px] font-semibold text-ink">Reviews</h2>
            <div className={`overflow-x-auto ${card}`}>
              <ReviewsTable reviews={listed} loading={loading} />
            </div>
            <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-faint">
              A row is one thing being reviewed — a repository&rsquo;s working
              tree, a branch, or a single commit — and its counts cover every
              base it has been pinned to, so re-pinning after the branch moves
              keeps the same row. Hover a status or a column heading for what it
              means.
              {idle.length > 0 && (
                <>
                  {' '}
                  <button
                    className="text-accent hover:underline"
                    onClick={() => setShowIdle(!showIdle)}
                  >
                    {showIdle
                      ? 'hide'
                      : `show ${String(idle.length)} more`}
                  </button>{' '}
                  {showIdle ? '' : 'with no notes — opening a commit against '}
                  {showIdle ? '' : 'its parent starts a review too.'}
                </>
              )}
            </p>
          </section>
        )}

        <section className="mb-10">
          <h2 className="mb-2 text-[13px] font-semibold text-ink">
            Repositories
          </h2>
          <div className={`overflow-x-auto ${card}`}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-edge">
                  <Th>Repository</Th>
                  <Th>Branch</Th>
                  <Th>Working tree</Th>
                  <Th>Review</Th>
                  <Th>{''}</Th>
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr
                    key={repo.id}
                    className={`group cursor-pointer ${row}`}
                    onClick={() => void openRepo(repo)}
                  >
                    <td
                      className="px-2 py-2 font-semibold text-ink"
                      title={repo.path}
                    >
                      {repo.name}
                    </td>
                    <td className="px-2 py-2 font-mono text-soft">
                      {repo.branch}
                    </td>
                    <td className="px-2 py-2 text-soft">
                      {repo.changedFiles === 0
                        ? 'no changes'
                        : `${String(repo.changedFiles)} ${repo.changedFiles === 1 ? 'file' : 'files'} changed`}
                    </td>
                    <td className="px-2 py-2">
                      {/*
                        Buttons rather than links, because the address of what
                        they open is not known until it exists: which review it
                        is depends on the repository's current branch and on its
                        default branch. ⌘-click and the keyboard lose out here;
                        the rows above, which name a review that already exists,
                        keep real links.
                      */}
                      <span className="flex items-baseline gap-3">
                        <span className="text-accent hover:underline">
                          {on_default(repo)
                            ? 'browse the working tree'
                            : `review against ${repo.defaultBranch}`}
                        </span>
                        {!on_default(repo) && (
                          <button
                            className={`text-[11px] ${btn()}`}
                            title="the working tree against the last commit — what is not committed yet, on its own"
                            onClick={(e) => {
                              e.stopPropagation()
                              void openRepo(repo, 'HEAD')
                            }}
                          >
                            local changes
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        // the setting decides what this does, so it cannot be
                        // offered before the setting has been read
                        disabled={removeMode === null}
                        title={
                          removeMode === 'unregister'
                            ? 'take this repository out of the workspace, keeping its notes'
                            : 'remove this repository and delete its reviews'
                        }
                        className={`opacity-0 group-hover:opacity-100 focus:opacity-100 ${btn('text', 'hover:text-rose-500')}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void removeRepo(repo)
                        }}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
                {loading && (
                  <SkeletonRows
                    rows={2}
                    columns={['w-24', 'w-32', 'w-24', 'w-36', 'w-12']}
                  />
                )}
                {overview !== null && repos.length === 0 && (
                  <tr>
                    <td className="px-2 py-2 text-faint" colSpan={5}>
                      No repositories registered yet.
                    </td>
                  </tr>
                )}
                <tr className="border-t border-edge">
                  <td className="px-2 py-2" colSpan={3}>
                    <input
                      className={`w-full font-mono text-xs ${field}`}
                      placeholder="~/path/to/a/git/repository"
                      value={newPath}
                      onChange={(e) => setNewPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void addRepo()
                      }}
                    />
                  </td>
                  <td className="px-2 py-2" colSpan={2}>
                    <button
                      className={btn('primary')}
                      disabled={newPath.trim() === ''}
                      onClick={() => void addRepo()}
                    >
                      add repository
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-ink">Activity</h2>
          <div className={`overflow-x-auto ${card}`}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-edge">
                  <Th>When</Th>
                  <Th>Repository</Th>
                  <Th>Who</Th>
                  <Th>Did what</Th>
                  <Th>Where</Th>
                </tr>
              </thead>
              <tbody>
                {(overview?.recent ?? []).map((entry) => (
                  <tr key={entry.id} className={row}>
                    <td className="px-2 py-1.5 whitespace-nowrap text-faint">
                      <TimeAgo at={entry.at} />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-soft">
                      {repo_names.get(entry.repoId ?? -1) ?? ''}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink">
                      {entry.actorName ?? 'someone'}
                    </td>
                    <td className="px-2 py-1.5 text-soft">
                      {actions[`${entry.subject}.${entry.action}`] ??
                        `${entry.subject} ${entry.action}`}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-faint">
                      {where(entry.detail)}
                    </td>
                  </tr>
                ))}
                {loading && (
                  <SkeletonRows
                    rows={6}
                    columns={['w-16', 'w-20', 'w-24', 'w-40', 'w-32']}
                  />
                )}
                {overview !== null && overview.recent.length === 0 && (
                  <tr>
                    <td className="px-2 py-2 text-faint" colSpan={5}>
                      Nothing recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            From the append-only record, across every repository, newest first.
          </p>
        </section>
        </div>
      </div>
    </div>
  )
}
