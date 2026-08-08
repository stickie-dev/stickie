import { useState } from 'react'
import type { Thread } from '@stickie/shared'
import { useReview } from '../store'

const ref_pattern = /([\w./-]+:L\d+(?:-L?\d+)?)/g

/** Render path:L10 / path:L10-L20 references as jump links. */
function MessageBody({ body }: { body: string }) {
  const openRef = useReview((s) => s.openRef)
  const parts = body.split(ref_pattern)
  return (
    <span className="whitespace-pre-wrap text-ink">
      {' '}
      {parts.map((part, i) => {
        const match = /^([\w./-]+):L(\d+)/.exec(part)
        if (i % 2 === 1 && match !== null) {
          const path = match[1] ?? ''
          const line = Number(match[2])
          return (
            <button
              key={i}
              className="rounded bg-accent/10 px-1 font-mono text-accent hover:bg-accent/20"
              title={`open ${path}`}
              onClick={() => void openRef(path, line)}
            >
              {part}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

const status_styles: Record<Thread['status'], string> = {
  open: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  resolved:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  detached:
    'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
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
    <div className="rounded-md border border-edge bg-panel text-sm shadow-lg">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${status_styles[thread.status]}`}
        >
          {thread.status}
        </span>
        <span className="text-xs text-soft">
          L{thread.startLine}
          {thread.endLine !== thread.startLine ? `–L${thread.endLine}` : ''}
          {' · thread '}
          {thread.id}
        </span>
        <span className="grow" />
        {thread.status === 'open' ? (
          <button
            className="text-xs text-emerald-600 hover:underline dark:text-emerald-400"
            onClick={() => void resolveThread(thread.id)}
          >
            resolve
          </button>
        ) : (
          <button
            className="text-xs text-amber-600 hover:underline dark:text-amber-400"
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
                  ? 'font-semibold text-sky-600 dark:text-sky-400'
                  : 'font-semibold text-ink'
              }
            >
              {message.author}
            </span>
            <MessageBody body={message.body} />
          </div>
        ))}
        {showReply ? (
          <div className="flex gap-2">
            <input
              autoFocus
              className="grow rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
              placeholder="reply…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitReply()
                if (e.key === 'Escape') setShowReply(false)
              }}
            />
            <button
              className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-strong"
              onClick={() => void submitReply()}
            >
              send
            </button>
          </div>
        ) : (
          <button
            className="text-xs text-soft hover:text-ink"
            onClick={() => setShowReply(true)}
          >
            reply…
          </button>
        )}
      </div>
    </div>
  )
}
