import { useEffect, useRef } from 'react'
import type { Draft } from '../store'
import { useReview } from '../store'

export function DraftForm({ draft }: { draft: Draft | undefined }) {
  const updateDraftBody = useReview((s) => s.updateDraftBody)
  const submitDraft = useReview((s) => s.submitDraft)
  const cancelDraft = useReview((s) => s.cancelDraft)
  const setActiveDraft = useReview((s) => s.setActiveDraft)
  const activeDraftId = useReview((s) => s.activeDraftId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // plain autoFocus loses the race against Monaco reclaiming focus after
  // the gutter click; grab it once the zone has settled
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true })
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  if (draft === undefined) return null

  const active = draft.id === activeDraftId

  return (
    <div
      className={`rounded-md border bg-panel p-2 text-sm shadow-lg ${active ? 'border-accent' : 'border-edge'}`}
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
        rows={2}
        className="w-full resize-y rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
        placeholder="What should change here? (⌘↵ to submit, Esc to discard)"
        value={draft.body}
        onChange={(e) => updateDraftBody(draft.id, e.target.value)}
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
