import { useMemo, useState } from 'react'
import { DraftForm } from './DraftForm'
import { useReview } from '../store'
import { ThreadCard } from './ThreadCard'

/**
 * Right-hand overview of every thread in the session: jump to any anchor,
 * reply, edit, or resolve without hunting through files. Notes still being
 * written stay here too, so a note survives — and stays editable — while
 * other files are visited to collect references.
 */
export function CommentsPanel() {
  const threads = useReview((s) => s.threads)
  const drafts = useReview((s) => s.drafts)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const repos = useReview((s) => s.repos)
  const selectRepo = useReview((s) => s.selectRepo)
  const openRef = useReview((s) => s.openRef)
  const toggleComments = useReview((s) => s.toggleComments)
  const [openOnly, setOpenOnly] = useState(true)

  const groups = useMemo(() => {
    const filtered = openOnly
      ? threads.filter((t) => t.status !== 'resolved')
      : threads
    const by_path = new Map<string, typeof filtered>()
    for (const thread of filtered) {
      const bucket = by_path.get(thread.path) ?? []
      bucket.push(thread)
      by_path.set(thread.path, bucket)
    }
    return [...by_path.entries()].map(([path, list]) => ({
      path,
      list: [...list].sort((a, b) => a.startLine - b.startLine),
    }))
  }, [threads, openOnly])

  const total = groups.reduce((sum, g) => sum + g.list.length, 0)

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-edge bg-surface">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-xs">
        <span className="font-semibold text-ink">Comments</span>
        <span className="text-faint">{total}</span>
        <span className="grow" />
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
      <div className="min-h-0 grow space-y-3 overflow-y-auto p-3">
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
        {groups.map((group) => (
          <div key={group.path} className="space-y-2">
            {group.list.map((thread) => (
              <div key={thread.id}>
                <button
                  className="mb-0.5 max-w-full truncate font-mono text-xs text-accent hover:underline"
                  title={`jump to ${group.path}:L${thread.startLine}`}
                  onClick={() =>
                    void openRef(thread.path, thread.startLine)
                  }
                >
                  {group.path}:L{thread.startLine}
                </button>
                <ThreadCard thread={thread} />
              </div>
            ))}
          </div>
        ))}
        {total === 0 && drafts.length === 0 && (
          <p className="text-xs text-faint">
            {openOnly ? 'No unresolved comments.' : 'No comments yet.'}
          </p>
        )}
      </div>
    </aside>
  )
}
