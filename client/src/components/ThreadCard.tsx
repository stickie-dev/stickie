import { useState } from 'react'
import type { Thread } from '@stickie/shared'
import { useReview } from '../store'

const status_styles: Record<Thread['status'], string> = {
  open: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  detached: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
}

export function ThreadCard({ thread }: { thread: Thread | undefined }) {
  const reply = useReview((s) => s.reply)
  const resolveThread = useReview((s) => s.resolveThread)
  const reopenThread = useReview((s) => s.reopenThread)
  const [replyText, setReplyText] = useState('')
  const [showReply, setShowReply] = useState(false)

  if (thread === undefined) return null

  const submitReply = async () => {
    const text = replyText.trim()
    if (text === '') return
    await reply(thread.id, text)
    setReplyText('')
    setShowReply(false)
  }

  return (
    <div className="rounded-md border border-zinc-600 bg-zinc-800 text-sm shadow-lg">
      <div className="flex items-center gap-2 border-b border-zinc-700 px-3 py-1.5">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${status_styles[thread.status]}`}
        >
          {thread.status}
        </span>
        <span className="text-xs text-zinc-400">
          L{thread.startLine}
          {thread.endLine !== thread.startLine ? `–L${thread.endLine}` : ''}
          {' · thread '}
          {thread.id}
        </span>
        <span className="grow" />
        {thread.status === 'open' ? (
          <button
            className="text-xs text-emerald-400 hover:underline"
            onClick={() => void resolveThread(thread.id)}
          >
            resolve
          </button>
        ) : (
          <button
            className="text-xs text-amber-400 hover:underline"
            onClick={() => void reopenThread(thread.id)}
          >
            reopen
          </button>
        )}
      </div>
      <div className="space-y-2 px-3 py-2">
        {thread.messages.map((message) => (
          <div key={message.id}>
            <span
              className={
                message.author === 'agent'
                  ? 'font-semibold text-sky-400'
                  : 'font-semibold text-zinc-300'
              }
            >
              {message.author}
            </span>
            <span className="whitespace-pre-wrap text-zinc-200"> {message.body}</span>
          </div>
        ))}
        {showReply ? (
          <div className="flex gap-2">
            <input
              autoFocus
              className="grow rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-sky-500"
              placeholder="reply…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitReply()
                if (e.key === 'Escape') setShowReply(false)
              }}
            />
            <button
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-500"
              onClick={() => void submitReply()}
            >
              send
            </button>
          </div>
        ) : (
          <button
            className="text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => setShowReply(true)}
          >
            reply…
          </button>
        )}
      </div>
    </div>
  )
}
