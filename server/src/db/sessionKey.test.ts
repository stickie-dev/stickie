import { describe, expect, it } from 'vitest'
import type { Db } from './driver.js'
import { applySchema } from './schema.js'
import { planMerges, rekeySessions } from './sessionKey.js'
import { openSqlite } from './sqlite.js'

describe('planMerges', () => {
  const row = (id: number, baseRef: string, source = '/repo') => ({
    id,
    repo_id: 1,
    source_kind: 'worktree',
    source_value: source,
    base_ref: baseRef,
  })

  it('leaves a key with one session alone', () => {
    expect(planMerges([row(1, 'master')], new Map())).toEqual([])
  })

  it('keeps whichever session holds the most notes', () => {
    const plans = planMerges(
      [row(1, 'master'), row(2, 'master'), row(3, 'master')],
      new Map([
        [1, 0],
        [2, 5],
        [3, 2],
      ]),
    )
    expect(plans).toEqual([{ survivor: 2, absorbed: [3, 1] }])
  })

  it('keeps the review that was started first when notes tie', () => {
    const plans = planMerges([row(7, 'master'), row(4, 'master')], new Map())
    expect(plans).toEqual([{ survivor: 4, absorbed: [7] }])
  })

  it('does not merge across base refs or sources', () => {
    expect(
      planMerges(
        [row(1, 'master'), row(2, 'HEAD'), row(3, 'master', '/other')],
        new Map(),
      ),
    ).toEqual([])
  })
})

/**
 * A database as the old key would have left it: sessions forked per commit.
 * Built by hand rather than through `applySchema`, which runs the very
 * migration under test — the tables carry only the columns the migration
 * touches, and the real shapes are exercised end to end elsewhere.
 */
async function legacyDatabase(): Promise<Db> {
  const db = openSqlite(':memory:')
  await db.exec(`
    create table repos (id integer primary key autoincrement, path text not null unique);
    create table sessions (
      id integer primary key autoincrement,
      repo_id integer not null references repos(id) on delete cascade,
      source_kind text not null,
      source_value text not null,
      base_ref text not null,
      base_sha text not null,
      created_at text not null default (datetime('now')),
      unique (repo_id, source_kind, source_value, base_sha)
    );
    create table threads (
      id integer primary key autoincrement,
      session_id integer not null references sessions(id) on delete cascade,
      path text not null,
      side text not null,
      start_line integer not null,
      end_line integer not null,
      snippet text not null
    );
    create table viewed_files (
      session_id integer not null references sessions(id) on delete cascade,
      path text not null,
      primary key (session_id, path)
    );
    create table activity (
      id integer primary key autoincrement,
      subject text not null,
      action text not null,
      session_id integer,
      detail text
    );
  `)
  await db.run('insert into repos (path) values (?)', ['/repo'])
  for (const sha of ['aaa', 'bbb', 'ccc']) {
    await db.run(
      `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
       values (1, 'worktree', '/repo', 'master', ?)`,
      [sha],
    )
  }
  // and one genuinely different review, which must survive on its own
  await db.run(
    `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
     values (1, 'ref', 'feature/x', 'main', 'ddd')`,
  )
  return db
}

describe('rekeySessions', () => {
  it('merges the forks and keeps every note', async () => {
    const db = await legacyDatabase()
    // one note on each forked session, plus a file read on two of them
    for (const session of [1, 2, 3]) {
      await db.run(
        `insert into threads (session_id, path, side, start_line, end_line, snippet)
         values (?, 'a.ts', 'source', 1, 1, 'x')`,
        [session],
      )
    }
    await db.run(
      `insert into viewed_files (session_id, path) values (1, 'a.ts'), (2, 'a.ts'), (2, 'b.ts')`,
    )

    const plans = await rekeySessions(db)
    expect(plans).toEqual([{ survivor: 1, absorbed: [2, 3] }])

    const sessions = await db.all<{ id: number }>('select id from sessions order by id')
    expect(sessions.map((r) => r.id)).toEqual([1, 4])
    const threads = await db.all<{ session_id: number }>(
      'select session_id from threads',
    )
    expect(threads).toHaveLength(3)
    expect(threads.every((t) => t.session_id === 1)).toBe(true)
    // a.ts was read on two of the forks and must not become two rows
    const viewed = await db.all<{ session_id: number; path: string }>(
      'select session_id, path from viewed_files order by path',
    )
    expect(viewed).toEqual([
      { session_id: 1, path: 'a.ts' },
      { session_id: 1, path: 'b.ts' },
    ])
    await db.close()
  })

  it('re-points the record and says why', async () => {
    const db = await legacyDatabase()
    await db.run(
      `insert into activity (subject, action, session_id) values ('note', 'created', 3)`,
    )
    await rekeySessions(db)
    const rows = await db.all<{ subject: string; action: string; session_id: number }>(
      'select subject, action, session_id from activity order by id',
    )
    expect(rows).toEqual([
      { subject: 'note', action: 'created', session_id: 1 },
      { subject: 'review', action: 'merged', session_id: 1 },
    ])
    await db.close()
  })

  it('leaves the new key in place and enforces it', async () => {
    const db = await legacyDatabase()
    await rekeySessions(db)
    await expect(
      db.run(
        `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
         values (1, 'worktree', '/repo', 'master', 'zzz')`,
      ),
    ).rejects.toThrow()
    // two refs at the same commit are two reviews now, which the old key forbade
    await db.run(
      `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
       values (1, 'worktree', '/repo', 'HEAD', 'aaa')`,
    )
    await db.close()
  })

  it('does nothing the second time, and nothing to a fresh database', async () => {
    const legacy = await legacyDatabase()
    await rekeySessions(legacy)
    expect(await rekeySessions(legacy)).toEqual([])
    await legacy.close()

    const fresh = openSqlite(':memory:')
    await applySchema(fresh)
    expect(await rekeySessions(fresh)).toEqual([])
    await fresh.close()
  })
})
