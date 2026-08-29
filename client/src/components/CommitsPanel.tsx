import { useEffect, useState } from 'react'
import { useReview } from '../store'
import { eyebrow, motion } from '../ui'

/**
 * Commits between base and source for the active repo. A click opens that
 * commit against its parent in the commit tab; ⌘/ctrl+click adds one commit
 * as another column, shift+click adds the whole span between — so a
 * selection reads left to right as the file's timeline. The review target
 * itself only ever moves from the source/base pickers above.
 */
export function CommitsPanel() {
  const session = useReview((s) => s.session)
  const commits = useReview((s) => s.commits)
  const loadCommits = useReview((s) => s.loadCommits)
  const commitView = useReview((s) => s.commitView)
  const selectCommits = useReview((s) => s.selectCommits)
  const [expanded, setExpanded] = useState(true)
  const [anchor, setAnchor] = useState<number | null>(null)

  const sessionId = session?.id
  useEffect(() => {
    void loadCommits()
  }, [sessionId, loadCommits])

  if (session === null) return null

  const selected = new Set(commitView?.shas ?? [])

  // the list is newest first; a selection is kept oldest first so the
  // timeline's columns run forwards in time
  const chronological = (shas: Set<string>) =>
    commits
      .map((c) => c.sha)
      .filter((sha) => shas.has(sha))
      .reverse()

  const pick = (index: number, event: React.MouseEvent) => {
    const commit = commits[index]
    if (commit === undefined) return
    if (event.shiftKey && anchor !== null) {
      const lo = Math.min(anchor, index)
      const hi = Math.max(anchor, index)
      const span = new Set(selected)
      for (const between of commits.slice(lo, hi + 1)) span.add(between.sha)
      void selectCommits(chronological(span))
      return
    }
    setAnchor(index)
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(selected)
      if (next.has(commit.sha)) next.delete(commit.sha)
      else next.add(commit.sha)
      void selectCommits(chronological(next))
      return
    }
    void selectCommits([commit.sha])
  }

  return (
    <div className="border-t border-edge text-xs">
      <button
        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-overlay ${motion}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-2 text-faint">{expanded ? '▾' : '▸'}</span>
        <span className="font-semibold text-soft">Commits</span>
        <span className="text-faint">{commits.length}</span>
        <span className="grow" />
        <span className={eyebrow}>click · ⌘ · shift</span>
      </button>
      {expanded && (
        <div className="max-h-56 overflow-y-auto pb-1">
          {commits.map((commit, index) => (
            <button
              key={commit.sha}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left font-mono hover:bg-overlay ${motion} ${selected.has(commit.sha) ? 'bg-accent-soft text-accent' : 'text-soft'}`}
              title={`${commit.subject}\nclick: this commit · ⌘+click: add it · shift+click: add the span`}
              onClick={(e) => pick(index, e)}
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
