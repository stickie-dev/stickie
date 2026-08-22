import { useState } from 'react'
import type { Thread } from '@stickie/shared'
import { useReview } from '../store'

const ref_pattern = /(@[\w./-]+(?::[\w./-]+)?:L\d+(?:-L?\d+)?)/g

/** Render @path:L10 and @repo:path:L10 references as jump links. */
function MessageBody({ body }: { body: string }) {
  const openRefTarget = useReview((s) => s.openRefTarget)
  const parts = body.split(ref_pattern)
  return (
    <span className="whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
      {' '}
      {parts.map((part, i) => {
        const match = /^@(.+):L(\d+)/.exec(part)
        if (i % 2 === 1 && match !== null) {
          const target = match[1] ?? ''
          const line = Number(match[2])
          const colon = target.indexOf(':')
          const has_repo =
            colon !== -1 && !target.slice(0, colon).includes('/')
          const repo = has_repo ? target.slice(0, colon) : null
          const path = has_repo ? target.slice(colon + 1) : target
          return (
            <button
              key={i}
              className="rounded bg-accent/10 px-1 text-left font-mono text-accent [overflow-wrap:anywhere] hover:bg-accent/20"
              title={repo === null ? `open ${path}` : `open ${path} in ${repo}`}
              onClick={() => void openRefTarget(repo, path, line)}
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
  const postThread = useReview((s) => s.postThread)
  const resolveThread = useReview((s) => s.resolveThread)
  const reopenThread = useReview((s) => s.reopenThread)
  const setActiveReply = useReview((s) => s.setActiveReply)
  const updateReplyDraft = useReview((s) => s.updateReplyDraft)
  const editMessage = useReview((s) => s.editMessage)
  const deleteThread = useReview((s) => s.deleteThread)
  const deleteMessage = useReview((s) => s.deleteMessage)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const replyText = useReview((s) =>
    thread === undefined ? '' : (s.replyDrafts[thread.id] ?? ''),
  )
  const [showReply, setShowReply] = useState(false)

  if (thread === undefined) return null

  const submitReply = async () => {
    const text = replyText.trim()
    if (text === '') return
    await reply(thread.id, text)
    setShowReply(false)
  }

  const closeReply = () => {
    setShowReply(false)
    setActiveReply(null)
  }

  return (
    <div className="min-w-0 rounded-md border border-edge bg-panel text-sm shadow-lg">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-3 py-1.5">
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
        {thread.pending && (
          <span className="rounded border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-violet-700 dark:text-violet-300">
            pending
          </span>
        )}
        {thread.origin !== null && (
          <span className="rounded border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-soft">
            {thread.origin}
          </span>
        )}
        <span className="grow" />
        {thread.pending && (
          <button
            className="mr-2 text-xs text-violet-700 hover:underline dark:text-violet-300"
            title="make this note visible to agents without submitting the whole review"
            onClick={() => void postThread(thread.id)}
          >
            post now
          </button>
        )}
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
        <button
          className="ml-2 text-xs text-rose-600 hover:underline dark:text-rose-400"
          title="delete this note and its replies"
          onClick={() => {
            if (window.confirm('Delete this note and all its replies?')) {
              void deleteThread(thread.id)
            }
          }}
        >
          delete
        </button>
      </div>
      <div className="space-y-2 px-3 py-2">
        {thread.messages.map((message) =>
          editingId === message.id ? (
            <div key={message.id} className="flex gap-2">
              <textarea
                autoFocus
                rows={2}
                className="grow resize-y rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    void editMessage(thread.id, message.id, editText.trim())
                    setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
              <div className="flex flex-col gap-1">
                <button
                  className="rounded bg-accent px-2 py-0.5 text-xs text-white hover:bg-accent-strong"
                  onClick={() => {
                    if (editText.trim() !== '') {
                      void editMessage(thread.id, message.id, editText.trim())
                    }
                    setEditingId(null)
                  }}
                >
                  save
                </button>
                <button
                  className="text-xs text-soft hover:text-ink"
                  onClick={() => setEditingId(null)}
                >
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <div key={message.id} className="group">
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
              {message.author === 'user' && (
                <>
                  <button
                    className="ml-1.5 hidden text-xs text-faint group-hover:inline hover:text-ink"
                    title="edit this message"
                    onClick={() => {
                      setEditingId(message.id)
                      setEditText(message.body)
                    }}
                  >
                    edit
                  </button>
                  <button
                    className="ml-1.5 hidden text-xs text-faint group-hover:inline hover:text-rose-500"
                    title="delete this message"
                    onClick={() => void deleteMessage(thread.id, message.id)}
                  >
                    delete
                  </button>
                </>
              )}
            </div>
          ),
        )}
        {showReply ? (
          <div className="flex gap-2 border-t border-edge pt-2">
            <input
              autoFocus
              className="grow rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
              placeholder="reply… (select code anywhere to insert a reference)"
              value={replyText}
              onChange={(e) => updateReplyDraft(thread.id, e.target.value)}
              onFocus={() => setActiveReply(thread.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitReply()
                if (e.key === 'Escape') closeReply()
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
          <div className="border-t border-edge pt-1.5">
            <button
              className="text-xs text-soft hover:text-ink"
              onClick={() => setShowReply(true)}
            >
              reply…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
