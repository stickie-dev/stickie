import { useEffect, useState } from 'react'
import { api } from '../api'
import type { CommitBetween } from '../api'
import { useReview } from '../store'

/**
 * Commits between base and source for the active repo. Click reviews one
 * commit against its parent; shift+click reviews a contiguous range; the
 * top row returns to the full working-tree review.
 */
export function CommitsPanel() {
  const session = useReview((s) => s.session)
  const targets = useReview((s) => s.targets)
  const setSource = useReview((s) => s.setSource)
  const [commits, setCommits] = useState<CommitBetween[]>([])
  const [expanded, setExpanded] = useState(true)
  const [anchor, setAnchor] = useState<number | null>(null)

  const sessionId = session?.id
  useEffect(() => {
    if (sessionId === undefined) {
      setCommits([])
      return
    }
    void api
      .commits(sessionId)
      .then(setCommits)
      .catch(() => setCommits([]))
  }, [sessionId])

  if (session === null) return null

  // highlight the range the current session reviews
  const top_index =
    session.source.kind === 'ref'
      ? commits.findIndex((c) => c.sha === session.source.value)
      : -1
  const bottom_index =
    top_index === -1
      ? -1
      : commits.findIndex(
          (c, i) => i >= top_index && c.parentSha === session.baseSha,
        )
  const isSelected = (index: number) =>
    top_index !== -1 &&
    bottom_index !== -1 &&
    index >= top_index &&
    index <= bottom_index
  const reviewing_worktree = session.source.kind === 'worktree'

  const pick = (index: number, shift: boolean) => {
    if (shift && anchor !== null) {
      const lo = Math.min(anchor, index)
      const hi = Math.max(anchor, index)
      const newest = commits[lo]
      const oldest = commits[hi]
      if (newest === undefined || oldest === undefined) return
      void setSource(
        { kind: 'ref', value: newest.sha },
        `${oldest.sha}^`,
      )
      return
    }
    setAnchor(index)
    const commit = commits[index]
    if (commit === undefined) return
    void setSource({ kind: 'ref', value: commit.sha }, `${commit.sha}^`)
  }

  const resetToWorktree = () => {
    const main = targets?.worktrees.find((wt) => wt.isMain)
    if (main === undefined) return
    setAnchor(null)
    void setSource({ kind: 'worktree', value: main.path })
  }

  return (
    <div className="border-t border-edge text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-overlay"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-2 text-faint">{expanded ? '▾' : '▸'}</span>
        <span className="font-semibold text-soft">Commits</span>
        <span className="text-faint">{commits.length}</span>
        <span className="grow" />
        <span className="text-[10px] text-faint">
          click: one · shift: range
        </span>
      </button>
      {expanded && (
        <div className="max-h-56 overflow-y-auto pb-1">
          <button
            className={`flex w-full items-center gap-2 px-3 py-1 text-left font-mono hover:bg-overlay ${reviewing_worktree ? 'bg-overlay text-ink' : 'text-soft'}`}
            title="review the full range incl. uncommitted changes"
            onClick={resetToWorktree}
          >
            <span className="shrink-0 text-faint">◉</span>
            working tree
          </button>
          {commits.map((commit, index) => (
            <button
              key={commit.sha}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left font-mono hover:bg-overlay ${isSelected(index) ? 'bg-accent/10 text-ink' : 'text-soft'}`}
              title={`${commit.subject}\nclick: diff vs parent · shift+click: range`}
              onClick={(e) => pick(index, e.shiftKey)}
            >
              <span className="shrink-0 text-faint">{commit.shortSha}</span>
              <span className="truncate">{commit.subject}</span>
            </button>
          ))}
          {commits.length === 0 && (
            <p className="px-3 py-1 text-faint">
              no commits between base and source
            </p>
          )}
        </div>
      )}
    </div>
  )
}
