import { branchTipDates } from './git.js'
import type { ExpiryFacts, Store } from './store.js'

/**
 * Reviews left alone go away by themselves: archived first, after
 * `archiveAfterDays` with nothing happening in them, and deleted after
 * `deleteAfterDays`. A review the reviewer has kept is never touched.
 *
 * Archiving first is the warning. A review is never deleted without having sat
 * in the overview's Archived list for at least the gap between the two numbers,
 * however long it was left before stickie next looked — a machine switched off
 * for four months must not come back and delete on its first sweep what it
 * never showed as archived.
 *
 * What counts as something happening: anything in the activity record (a
 * note, a reply, a resolution, a file marked read, a re-pin, an archive or a
 * restore by hand), the review being opened, and a commit on its branch. A
 * deletion keeps the record: the notes go, the rows saying what happened to
 * them stay, and one more says the review expired and how many notes went.
 *
 * The clock started when this policy did (`expiry_since`), not when each
 * review was last touched: a database from before it existed must not lose
 * half its reviews the first time a new version starts.
 */

export interface ExpiryPolicy {
  /** null: never archived for being left alone */
  archiveAfterDays: number | null
  /** null: never deleted for being left alone */
  deleteAfterDays: number | null
}

export const default_expiry: ExpiryPolicy = {
  archiveAfterDays: 60,
  deleteAfterDays: 90,
}

const day_ms = 86_400_000

/** Missing means the default; empty or 0 means never. */
export function policyFrom(
  archive: string | null,
  remove: string | null,
): ExpiryPolicy {
  const days = (stored: string | null, fallback: number | null) => {
    if (stored === null) return fallback
    const value = Number(stored)
    return Number.isInteger(value) && value > 0 ? value : null
  }
  return {
    archiveAfterDays: days(archive, default_expiry.archiveAfterDays),
    deleteAfterDays: days(remove, default_expiry.deleteAfterDays),
  }
}

export async function readPolicy(store: Store): Promise<ExpiryPolicy> {
  return policyFrom(
    await store.getSetting('archive_after_days'),
    await store.getSetting('delete_after_days'),
  )
}

/**
 * How long the activity record is kept, in days; null is for ever. Missing
 * means the default, empty or 0 means for ever — the same reading as the two
 * expiry numbers.
 */
export const default_activity_days = 90

export function activityDaysFrom(stored: string | null): number | null {
  if (stored === null) return default_activity_days
  const value = Number(stored)
  return Number.isInteger(value) && value > 0 ? value : null
}

export async function readActivityDays(store: Store): Promise<number | null> {
  return activityDaysFrom(await store.getSetting('activity_keep_days'))
}

/** Deleting has to come after archiving, or there is no warning between. */
export function policyProblem(policy: ExpiryPolicy): string | null {
  const { archiveAfterDays: archive, deleteAfterDays: remove } = policy
  if (archive !== null && remove !== null && remove <= archive) {
    return 'deleting has to come later than archiving'
  }
  return null
}

/**
 * When the clock started, set the first time anything asks. Every review's
 * idle time is counted from no earlier than this.
 */
export async function clockStart(store: Store, now = Date.now()): Promise<number> {
  const stored = await store.getSetting('expiry_since')
  const parsed = stored === null ? Number.NaN : Date.parse(stored)
  if (Number.isFinite(parsed)) return parsed
  await store.setSetting('expiry_since', new Date(now).toISOString())
  return now
}

/**
 * The same clock, read without starting it: for pages that only show when
 * something is due, since a GET that writes is worse than one that guesses.
 */
export async function readClock(store: Store, now = Date.now()): Promise<number> {
  const stored = await store.getSetting('expiry_since')
  const parsed = stored === null ? Number.NaN : Date.parse(stored)
  return Number.isFinite(parsed) ? parsed : now
}

export interface Idleness {
  /** the last time anything happened in it, as epoch ms */
  lastActiveAt: number
  /** when it was archived, as epoch ms, or null */
  archivedAt: number | null
  kept: boolean
}

/** The latest of several moments, any of which may be missing. */
export function latest(...moments: (string | number | null | undefined)[]): number {
  let best = Number.NEGATIVE_INFINITY
  for (const moment of moments) {
    if (moment == null) continue
    const value = typeof moment === 'number' ? moment : Date.parse(moment)
    if (Number.isFinite(value) && value > best) best = value
  }
  return best
}

/** How long a review has been left alone, from what the database and git say. */
export function idleness(
  facts: ExpiryFacts,
  since: number,
  tipAt: string | null,
): Idleness {
  return {
    lastActiveAt: latest(
      since,
      facts.createdAt,
      facts.seenAt,
      facts.lastRecordedAt,
      facts.lastMessageAt,
      tipAt,
    ),
    archivedAt: facts.archivedAt === null ? null : Date.parse(facts.archivedAt),
    kept: facts.keptAt !== null,
  }
}

