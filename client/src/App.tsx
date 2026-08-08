import { useEffect, useState } from 'react'
import type { GitStatus } from '@stickie/shared'

export function App() {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/status')
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) {
          throw new Error(body.error ?? response.statusText)
        }
        setStatus(body)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [])

  return (
    <main className="mx-auto max-w-2xl p-8 font-mono">
      <h1 className="text-2xl font-bold">stickie</h1>
      <p className="mt-1 text-sm text-gray-500">
        Not another Editor — Notes for Agents
      </p>
      <section className="mt-6 rounded border border-gray-300 p-4 text-sm">
        {error !== null && <p className="text-red-600">{error}</p>}
        {status === null && error === null && <p>loading…</p>}
        {status !== null && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-gray-500">repo</dt>
            <dd>{status.repoPath}</dd>
            <dt className="text-gray-500">branch</dt>
            <dd>{status.branch}</dd>
            <dt className="text-gray-500">changed files</dt>
            <dd>{status.clean ? 'none (clean)' : status.changedFiles}</dd>
          </dl>
        )}
      </section>
    </main>
  )
}
