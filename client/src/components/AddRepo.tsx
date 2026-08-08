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
    <div className="mx-auto mt-24 w-[28rem] rounded-lg border border-zinc-700 bg-zinc-800/50 p-6">
      <h2 className="text-sm font-semibold text-zinc-200">Add a repository</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Absolute path to a git repository to review.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          className="grow rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-sky-500"
          placeholder="/path/to/repo"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <button
          className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          onClick={() => void submit()}
        >
          add
        </button>
      </div>
      {error !== null && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  )
}
