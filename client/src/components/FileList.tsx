import type { ChangedFile } from '@stickie/shared'
import { useReview } from '../store'

const status_letter: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
}

const status_color: Record<ChangedFile['status'], string> = {
  added: 'text-emerald-400',
  modified: 'text-amber-400',
  deleted: 'text-rose-400',
  renamed: 'text-sky-400',
  untracked: 'text-emerald-600',
}

export function FileList() {
  const files = useReview((s) => s.files)
  const allFiles = useReview((s) => s.allFiles)
  const showAll = useReview((s) => s.showAll)
  const setShowAll = useReview((s) => s.setShowAll)
  const selectedPath = useReview((s) => s.selectedPath)
  const openFile = useReview((s) => s.openFile)
  const threads = useReview((s) => s.threads)

  const open_count = (path: string) =>
    threads.filter((t) => t.path === path && t.status === 'open').length

  const changed_paths = new Set(files.map((f) => f.path))

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-zinc-800 text-xs">
        <button
          className={`px-3 py-1.5 ${showAll ? 'text-zinc-500 hover:text-zinc-300' : 'border-b-2 border-sky-500 text-zinc-100'}`}
          onClick={() => void setShowAll(false)}
        >
          Changed ({files.length})
        </button>
        <button
          className={`px-3 py-1.5 ${showAll ? 'border-b-2 border-sky-500 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          onClick={() => void setShowAll(true)}
        >
          All files
        </button>
      </div>
      <div className="min-h-0 grow overflow-y-auto py-1 text-xs">
        {!showAll &&
          files.map((file) => (
            <button
              key={file.path}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left font-mono hover:bg-zinc-800 ${selectedPath === file.path ? 'bg-zinc-800' : ''}`}
              onClick={() => void openFile(file.path, file.status)}
              title={
                file.oldPath !== undefined
                  ? `${file.oldPath} → ${file.path}`
                  : file.path
              }
            >
              <span className={`w-3 shrink-0 ${status_color[file.status]}`}>
                {status_letter[file.status]}
              </span>
              <span className="truncate text-zinc-300">{file.path}</span>
              {open_count(file.path) > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-1.5 text-amber-300">
                  {open_count(file.path)}
                </span>
              )}
            </button>
          ))}
        {!showAll && files.length === 0 && (
          <p className="px-3 py-2 text-zinc-500">No changes to review.</p>
        )}
        {showAll &&
          (allFiles ?? []).map((path) => (
            <button
              key={path}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left font-mono hover:bg-zinc-800 ${selectedPath === path ? 'bg-zinc-800' : ''}`}
              onClick={() => void openFile(path)}
            >
              <span
                className={`w-3 shrink-0 ${changed_paths.has(path) ? 'text-amber-400' : 'text-zinc-700'}`}
              >
                {changed_paths.has(path) ? '•' : ''}
              </span>
              <span className="truncate text-zinc-400">{path}</span>
              {open_count(path) > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-amber-500/20 px-1.5 text-amber-300">
                  {open_count(path)}
                </span>
              )}
            </button>
          ))}
        {showAll && allFiles === null && (
          <p className="px-3 py-2 text-zinc-500">loading…</p>
        )}
      </div>
    </div>
  )
}
