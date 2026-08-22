import { useEffect, useMemo, useRef, useState } from 'react'
import { DraftForm } from './DraftForm'
import { orderedThreadIds, useReview } from '../store'
import { ThreadCard } from './ThreadCard'

/** A composer for notes that carry no code anchor. */
function NoteComposer({ onDone }: { onDone: () => void }) {
  const addNote = useReview((s) => s.addNote)
  const selectedPath = useReview((s) => s.selectedPath)
  const [scope, setScope] = useState<'review' | 'file'>(
    selectedPath === null ? 'review' : 'file',
  )
  const [body, setBody] = useState('')

  const submit = () => {
    if (body.trim() === '') return
    void addNote(scope, body.trim())
    setBody('')
    onDone()
  }

  return (
    <div className="rounded-md border border-accent bg-panel p-2 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-soft">
        <span>note on</span>
        <select
          className="rounded border border-edge bg-surface px-1 py-0.5 text-ink"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'review' | 'file')}
        >
          <option value="review">the whole review</option>
          <option value="file" disabled={selectedPath === null}>
            {selectedPath === null ? 'no file open' : selectedPath}
          </option>
        </select>
      </div>
      <textarea
        autoFocus
        rows={3}
        className="w-full resize-y rounded border border-edge bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
        placeholder="Anything not tied to a line — approach, missing tests, naming… (⌘↵ to add)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          if (e.key === 'Escape') onDone()
        }}
      />
      <div className="mt-1 flex justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-soft hover:text-ink"
          onClick={onDone}
        >
          cancel
        </button>
        <button
          className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-strong disabled:opacity-50"
          disabled={body.trim() === ''}
          onClick={submit}
        >
          add note
        </button>
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
export function CommentsPanel() {
  const threads = useReview((s) => s.threads)
  const drafts = useReview((s) => s.drafts)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const repos = useReview((s) => s.repos)
  const selectRepo = useReview((s) => s.selectRepo)
  const openRef = useReview((s) => s.openRef)
  const toggleComments = useReview((s) => s.toggleComments)
  const promptOrder = useReview((s) => s.promptOrder)
  const moveInPromptOrder = useReview((s) => s.moveInPromptOrder)
  const [openOnly, setOpenOnly] = useState(true)
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

  const total = visible.length

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-edge bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge px-3 py-1.5 text-xs">
        <span className="font-semibold text-ink">Comments</span>
        <span className="text-faint">{total}</span>
        <span className="grow" />
        <button
          className="text-soft hover:text-ink"
          title="add a note that is not tied to a line"
          onClick={() => setComposing(true)}
        >
          + note
        </button>
        <button
          className={arranging ? 'text-accent' : 'text-soft hover:text-ink'}
          title="show the order Copy prompt uses, and rearrange it"
          onClick={() => setArranging(!arranging)}
        >
          prompt order
        </button>
        <label className="flex items-center gap-1 text-soft">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          unresolved only
        </label>
        <button className="text-soft hover:text-ink" onClick={toggleComments}>
          close
        </button>
      </div>
      <div
        ref={listRef}
        className="min-h-0 grow space-y-3 overflow-y-auto p-3"
      >
        {composing && <NoteComposer onDone={() => setComposing(false)} />}
        {drafts.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
              in progress
            </p>
            {drafts.map((draft) => {
              const repo_name = repos.find((r) => r.id === draft.repoId)?.name
              const cross_repo = draft.repoId !== activeRepoId
              return (
                <div key={draft.id}>
                  <button
                    className="mb-0.5 max-w-full truncate font-mono text-xs text-accent hover:underline"
                    title={`back to ${draft.path}:L${draft.startLine}`}
                    onClick={() => {
                      void (async () => {
                        if (cross_repo) await selectRepo(draft.repoId)
                        await openRef(draft.path, draft.startLine)
                      })()
                    }}
                  >
                    {cross_repo && repo_name !== undefined
                      ? `${repo_name}:`
                      : ''}
                    {draft.path}:L{draft.startLine}
                  </button>
                  <DraftForm draft={draft} surface="panel" />
                </div>
              )
            })}
          </div>
        )}
        {visible.map((thread, index) => (
          <div key={thread.id} data-thread={thread.id}>
            <div className="mb-0.5 flex items-center gap-2">
              {thread.startLine === 0 ? (
                <span className="max-w-full truncate font-mono text-xs text-soft">
                  {thread.path === '' ? 'whole review' : `${thread.path} · file`}
                </span>
              ) : (
                <button
                  className="max-w-full truncate font-mono text-xs text-accent hover:underline"
                  title={`jump to ${thread.path}:L${thread.startLine}`}
                  onClick={() => void openRef(thread.path, thread.startLine)}
                >
                  {thread.path}:L{thread.startLine}
                </button>
              )}
              {arranging && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs text-soft">
                  <span className="mr-1 text-faint">{index + 1}</span>
                  <button
                    className="rounded px-1.5 py-0.5 hover:bg-overlay hover:text-ink disabled:opacity-30"
                    title="earlier in the prompt"
                    disabled={index === 0}
                    onClick={() => moveInPromptOrder(thread.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 hover:bg-overlay hover:text-ink disabled:opacity-30"
                    title="later in the prompt"
                    disabled={index === visible.length - 1}
                    onClick={() => moveInPromptOrder(thread.id, 1)}
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>
            <ThreadCard thread={thread} />
          </div>
        ))}
        {total === 0 && drafts.length === 0 && !composing && (
          <p className="text-xs text-faint">
            {openOnly ? 'No unresolved comments.' : 'No comments yet.'}
          </p>
        )}
      </div>
    </aside>
  )
}
