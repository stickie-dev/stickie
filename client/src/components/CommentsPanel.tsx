import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MergeRequest, MrThread, NoteDefault } from '../api'
import { GrowingTextarea } from './GrowingTextarea'
import { DraftForm } from './DraftForm'
import { SubmitSplit } from './SubmitSplit'
import { postsComment } from '../keys'
import { paneWidth } from '../panes'
import { orderedThreadIds, useReview } from '../store'
import { plainSummary } from '../markdown'
import {
  CardBody,
  CardHeader,
  CardShell,
  ReplyBox,
  ReplyRow,
  Saids,
  StatusBadge,
} from './NoteCard'
import { ThreadCard } from './ThreadCard'
import { ChevronDown, ChevronRight, Close, Grip, Reorder } from '../icons'
import { dropAt } from '../reorder'
import { Loading, SkeletonCard } from './Skeleton'
import {
  badge,
  btn,
  card,
  field,
  field_flush,
  icon_button,
  icon_button_on,
} from '../ui'

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
 * order and follows new arrivals; the prompt-order toggle switches it to the
 * arrangement Copy prompt uses, where each note has a handle to drag it by.
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
  candidate,
}: {
  threads: MrThread[]
  loading: boolean
  mr: { iid: number; projectPath: string } | null
  candidate: MergeRequest | null
}) {
  const notes = useReview((s) => s.threads)
  const discussInStickie = useReview((s) => s.discussInStickie)
  const replyToMr = useReview((s) => s.replyToMr)
  const openRef = useReview((s) => s.openRef)
  const setNoteHighlight = useReview((s) => s.setNoteHighlight)
  const [answering, setAnswering] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // resolved discussions start folded: they are the ones already dealt with,
  // and on a busy merge request they are most of the list
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [showResolved, setShowResolved] = useState(false)

  const settled = threads.filter((t) => t.resolved).length
  const shown = showResolved ? threads : threads.filter((t) => !t.resolved)
  /** The stickie note started from a discussion, if one was. */
  const noteFor = (id: string) => notes.find((n) => n.mrDiscussion === id)

  if (loading && threads.length === 0) {
    return (
      <div className="min-h-0 grow overflow-y-auto px-2 py-3">
        <Loading what="the merge request">
          <SkeletonCard />
          <SkeletonCard />
        </Loading>
      </div>
    )
  }
  if (threads.length === 0) {
    return (
      <p className="min-h-0 grow px-2 py-3 text-xs text-faint">
        {mr === null
          ? 'No merge request for this branch.'
          : `Nothing has been said on !${String(mr.iid)} yet.`}
      </p>
    )
  }

  return (
    <div className="min-h-0 grow space-y-3 overflow-y-auto px-2 py-3">
      {candidate !== null && (
        <p className="text-xs text-faint">
          <a
            href={candidate.webUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            !{candidate.iid}
          </a>{' '}
          {candidate.title} — {candidate.sourceBranch} into{' '}
          {candidate.targetBranch}

        </p>
      )}
      {settled > 0 && (
        <button
          className={`text-xs ${btn()}`}
          onClick={() => setShowResolved(!showResolved)}
        >
          {showResolved ? 'hide' : 'show'} {settled} resolved
        </button>
      )}
      {shown.map((thread) => {
        const open = opened[thread.id] ?? !thread.resolved
        const first = thread.messages[0]
        const note = noteFor(thread.id)
        return (
          <CardShell key={thread.id}>
            <CardHeader>
              <button
                className="flex min-w-0 grow items-center gap-2 text-left"
                aria-expanded={open}
                onClick={() => setOpened({ ...opened, [thread.id]: !open })}
              >
                <span className="shrink-0 text-faint [&>svg]:h-3.5 [&>svg]:w-3.5">
                  {open ? <ChevronDown /> : <ChevronRight />}
                </span>
                <StatusBadge status={thread.resolved ? 'resolved' : 'open'} />
                <span className="min-w-0 truncate text-xs text-soft">
                  {thread.path === null
                    ? 'on the merge request'
                    : `${thread.path}${thread.line === null ? '' : `:L${String(thread.line)}`}`}
                </span>
                {thread.messages.length > 1 && (
                  <span className="shrink-0 text-xs tabular-nums text-faint">
                    {thread.messages.length}
                  </span>
                )}
              </button>
              {note !== undefined && (
                <span className={`${badge} bg-accent-soft text-accent`}>
                  note {note.number}
                </span>
              )}
            </CardHeader>
            {!open && first !== undefined ? (
              <p className="truncate px-3 py-1.5 text-faint">
                <span className="font-medium">{first.author}</span>{' '}
                {plainSummary(first.body)}
              </p>
            ) : (
              <CardBody>
                <Saids
                  saids={thread.messages.map((m) => ({
                    author: m.author,
                    kind: 'other' as const,
                    body: m.body,
                    at: m.createdAt,
                  }))}
                />
                {/*
                  Two answers to one discussion, going to different places: a
                  reply lands on the merge request where the people in it will
                  see it, a note stays here to be worked through. Neither does
                  the other — starting a note must not put anything on the MR,
                  since the point of one is often to think before saying
                  anything at all.
                */}
                {answering === thread.id ? (
                  <ReplyBox
                    value={draft}
                    onChange={setDraft}
                    onSubmit={() => {
                      void replyToMr(thread.id, draft)
                      setAnswering(null)
                      setDraft('')
                    }}
                    onCancel={() => {
                      setAnswering(null)
                      setDraft('')
                    }}
                    submitLabel="Reply to MR"
                    submitTitle="post this on the merge request, signed as having come through stickie"
                    placeholder="what to say, or what to work through here…"
                    extra={
                      note === undefined ? (
                        <button
                          className={`text-xs ${btn()}`}
                          title="start a note here, carrying this discussion — nothing is posted to the merge request"
                          onClick={() => {
                            void discussInStickie(thread, draft)
                            setAnswering(null)
                            setDraft('')
                          }}
                        >
                          Start a note
                        </button>
                      ) : undefined
                    }
                  />
                ) : (
                  <ReplyRow
                    onOpen={() => {
                      setAnswering(thread.id)
                      setDraft('')
                    }}
                    extra={
                      note === undefined ? (
                        <button
                          className={`shrink-0 text-xs ${btn()}`}
                          title="start a note here, carrying this discussion — nothing is posted to the merge request"
                          onClick={() => void discussInStickie(thread, '')}
                        >
                          Start a note
                        </button>
                      ) : (
                        // one note per discussion: a second one beside it
                        // would be two places to look for the same argument
                        <button
                          className={`shrink-0 text-xs ${btn()}`}
                          title={`go to note ${String(note.number)}`}
                          onClick={() => {
                            setNoteHighlight(note.id)
                            if (note.startLine > 0 && note.path !== '') {
                              void openRef(note.path, note.startLine)
                            }
                          }}
                        >
                          Go to note
                        </button>
                      )
                    }
                  />
                )}
              </CardBody>
            )}
          </CardShell>
        )
      })}
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
  const placeInPromptOrder = useReview((s) => s.placeInPromptOrder)
  // three tabs, not two: the merge request's discussion is a third thing to
  // look at, and it is not stickie's notes — it is read from GitLab and shown
  const tab = useReview((s) => s.commentsTab)
  const setTab = useReview((s) => s.setCommentsTab)
  const openOnly = tab === 'unresolved'
  const session = useReview((s) => s.session)
  const mrThreads = useReview((s) => s.mrThreads)
  const mrLoading = useReview((s) => s.mrLoading)
  const mrLoaded = useReview((s) => s.mrLoaded)
  const loadMrThreads = useReview((s) => s.loadMrThreads)
  const [arranging, setArranging] = useState(false)
  const [composing, setComposing] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  /** the note being dragged, and where letting go would put it */
  const [dragging, setDragging] = useState<{
    id: number
    over: { id: number; after: boolean } | null
  } | null>(null)

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

  /*
   * A note is dragged by its handle rather than by the card, since the card is
   * text to select and buttons to press. Pointer events and not the browser's
   * drag and drop: the drop is worked out from where the cards are, so the gap
   * between two of them is a place to land too, and the list scrolls when the
   * pointer is held at either end of it.
   */
  const startDrag = (id: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    let over: { id: number; after: boolean } | null = null
    setDragging({ id, over })
    const move = (e: PointerEvent) => {
      const list = listRef.current
      if (list === null) return
      const box = list.getBoundingClientRect()
      if (e.clientY < box.top + 24) list.scrollBy(0, -16)
      else if (e.clientY > box.bottom - 24) list.scrollBy(0, 16)
      const cards = [
        ...list.querySelectorAll<HTMLElement>('[data-thread]'),
      ].map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          id: Number(node.dataset.thread),
          top: rect.top,
          bottom: rect.bottom,
        }
      })
      over = dropAt(cards, e.clientY)
      setDragging({ id, over })
    }
    const end = (e: PointerEvent) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      if (e.type === 'pointerup' && over !== null) {
        placeInPromptOrder(id, over.id, over.after)
      }
      setDragging(null)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  // what each filter would show, so the choice does not have to be made blind
  const unresolved = threads.filter((t) => t.status !== 'resolved').length
  const total = visible.length
  const mrCandidate = useReview((s) => s.mrCandidate)
  /*
   * The tab is there whenever this branch has an open merge request, whether
   * or not it has been attached — there is one, and hiding it behind a button
   * in the top bar only meant going to look for something stickie already knew.
   * Attaching is what lets a note be tied to a discussion, so it happens when
   * one is started rather than as a step of its own.
   */
  const mr =
    session?.mr ??
    (mrCandidate === null
      ? null
      : { iid: mrCandidate.iid, projectPath: mrCandidate.projectPath })

  // opened rather than loaded on mount: nobody pays for a GitLab round trip
  // until they look. Once, though — on `mrLoaded` rather than on an empty
  // list, or a fetch that fails leaves the list empty and the effect asks
  // again, and again, for as long as the tab is open
  const mrIid = mr?.iid ?? null
  // the kept tab can name a list this review has not got: a branch with no
  // open merge request would otherwise open on an empty third tab that is not
  // even there
  useEffect(() => {
    if (tab === 'mr' && mr === null && mrLoaded) setTab('unresolved')
  }, [tab, mr, mrLoaded, setTab])

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
      <div className="flex items-center gap-2 border-b border-edge px-2 py-2">
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
      <div className="flex items-center gap-1 border-b border-edge px-2 py-1.5 text-xs">
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
          className={arranging ? icon_button_on : icon_button}
          title={
            arranging
              ? 'prompt order: the order Copy prompt uses — drag a note by its handle to move it\nclick for the order they were written in'
              : 'the order they were written in\nclick for the order Copy prompt uses, and rearrange it'
          }
          aria-label="prompt order"
          aria-pressed={arranging}
          onClick={() => setArranging(!arranging)}
        >
          <Reorder />
        </button>
      </div>
      {tab === 'mr' && (
        <MrThreads
          threads={mrThreads}
          loading={mrLoading}
          mr={mr}
          candidate={mrCandidate}
        />
      )}
      <div
        ref={listRef}
        className={`min-h-0 grow space-y-3 overflow-y-auto px-2 py-3 ${tab === 'mr' ? 'hidden' : ''}`}
      >
        {visible.map((thread, index) => (
          <div
            key={thread.id}
            data-thread={thread.id}
            className={`relative ${dragging?.id === thread.id ? 'opacity-40' : ''}`}
          >
            {/* where the note being dragged would land, in the gap beside
                this one */}
            {dragging !== null &&
              dragging.over?.id === thread.id &&
              dragging.id !== thread.id && (
                <span
                  className={`absolute inset-x-0 h-0.5 rounded-full bg-accent ${dragging.over.after ? '-bottom-[7px]' : '-top-[7px]'}`}
                  aria-hidden="true"
                />
              )}
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
                <span className="flex shrink-0 items-center gap-1 text-xs">
                  <span className="text-faint tabular-nums">{index + 1}</span>
                  {/* the arrow keys move it too, against the note shown next
                      to it, for anyone not dragging */}
                  <button
                    className={`cursor-grab touch-none active:cursor-grabbing ${icon_button}`}
                    title={'drag to move it in the prompt\nor ↑ ↓ while this is focused'}
                    aria-label={`move note ${String(index + 1)} in the prompt`}
                    onPointerDown={(e) => startDrag(thread.id, e)}
                    onKeyDown={(e) => {
                      const above = e.key === 'ArrowUp' ? visible[index - 1] : undefined
                      const below = e.key === 'ArrowDown' ? visible[index + 1] : undefined
                      if (above === undefined && below === undefined) return
                      e.preventDefault()
                      if (above !== undefined) placeInPromptOrder(thread.id, above.id, false)
                      if (below !== undefined) placeInPromptOrder(thread.id, below.id, true)
                    }}
                  >
                    <Grip />
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
      <div className="border-t border-edge px-2 py-3">
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
