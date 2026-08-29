import { useState } from 'react'
import type { Thread } from '@stickie/shared'
import { postsComment } from '../keys'
import { useReview } from '../store'
import { TimeAgo } from './TimeAgo'
import { ask } from '../confirm'
import { badge, btn, field } from '../ui'

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
  open: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  detached: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
}

export function ThreadCard({ thread }: { thread: Thread | undefined }) {
  const reply = useReview((s) => s.reply)
  /**
   * A note address marks the note it named. Landing on its line is not enough
   * on its own — a line can carry several notes, and a whole-file note has no
   * line at all — so the card says which one the link meant.
   */
  const linked = useReview(
    (s) => thread !== undefined && s.noteHighlight === thread.id,
  )
  const postThread = useReview((s) => s.postThread)
  const resolveThread = useReview((s) => s.resolveThread)
  const reopenThread = useReview((s) => s.reopenThread)
  const submitKey = useReview((s) => s.submitKey)
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
  /**
   * A resolved note is history, and a file holding eleven of them is mostly
   * history standing in front of the code. So it folds to its first line and
   * opens on ask — except the note a link pointed at, which opens itself,
   * being the one somebody was sent to read.
   */
  const [opened, setOpened] = useState(false)
  const folds = thread?.status === 'resolved'
  const open = !folds || opened || linked
  const first = thread?.messages[0]

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
    <div
      className={`min-w-0 rounded-lg bg-panel text-[13px] shadow-lifted ${
        linked ? 'ring-1 ring-accent' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge/60 px-3 py-1.5">
        <span className={`${badge} ${status_styles[thread.status]}`}>
          {thread.status}
        </span>
        <span className="text-xs text-soft">
          {thread.startLine === 0
            ? thread.path === ''
              ? 'review note'
              : 'file note'
            : `L${thread.startLine}${
                thread.endLine !== thread.startLine
                  ? `–L${thread.endLine}`
                  : ''
              }`}
          {/*
            The note's number inside this review, which is what the export and
            the MCP tools take — the row id is in the link and nowhere a person
            has to read it.
          */}
          {' · note '}
          {thread.number}
        </span>
        {/*
          When the note was raised, in the header rather than only on its first
          message: the panel showed it above the card and the diff showed it
          nowhere, so a note in the code said nothing about when it was written.
          A folded note has no message line to carry it either.
        */}
        <TimeAgo at={thread.createdAt} className="text-xs text-faint" />
        {thread.pending && (
          <span
            className={`${badge} bg-violet-500/15 text-violet-700 dark:text-violet-300`}
          >
            draft
          </span>
        )}
        {thread.origin !== null && (
          <span className={`${badge} bg-overlay text-soft`}>
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
        {/*
          Anything not resolved can be resolved, detached included. Everything
          that counts unresolved notes counts a detached one — the status bar,
          the comments panel, and the export, which sends every note that is
          not resolved — so a note whose code has gone has to be closable or it
          rides along in every export from here on.
        */}
        {folds && (
          <button
            className={`mr-1 text-xs ${btn()}`}
            title={
              open ? 'fold this note away' : 'read this note and its replies'
            }
            onClick={() => setOpened(!opened)}
          >
            {open ? 'hide' : 'show'}
          </button>
        )}
        {thread.status === 'resolved' ? (
          <button
            className="text-xs text-amber-600 hover:underline dark:text-amber-400"
            onClick={() => void reopenThread(thread.id)}
          >
            reopen
          </button>
        ) : (
          <button
            className="text-xs text-emerald-600 hover:underline dark:text-emerald-400"
            title={
              thread.status === 'detached'
                ? 'close this note as history — the code it was written against is gone'
                : undefined
            }
            onClick={() => void resolveThread(thread.id)}
          >
            resolve
          </button>
        )}
        <button
          className="ml-2 text-xs text-rose-600 hover:underline dark:text-rose-400"
          title="delete this note and its replies"
          onClick={() => {
            void (async () => {
              const replies = thread.messages.length - 1
              if (
                await ask({
                  title: `Delete note ${String(thread.number)}?`,
                  detail:
                    replies > 0
                      ? `It and its ${String(replies)} ${
                          replies === 1 ? 'reply' : 'replies'
                        } go. The record keeps that it existed; the note itself cannot be brought back.`
                      : 'The record keeps that it existed; the note itself cannot be brought back.',
                  confirmLabel: 'Delete',
                  danger: true,
                })
              ) {
                await deleteThread(thread.id)
              }
            })()
          }}
        >
          delete
        </button>
      </div>
      <div className="space-y-2 px-3 py-2">
        {/* folded: who raised it and the first line of what they said */}
        {!open && (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-semibold text-ink">
              {first?.actorName ?? first?.author ?? ''}
            </span>
            <span className="truncate text-soft">{first?.body ?? ''}</span>
            {thread.messages.length > 1 && (
              <span
                className="shrink-0 text-xs text-faint"
                title={`${String(thread.messages.length - 1)} more in this note`}
              >
                +{thread.messages.length - 1}
              </span>
            )}
          </div>
        )}
        {open &&
          thread.messages.map((message) =>
          editingId === message.id ? (
            <div key={message.id} className="flex gap-2">
              <textarea
                autoFocus
                rows={2}
                className={`grow resize-y ${field}`}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (postsComment(e, submitKey)) {
                    e.preventDefault()
                    void editMessage(thread.id, message.id, editText.trim())
                    setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
              <div className="flex flex-col gap-1">
                <button
                  className={`text-xs ${btn('primary')}`}
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
                title={`role: ${message.author}`}
              >
                {message.actorName ?? message.author}
              </span>
              <TimeAgo at={message.createdAt} className="ml-1.5 text-faint" />
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
          <div className="flex gap-2 border-t border-edge/60 pt-2">
            <textarea
              autoFocus
              rows={2}
              className={`grow resize-y ${field}`}
              placeholder={
                submitKey === 'enter'
                  ? 'reply… (↵ to send, ⇧↵ for a new line)'
                  : 'reply… (⌘↵ to send)'
              }
              value={replyText}
              onChange={(e) => updateReplyDraft(thread.id, e.target.value)}
              onFocus={() => setActiveReply(thread.id)}
              onKeyDown={(e) => {
                if (postsComment(e, submitKey)) {
                  e.preventDefault()
                  void submitReply()
                }
                if (e.key === 'Escape') closeReply()
              }}
            />
            <button
              className={`text-xs ${btn('primary')}`}
              onClick={() => void submitReply()}
            >
              send
            </button>
          </div>
        ) : (
          <div className="border-t border-edge/60 pt-1.5">
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
