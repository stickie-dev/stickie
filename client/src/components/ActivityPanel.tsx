import { useCallback, useEffect, useState } from 'react'
import type { ActivityEntry } from '@stickie/shared'
import { api } from '../api'
import { useReview } from '../store'
import { TimeAgo } from './TimeAgo'
import { Loading, Skeleton } from './Skeleton'
import { Close, Refresh } from '../icons'
import { icon_button } from '../ui'

/**
 * What happened, newest first: in this review, or everywhere — every
 * repository and review, including what outlived its review, a repository
 * removed or a review expired. Everywhere was a table on the overview; with
 * a panel for the record, a second copy of it there was one more place to
 * look. Reading the record back is what keeps it honest — a table nothing
 * looks at accumulates wrong rows quietly.
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
  'review.archived': 'archived this review',
  'review.unarchived': 'brought this review back',
  'review.kept': 'kept this review from expiring',
  'review.unkept': 'let this review expire again',
  'review.expired': 'deleted this review after it was left alone',
  'file.viewed': 'marked a file read',
  'file.unviewed': 'unmarked a file',
  'repo.added': 'added a repository',
  'repo.removed': 'removed a repository, and its reviews with it',
  'repo.unregistered': 'took a repository out of the workspace',
}

type Scope = 'review' | 'everywhere'

/** Who did it: what stickie did by itself says so rather than "someone". */
function actorOf(entry: ActivityEntry): string {
  if (entry.actorName !== null) return entry.actorName
  return entry.detail?.automatic === true ? 'stickie' : 'someone'
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
  // without it, four commit inspections in a row read as one line repeated
  else if (typeof d.baseSha === 'string' && parts.length === 0) {
    parts.push(d.baseSha.slice(0, 8))
  }
  if (typeof d.idleDays === 'number') {
    parts.push(`left alone ${String(d.idleDays)} days`)
  }
  return parts.length === 0 ? null : parts.join(' · ')
}

export function ActivityPanel() {
  const session = useReview((s) => s.session)
  const threads = useReview((s) => s.threads)
  const viewed = useReview((s) => s.viewed)
  const showLower = useReview((s) => s.showLower)
  const repos = useReview((s) => s.repos)
  const [chosen, setChosen] = useState<Scope>('review')
  // with no review open there is only everywhere to show
  const scope: Scope = session === null ? 'everywhere' : chosen
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setEntries(
        scope === 'everywhere' || session === null
          ? await api.workspaceActivity()
          : await api.activity(session.id),
      )
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [session, scope])

  // notes and viewed files are the two things the client changes, so their
  // state is the signal that something was recorded — no poll needed
  useEffect(() => {
    void load()
  }, [load, threads, viewed])

  return (
    // the slot below the files, filled — it was a fixed column on the right,
    // beside the comments, squeezing the diff from the side being read
    <section className="flex min-h-0 grow flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs">
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
      {/* its own row: beside the name, in the slot below the files, it was
          squeezed to nothing */}
      <div
        className="mx-3 mb-2 flex shrink-0 overflow-hidden rounded-md bg-overlay text-xs"
        role="group"
        aria-label="activity in"
      >
        {(
          [
            {
              key: 'review',
              label: 'this review',
              why: 'what happened in the review that is open',
            },
            {
              key: 'everywhere',
              label: 'everywhere',
              why: 'across every repository and review, including removed repositories and expired reviews',
            },
          ] as const
        ).map((choice) => (
          <button
            key={choice.key}
            className={`flex-1 px-1.5 py-0.5 ${scope === choice.key ? 'bg-accent text-white' : 'text-soft hover:text-ink'}`}
            title={choice.why}
            aria-pressed={scope === choice.key}
            disabled={choice.key === 'review' && session === null}
            onClick={() => {
              setEntries(null)
              setChosen(choice.key)
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 grow overflow-y-auto border-t border-edge px-3 py-2">
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
            // two lines that fit the slot below the files: what happened, then
            // when and where. A fixed column for the time beside the sentence
            // left the sentence a third of a narrow panel to wrap in
            <div
              key={entry.id}
              className="border-b border-edge py-1.5 text-xs leading-snug last:border-b-0"
            >
              <div className="text-ink">
                <span className="font-medium">{actorOf(entry)}</span>{' '}
                <span className="text-soft">
                  {/* across every review, "this review" is not one */}
                  {(
                    phrases[`${entry.subject}.${entry.action}`] ??
                    `${entry.subject} ${entry.action}`
                  ).replace(
                    'this review',
                    scope === 'everywhere' ? 'a review' : 'this review',
                  )}
                </span>
              </div>
              <div
                className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-faint"
                title={detail ?? undefined}
              >
                <TimeAgo at={entry.at} className="shrink-0" />
                {scope === 'everywhere' && entry.repoId !== null && (
                  <span className="shrink-0">
                    · {repos.find((r) => r.id === entry.repoId)?.name ?? ''}
                  </span>
                )}
                {detail !== null && (
                  <span className="min-w-0 truncate font-mono">· {detail}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
