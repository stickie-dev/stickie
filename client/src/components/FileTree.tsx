import { useMemo, useState } from 'react'
import type { ChangedFile } from '@stickie/shared'
import { fileIconUrl, folderIconUrl } from '../fileIcons'
import { useReview } from '../store'

const status_letter: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
}

const status_color: Record<ChangedFile['status'], string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-amber-600 dark:text-amber-400',
  deleted: 'text-rose-600 dark:text-rose-400',
  renamed: 'text-sky-600 dark:text-sky-400',
  untracked: 'text-emerald-700 dark:text-emerald-600',
}

interface TreeFile {
  path: string
  name: string
  status: ChangedFile['status'] | null
  oldPath?: string
}

interface TreeDir {
  name: string
  path: string
  dirs: TreeDir[]
  files: TreeFile[]
}

function buildTree(files: TreeFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] }
  const dir_map = new Map<string, TreeDir>([['', root]])
  const ensureDir = (path: string): TreeDir => {
    const existing = dir_map.get(path)
    if (existing !== undefined) return existing
    const idx = path.lastIndexOf('/')
    const parent = ensureDir(idx === -1 ? '' : path.slice(0, idx))
    const dir: TreeDir = { name: path.slice(idx + 1), path, dirs: [], files: [] }
    parent.dirs.push(dir)
    dir_map.set(path, dir)
    return dir
  }
  for (const file of files) {
    const idx = file.path.lastIndexOf('/')
    ensureDir(idx === -1 ? '' : file.path.slice(0, idx)).files.push(file)
  }
  for (const dir of dir_map.values()) {
    dir.dirs.sort((a, b) => a.name.localeCompare(b.name))
    dir.files.sort((a, b) => a.name.localeCompare(b.name))
  }
  return root
}

/** Collapse chains of single empty directories: a/b/c shows as one row. */
function compress(dir: TreeDir): TreeDir {
  let current = dir
  let name = dir.name
  while (current.dirs.length === 1 && current.files.length === 0) {
    const only = current.dirs[0]
    if (only === undefined) break
    name = name === '' ? only.name : `${name}/${only.name}`
    current = only
  }
  return {
    name,
    path: current.path,
    files: current.files,
    dirs: current.dirs.map(compress),
  }
}

export function FileTree() {
  const files = useReview((s) => s.files)
  const allFiles = useReview((s) => s.allFiles)
  const showAll = useReview((s) => s.showAll)
  const setShowAll = useReview((s) => s.setShowAll)
  const selectedPath = useReview((s) => s.selectedPath)
  const openFile = useReview((s) => s.openFile)
  const threads = useReview((s) => s.threads)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const status_by_path = useMemo(
    () => new Map(files.map((f) => [f.path, f])),
    [files],
  )

  const tree = useMemo(() => {
    const items: TreeFile[] = showAll
      ? (allFiles ?? []).map((path) => ({
          path,
          name: path.split('/').at(-1) ?? path,
          status: status_by_path.get(path)?.status ?? null,
        }))
      : files.map((f) => ({
          path: f.path,
          name: f.path.split('/').at(-1) ?? f.path,
          status: f.status,
          oldPath: f.oldPath,
        }))
    const root = buildTree(items)
    return { ...root, dirs: root.dirs.map(compress) }
  }, [showAll, allFiles, files, status_by_path])

  const open_count = (path: string) =>
    threads.filter((t) => t.path === path && t.status === 'open').length

  const toggleDir = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderFile = (file: TreeFile) => {
    const icon = fileIconUrl(file.name)
    return (
      <button
        key={file.path}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 pl-2 text-left font-mono hover:bg-overlay ${selectedPath === file.path ? 'bg-overlay' : ''}`}
        onClick={() => void openFile(file.path, file.status ?? undefined)}
        title={
          file.oldPath !== undefined
            ? `${file.oldPath} → ${file.path}`
            : file.path
        }
      >
        {icon !== null && <img src={icon} alt="" className="h-4 w-4 shrink-0" />}
        <span
          className={`truncate ${file.status !== null ? 'text-ink' : 'text-soft'}`}
        >
          {file.name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {open_count(file.path) > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 text-amber-700 dark:text-amber-300">
              {open_count(file.path)}
            </span>
          )}
          {file.status !== null && (
            <span className={`w-3 ${status_color[file.status]}`}>
              {status_letter[file.status]}
            </span>
          )}
        </span>
      </button>
    )
  }

  // each nesting level is a bordered container, so indentation and the
  // vertical guide line come from the same structure
  const renderDir = (dir: TreeDir): React.ReactNode => (
    <div key={dir.path}>
      {dir.name !== '' && (
        <button
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-overlay"
          onClick={() => toggleDir(dir.path)}
        >
          <span className="w-2 shrink-0 text-faint">
            {collapsed.has(dir.path) ? '▸' : '▾'}
          </span>
          {(() => {
            const icon = folderIconUrl(dir.name, !collapsed.has(dir.path))
            return icon !== null ? (
              <img src={icon} alt="" className="h-4 w-4 shrink-0" />
            ) : null
          })()}
          <span className="truncate text-soft">{dir.name}</span>
        </button>
      )}
      {(dir.name === '' || !collapsed.has(dir.path)) && (
        <div
          className={
            dir.name === '' ? '' : 'ml-[13px] border-l border-edge/70'
          }
        >
          {dir.dirs.map((child) => renderDir(child))}
          {dir.files.map(renderFile)}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-edge text-xs">
        <button
          className={`px-3 py-1.5 ${showAll ? 'text-faint hover:text-soft' : 'border-b-2 border-accent text-ink'}`}
          onClick={() => void setShowAll(false)}
        >
          Changed ({files.length})
        </button>
        <button
          className={`px-3 py-1.5 ${showAll ? 'border-b-2 border-accent text-ink' : 'text-faint hover:text-soft'}`}
          onClick={() => void setShowAll(true)}
        >
          All files
        </button>
      </div>
      <div className="min-h-0 grow overflow-y-auto py-1 text-xs">
        {renderDir(tree)}
        {!showAll && files.length === 0 && (
          <p className="px-3 py-2 text-faint">No changes to review.</p>
        )}
        {showAll && allFiles === null && (
          <p className="px-3 py-2 text-faint">loading…</p>
        )}
      </div>
    </div>
  )
}
