import { useMemo } from 'react'
import type { NavHit } from '../api'
import { useReview } from '../store'
import { Close } from '../icons'
import { btn, icon_button } from '../ui'

export function UsagesPanel() {
  const usages = useReview((s) => s.usages)
  const openUsages = useReview((s) => s.openUsages)
  const closeUsages = useReview((s) => s.closeUsages)
  const openHit = useReview((s) => s.openHit)
  const openHitSide = useReview((s) => s.openHitSide)

  const grouped = useMemo(() => {
    if (usages === null) return []
    const by_file = new Map<string, NavHit[]>()
    for (const hit of usages.hits) {
      const key = `${hit.repoPath}\u0000${hit.path}`
      const bucket = by_file.get(key) ?? []
      bucket.push(hit)
      by_file.set(key, bucket)
    }
    return [...by_file.entries()].map(([key, hits]) => {
      const [repoPath = '', path = ''] = key.split('\u0000')
      return { repoPath, path, hits }
    })
  }, [usages])

  if (usages === null) return null

  return (
    <section className="flex h-56 shrink-0 flex-col border-t border-edge bg-panel">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-xs">
        <span className="text-ink">
          Usages of <span className="font-mono">{usages.name}</span>
        </span>
        <span className="text-faint">
          {usages.hits.length} hit{usages.hits.length === 1 ? '' : 's'}
          {usages.scope === 'workspace' ? ' across all repos' : ''}
        </span>
        <span className="grow" />
        <button
          className={btn('text', 'px-2 py-0.5')}
          onClick={() =>
            void openUsages(
              usages.name,
              usages.scope === 'repo' ? 'workspace' : 'repo',
            )
          }
        >
          {usages.scope === 'repo' ? 'search all repos' : 'this repo only'}
        </button>
        <button
          className={icon_button}
          title="close the panel"
          aria-label="close the panel"
          onClick={closeUsages}
        >
          <Close />
        </button>
      </div>
      <div className="min-h-0 grow overflow-y-auto py-1 text-xs">
        {grouped.map((group) => (
          <div key={`${group.repoPath}:${group.path}`}>
            <p className="px-3 py-1 font-mono text-soft">
              {group.path}
              {usages.scope === 'workspace' && (
                <span className="ml-2 text-faint">
                  {group.repoPath.split('/').at(-1)}
                </span>
              )}
            </p>
            {group.hits.map((hit) => (
              <div
                key={`${hit.path}:${hit.line}`}
                className="group flex w-full items-center gap-3 px-5 py-0.5 hover:bg-overlay"
              >
                <button
                  className="flex min-w-0 grow gap-3 text-left font-mono"
                  onClick={() => void openHit(hit)}
                >
                  <span className="w-10 shrink-0 text-right text-faint">
                    {hit.line}
                  </span>
                  <span className="truncate text-ink">
                    {hit.preview.trim()}
                  </span>
                </button>
                <button
                  className="hidden shrink-0 text-xs text-soft group-hover:inline hover:text-ink"
                  title="open beside the diff"
                  onClick={() => openHitSide(hit)}
                >
                  side ▸
                </button>
              </div>
            ))}
          </div>
        ))}
        {usages.hits.length === 0 && (
          <p className="px-3 py-2 text-faint">No usages found.</p>
        )}
      </div>
    </section>
  )
}
