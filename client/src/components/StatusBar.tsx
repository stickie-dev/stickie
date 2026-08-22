import { useReview } from '../store'

/**
 * Bottom bar: where you are, and what the review still owes you. The path is
 * clickable segment by segment — repository, folders, then the file itself,
 * which copies its workspace-relative path.
 */
export function StatusBar() {
  const repos = useReview((s) => s.repos)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const selectedPath = useReview((s) => s.selectedPath)
  const viewMode = useReview((s) => s.viewMode)
  const files = useReview((s) => s.files)
  const threads = useReview((s) => s.threads)
  const viewed = useReview((s) => s.viewed)
  const connected = useReview((s) => s.connected)
  const selectRepo = useReview((s) => s.selectRepo)
  const openDir = useReview((s) => s.openDir)
  const pushToast = useReview((s) => s.pushToast)

  const repo = repos.find((r) => r.id === activeRepoId)
  if (repo === undefined) return null

  const segments = viewMode === 'commits' || selectedPath === null
    ? []
    : selectedPath.split('/')
  const file = segments.at(-1)
  const dirs = segments.slice(0, -1)

  const unresolved = threads.filter((t) => t.status !== 'resolved').length
  const pending = threads.filter((t) => t.pending).length
  const seen = files.filter((f) => viewed.has(f.path)).length

  const copyPath = () => {
    if (selectedPath === null) return
    void navigator.clipboard
      .writeText(selectedPath)
      .then(() => pushToast('info', `copied ${selectedPath}`))
      .catch(() => pushToast('error', 'clipboard refused the path'))
  }

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-edge bg-surface px-3 py-1 text-[11px]">
      <button
        className="shrink-0 text-soft hover:text-ink"
        title="make this repository active"
        onClick={() => void selectRepo(repo.id)}
      >
        {repo.name}
      </button>
      {dirs.map((dir, index) => {
        const path = dirs.slice(0, index + 1).join('/')
        return (
          <span key={path} className="flex min-w-0 items-center gap-1">
            <span className="text-faint">›</span>
            <button
              className="truncate font-mono text-soft hover:text-ink"
              title={`show ${path} in the tree`}
              onClick={() => void openDir(repo.id, path)}
            >
              {dir}
            </button>
          </span>
        )
      })}
      {file !== undefined && (
        <>
          <span className="text-faint">›</span>
          <button
            className="truncate font-mono text-ink hover:underline"
            title="copy this path"
            onClick={copyPath}
          >
            {file}
          </button>
        </>
      )}
      <span className="grow" />
      <span className="shrink-0 text-faint">
        {files.length} changed · {seen} viewed · {unresolved} unresolved
        {pending > 0 ? ` · ${pending} pending` : ''}
      </span>
      <span
        className={`ml-2 shrink-0 ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}
        title={connected ? 'watching for changes' : 'not connected'}
      >
        ●
      </span>
    </div>
  )
}
