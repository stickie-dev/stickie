import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import type { ReviewSource, TargetOptions } from '@stickie/shared'
import { api } from '../api'
import { ChevronDown, ChevronRight, Plus } from '../icons'
import { useReview } from '../store'
import { eyebrow, glass, icon_button, motion } from '../ui'

/** As wide as the panel is drawn, so it can be kept inside the window. */
const panel_width = 320

type Sources = TargetOptions | 'loading' | 'failed'

/**
 * Opens another repository's review without leaving this one.
 *
 * The overview is the other way to get there, and it is a page drawn over the
 * review: going to it and back covers the diff, and every trip is a trip back
 * to where the reader was. Beside the tabs is where opening something else is
 * looked for, so that is where this sits.
 *
 * A repository's name opens it where it was last read from — its main
 * checkout the first time. Its sources are a click further, fetched only when
 * asked for, because that is a git call per repository and most openings never
 * need one. The base is not offered here: it is a lens on the work rather than
 * a choice of which work, and the picker for it is already in the bar above.
 */
export function OpenRepoMenu() {
  const repos = useReview((s) => s.repos)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const openRepo = useReview((s) => s.openRepo)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [sources, setSources] = useState<Record<number, Sources>>({})
  const button = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  const close = () => {
    setAt(null)
    setExpanded(null)
  }

  // a page drawn over the review takes the review out of reach, and a panel
  // left open would go on painting over that page, unpressable
  useEffect(() => {
    close()
  }, [location.pathname])

  useEffect(() => {
    if (at === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      close()
      button.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at])

  const toggle = (repoId: number) => {
    if (expanded === repoId) {
      setExpanded(null)
      return
    }
    setExpanded(repoId)
    const known = sources[repoId]
    if (known !== undefined && known !== 'failed') return
    setSources((was) => ({ ...was, [repoId]: 'loading' }))
    api.targets(repoId).then(
      (found) => setSources((was) => ({ ...was, [repoId]: found })),
      () => setSources((was) => ({ ...was, [repoId]: 'failed' })),
    )
  }

  const go = (repoId: number, source?: ReviewSource) => {
    close()
    void openRepo(repoId, source)
  }

  const row = `flex w-full min-w-0 items-baseline gap-2 px-2 py-1 text-left hover:bg-overlay ${motion}`

  return (
    <>
      <button
        ref={button}
        className={`shrink-0 self-center ${icon_button}`}
        title="open a review of another repository"
        aria-label="open a review of another repository"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={() => {
          if (at !== null) {
            close()
            return
          }
          const r = button.current?.getBoundingClientRect()
          if (r !== undefined) setAt({ left: r.left, top: r.bottom + 4 })
        }}
      >
        <Plus />
      </button>
      {at !== null && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            role="menu"
            className={`fixed z-50 max-h-[min(28rem,calc(100vh-6rem))] overflow-y-auto rounded-lg py-1 text-xs ${glass}`}
            style={{
              width: panel_width,
              // fixed rather than absolute: the tab strip clips what it holds,
              // and a panel inside it would be cut to the strip's height
              left: Math.max(8, Math.min(at.left, window.innerWidth - panel_width - 8)),
              top: at.top,
            }}
          >
            <div className={`px-2 pt-1 pb-1.5 ${eyebrow}`}>open a review of</div>
            {repos.length === 0 && (
              <p className="px-2 py-1 text-faint">
                No repositories yet — add one from the tree.
              </p>
            )}
            {repos.map((repo) => {
              const open = expanded === repo.id
              const found = sources[repo.id]
              return (
                <div key={repo.id}>
                  <div className="flex items-center">
                    <button
                      className={`ml-1 shrink-0 rounded-sm p-0.5 text-faint hover:text-ink ${motion}`}
                      aria-label={`${open ? 'hide' : 'show'} where ${repo.name} can be read from`}
                      aria-expanded={open}
                      onClick={() => toggle(repo.id)}
                    >
                      {open ? <ChevronDown /> : <ChevronRight />}
                    </button>
                    <button
                      role="menuitem"
                      className={row}
                      title={repo.path}
                      onClick={() => go(repo.id)}
                    >
                      <span className="truncate text-ink">{repo.name}</span>
                      <span className="truncate font-mono text-meta text-faint">
                        {repo.branch}
                      </span>
                      {repo.id === activeRepoId && (
                        <span className="ml-auto shrink-0 text-meta text-faint">
                          open
                        </span>
                      )}
                    </button>
                  </div>
                  {open && found === 'loading' && (
                    <p className="py-1 pr-2 pl-7 text-faint">reading…</p>
                  )}
                  {open && found === 'failed' && (
                    <p className="py-1 pr-2 pl-7 text-faint">
                      Could not read this repository's branches.
                    </p>
                  )}
                  {open && typeof found === 'object' && (
                    <Sources
                      sources={found}
                      row={row}
                      onPick={(source) => go(repo.id, source)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

function Sources({
  sources,
  row,
  onPick,
}: {
  sources: TargetOptions
  row: string
  onPick: (source: ReviewSource) => void
}) {
  // a detached checkout has no branch, and a review is of a branch: the server
  // refuses one, so offering it here would only be offering the refusal
  const worktrees = sources.worktrees.filter((wt) => wt.branch !== null)
  return (
    <div className="pb-1 pl-5">
      {worktrees.length > 0 && (
        <div className={`px-2 pt-1 ${eyebrow}`}>working trees</div>
      )}
      {worktrees.map((wt) => (
        <button
          key={wt.path}
          role="menuitem"
          className={row}
          title={wt.path}
          onClick={() => onPick({ kind: 'worktree', value: wt.path })}
        >
          <span className="truncate font-mono text-ink">{wt.branch}</span>
          <span className="truncate text-meta text-faint">
            {wt.path.split('/').at(-1)}
          </span>
        </button>
      ))}
      {sources.branches.length > 0 && (
        <div className={`px-2 pt-1.5 ${eyebrow}`}>branches</div>
      )}
      {sources.branches.map((branch) => (
        <button
          key={branch.name}
          role="menuitem"
          className={row}
          onClick={() => onPick({ kind: 'ref', value: branch.name })}
        >
          <span className="truncate font-mono text-ink">{branch.name}</span>
        </button>
      ))}
    </div>
  )
}
