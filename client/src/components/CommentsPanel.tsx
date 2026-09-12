import { useEffect, useMemo, useRef, useState } from 'react'
import type { MrThread, NoteDefault } from '../api'
import { GrowingTextarea } from './GrowingTextarea'
import { DraftForm } from './DraftForm'
import { SubmitSplit } from './SubmitSplit'
import { postsComment } from '../keys'
import { paneWidth } from '../panes'
import { orderedThreadIds, useReview } from '../store'
import { Markdown } from './Markdown'
import { ThreadCard } from './ThreadCard'
import { Close } from '../icons'
import { Loading, SkeletonCard } from './Skeleton'
import { badge, btn, card, field, field_flush, icon_button } from '../ui'

/** A composer for notes that carry no code anchor. */
function NoteComposer({ onDone }: { onDone: () => void }) {
  const addNote = useReview((s) => s.addNote)
  const rememberNoteDefault = useReview((s) => s.rememberNoteDefault)
  const submitKey = useReview((s) => s.submitKey)
  const selectedPath = useReview((s) => s.selectedPath)
  /**
   * The whole review, whether or not a file is open. This is the composer for a
   * remark that belongs to no line, and the usual such remark is about the
   * change rather than about whichever file happens to be on screen — which is
   * what it used to assume.
   */
  const [scope, setScope] = useState<'review' | 'file'>('review')
  const [body, setBody] = useState('')

  const submit = (as?: NoteDefault) => {
    if (body.trim() === '') return
    void addNote(scope, body.trim(), as)
    setBody('')
    onDone()
  }

  return (
    <div className="rounded-lg bg-panel p-2 text-note ring-1 ring-accent">
      <div className="mb-1 flex items-center gap-2 text-xs text-soft">
        <span>note on</span>
        {/*
          Both are notes with no line under them. The review is the usual one —
          the approach, a missing test, something that belongs to the change
          rather than to a place in it. The other attaches the same kind of note
          to a whole file, for "this file should be split" and the like; it is
          the file that is open, since a list of every file to pick from is a
          file picker and this is a note box. The export writes them as "whole
          review" and "path (whole file)".
        */}
        <select
          className={`px-1 py-0.5 ${field}`}
          value={scope}
          onChange={(e) => setScope(e.target.value as 'review' | 'file')}
        >
          <option value="review">the whole review</option>
          <option value="file" disabled={selectedPath === null}>
            {selectedPath === null
              ? 'a whole file — none open'
              : `the whole file — ${selectedPath.split('/').at(-1) ?? selectedPath}`}
          </option>
        </select>
      </div>
      <GrowingTextarea
        autoFocus
        rows={3}
        className={`w-full ${field_flush}`}
        placeholder="Anything not tied to a line — approach, missing tests, naming… (⌘↵ to add)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (postsComment(e, submitKey)) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') onDone()
        }}
      />
      <div className="mt-1 flex justify-end gap-2">
        <button className={`text-xs ${btn()}`} onClick={onDone}>
          cancel
        </button>
        {/* the same control a note on a line gets: one place decides what
            sending means, and it says which it will do */}
        <SubmitSplit
          menuKey="general"
          disabled={body.trim() === ''}
          onPick={(as) => void rememberNoteDefault(as)}
          onSubmit={(as) => submit(as)}
        />
      </div>
    </div>
  )
}

/**
 * Right-hand overview of every thread in the session: jump to any anchor,
 * reply, edit, or resolve without hunting through files. Notes still being
 * written stay here too, so a note survives — and stays editable — while
 * other files are visited to collect references. The list is in posting
 * order and follows new arrivals; *prompt order* switches it to the
 * arrangement Copy prompt uses, where notes can be moved by hand.
 */
/**
 * The attached merge request's discussion, read from GitLab.
 *
 * Read-only on purpose. These are not stickie's notes and must not look like
 * them: nobody should have to work out which marks in this panel are theirs.
 * Two things can be done with one — reply, which goes to the merge request
 * and is signed as having come through stickie, and start a note here, which
 * makes an ordinary stickie note on the same lines carrying what was said.
 */