/**
 * When a review will be archived and when deleted, if it is left alone until
 * then; null for what will not happen.
 */
export function dueDates(
  review: Idleness,
  policy: ExpiryPolicy,
): { archivesAt: number | null; deletesAt: number | null } {
  if (review.kept) return { archivesAt: null, deletesAt: null }
  const { archiveAfterDays: archive, deleteAfterDays: remove } = policy
  const archives_at =
    archive === null ? null : review.lastActiveAt + archive * day_ms
  const archivesAt = review.archivedAt === null ? archives_at : null
  if (remove === null) return { archivesAt, deletesAt: null }
  const idle_due = review.lastActiveAt + remove * day_ms
  // with no archive stage, deleting is the only step and nothing comes before
  if (archive === null) return { archivesAt, deletesAt: idle_due }
  // at least the gap between the two numbers in the Archived list first
  const archived_since = review.archivedAt ?? archives_at ?? idle_due
  return {
    archivesAt,
    deletesAt: Math.max(idle_due, archived_since + (remove - archive) * day_ms),
  }
}

export type Verdict = 'archive' | 'delete' | null

export function verdict(
  review: Idleness,
  policy: ExpiryPolicy,
  now: number,
): Verdict {
  const { archivesAt, deletesAt } = dueDates(review, policy)
  // never straight from the list to gone while there is an archive stage
  const may_delete =
    review.archivedAt !== null || policy.archiveAfterDays === null
  if (deletesAt !== null && now >= deletesAt && may_delete) return 'delete'
  if (archivesAt !== null && now >= archivesAt) return 'archive'
  return null
}

export interface SweepResult {
  archived: number[]
  deleted: { sessionId: number; notes: number }[]
}

let running: Promise<SweepResult> | null = null

/**
 * Archives and deletes whatever the policy says is due. One sweep at a time:
 * a second asked for while one runs gets the first one's answer.
 *
 * Git is asked only about reviews the database already says are due, one call
 * per repository, so a sweep over a quiet workspace runs no git at all.
 */
export function sweep(store: Store, now = Date.now()): Promise<SweepResult> {
  running ??= sweepOnce(store, now).finally(() => {
    running = null
  })
  return running
}

async function sweepOnce(store: Store, now: number): Promise<SweepResult> {
  const result: SweepResult = { archived: [], deleted: [] }
  // the record's own retention rides on the same sweep
  const keep = await readActivityDays(store)
  if (keep !== null) {
    const pruned = await store.pruneActivity(keep)
    if (pruned > 0) {
      console.log(
        `stickie: dropped ${String(pruned)} activity rows older than ${String(keep)} days`,
      )
    }
  }
  const policy = await readPolicy(store)
  if (policy.archiveAfterDays === null && policy.deleteAfterDays === null) {
    return result
  }
  const since = await clockStart(store, now)
  const tips = new Map<string, Map<string, string>>()
  const tipOf = async (facts: ExpiryFacts) => {
    if (facts.branch === null) return null
    let dates = tips.get(facts.repoPath)
    if (dates === undefined) {
      dates = await branchTipDates(facts.repoPath).catch(() => new Map())
      tips.set(facts.repoPath, dates)
    }
    return dates.get(facts.branch) ?? null
  }

  for (const facts of await store.expiryFacts()) {
    if (verdict(idleness(facts, since, null), policy, now) === null) continue
    // due by the record; a recent commit on its branch can still save it
    const review = idleness(facts, since, await tipOf(facts))
    const due = verdict(review, policy, now)
    if (due === null) continue
    const idle_days = Math.floor((now - review.lastActiveAt) / day_ms)
    if (due === 'archive') {
      await store.setArchived(facts.sessionId, true, new Date(now))
      await store.recordActivity({
        subject: 'review',
        action: 'archived',
        actorId: null,
        repoId: facts.repoId,
        sessionId: facts.sessionId,
        detail: { automatic: true, idleDays: idle_days },
      })
      result.archived.push(facts.sessionId)
    } else {
      await store.deleteSession(facts.sessionId)
      await store.recordActivity({
        subject: 'review',
        action: 'expired',
        actorId: null,
        repoId: facts.repoId,
        sessionId: facts.sessionId,
        detail: {
          automatic: true,
          idleDays: idle_days,
          notes: facts.notes,
          branch: facts.branch,
          archivedAt: facts.archivedAt,
        },
      })
      result.deleted.push({ sessionId: facts.sessionId, notes: facts.notes })
    }
  }
  if (result.archived.length > 0 || result.deleted.length > 0) {
    console.log(
      `stickie: archived ${String(result.archived.length)} and deleted ` +
        `${String(result.deleted.length)} reviews left alone (Settings → Reviews)`,
    )
  }
  return result
}
