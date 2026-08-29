import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { NavHit } from '../api'
import { useReview } from '../store'
import { btn } from '../ui'

/**
 * Workspace-wide text search (cmd+F / cmd+shift+F). Results open in the
 * reference side pane by default so the diff under review stays put.
 */
export function SearchOverlay() {
  const open = useReview((s) => s.searchOpen)
  const setSearchOpen = useReview((s) => s.setSearchOpen)
  const session = useReview((s) => s.session)
  const openHitSide = useReview((s) => s.openHitSide)
  const openHit = useReview((s) => s.openHit)
  const repos = useReview((s) => s.repos)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NavHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    if (timer.current !== null) clearTimeout(timer.current)
    if (query.trim().length < 2 || session === null) {
      setHits(null)
      return
    }
    setSearching(true)
    timer.current = setTimeout(() => {
      void api
        .search(session.id, query.trim())
        .then((results) => setHits(results))
        .catch(() => setHits([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [query, open, session])

  const repoLabel = useMemo(() => {
    return (hit: NavHit) =>
      repos.find(
        (r) => r.path === hit.repoPath || hit.repoPath.startsWith(r.path + '/'),
      )?.name ?? hit.repoPath.split('/').at(-1)
  }, [repos])

  if (!open) return null

  const close = () => {
    setSearchOpen(false)
    setQuery('')
    setHits(null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-16"
      onClick={close}
    >
      <div
        className="flex max-h-[70vh] w-[42rem] flex-col rounded-lg border border-edge bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="rounded-t-lg border-b border-edge bg-panel px-4 py-3 font-mono text-sm text-ink outline-none"
          placeholder="search all repos… (Enter opens the first hit beside the diff)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter' && hits !== null && hits[0] !== undefined) {
              openHitSide(hits[0])
              close()
            }
          }}
        />
        <div className="min-h-0 grow overflow-y-auto py-1 text-xs">
          {searching && <p className="px-4 py-2 text-faint">searching…</p>}
          {!searching && hits !== null && hits.length === 0 && (
            <p className="px-4 py-2 text-faint">no matches</p>
          )}
          {!searching &&
            hits?.map((hit, index) => (
              <div
                key={`${hit.repoPath}:${hit.path}:${hit.line}:${index}`}
                className="group flex w-full items-center gap-2 px-4 py-1 hover:bg-overlay"
              >
                <button
                  className="flex min-w-0 grow items-center gap-2 text-left"
                  title="open beside the diff"
                  onClick={() => {
                    openHitSide(hit)
                    close()
                  }}
                >
                  <span className="shrink-0 rounded bg-overlay px-1 text-[10px] text-faint">
                    {repoLabel(hit)}
                  </span>
                  <span className="shrink-0 font-mono text-soft">
                    {hit.path}:{hit.line}
                  </span>
                  <span className="truncate font-mono text-faint">
                    {hit.preview.trim()}
                  </span>
                </button>
                <button
                  className={`hidden shrink-0 group-hover:inline ${btn()}`}
                  title="open in the main view (leaves the diff)"
                  onClick={() => {
                    void openHit(hit)
                    close()
                  }}
                >
                  main ↗
                </button>
              </div>
            ))}
          {hits === null && !searching && (
            <p className="px-4 py-2 text-faint">
              type at least 2 characters — results open in the reference pane,
              keeping your diff in place
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
