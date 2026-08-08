import type { ReviewSource } from '@stickie/shared'
import { useReview } from '../store'

function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.slice(-2).join('/')
}

export function TopBar() {
  const repos = useReview((s) => s.repos)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const selectRepo = useReview((s) => s.selectRepo)
  const targets = useReview((s) => s.targets)
  const source = useReview((s) => s.source)
  const setSource = useReview((s) => s.setSource)
  const session = useReview((s) => s.session)
  const baseRef = useReview((s) => s.baseRef)
  const setBase = useReview((s) => s.setBase)
  const copyPrompt = useReview((s) => s.copyPrompt)
  const promptCopied = useReview((s) => s.promptCopied)
  const connected = useReview((s) => s.connected)
  const threads = useReview((s) => s.threads)
  const theme = useReview((s) => s.theme)
  const toggleTheme = useReview((s) => s.toggleTheme)

  const open_threads = threads.filter((t) => t.status === 'open').length

  const source_key = (s: ReviewSource) => `${s.kind}:${s.value}`
  const parse_source = (key: string): ReviewSource => {
    const idx = key.indexOf(':')
    return {
      kind: key.slice(0, idx) as ReviewSource['kind'],
      value: key.slice(idx + 1),
    }
  }

  const select_classes =
    'rounded border border-edge bg-overlay px-1.5 py-1 text-ink'

  return (
    <header className="flex items-center gap-3 border-b border-edge px-3 py-2 text-xs">
      <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
      <span className="font-bold tracking-wide text-ink">stickie</span>
      <span
        className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-faint'}`}
        title={connected ? 'live updates on' : 'not connected'}
      />

      <label className="text-faint">repo</label>
      <select
        className={select_classes}
        value={activeRepoId ?? ''}
        onChange={(e) => void selectRepo(Number(e.target.value))}
      >
        {repos.map((repo) => (
          <option key={repo.id} value={repo.id}>
            {repo.name}
          </option>
        ))}
      </select>

      <label className="text-faint">source</label>
      <select
        className={`max-w-72 ${select_classes}`}
        value={source === null ? '' : source_key(source)}
        onChange={(e) => void setSource(parse_source(e.target.value))}
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

      <span className="grow" />
      <span className="text-soft">
        {open_threads} open note{open_threads === 1 ? '' : 's'}
      </span>
      <button
        className="rounded border border-edge px-2 py-1 text-soft hover:text-ink"
        title="toggle theme"
        onClick={toggleTheme}
      >
        {theme === 'dark' ? 'light' : 'dark'}
      </button>
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
