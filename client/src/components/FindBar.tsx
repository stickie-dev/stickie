import { useEffect, useRef } from 'react'
import { fileCount } from '../find'
import { useReview } from '../store'
import { btn, field, icon_button } from '../ui'

/**
 * Find, over the whole review rather than one editor.
 *
 * ⌘F used to open the workspace search — every registered repository, results
 * in a side pane — which is a different question from "where is this word in
 * what I am reading". That one is still the Search button and ⌘⇧F; this is ⌘F,
 * where a reader's hand already goes.
 *
 * It sits over the diff rather than pushing it down, so the line a match is on
 * does not move while the query is being typed.
 */
export function FindBar() {
  const open = useReview((s) => s.findOpen)
  const openFind = useReview((s) => s.openFind)
  const query = useReview((s) => s.findQuery)
  const setQuery = useReview((s) => s.setFindQuery)
  const caseSensitive = useReview((s) => s.findCase)
  const setCase = useReview((s) => s.setFindCase)
  const matches = useReview((s) => s.findMatches)
  const at = useReview((s) => s.findAt)
  const capped = useReview((s) => s.findCapped)
  const busy = useReview((s) => s.findBusy)
  const step = useReview((s) => s.stepFind)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      input.current?.focus()
      input.current?.select()
    }
  }, [open])

  if (!open) return null

  const files = fileCount(matches)
  const count =
    query === ''
      ? ''
      : busy
        ? 'looking…'
        : matches.length === 0
          ? 'no matches'
          : `${String(at + 1)} of ${String(matches.length)}${capped ? '+' : ''}` +
            (files > 1 ? ` in ${String(files)} files` : '')

  return (
    <div className="absolute top-2 right-6 z-40 flex items-center gap-1 rounded-lg bg-panel p-1 shadow-lifted">
      <input
        ref={input}
        className={`w-52 text-xs ${field}`}
        placeholder="find in this review"
        value={query}
        onChange={(e) => void setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            openFind(false)
          }
          // Enter walks the matches, the way every find does
          if (e.key === 'Enter') {
            e.preventDefault()
            void step(e.shiftKey ? -1 : 1)
          }
        }}
      />
      <span className="w-32 shrink-0 px-1 text-[11px] text-faint tabular-nums">
        {count}
      </span>
      <button
        className={`text-[11px] ${caseSensitive ? 'text-accent' : ''} ${btn('outline')}`}
        title="match case"
        aria-pressed={caseSensitive}
        onClick={() => void setCase(!caseSensitive)}
      >
        Aa
      </button>
      <button
        className={icon_button}
        title="previous match (⇧↵)"
        disabled={matches.length === 0}
        onClick={() => void step(-1)}
      >
        ↑
      </button>
      <button
        className={icon_button}
        title="next match (↵)"
        disabled={matches.length === 0}
        onClick={() => void step(1)}
      >
        ↓
      </button>
      <button
        className={icon_button}
        title="close (esc)"
        onClick={() => openFind(false)}
      >
        ✕
      </button>
    </div>
  )
}
