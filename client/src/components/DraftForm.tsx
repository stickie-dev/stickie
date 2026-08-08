import { useEffect, useRef } from 'react'
import { useReview } from '../store'

export function DraftForm() {
  const draft = useReview((s) => s.draft)
  const updateDraftBody = useReview((s) => s.updateDraftBody)
  const submitDraft = useReview((s) => s.submitDraft)
  const cancelDraft = useReview((s) => s.cancelDraft)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // plain autoFocus loses the race against Monaco reclaiming focus after
  // the gutter click; grab it once the zone has settled
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus({ preventScroll: true })
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  if (draft === null) return null

  return (
    <div className="rounded-md border border-accent bg-panel p-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-soft">
        New note on L{draft.startLine}
        {draft.endLine !== draft.startLine ? `–L${draft.endLine}` : ''} (
        {draft.side} side) — select code anywhere, here or in another file,
        to insert a reference
      </div>
      <textarea
        ref={textareaRef}
        rows={2}
        className="w-full resize-y rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
        placeholder="What should change here? (⌘↵ to submit, Esc to cancel)"
        value={draft.body}
        onChange={(e) => updateDraftBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            void submitDraft()
          }
          if (e.key === 'Escape') cancelDraft()
        }}
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-soft hover:text-ink"
          onClick={cancelDraft}
        >
          cancel
        </button>
        <button
          className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-strong disabled:opacity-50"
          disabled={draft.body.trim() === ''}
          onClick={() => void submitDraft()}
        >
          comment
        </button>
      </div>
    </div>
  )
}