function MrThreads({
  threads,
  loading,
  mr,
}: {
  threads: MrThread[]
  loading: boolean
  mr: { iid: number; projectPath: string } | null
}) {
  const discussInStickie = useReview((s) => s.discussInStickie)
  const replyToMr = useReview((s) => s.replyToMr)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')

  if (loading && threads.length === 0) {
    return (
      <div className="min-h-0 grow overflow-y-auto p-3">
        <Loading what="the merge request">
          <SkeletonCard />
          <SkeletonCard />
        </Loading>
      </div>
    )
  }
  if (threads.length === 0) {
    return (
      <p className="min-h-0 grow p-3 text-xs text-faint">
        {mr === null
          ? 'No merge request attached.'
          : `Nothing has been said on !${String(mr.iid)} yet.`}
      </p>
    )
  }

  return (
    <div className="min-h-0 grow space-y-3 overflow-y-auto p-3">
      {threads.map((thread) => (
        <div key={thread.id} className={`p-2 ${card}`}>
          <div className="mb-1 flex items-center gap-2 text-xs">
            <span className="min-w-0 truncate font-mono text-soft">
              {thread.path === null
                ? 'on the merge request'
                : `${thread.path}${thread.line === null ? '' : `:L${String(thread.line)}`}`}
            </span>
            <span className="grow" />
            {thread.resolved && <span className={`${badge} bg-overlay text-faint`}>resolved</span>}
          </div>
          {thread.messages.map((m, i) => (
            <div key={i} className="mb-1.5 text-note">
              <span className="font-medium text-ink">{m.author}</span>
              {/* a hub's comments are markdown, and rather more of it than
                  stickie's own notes tend to be: checkboxes, images, tables */}
              <div className="text-soft">
                <Markdown body={m.body} text={(run) => run} />
              </div>
            </div>
          ))}
          {replyTo === thread.id ? (
            <div className="mt-2">
              <GrowingTextarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="reply on the merge request…"
              />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  className={`text-xs ${btn()}`}
                  onClick={() => {
                    setReplyTo(null)
                    setReply('')
                  }}
                >
                  cancel
                </button>
                <button
                  className={`text-xs ${btn('primary')}`}
                  disabled={reply.trim() === ''}
                  onClick={() => {
                    void replyToMr(thread.id, reply)
                    setReplyTo(null)
                    setReply('')
                  }}
                >
                  Reply on !{mr?.iid}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex gap-2">
              <button
                className={`text-xs ${btn()}`}
                title="reply on the merge request — it goes there, signed as having come through stickie"
                onClick={() => setReplyTo(thread.id)}
              >
                reply there
              </button>
              <button
                className={`text-xs ${btn()}`}
                title="start a stickie note on these lines, carrying what was said here"
                onClick={() => void discussInStickie(thread)}
              >
                note here
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function CommentsPanel() {
  const width = useReview((s) => s.paneRatios.comments)
  const threads = useReview((s) => s.threads)
  const drafts = useReview((s) => s.drafts)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const repos = useReview((s) => s.repos)
  const selectRepo = useReview((s) => s.selectRepo)
  const openRef = useReview((s) => s.openRef)
  const toggleComments = useReview((s) => s.toggleComments)
  const promptOrder = useReview((s) => s.promptOrder)
  const moveInPromptOrder = useReview((s) => s.moveInPromptOrder)
  // three tabs, not two: the merge request's discussion is a third thing to
  // look at, and it is not stickie's notes — it is read from GitLab and shown
  const [tab, setTab] = useState<'unresolved' | 'all' | 'mr'>('unresolved')
  const openOnly = tab === 'unresolved'
  const session = useReview((s) => s.session)
  const mrThreads = useReview((s) => s.mrThreads)
  const mrLoading = useReview((s) => s.mrLoading)
  const mrLoaded = useReview((s) => s.mrLoaded)
  const loadMrThreads = useReview((s) => s.loadMrThreads)
  const [arranging, setArranging] = useState(false)
  const [composing, setComposing] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const filtered = openOnly
      ? threads.filter((t) => t.status !== 'resolved')
      : threads
    if (!arranging) return [...filtered].sort((a, b) => a.id - b.id)
    const rank = new Map(
      orderedThreadIds(threads, promptOrder).map((id, index) => [id, index]),
    )
    return [...filtered].sort(
      (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
    )
  }, [threads, openOnly, arranging, promptOrder])

  // a note arriving from an agent should be visible without hunting for it
  const seen = useRef<number[]>([])
  useEffect(() => {
    const ids = threads.map((t) => t.id)
    const fresh = ids.filter((id) => !seen.current.includes(id))
    seen.current = ids
    if (fresh.length === 0 || arranging) return
    const newest = Math.max(...fresh)
    const node = listRef.current?.querySelector(`[data-thread="${newest}"]`)
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [threads, arranging])

  // what each filter would show, so the choice does not have to be made blind
  const unresolved = threads.filter((t) => t.status !== 'resolved').length
  const total = visible.length
  const mr = session?.mr ?? null

  // opened rather than loaded on mount: nobody pays for a GitLab round trip
  // until they look. Once, though — on `mrLoaded` rather than on an empty
  // list, or a fetch that fails leaves the list empty and the effect asks
  // again, and again, for as long as the tab is open
  const mrIid = mr?.iid ?? null
  useEffect(() => {
    if (tab === 'mr' && mrIid !== null && !mrLoaded && !mrLoading) {
      void loadMrThreads()
    }
  }, [tab, mrIid, mrLoaded, mrLoading, loadMrThreads])

  return (
    <aside
      className="flex shrink-0 flex-col bg-surface"
      style={{ width: paneWidth('comments', width) }}
    >
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <h2 className="text-sm font-semibold text-ink">Comments</h2>
        <span className="grow" />
        <button
          className={icon_button}
          title="close the panel"
          aria-label="close the panel"
          onClick={toggleComments}
        >
          <Close />
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-edge px-3 py-1.5 text-xs">
        <div className="flex overflow-hidden rounded-md bg-overlay">
          {(
            [
              { key: 'unresolved', label: 'Unresolved', count: unresolved },
              { key: 'all', label: 'All', count: threads.length },
              ...(mr == null
                ? []
                : [
                    {
                      key: 'mr' as const,
                      label: `MR (!${String(mr.iid)})`,
                      count: mrThreads.length,
                    },
                  ]),
            ] as const
          ).map((choice) => {
            const active = tab === choice.key
            return (
              <button
                key={choice.key}
                className={`flex items-center gap-1.5 px-2 py-0.5 ${active ? 'bg-accent text-white' : 'text-soft hover:bg-overlay hover:text-ink'}`}
                onClick={() => {
                  // already here: the reader is asking for it again
                  if (choice.key === 'mr' && tab === 'mr') void loadMrThreads()
                  setTab(choice.key)
                }}
              >
                {choice.label}
                <span
                  className={`tabular-nums ${active ? 'text-white/70' : 'text-faint'}`}
                >
                  {choice.count}
                </span>
              </button>
            )
          })}
        </div>
        <span className="grow" />
        <button
          className={`rounded px-1.5 py-0.5 ${arranging ? 'bg-accent/15 text-accent' : 'text-soft hover:bg-overlay hover:text-ink'}`}
          title="show the order Copy prompt uses, and rearrange it"
          onClick={() => setArranging(!arranging)}
        >
          prompt order
        </button>
      </div>
      {tab === 'mr' && (
        <MrThreads
          threads={mrThreads}
          loading={mrLoading}
          mr={mr}
        />
      )}
      <div
        ref={listRef}
        className={`min-h-0 grow space-y-3 overflow-y-auto p-3 ${tab === 'mr' ? 'hidden' : ''}`}
      >
        {visible.map((thread, index) => (
          <div key={thread.id} data-thread={thread.id}>
            <div className="mb-1 flex items-center gap-2">
              {thread.startLine === 0 ? (
                <span className="min-w-0 truncate font-mono text-xs text-soft">
                  {thread.path === '' ? 'whole review' : `${thread.path} · file`}
                </span>
              ) : (
                <button
                  className="min-w-0 truncate font-mono text-xs text-accent hover:underline"
                  title={`jump to ${thread.path}:L${thread.startLine}`}
                  onClick={() => void openRef(thread.path, thread.startLine)}
                >
                  {thread.path}:L{thread.startLine}
                </button>
              )}
              <span className="grow" />
              {/* the card carries its own time now, in its header */}
              {arranging && (
                <span className="flex shrink-0 items-center gap-0.5 text-xs text-soft">
                  <span className="mr-1 text-faint">{index + 1}</span>
                  <button
                    className={btn('text', 'px-1.5 py-0.5')}
                    title="earlier in the prompt"
                    disabled={index === 0}
                    onClick={() => moveInPromptOrder(thread.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className={btn('text', 'px-1.5 py-0.5')}
                    title="later in the prompt"
                    disabled={index === visible.length - 1}
                    onClick={() => moveInPromptOrder(thread.id, 1)}
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>
            <ThreadCard thread={thread} surface="panel" />
          </div>
        ))}

        {/* notes still being written sit last, where they were just made */}
        {drafts.map((draft) => {
          const repo_name = repos.find((r) => r.id === draft.repoId)?.name
          const cross_repo = draft.repoId !== activeRepoId
          return (
            <div key={draft.id}>
              <button
                className="mb-1 max-w-full truncate font-mono text-xs text-accent hover:underline"
                title={`back to ${draft.path}:L${draft.startLine}`}
                onClick={() => {
                  void (async () => {
                    if (cross_repo) await selectRepo(draft.repoId)
                    await openRef(draft.path, draft.startLine)
                  })()
                }}
              >
                {cross_repo && repo_name !== undefined ? `${repo_name}:` : ''}
                {draft.path}:L{draft.startLine}
              </button>
              <DraftForm draft={draft} surface="panel" />
            </div>
          )
        })}

        {total === 0 && drafts.length === 0 && !composing && (
          <p className="text-xs text-faint">
            {openOnly ? 'No unresolved comments.' : 'No comments yet.'}
          </p>
        )}
      </div>

      {/* the composer sits where what it makes will appear, not opposite it */}
      <div className="border-t border-edge p-3">
        {composing ? (
          <NoteComposer onDone={() => setComposing(false)} />
        ) : (
          <button
            className={`w-full text-xs ${btn('outline', 'py-1.5')}`}
            title="a note on the whole file or the whole review, with no line behind it"
            onClick={() => setComposing(true)}
          >
            + note
          </button>
        )}
      </div>
    </aside>
  )
}
