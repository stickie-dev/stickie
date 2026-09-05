import { describe, expect, it } from 'vitest'
import type { Db } from './driver.js'
import type { BranchResolver } from './reviewBranch.js'
import { branchFor, rekeyByBranch } from './reviewBranch.js'
import { applySchema } from './schema.js'
import { openSqlite } from './sqlite.js'

/** What the worktrees of the fixture below have checked out. */
const checkouts = new Map([
  ['/repo', 'master'],
  ['/repo/.worktrees/x', 'feature/x'],
  ['/repo/.worktrees/gone', null],
])

const resolve: BranchResolver = (source) =>
  Promise.resolve(checkouts.get(source.value) ?? null)

/**
 * A database as the base-ref key left it: a review is (repo, source, base ref),
 * so one working tree holds a review per base and a branch that has moved
 * between checkouts holds one per path. Built by hand rather than through
 * `applySchema`, which runs the very migration under test.
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
      branch text,
      base_ref text not null,
      base_sha text not null,
      prev_base_ref text,
      prev_base_sha text,
      notes_issued integer not null default 0,
      created_at text not null default (datetime('now')),
      unique (repo_id, source_kind, source_value, base_ref)
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
  const add = (kind: string, value: string, baseRef: string, baseSha: string) =>
    db.run(
      `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
       values (1, ?, ?, ?, ?)`,
      [kind, value, baseRef, baseSha],
    )
  // 1 and 2: the same working tree, read against two bases — one review now
  await add('worktree', '/repo', 'master', 'aaa')
  await add('worktree', '/repo', 'HEAD', 'bbb')
  // 3: a different branch, in a worktree of its own
  await add('worktree', '/repo/.worktrees/x', 'master', 'ccc')
  // 4: the same branch again, as a ref — the fork the old key could not avoid
  await add('ref', 'feature/x', 'master', 'ccc')
  // 5: a worktree that no longer exists, so no branch can be found for it
  await add('worktree', '/repo/.worktrees/gone', 'master', 'ddd')
  return db
}

const note = (db: Db, session: number, path: string) =>
  db.run(
    `insert into threads (session_id, path, side, start_line, end_line, snippet)
     values (?, ?, 'source', 1, 1, 'x')`,
    [session, path],
  )

describe('branchFor', () => {
  it('takes a ref source at its word', async () => {
    const row = {
      id: 1,
      repo_id: 1,
      source_kind: 'ref',
      source_value: 'feature/x',
      base_ref: 'master',
      branch: null,
    }
    expect(await branchFor(row, resolve)).toBe('feature/x')
  })

  it('asks a worktree what it has checked out', async () => {
    const row = {
      id: 1,
      repo_id: 1,
      source_kind: 'worktree',
      source_value: '/repo/.worktrees/x',
      base_ref: 'master',
      branch: null,
    }
    expect(await branchFor(row, resolve)).toBe('feature/x')
  })

  it('answers null for a worktree it cannot reach', async () => {
    const row = {
      id: 1,
      repo_id: 1,
      source_kind: 'worktree',
      source_value: '/repo/.worktrees/gone',
      base_ref: 'master',
      branch: null,
    }
    expect(await branchFor(row, resolve)).toBe(null)
  })
})

describe('rekeyByBranch', () => {
  it('places every review it can on a branch', async () => {
    const db = await legacyDatabase()
    const result = await rekeyByBranch(db, resolve)
    expect(result?.stamped).toBe(4)
    expect(result?.unplaced).toBe(1)
    await db.close()
  })

  it('merges the two bases of one branch, keeping every note', async () => {
    const db = await legacyDatabase()
    await note(db, 1, 'a.ts')
    await note(db, 2, 'b.ts')
    await note(db, 2, 'c.ts')
    await db.run(
      `insert into viewed_files (session_id, path) values (1, 'a.ts'), (2, 'a.ts'), (2, 'b.ts')`,
    )

    const result = await rekeyByBranch(db, resolve)
    // 2 holds the most notes, so it survives and 1 folds into it
    expect(result?.merged).toContainEqual({ survivor: 2, absorbed: [1] })

    const threads = await db.all<{ session_id: number }>(
      'select session_id from threads',
    )
    expect(threads).toHaveLength(3)
    expect(threads.every((t) => t.session_id === 2)).toBe(true)
    // a.ts was read in both and must not become two rows
    const viewed = await db.all<{ session_id: number; path: string }>(
      'select session_id, path from viewed_files order by path',
    )
    expect(viewed).toEqual([
      { session_id: 2, path: 'a.ts' },
      { session_id: 2, path: 'b.ts' },
    ])
    await db.close()
  })

  it('merges a branch reviewed in a worktree with the same branch as a ref', async () => {
    const db = await legacyDatabase()
    await note(db, 4, 'a.ts')
    const result = await rekeyByBranch(db, resolve)
    expect(result?.merged).toContainEqual({ survivor: 4, absorbed: [3] })
    const rows = await db.all<{ id: number; branch: string | null }>(
      'select id, branch from sessions order by id',
    )
    // nothing has a note on master, so the oldest of that pair survives
    expect(rows).toEqual([
      { id: 1, branch: 'master' },
      { id: 4, branch: 'feature/x' },
      { id: 5, branch: null },
    ])
    await db.close()
  })

  it('never merges a review it could not place', async () => {
    const db = await legacyDatabase()
    await note(db, 5, 'a.ts')
    await rekeyByBranch(db, resolve)
    const kept = await db.get<{ n: number }>(
      'select count(*) as n from threads where session_id = 5',
    )
    expect(Number(kept?.n)).toBe(1)
    await db.close()
  })

  it('says in the record which reviews were folded together', async () => {
    const db = await legacyDatabase()
    await db.run(
      `insert into activity (subject, action, session_id) values ('note', 'created', 1)`,
    )
    await rekeyByBranch(db, resolve)
    const rows = await db.all<{ subject: string; action: string; session_id: number }>(
      'select subject, action, session_id from activity order by id',
    )
    // the note's own row followed it onto the survivor
    expect(rows[0]).toEqual({ subject: 'note', action: 'created', session_id: 1 })
    expect(
      rows.some((r) => r.subject === 'review' && r.action === 'merged'),
    ).toBe(true)
    await db.close()
  })

  it('leaves the branch key in place and enforces it', async () => {
    const db = await legacyDatabase()
    await rekeyByBranch(db, resolve)
    await expect(
      db.run(
        `insert into sessions (repo_id, source_kind, source_value, branch, base_ref, base_sha)
         values (1, 'worktree', '/repo', 'master', 'HEAD', 'zzz')`,
      ),
    ).rejects.toThrow()
    // a second unplaced review is not a duplicate of the first: nulls stay apart
    await db.run(
      `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
       values (1, 'worktree', '/repo/.worktrees/other', 'master', 'zzz')`,
    )
    await db.close()
  })

  it('keeps the notes of a rebuilt table', async () => {
    const db = await legacyDatabase()
    await note(db, 3, 'a.ts')
    await note(db, 5, 'b.ts')
    await rekeyByBranch(db, resolve)
    const total = await db.get<{ n: number }>('select count(*) as n from threads')
    expect(Number(total?.n)).toBe(2)
    const orphans = await db.all('pragma foreign_key_check')
    expect(orphans).toEqual([])
    await db.close()
  })

  it('does nothing the second time, and nothing to a fresh database', async () => {
    const legacy = await legacyDatabase()
    await rekeyByBranch(legacy, resolve)
    expect(await rekeyByBranch(legacy, resolve)).toBe(null)
    await legacy.close()

    const fresh = openSqlite(':memory:')
    await applySchema(fresh)
    expect(await rekeyByBranch(fresh, resolve)).toBe(null)
    await fresh.close()
  })
})
