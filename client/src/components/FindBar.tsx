import { useEffect, useRef } from 'react'
import { fileCount } from '../find'
import { useReview } from '../store'
import { ChevronDown, ChevronUp, Close } from '../icons'
import { btn, field, glass, icon_button, motion } from '../ui'

/**
 * Find, over the whole review rather than one editor.
 *
 * ⌘F used to open the workspace search — every registered repository, results
 * in a side pane — which is a different question from "where is this word in
 * what I am reading". That one is the Search button, ⌘⇧F and ⇧⇧; this is ⌘F,
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
  const refind = useReview((s) => s.refind)
  const viewMode = useReview((s) => s.viewMode)
  const selectedPath = useReview((s) => s.selectedPath)
  const findScope = useReview((s) => s.findScope)
  const flipFindScope = useReview((s) => s.flipFindScope)
  const input = useRef<HTMLInputElement>(null)

  const file_name =
    selectedPath === null ? null : (selectedPath.split('/').at(-1) ?? selectedPath)
  const scope = findScope === 'file' && file_name !== null ? file_name : 'this diff'
  // the file being read changes as the reader moves through the diff, and
  // "this file" means that one — so a move has new answers to the same question
  useEffect(() => {
    void refind()
  }, [viewMode, selectedPath, refind])

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
    <div className={`absolute top-2 right-6 z-40 flex items-center gap-1 rounded-lg p-1 ${glass}`}>
      <input
        ref={input}
        className={`w-52 text-xs ${field}`}
        placeholder={`find in ${scope}`}
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
      {/*
        Where it is looking, said and switchable: ⌘F again does the same. The
        file is the one being read, so in the diff it follows the reader from
        file to file.
      */}
      <div
        role="group"
        aria-label="find in"
        className="flex shrink-0 items-center rounded-md bg-overlay p-0.5 text-dense"
      >
        <button
          className={`rounded-sm px-1.5 py-0.5 ${motion} ${findScope === 'diff' ? 'bg-panel text-ink shadow-soft' : 'text-soft hover:text-ink'}`}
          aria-pressed={findScope === 'diff'}
          title={'every file in this diff\n⌘F again switches'}
          onClick={() => {
            if (findScope !== 'diff') void flipFindScope()
          }}
        >
          this diff
        </button>
        <button
          className={`max-w-28 truncate rounded-sm px-1.5 py-0.5 ${motion} ${findScope === 'file' ? 'bg-panel text-ink shadow-soft' : 'text-soft hover:text-ink'}`}
          aria-pressed={findScope === 'file'}
          disabled={file_name === null}
          title={`only ${file_name ?? 'the file being read'}\n⌘F again switches`}
          onClick={() => {
            if (findScope !== 'file') void flipFindScope()
          }}
        >
          {file_name ?? 'this file'}
        </button>
      </div>
      <span className="w-32 shrink-0 px-1 text-dense text-faint tabular-nums">
        {count}
      </span>
      <button
        className={`text-dense ${caseSensitive ? 'text-accent' : ''} ${btn('outline')}`}
        title="match case"
        aria-pressed={caseSensitive}
        onClick={() => void setCase(!caseSensitive)}
      >
        Aa
      </button>
      <button
        className={icon_button}
        title="previous match (⇧↵)"
        aria-label="previous match"
        disabled={matches.length === 0}
        onClick={() => void step(-1)}
      >
        <ChevronUp />
      </button>
      <button
        className={icon_button}
        title="next match (↵)"
        aria-label="next match"
        disabled={matches.length === 0}
        onClick={() => void step(1)}
      >
        <ChevronDown />
      </button>
      <button
        className={icon_button}
        title="close (esc)"
        aria-label="close find"
        onClick={() => openFind(false)}
      >
        <Close />
      </button>
    </div>
  )
}
