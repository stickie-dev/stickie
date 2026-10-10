import { describe, expect, it } from 'vitest'
import { applySchema } from './db/schema.js'
import { openSqlite } from './db/sqlite.js'
import {
  dueDates,
  policyFrom,
  policyProblem,
  sweep,
  verdict,
} from './expiry.js'
import type { Idleness } from './expiry.js'
import { Store } from './store.js'

const day = 86_400_000
const policy = { archiveAfterDays: 60, deleteAfterDays: 90 }
/** Left alone since day 0. */
const left = (extra: Partial<Idleness> = {}): Idleness => ({
  lastActiveAt: 0,
  archivedAt: null,
  kept: false,
  ...extra,
})

describe('policyFrom', () => {
  it('uses 60 and 90 when nothing is stored', () => {
    expect(policyFrom(null, null)).toEqual(policy)
  })

  it('reads empty and 0 as never', () => {
    expect(policyFrom('', '0')).toEqual({
      archiveAfterDays: null,
      deleteAfterDays: null,
    })
  })

  it('wants deleting later than archiving', () => {
    expect(
      policyProblem({ archiveAfterDays: 30, deleteAfterDays: 30 }),
    ).not.toBeNull()
    expect(
      policyProblem({ archiveAfterDays: null, deleteAfterDays: 30 }),
    ).toBeNull()
    expect(policyProblem(policy)).toBeNull()
  })
})

describe('verdict', () => {
  it('leaves a review alone until the archive day', () => {
    expect(verdict(left(), policy, 59 * day)).toBeNull()
    expect(verdict(left(), policy, 60 * day)).toBe('archive')
  })

  it('deletes an archived review on the delete day', () => {
    const archived = left({ archivedAt: 60 * day })
    expect(verdict(archived, policy, 89 * day)).toBeNull()
    expect(verdict(archived, policy, 90 * day)).toBe('delete')
  })

  it('archives first when it was left past both, so the delete is seen coming', () => {
    // stickie was not running for four months
    expect(verdict(left(), policy, 120 * day)).toBe('archive')
    const archived = left({ archivedAt: 120 * day })
    // and then sits archived for the gap between the two numbers
    expect(verdict(archived, policy, 149 * day)).toBeNull()
    expect(verdict(archived, policy, 150 * day)).toBe('delete')
  })

  it('counts an archive by hand as the start of the archived stretch', () => {
    // archived on day 5 by the reviewer, left alone since day 0
    const archived = left({ archivedAt: 5 * day })
    expect(verdict(archived, policy, 90 * day)).toBe('delete')
  })

  it('never touches a kept review', () => {
    const kept = left({ kept: true, archivedAt: 0 })
    expect(verdict(kept, policy, 1000 * day)).toBeNull()
    expect(dueDates(kept, policy)).toEqual({ archivesAt: null, deletesAt: null })
  })

  it('deletes straight away with no archive stage', () => {
    const only = { archiveAfterDays: null, deleteAfterDays: 90 }
    expect(verdict(left(), only, 90 * day)).toBe('delete')
  })

  it('only archives with no delete stage', () => {
    const only = { archiveAfterDays: 60, deleteAfterDays: null }
    expect(verdict(left({ archivedAt: 60 * day }), only, 1000 * day)).toBeNull()
  })
})

describe('sweep', () => {
  it('starts the clock on its first run instead of acting on old reviews', async () => {
    const db = openSqlite(':memory:')
    await applySchema(db)
    const store = new Store(db)
    const repo = await store.addRepo('/nonexistent/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      'old',
      { kind: 'ref', value: 'old' },
      'main',
      'abc',
    )
    await db.run(
      "update sessions set created_at = '2020-01-01 00:00:00' where id = ?",
      [session.id],
    )
    const now = Date.parse('2026-10-10T00:00:00Z')
    expect(await sweep(store, now)).toEqual({ archived: [], deleted: [] })
    // sixty days after the clock started, it is archived
    const later = now + 60 * day
    expect((await sweep(store, later)).archived).toEqual([session.id])
    // and thirty after that, deleted — with the record kept
    const gone = await sweep(store, later + 30 * day)
    expect(gone.deleted).toEqual([{ sessionId: session.id, notes: 0 }])
    expect(await store.getSession(session.id)).toBeUndefined()
    const record = await store.listActivity({ sessionId: session.id }, 10)
    expect(record.map((entry) => entry.action)).toContain('expired')
  })
})
