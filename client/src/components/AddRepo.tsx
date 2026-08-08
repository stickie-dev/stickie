import { useState } from 'react'
import { useReview } from '../store'

export function AddRepo() {
  const addRepo = useReview((s) => s.addRepo)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = path.trim()
    if (trimmed === '') return
    try {
      await addRepo(trimmed)
      setPath('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto mt-24 w-[28rem] rounded-lg border border-edge bg-panel p-6">
      <h2 className="text-sm font-semibold text-ink">Add a repository</h2>
      <p className="mt-1 text-xs text-faint">
        Absolute path to a git repository to review.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          className="grow rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
          placeholder="/path/to/repo"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <button
          className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
          onClick={() => void submit()}
        >
          add
        </button>
      </div>
      {error !== null && <p className="mt-2 text-xs text-rose-500">{error}</p>}
    </div>
  )
}
