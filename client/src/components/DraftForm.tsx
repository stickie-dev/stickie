import { useEffect, useRef, useState } from 'react'
import { useReview } from '../store'

export function DraftForm() {
  const draft = useReview((s) => s.draft)
  const submitDraft = useReview((s) => s.submitDraft)
  const cancelDraft = useReview((s) => s.cancelDraft)
  const [text, setText] = useState('')
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

  const submit = async () => {
    const body = text.trim()
    if (body === '') return
    await submitDraft(body)
  }

  return (
    <div className="rounded-md border border-sky-700 bg-zinc-800 p-2 text-sm shadow-lg">
      <div className="mb-1 text-xs text-zinc-400">
        New note on L{draft.startLine}
        {draft.endLine !== draft.startLine ? `–L${draft.endLine}` : ''} (
        {draft.side} side)
      </div>
      <textarea
        ref={textareaRef}
        rows={2}
        className="w-full resize-y rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-sky-500"
        placeholder="What should change here? (⌘↵ to submit, Esc to cancel)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          if (e.key === 'Escape') cancelDraft()
        }}
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          onClick={cancelDraft}
        >
          cancel
        </button>
        <button
          className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
          onClick={() => void submit()}
        >
          comment
        </button>
      </div>
    </div>
  )
}
