import type { Db } from './driver.js'

/**
 * Moves `sessions` onto the key it should always have had:
 * (repo_id, source_kind, source_value, base_ref) rather than … base_sha.
 *
 * Keying on the pinned commit made a review's identity depend on where its base
 * ref happened to point when it started, so every commit to the reviewed branch
 * minted another review and split one person's notes across a row per commit.
 * The pinned commit is state; the ref is identity. A source reviewed against
 * two different bases is genuinely two reviews, and this is what lets them
 * coexist even when both bases resolve to the same commit.
 *
 * Runs once. Afterwards the table carries the new key and the detection below
 * finds nothing to do, so it is safe on every start.
 */

const merged_action = 'merged'

interface SessionRow {
  id: number
  repo_id: number
  source_kind: string
  source_value: string
  base_ref: string
}

/** Which sessions collapse into which, under the new key. */
export interface MergePlan {
  survivor: number
  absorbed: number[]
}

/**
 * One survivor per key, keeping whichever row holds the most notes so a
 * reviewer's work stays where they left it; oldest wins a tie, since that is
 * the review they started.
 */
export function planMerges(
  sessions: SessionRow[],
  threadCounts: Map<number, number>,
): MergePlan[] {
  const groups = new Map<string, SessionRow[]>()
  for (const row of sessions) {
    // a NUL cannot occur in a path or a ref, where a space can: joining on one
    // would let ('/a b', 'master') and ('/a', 'b master') collide
    const key = [
      row.repo_id,
      row.source_kind,
      row.source_value,
      row.base_ref,
    ].join('\u0000')
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const plans: MergePlan[] = []
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    const ranked = [...rows].sort((a, b) => {
      const by_notes = (threadCounts.get(b.id) ?? 0) - (threadCounts.get(a.id) ?? 0)
      return by_notes !== 0 ? by_notes : a.id - b.id
    })
    const [survivor, ...rest] = ranked
    if (survivor === undefined) continue
    plans.push({ survivor: survivor.id, absorbed: rest.map((row) => row.id) })
  }
  return plans
}

async function oldKeyConstraint(db: Db): Promise<string | null> {
  if (db.dialect === 'sqlite') {
    const row = await db.get<{ sql: string | null }>(
      `select sql from sqlite_master where type = 'table' and name = 'sessions'`,
    )
    const ddl = row?.sql ?? ''
    return /unique\s*\([^)]*base_sha[^)]*\)/i.test(ddl) ? 'sqlite' : null
  }
  const rows = await db.all<{ constraint_name: string; cols: string }>(
    `select tc.constraint_name,
            string_agg(kcu.column_name, ',' order by kcu.ordinal_position) as cols
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
     where tc.table_name = 'sessions' and tc.constraint_type = 'UNIQUE'
     group by tc.constraint_name`,
  )
  const stale = rows.find((row) => row.cols.split(',').includes('base_sha'))
  return stale?.constraint_name ?? null
}

async function mergeForks(db: Db): Promise<MergePlan[]> {
  const sessions = await db.all<SessionRow>(
    'select id, repo_id, source_kind, source_value, base_ref from sessions order by id',
  )
  const counts = await db.all<{ session_id: number; n: number }>(
    'select session_id, count(*) as n from threads group by session_id',
  )
  const plans = planMerges(
    sessions,
    new Map(counts.map((row) => [row.session_id, Number(row.n)])),
  )

  for (const plan of plans) {
    for (const absorbed of plan.absorbed) {
      await db.run('update threads set session_id = ? where session_id = ?', [
        plan.survivor,
        absorbed,
      ])
      // (session_id, path) is a primary key, so a file read in both places
      // cannot simply be re-pointed onto the survivor
      await db.run(
        `insert into viewed_files (session_id, path)
         select ?, path from viewed_files where session_id = ?
         on conflict do nothing`,
        [plan.survivor, absorbed],
      )
      await db.run('delete from viewed_files where session_id = ?', [absorbed])
      // the record is append-only in normal operation; a one-off re-key points
      // its rows at the same review under a corrected identity, and says so in
      // a row of its own below
      await db.run('update activity set session_id = ? where session_id = ?', [
        plan.survivor,
        absorbed,
      ])
      await db.run('delete from sessions where id = ?', [absorbed])
    }
    await db.run(
      `insert into activity (subject, action, session_id, detail)
       values (?, ?, ?, ?)`,
      [
        'review',
        merged_action,
        plan.survivor,
        JSON.stringify({
          absorbed: plan.absorbed,
          reason: 'sessions re-keyed from base_sha to base_ref',
        }),
      ],
    )
  }
  return plans
}

const sqlite_rebuilt_table = `
create table sessions_rekeyed (
  id integer primary key autoincrement,
  repo_id integer not null references repos(id) on delete cascade,
  source_kind text not null,
  source_value text not null,
  base_ref text not null,
  base_sha text not null,
  created_at text not null default (datetime('now')),
  unique (repo_id, source_kind, source_value, base_ref)
);
insert into sessions_rekeyed (id, repo_id, source_kind, source_value, base_ref, base_sha, created_at)
  select id, repo_id, source_kind, source_value, base_ref, base_sha, created_at from sessions;
drop table sessions;
alter table sessions_rekeyed rename to sessions;
`

export async function rekeySessions(db: Db): Promise<MergePlan[]> {
  const stale = await oldKeyConstraint(db)
  if (stale === null) return []

  const plans = await mergeForks(db)

  if (db.dialect === 'postgres') {
    await db.exec(`alter table sessions drop constraint "${stale}"`)
    await db.exec(
      `alter table sessions add constraint sessions_repo_source_base_ref_key
         unique (repo_id, source_kind, source_value, base_ref)`,
    )
    return plans
  }

  // SQLite cannot drop a constraint, so the table is rebuilt. Foreign keys are
  // switched off around it — this connection has them on, and dropping the old
  // table with them on would cascade every note away. The pragma is a no-op
  // inside a transaction, so it has to sit outside one.
  await db.exec('pragma foreign_keys = off')
  try {
    await db.transaction(async () => {
      await db.exec(sqlite_rebuilt_table)
    })
    const orphans = await db.all<Record<string, unknown>>(
      'pragma foreign_key_check',
    )
    if (orphans.length > 0) {
      throw new Error(
        `session re-key left ${String(orphans.length)} rows without a parent`,
      )
    }
  } finally {
    await db.exec('pragma foreign_keys = on')
  }
  return plans
}
