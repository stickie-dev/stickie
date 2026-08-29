import { Link } from 'react-router'
import type { ReviewSource } from '@stickie/shared'
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

  const changeSource = (key: string) => {
    const parsed = parse_source(key)
    // reviewing a single commit: diff it against its parent
    const is_commit =
      parsed.kind === 'ref' && /^[0-9a-f]{40}$/.test(parsed.value)
    void setSource(parsed, is_commit ? `${parsed.value}^` : undefined)
  }

  const select_classes =
    'rounded border border-edge bg-overlay px-1.5 py-1 text-ink'

  return (
    <header className="flex items-center gap-3 border-b border-edge px-3 py-2 text-xs">
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
        className={`max-w-72 ${select_classes}`}
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
            <optgroup label="commits (vs parent)">
              {targets.recentCommits.map((commit) => (
                <option key={commit.sha} value={`ref:${commit.sha}`}>
                  {commit.shortSha} {commit.subject.slice(0, 48)}
                </option>
              ))}
            </optgroup>
          </>
        )}
      </select>

      <label className="text-faint">base</label>
      <select
        className={`max-w-52 ${select_classes}`}
        value={baseRef ?? 'auto'}
        onChange={(e) =>
          void setBase(e.target.value === 'auto' ? undefined : e.target.value)
        }
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
        className="rounded border border-edge px-2 py-1 text-soft hover:text-ink"
        title="search all repos (⌘F / ⌘⇧F)"
        onClick={() => setSearchOpen(true)}
      >
        Search
      </button>
      <button
        className={`rounded border px-2 py-1 ${commentsOpen ? 'border-accent text-accent' : 'border-edge text-soft hover:text-ink'}`}
        title="toggle the all-comments panel"
        onClick={toggleComments}
      >
        Comments ({open_threads})
      </button>
      <button
        className={`rounded border px-2 py-1 ${activityOpen ? 'border-accent text-accent' : 'border-edge text-soft hover:text-ink'}`}
        title="what has happened in this review, and who did it"
        onClick={toggleActivity}
      >
        Activity
      </button>
      {pending_count > 0 && (
        <button
          className="rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500"
          title="send every draft note so agents can see them"
          onClick={() => void submitReview()}
        >
          Submit review ({pending_count})
        </button>
      )}
      <button
        className="rounded border border-edge px-2 py-1 text-soft hover:text-ink"
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
        className="rounded border border-edge px-2 py-1 text-soft hover:text-ink"
        title="settings"
        to={formatRoute({ kind: 'settings', section: 'identity' })}
      >
        ⚙
      </Link>
      <button
        className="rounded bg-accent px-2.5 py-1 font-medium text-white hover:bg-accent-strong disabled:opacity-50"
        disabled={session === null}
        onClick={() => void copyPrompt()}
      >
        {promptCopied ? 'copied ✓' : 'Copy prompt'}
      </button>
    </header>
  )
}
