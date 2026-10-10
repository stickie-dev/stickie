import { useCallback, useEffect, useState } from 'react'
import type { ActivityEntry } from '@stickie/shared'
import { api } from '../api'
import { useReview } from '../store'
import { TimeAgo } from './TimeAgo'
import { Loading, Skeleton } from './Skeleton'
import { Close, Refresh } from '../icons'
import { icon_button } from '../ui'

/**
 * What happened in this review, newest first. Reading the record back is what
 * keeps it honest — a table nothing looks at accumulates wrong rows quietly.
 */

const phrases: Record<string, string> = {
  'note.created': 'raised a note',
  'note.replied': 'replied',
  'note.edited': 'edited a note',
  'note.resolved': 'resolved a note',
  'note.reopened': 'reopened a note',
  'note.deleted': 'deleted a note',
  'note.posted': 'posted a note to the agent',
  'review.opened': 'opened this review',
  'review.submitted': 'submitted the review',
  'review.repinned': 're-pinned the base',
  'review.imported': 'imported notes',
  'review.exported': 'took the notes to an agent',
  'file.viewed': 'marked a file read',
  'file.unviewed': 'unmarked a file',
}

function detailText(entry: ActivityEntry): string | null {
  const d = entry.detail
  if (d === null) return null
  const parts: string[] = []
  if (typeof d.path === 'string' && d.path !== '') {
    const line =
      typeof d.startLine === 'number' && d.startLine > 0
        ? `:L${String(d.startLine)}`
        : ''
    parts.push(`${d.path}${line}`)
  }
  if (typeof d.posted === 'number') parts.push(`${String(d.posted)} notes`)
  if (typeof d.notes === 'number') parts.push(`${String(d.notes)} notes`)
  if (typeof d.carried === 'number') {
    parts.push(`${String(d.carried)} carried forward`)
  }
  if (typeof d.imported === 'number') {
    parts.push(`${String(d.imported)} imported`)
  }
  if (typeof d.toBaseSha === 'string') parts.push(d.toBaseSha.slice(0, 8))
  return parts.length === 0 ? null : parts.join(' · ')
}

export function ActivityPanel() {
  const session = useReview((s) => s.session)
  const threads = useReview((s) => s.threads)
  const viewed = useReview((s) => s.viewed)
  const showLower = useReview((s) => s.showLower)
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (session === null) return
    try {
      setEntries(await api.activity(session.id))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [session])

  // notes and viewed files are the two things the client changes, so their
  // state is the signal that something was recorded — no poll needed
  useEffect(() => {
    void load()
  }, [load, threads, viewed])

  return (
    // the slot below the files, filled — it was a fixed column on the right,
    // beside the comments, squeezing the diff from the side being read
    <section className="flex min-h-0 grow flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-xs">
        {/* what the record is, on the name rather than under the list: in the
            slot below the files a paragraph was a third of the panel */}
        <span
          className="font-semibold text-ink"
          title={'append-only: nothing here is rewritten when a note changes or is deleted\nit lives in the same database as the notes, so on a local SQLite file its owner can still edit it — a record, not proof'}
        >
          Activity
        </span>
        <span className="text-faint">
          {entries === null ? '' : entries.length}
        </span>
        <span className="grow" />
        <button
          className={icon_button}
          title="reload"
          aria-label="reload"
          onClick={() => void load()}
        >
          <Refresh />
        </button>
        <button
          className={icon_button}
          title="close activity"
          aria-label="close activity"
          onClick={() => showLower(null)}
        >
          <Close />
        </button>
      </div>

      <div className="min-h-0 grow overflow-y-auto px-3 py-2">
        {error !== null && <p className="text-xs text-rose-500">{error}</p>}
        {entries === null && error === null && (
          <Loading what="the record" className="space-y-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="space-y-1.5">
                <Skeleton w="w-28" h="h-2.5" />
                <Skeleton w="w-11/12" h="h-3" />
              </div>
            ))}
          </Loading>
        )}
        {entries !== null && entries.length === 0 && (
          <p className="text-xs text-faint">Nothing recorded yet.</p>
        )}
        {entries?.map((entry) => {
          const detail = detailText(entry)
          return (
            <div
              key={entry.id}
              className="border-b border-edge py-1.5 text-xs last:border-b-0"
            >
              <div className="flex items-baseline gap-1.5">
                <TimeAgo
                  at={entry.at}
                  className="w-16 shrink-0 text-right text-faint"
                />
                <span className="text-ink">
                  <span className="font-medium">
                    {entry.actorName ?? 'someone'}
                  </span>{' '}
                  <span className="text-soft">
                    {phrases[`${entry.subject}.${entry.action}`] ??
                      `${entry.subject} ${entry.action}`}
                  </span>
                </span>
              </div>
              {detail !== null && (
                <div className="mt-0.5 pl-11 font-mono break-all text-faint">
                  {detail}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
