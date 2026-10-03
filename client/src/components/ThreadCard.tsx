import { useState } from 'react'
import type { Thread } from '@stickie/shared'
import { postsComment } from '../keys'
import {
  ReplyBox,
  ReplyRow,
  SaidLine,
  StatusBadge,
  shadeRun,
} from './NoteCard'
import { useReview } from '../store'
import { GrowingTextarea } from './GrowingTextarea'
import { TimeAgo } from './TimeAgo'
import { ask } from '../confirm'
import { Send } from '../icons'
import { badge, btn, field, motion } from '../ui'

/** Where the card is rendered; the same note appears in both. */
type Surface = 'zone' | 'panel'

export function ThreadCard({
  thread,
  surface = 'zone',
}: {
  thread: Thread | undefined
  surface?: Surface
}) {
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
   * history standing in front of the code. So in the diff it folds to its first
   * line and opens on ask — except the note a link pointed at, which opens
   * itself, being the one somebody was sent to read.
   *
   * Not in the comments panel: there the notes *are* the content, nothing is
   * standing in front of anything, and the Unresolved filter above them already
   * puts the history out of the way for anyone who wants it gone.
   */
  const [opened, setOpened] = useState(false)
  const folds = surface === 'zone' && thread?.status === 'resolved'
  const open = !folds || opened || linked
  const first = thread?.messages[0]
  // the ground shifts when the speaker does, the same way it does on a merge
  // request's discussions — one rule, drawn by one component
  const shades = shadeRun(
    (thread?.messages ?? []).map((m) => m.actorName ?? m.author),
  )

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
      className={`min-w-0 rounded-lg bg-panel text-note shadow-lifted ${
        linked ? 'ring-1 ring-accent' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge/60 px-3 py-1.5">
        <StatusBadge status={thread.status} />
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
            className="mr-2 inline-flex items-center gap-1 text-xs text-violet-700 hover:underline dark:text-violet-300"
            title="make this note visible to agents without submitting the whole review"
            onClick={() => void postThread(thread.id)}
          >
            <Send className="h-3 w-3" />
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
          thread.messages.map((message, index) =>
          editingId === message.id ? (
            <div key={message.id} className="flex items-end gap-2">
              <GrowingTextarea
                autoFocus
                className={`grow ${field}`}
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
            <SaidLine
              key={message.id}
              shade={shades[index] ?? false}
              said={{
                    author: message.actorName ?? message.author,
                    kind: message.author,
                    body: message.body,
                    at: message.createdAt,
                    actions:
                      message.author === 'user' ? (
                        <>
                          {/*
                            Faded rather than absent, so the row is the same
                            height either way — and deaf to the pointer while
                            it is faded, because an invisible delete is worse
                            than no delete at all.
                          */}
                          <button
                            className={`ml-1.5 text-xs text-faint opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-events-none hover:text-ink ${motion}`}
                            title="edit this message"
                            onClick={() => {
                              setEditingId(message.id)
                              setEditText(message.body)
                            }}
                          >
                            edit
                          </button>
                          <button
                            className={`ml-1.5 text-xs text-faint opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-events-none hover:text-rose-500 ${motion}`}
                            title="delete this message"
                            onClick={() => void deleteMessage(thread.id, message.id)}
                          >
                            delete
                          </button>
                        </>
                      ) : undefined,
              }}
            />
          ),
        )}
        {showReply ? (
          <ReplyBox
            value={replyText}
            onChange={(next) => updateReplyDraft(thread.id, next)}
            onFocus={() => setActiveReply(thread.id)}
            onSubmit={() => void submitReply()}
            onCancel={closeReply}
            submitLabel="send"
          />
        ) : (
          <ReplyRow onOpen={() => setShowReply(true)} />
        )}
      </div>
    </div>
  )
}
