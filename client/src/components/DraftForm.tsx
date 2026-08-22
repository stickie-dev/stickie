import { useEffect, useRef } from 'react'
import type { Draft } from '../store'
import { useReview } from '../store'

/** Where a form for the same note is rendered; each surface focuses alone. */
type Surface = 'zone' | 'panel'

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
      className={`min-w-0 rounded-md border bg-panel p-2 text-sm shadow-lg ${active ? 'border-accent' : 'border-edge'}`}
      onFocusCapture={() => setActiveDraft(draft.id)}
      onMouseDownCapture={() => setActiveDraft(draft.id)}
    >
      <div className="mb-1 text-xs text-soft">
        New note on L{draft.startLine}
        {draft.endLine !== draft.startLine ? `–L${draft.endLine}` : ''} (
        {draft.side} side)
        {active
          ? ' — active: selections elsewhere add references here'
          : ' — click to make active'}
      </div>
      <textarea
        ref={textareaRef}
        data-stickie-draft={key}
        rows={2}
        className="w-full resize-y rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
        placeholder="What should change here? (⌘↵ to submit, Esc to discard)"
        value={draft.body}
        onChange={(e) => {
          updateDraftBody(draft.id, e.target.value)
          remember(e.currentTarget)
        }}
        onSelect={(e) => remember(e.currentTarget)}
        onFocus={(e) => remember(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            void submitDraft(draft.id)
          }
          if (e.key === 'Escape') cancelDraft(draft.id)
        }}
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-soft hover:text-ink"
          onClick={() => cancelDraft(draft.id)}
        >
          cancel
        </button>
        <button
          className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-strong disabled:opacity-50"
          disabled={draft.body.trim() === ''}
          onClick={() => void submitDraft(draft.id)}
        >
          comment
        </button>
      </div>
    </div>
  )
}
