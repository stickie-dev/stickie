import { useState } from 'react'
import { useReview } from '../store'
import { btn } from '../ui'

interface Sibling {
  name: string
  path: string
  isDir: boolean
  current: boolean
}

/**
 * Bottom bar: where you are, and what the review still owes you. Every path
 * segment opens what sits beside it — folders and files at that level — so
 * the bar navigates rather than just reporting.
 */
export function StatusBar() {
  const repos = useReview((s) => s.repos)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const selectedPath = useReview((s) => s.selectedPath)
  const viewMode = useReview((s) => s.viewMode)
  const files = useReview((s) => s.files)
  const repoSessions = useReview((s) => s.repoSessions)
  const threads = useReview((s) => s.threads)
  const viewed = useReview((s) => s.viewed)
  const connected = useReview((s) => s.connected)
  const selectRepo = useReview((s) => s.selectRepo)
  const openDir = useReview((s) => s.openDir)
  const openFileInRepo = useReview((s) => s.openFileInRepo)
  const pushToast = useReview((s) => s.pushToast)
  const [open, setOpen] = useState<number | null>(null)

  const repo = repos.find((r) => r.id === activeRepoId)
  if (repo === undefined) return null

  const segments =
    viewMode === 'commits' || selectedPath === null
      ? []
      : selectedPath.split('/')
  const file = segments.at(-1)
  const dirs = segments.slice(0, -1)

  const entry = repoSessions[repo.id]
  // the all-files list when it has been fetched, else what changed
  const known =
    entry?.showAll === true && entry.allFiles !== null
      ? (entry?.allFiles ?? [])
      : files.map((f) => f.path)

  /** Folders and files directly under `parent`, in tree order. */
  const siblings = (parent: string): Sibling[] => {
    const prefix = parent === '' ? '' : `${parent}/`
    const dirs_seen = new Set<string>()
    const found: Sibling[] = []
    for (const path of known) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      if (rest === '') continue
      const slash = rest.indexOf('/')
      if (slash === -1) {
        found.push({
          name: rest,
          path,
          isDir: false,
          current: path === selectedPath,
        })
        continue
      }
      const name = rest.slice(0, slash)
      if (dirs_seen.has(name)) continue
      dirs_seen.add(name)
      found.push({
        name,
        path: `${prefix}${name}`,
        isDir: true,
        current: selectedPath?.startsWith(`${prefix}${name}/`) === true,
      })
    }
    return found.sort((a, b) =>
      a.isDir === b.isDir
        ? a.name.localeCompare(b.name)
        : a.isDir
          ? -1
          : 1,
    )
  }

  const unresolved = threads.filter((t) => t.status !== 'resolved').length
  // `pending` is the API's name for it; a person reading the bar sees a draft
  const drafts = threads.filter((t) => t.pending).length
  const seen = files.filter((f) => viewed.has(f.path)).length

  const copyPath = () => {
    if (selectedPath === null) return
    void navigator.clipboard
      .writeText(selectedPath)
      .then(() => pushToast('info', `copied ${selectedPath}`))
      .catch(() => pushToast('error', 'clipboard refused the path'))
  }

  const menu = (index: number, parent: string) => {
    const list = siblings(parent)
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(null)} />
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-72 w-80 overflow-y-auto rounded-lg bg-panel py-1 shadow-lifted">
          <button
            className="flex w-full items-center gap-2 px-2 py-1 text-left text-soft hover:bg-overlay hover:text-ink"
            onClick={() => {
              copyPath()
              setOpen(null)
            }}
          >
            copy the open file's path
          </button>
          <div className="my-1 border-t border-edge" />
          {list.length === 0 && (
            <p className="px-2 py-1 text-faint">
              nothing else here — turn on <span className="font-mono">all</span>{' '}
              in the tree to browse beyond the changed files
            </p>
          )}
          {list.map((item) => (
            <button
              key={item.path}
              className={`flex w-full items-center gap-2 px-2 py-1 text-left font-mono hover:bg-overlay ${item.current ? 'text-ink' : 'text-soft'}`}
              onClick={() => {
                setOpen(null)
                if (item.isDir) void openDir(repo.id, item.path)
                else void openFileInRepo(repo.id, item.path)
              }}
            >
              <span className="shrink-0 text-faint">
                {item.isDir ? '▸' : ' '}
              </span>
              <span className="truncate">{item.name}</span>
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <div className="relative flex shrink-0 items-center gap-1 border-t border-edge bg-panel px-3 py-1 text-[11px]">
      <button
        className={`shrink-0 ${btn()}`}
        title="make this repository active"
        onClick={() => void selectRepo(repo.id)}
      >
        {repo.name}
      </button>
      {dirs.map((dir, index) => {
        const path = dirs.slice(0, index + 1).join('/')
        return (
          <span key={path} className="relative flex min-w-0 items-center gap-1">
            <span className="text-faint">›</span>
            <button
              className={`truncate font-mono hover:text-ink ${open === index ? 'text-ink' : 'text-soft'}`}
              title={`what else is in ${path}`}
              onClick={() => setOpen(open === index ? null : index)}
            >
              {dir}
            </button>
            {open === index && menu(index, dirs.slice(0, index).join('/'))}
          </span>
        )
      })}
      {file !== undefined && (
        <span className="relative flex min-w-0 items-center gap-1">
          <span className="text-faint">›</span>
          <button
            className="truncate font-mono text-ink hover:underline"
            title="what else is in this folder"
            onClick={() => setOpen(open === dirs.length ? null : dirs.length)}
          >
            {file}
          </button>
          {open === dirs.length && menu(dirs.length, dirs.join('/'))}
        </span>
      )}
      <span className="grow" />
      <span className="shrink-0 text-faint">
        {files.length} changed · {seen} viewed · {unresolved} unresolved
        {drafts > 0 ? ` · ${drafts} draft` : ''}
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
