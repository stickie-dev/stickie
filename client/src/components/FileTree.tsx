import { useEffect, useMemo, useState } from 'react'
import type { ChangedFile } from '@stickie/shared'
import { fileIconUrl, folderIconUrl } from '../fileIcons'
import { repoFiles, useReview } from '../store'
import { Loading, Skeleton } from './Skeleton'
import { ChevronDown, ChevronRight } from '../icons'
import { field, motion } from '../ui'

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

const test_file_pattern =
  /^(test_|tests?\.)|\.(test|spec)\.|_test\.|^conftest\./

function isTestFile(name: string): boolean {
  return test_file_pattern.test(name)
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
    // tests read best after the code they exercise
    dir.files.sort((a, b) => {
      const rank = Number(isTestFile(a.name)) - Number(isTestFile(b.name))
      return rank !== 0 ? rank : a.name.localeCompare(b.name)
    })
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

/** One registered repository as a top-level node of the workspace tree. */
function RepoNode({ repoId }: { repoId: number }) {
  const repo = useReview((s) => s.repos.find((r) => r.id === repoId))
  const entry = useReview((s) => s.repoSessions[repoId])
  // this repository's changed files, whether or not it is the active one:
  // one list, so the count here cannot disagree with the diff beside it
  const files = useReview((s) => repoFiles(s, repoId))
  const activeRepoId = useReview((s) => s.activeRepoId)
  const selectRepo = useReview((s) => s.selectRepo)
  const selectedPath = useReview((s) => s.selectedPath)
  const openFileInRepo = useReview((s) => s.openFileInRepo)
  const showFileInRepo = useReview((s) => s.showFileInRepo)
  const toggleRepoExpanded = useReview((s) => s.toggleRepoExpanded)
  const toggleRepoShowAll = useReview((s) => s.toggleRepoShowAll)
  const threads = useReview((s) => s.threads)
  const viewed = useReview((s) => s.viewed)
  // in the store, and stored: a tree that reopens itself fully expanded on
  // every reload is a tree the reader closes again every morning
  const collapsedDirs = useReview((s) => s.collapsedDirs[repoId])
  const toggleDirIn = useReview((s) => s.toggleDir)
  const revealCollapsed = useReview((s) => s.revealCollapsed)
  const collapsed = useMemo(() => new Set(collapsedDirs ?? []), [collapsedDirs])
  const revealDir = useReview((s) => s.revealDir)
  const clearRevealDir = useReview((s) => s.clearRevealDir)

  // the status bar's path asks for a folder: open its ancestors and show it
  useEffect(() => {
    if (revealDir === null || revealDir.repoId !== repoId) return
    const target = revealDir.dir
    revealCollapsed(repoId, target)
    // the folder may only appear once the all-files tree has loaded
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const show = () => {
      const node = document.querySelector<HTMLElement>(
        `[data-dir="${CSS.escape(`${repoId}:${target}`)}"]`,
      )
      if (node === null) {
        attempts += 1
        if (attempts < 20) timer = setTimeout(show, 80)
        else clearRevealDir()
        return
      }
      const settle = () => {
        node.scrollIntoView({ block: 'nearest' })
        // deep paths would otherwise drag the tree sideways, hiding the names
        for (let el = node.parentElement; el !== null; el = el.parentElement) {
          if (el.scrollLeft > 0) el.scrollLeft = 0
        }
      }
      settle()
      // the rest of the tree can still be arriving and push the row away
      for (const delay of [120, 360]) setTimeout(settle, delay)
      clearRevealDir()
    }
    timer = setTimeout(show, 30)
    return () => clearTimeout(timer)
  }, [revealDir, repoId, clearRevealDir, revealCollapsed])

  const is_active = repoId === activeRepoId

  const tree = useMemo(() => {
    if (entry === undefined) return null
    const status_by_path = new Map(files.map((f) => [f.path, f]))
    const items: TreeFile[] = entry.showAll
      ? (entry.allFiles ?? []).map((path) => ({
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
  }, [entry, files])

  if (repo === undefined) return null

  const open_count = (path: string) =>
    is_active
      ? threads.filter((t) => t.path === path && t.status === 'open').length
      : 0

  const toggleDir = (path: string) => toggleDirIn(repoId, path)

  const renderFile = (file: TreeFile) => {
    const icon = fileIconUrl(file.name)
    const is_selected = is_active && selectedPath === file.path
    const is_viewed = is_active && viewed.has(file.path)
    return (
      <button
        key={file.path}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 pl-2 text-left font-mono select-none hover:bg-overlay ${is_selected ? 'bg-overlay' : ''}`}
        onClick={() => void showFileInRepo(repoId, file.path, file.status ?? undefined)}
        onDoubleClick={() =>
          void openFileInRepo(repoId, file.path, file.status ?? undefined)
        }
        title={
          file.oldPath !== undefined
            ? `${file.oldPath} → ${file.path}`
            : file.path
        }
      >
        {icon !== null && <img src={icon} alt="" className="h-4 w-4 shrink-0" />}
        <span
          className={`truncate ${is_viewed ? 'text-faint line-through decoration-edge' : file.status !== null ? 'text-ink' : 'text-soft'}`}
        >
          {file.name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {is_viewed && (
            <span className="text-emerald-600 dark:text-emerald-400">✓</span>
          )}
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

  const renderDir = (dir: TreeDir): React.ReactNode => (
    <div key={dir.path}>
      {dir.name !== '' && (
        <button
          data-dir={`${repoId}:${dir.path}`}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-overlay"
          onClick={() => toggleDir(dir.path)}
        >
          <span className="shrink-0 text-faint [&>svg]:h-3.5 [&>svg]:w-3.5">
            {collapsed.has(dir.path) ? <ChevronRight /> : <ChevronDown />}
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
          className={dir.name === '' ? '' : 'ml-[13px] border-l border-edge/70'}
        >
          {dir.dirs.map((child) => renderDir(child))}
          {dir.files.map(renderFile)}
        </div>
      )}
    </div>
  )

  const expanded = entry?.expanded ?? true

  return (
    <div className="mb-1">
      <div
        className={`group flex w-full items-center gap-1.5 px-2 py-1 ${is_active ? 'bg-overlay' : 'hover:bg-overlay'}`}
      >
        <button
          className={`-my-1 shrink-0 rounded-sm p-1 text-faint hover:bg-overlay hover:text-ink [&>svg]:h-3.5 [&>svg]:w-3.5 ${motion}`}
          title={expanded ? 'collapse' : 'expand'}
          aria-expanded={expanded}
          onClick={() => toggleRepoExpanded(repoId)}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </button>
        <button
          className="flex min-w-0 grow items-center gap-1.5 text-left"
          title="make this repo active (source/base pickers apply to it)"
          onClick={() => {
            if (is_active) toggleRepoExpanded(repoId)
            else void selectRepo(repoId)
          }}
        >
          {/* the name does not shrink: it is what the row is. A long branch
              name truncates instead, since it is the qualifier */}
          <span
            className={`shrink-0 font-semibold ${is_active ? 'text-ink' : 'text-soft'}`}
            title={repo.path}
          >
            {repo.name}
          </span>
          <span
            className="min-w-0 truncate text-meta text-faint"
            title={`on ${repo.branch}`}
          >
            {repo.branch}
          </span>
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-meta">
          {(entry?.openCount ?? 0) > 0 && (
            <span
              className="rounded-full bg-amber-500/20 px-1.5 text-amber-700 dark:text-amber-300"
              title={`${String(entry?.openCount ?? 0)} unresolved ${
                entry?.openCount === 1 ? 'note' : 'notes'
              } in this repository`}
            >
              {entry?.openCount}
            </span>
          )}
          <button
            className={`rounded-sm px-1 ${motion} ${entry?.showAll === true ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-overlay hover:text-ink'}`}
            title={
              entry?.showAll === true
                ? 'showing all files — click for changed only'
                : 'show all files of this repo'
            }
            onClick={() => void toggleRepoShowAll(repoId)}
          >
            all
          </button>
          <span
            className="text-faint"
            title={`${String(files.length)} changed ${
              files.length === 1 ? 'file' : 'files'
            }`}
          >
            {files.length}
          </span>
        </span>
      </div>
      {expanded && repo?.missing === true && (
        <p
          className="ml-[13px] px-3 py-1 text-amber-600 dark:text-amber-400"
          title={`nothing at ${repo.path} is a git repository any more. If it moved, add it again at its new path; its reviews stay either way.`}
        >
          folder not found
        </p>
      )}
      {expanded && entry === undefined && repo?.missing !== true && (
        <Loading
          what="the file tree"
          className="ml-[13px] space-y-1.5 py-1.5 pl-3"
        >
          {['w-32', 'w-24', 'w-36', 'w-20'].map((width) => (
            <Skeleton key={width} w={width} h="h-2.5" />
          ))}
        </Loading>
      )}
      {expanded && tree !== null && (
        <div className="ml-[13px] border-l border-edge/70">
          {renderDir(tree)}
          {entry?.showAll !== true && files.length === 0 && (
            <p className="px-3 py-1 text-faint">no changes</p>
          )}
        </div>
      )}
    </div>
  )
}

export function FileTree() {
  const repos = useReview((s) => s.repos)
  const addRepo = useReview((s) => s.addRepo)
  const pushToast = useReview((s) => s.pushToast)
  const [adding, setAdding] = useState(false)
  const [newPath, setNewPath] = useState('')

  const submitAdd = async () => {
    const trimmed = newPath.trim()
    if (trimmed === '') return
    try {
      await addRepo(trimmed)
      setNewPath('')
      setAdding(false)
    } catch (error) {
      pushToast(
        'error',
        `add repo: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 11px: a path is dense detail, and the tree is twenty of them */}
      <div className="min-h-0 grow overflow-y-auto py-1 text-dense">
        {repos.map((repo) => (
          <RepoNode key={repo.id} repoId={repo.id} />
        ))}
      </div>
      <div className="border-t border-edge p-1.5 text-xs">
        {adding ? (
          <input
            autoFocus
            className={`w-full font-mono ${field}`}
            placeholder="~/path/to/repo"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitAdd()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        ) : (
          <button
            className="w-full rounded px-2 py-1 text-left text-faint hover:bg-overlay hover:text-ink"
            onClick={() => setAdding(true)}
          >
            + add repository
          </button>
        )}
      </div>
    </div>
  )
}
