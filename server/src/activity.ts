/**
 * What the record can say. `subject` and `action` are separate columns, so the
 * pairs that make sense are declared here and the types below make an invalid
 * one unwritable — a two-column vocabulary is more queryable than one string,
 * but only if nothing can put `file` and `submitted` in the same row.
 */
export const activity_actions = {
  note: [
    'created',
    'replied',
    'edited',
    'resolved',
    'reopened',
    'deleted',
    'posted',
  ],
  review: ['opened', 'submitted', 'repinned', 'imported', 'exported', 'merged'],
  file: ['viewed', 'unviewed'],
} as const

export type ActivitySubject = keyof typeof activity_actions

export type ActivityAction<S extends ActivitySubject = ActivitySubject> =
  (typeof activity_actions)[S][number]

export function isActivityPair(subject: string, action: string): boolean {
  const actions: readonly string[] | undefined = (
    activity_actions as Record<string, readonly string[]>
  )[subject]
  return actions !== undefined && actions.includes(action)
}

/**
 * One thing that happened. The ids are what it points at; `detail` is what the
 * route already knew, kept so the row still says something once its referents
 * are gone — a resolved note can be deleted, its record cannot.
 */
export interface ActivityEntry {
  id: number
  at: string
  subject: ActivitySubject
  action: string
  actorName: string | null
  repoId: number | null
  sessionId: number | null
  threadId: number | null
  messageId: number | null
  detail: Record<string, unknown> | null
}

export interface ActivityInput<S extends ActivitySubject = ActivitySubject> {
  subject: S
  action: ActivityAction<S>
  actorId?: number | null
  repoId?: number | null
  sessionId?: number | null
  threadId?: number | null
  messageId?: number | null
  detail?: Record<string, unknown>
}
