import { useEffect, useRef } from 'react'
import type { NoteDefault } from '../api'
import { postsComment } from '../keys'
import type { Draft } from '../store'
import { useReview } from '../store'
import { GrowingTextarea } from './GrowingTextarea'
import { btn, field_flush } from '../ui'
import { SubmitSplit } from './SubmitSplit'

/** Where a form for the same note is rendered; each surface focuses alone. */
type Surface = 'zone' | 'panel'

/**
 * The line a note is anchored to, correctable in place: a selection is a rough
 * gesture, and re-dragging it to move an anchor by one line is worse than
 * typing the number.
 */
function LineBox({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (line: number) => void
}) {
  return (
    <span className="inline-flex items-baseline">
      <span className="text-faint">L</span>
      <input
        type="number"
        min={1}
        aria-label={label}
        title={`${label} — click to change`}
        value={value}
        onChange={(e) => {
          const line = Number(e.target.value)
          if (Number.isFinite(line) && line > 0) onChange(line)
        }}
        // sized to its digits so it reads as text until someone clicks it
        style={{ width: `${String(Math.max(2, String(value).length + 1))}ch` }}
        className="rounded border border-transparent bg-transparent px-0.5 text-center font-mono text-ink tabular-nums hover:border-edge focus:border-accent focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </span>
  )
}

// a form can remount without the user asking — the editor around it reloads,
// or its zone moves — so it must know whether a mount is its first (claim the
// caret) or a rebuild of the one that had it (put the caret back where it was)
const claimed = new Set<string>()
const carets = new Map<string, { start: number; end: number }>()
let holder: string | null = null
let watching = false

/**
 * Focus ownership survives a rebuild because a yanked node moves focus to the
 * body silently, while a deliberate move fires focusin on the new element —
 * the one signal that separates "interrupted" from "went elsewhere".
 */
function watchFocus(): void {
  if (watching) return
  watching = true
  document.addEventListener(
    'focusin',
    (event) => {
      const node = event.target as HTMLElement | null
      if (node?.dataset.stickieDraft !== holder) holder = null
    },
    true,
  )
}

export function DraftForm({
  draft,
  surface = 'zone',
}: {
  draft: Draft | undefined
  surface?: Surface
}) {
  const updateDraftBody = useReview((s) => s.updateDraftBody)
  const setDraftRange = useReview((s) => s.setDraftRange)
  const submitKey = useReview((s) => s.submitKey)
  const noteDefault = useReview((s) => s.noteDefault)
  const rememberNoteDefault = useReview((s) => s.rememberNoteDefault)
  const submitDraft = useReview((s) => s.submitDraft)
  const cancelDraft = useReview((s) => s.cancelDraft)
  const setActiveDraft = useReview((s) => s.setActiveDraft)
  const activeDraftId = useReview((s) => s.activeDraftId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const key = draft === undefined ? null : `${surface}:${draft.id}`
  useEffect(() => {
    if (key === null) return
    watchFocus()
    const first = !claimed.has(key)
    // the panel's copy must not steal the caret from the code it sits beside
    if (first && surface !== 'zone') {
      claimed.add(key)
      return
    }
    if (!first && holder !== key) return
    claimed.add(key)
    // monaco keeps a view zone's node display:none while it settles the
    // collapsed regions around the click that opened this form, and focus()
    // on a non-rendered node is dropped — so keep asking until the caret
    // lands, and give up the moment the user does anything themselves
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let abandoned = false
    const abandon = () => {
      abandoned = true
      clearTimeout(timer)
    }
    const take = () => {
      const node = textareaRef.current
      if (node === null || abandoned) return
      const active = document.activeElement
      if (active === node) return
      if (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement
      ) {
        return
      }
      node.focus({ preventScroll: true })
      if (document.activeElement === node) {
        const caret = carets.get(key)
        if (caret !== undefined) node.setSelectionRange(caret.start, caret.end)
        holder = key
        return
      }
      attempts += 1
      if (attempts < 50) timer = setTimeout(take, 60)
    }
    // a click elsewhere is the user choosing where to be; keystrokes are not,
    // since a read-only editor would swallow them
    window.addEventListener('mousedown', abandon, { capture: true, once: true })
    take()
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', abandon, { capture: true })
    }
  }, [key, surface])

  if (draft === undefined || key === null) return null

  const active = draft.id === activeDraftId

  const remember = (node: HTMLTextAreaElement) => {
    holder = key
    carets.set(key, {
      start: node.selectionStart,
      end: node.selectionEnd,
    })
  }

  return (
    <div
      className={`min-w-0 rounded-lg bg-panel p-2 text-note shadow-lifted ${active ? 'ring-1 ring-accent' : ''}`}
      onFocusCapture={() => setActiveDraft(draft.id)}
      onMouseDownCapture={() => setActiveDraft(draft.id)}
    >
      <div className="mb-1 flex flex-wrap items-center gap-x-1 text-xs text-soft">
        <span>note on</span>
        <LineBox
          value={draft.startLine}
          label="first line"
          onChange={(line) => setDraftRange(draft.id, line, draft.endLine)}
        />
        <span>–</span>
        <LineBox
          value={draft.endLine}
          label="last line"
          onChange={(line) => setDraftRange(draft.id, draft.startLine, line)}
        />
        <span>({draft.side} side)</span>
        <span className="text-faint">
          {active
            ? '— active: selections elsewhere add references here'
            : '— click to make active'}
        </span>
      </div>
      <GrowingTextarea
        inputRef={textareaRef}
        data-stickie-draft={key}
        className={`w-full ${field_flush}`}
        placeholder={`What should change here? (${
          submitKey === 'enter' ? '↵' : '⌘↵'
        } to ${noteDefault === 'comment' ? 'comment' : 'draft'}, ${
          submitKey === 'enter' ? '⇧↵' : '↵'
        } for a new line)`}
        value={draft.body}
        onChange={(e) => {
          updateDraftBody(draft.id, e.target.value)
          remember(e.currentTarget)
        }}
        onSelect={(e) => remember(e.currentTarget)}
        onFocus={(e) => remember(e.currentTarget)}
        onKeyDown={(e) => {
          if (postsComment(e, submitKey)) {
            e.preventDefault()
            // the key does whatever the button says it does
            void submitDraft(draft.id)
          }
          if (e.key === 'Escape') cancelDraft(draft.id)
        }}
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          className={`text-xs ${btn()}`}
          onClick={() => cancelDraft(draft.id)}
        >
          cancel
        </button>
        <SubmitSplit
          menuKey={`draft:${String(draft.id)}`}
          disabled={draft.body.trim() === ''}
          onPick={(as: NoteDefault) => void rememberNoteDefault(as)}
          onSubmit={(as: NoteDefault) => void submitDraft(draft.id, as)}
        />
      </div>
    </div>
  )
}
