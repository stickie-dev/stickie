import type { Db, Dialect } from './driver.js'
import { numberNotes } from './noteNumbers.js'
import type { BranchResolver } from './reviewBranch.js'
import { rekeyByBranch } from './reviewBranch.js'
import { rekeySessions } from './sessionKey.js'

/**
 * The schema, per dialect. Two literals rather than a generated one: the
 * differences are few and worth reading side by side, and a home-made DDL
 * abstraction would hide more than it saves.
 *
 * `activity` is append-only by convention, not by permission: nothing in the
 * code updates or deletes a row, and its foreign keys are deliberately plain
 * integers with no `on delete cascade`, so deleting a note does not delete the
 * record that it existed. On the default SQLite file the owner can still edit
 * it by hand — it is a record, not evidence, and nothing may claim otherwise.
 *
 * A review is keyed by the branch it reviews: see `reviewBranch.ts`, which
 * moves an older database onto that key, and `sessionKey.ts` before it, which
 * moved it off the pinned commit. Notes are numbered within their review rather
 * than globally: see `noteNumbers.ts`, which fills the column in and puts the
 * unique index on.
 */

const sqlite_schema = `
create table if not exists repos (
  id integer primary key autoincrement,
  path text not null unique
);

create table if not exists sessions (
  id integer primary key autoincrement,
  repo_id integer not null references repos(id) on delete cascade,
  source_kind text not null,
  source_value text not null,
  branch text,
  base_ref text not null,
  base_sha text not null,
  prev_base_ref text,
  prev_base_sha text,
  created_at text not null default (datetime('now')),
  unique (repo_id, branch)
);

create table if not exists threads (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  path text not null,
  side text not null,
  start_line integer not null,
  end_line integer not null,
  blob_sha text,
  snippet text not null,
  status text not null default 'open',
  created_at text not null default (datetime('now'))
);

create table if not exists messages (
  id integer primary key autoincrement,
  thread_id integer not null references threads(id) on delete cascade,
  author text not null,
  body text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists viewed_files (
  session_id integer not null references sessions(id) on delete cascade,
  path text not null,
  viewed_at text not null default (datetime('now')),
  primary key (session_id, path)
);

create table if not exists actors (
  id integer primary key autoincrement,
  kind text not null,
  name text not null,
  email text,
  created_at text not null default (datetime('now')),
  unique (kind, name)
);

create table if not exists activity (
  id integer primary key autoincrement,
  at text not null default (datetime('now')),
  actor_id integer references actors(id),
  subject text not null,
  action text not null,
  repo_id integer,
  session_id integer,
  thread_id integer,
  message_id integer,
  detail text
);

create index if not exists activity_session on activity (session_id, id);
create index if not exists activity_repo on activity (repo_id, id);
`

const postgres_schema = `
create table if not exists repos (
  id serial primary key,
  path text not null unique
);

create table if not exists sessions (
  id serial primary key,
  repo_id integer not null references repos(id) on delete cascade,
  source_kind text not null,
  source_value text not null,
  branch text,
  base_ref text not null,
  base_sha text not null,
  prev_base_ref text,
  prev_base_sha text,
  created_at timestamptz not null default now(),
  unique (repo_id, branch)
);

create table if not exists threads (
  id serial primary key,
  session_id integer not null references sessions(id) on delete cascade,
  path text not null,
  side text not null,
  start_line integer not null,
  end_line integer not null,
  blob_sha text,
  snippet text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id serial primary key,
  thread_id integer not null references threads(id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists viewed_files (
  session_id integer not null references sessions(id) on delete cascade,
  path text not null,
  viewed_at timestamptz not null default now(),
  primary key (session_id, path)
);

create table if not exists actors (
  id serial primary key,
  kind text not null,
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

create table if not exists activity (
  id serial primary key,
  at timestamptz not null default now(),
  actor_id integer references actors(id),
  subject text not null,
  action text not null,
  repo_id integer,
  session_id integer,
  thread_id integer,
  message_id integer,
  detail text
);

create index if not exists activity_session on activity (session_id, id);
create index if not exists activity_repo on activity (repo_id, id);
`

/**
 * Columns added after the first release, per dialect and per table. All of
 * them nullable or defaulted: an existing row must stay valid, and no read
 * path may require one.
 */
const added_columns: Record<string, Record<Dialect, [string, string][]>> = {
  repos: {
    // when this repository left the workspace without its reviews being
    // deleted. Null is the normal state; a row with a stamp is kept only so
    // that re-adding the same path finds its notes again
    sqlite: [['removed_at', 'removed_at text']],
    postgres: [['removed_at', 'removed_at timestamptz']],
  },
  sessions: {
    // how many note numbers this review has handed out. Defaulting to 0 on an
    // existing review is safe: `createThread` takes whichever is higher, this
    // or the highest number in the review, so a review that already holds
    // notes 0..12 carries on at 13 without a migration to set it.
    //
    // `branch` is what a review *is*; it is nullable because an older database
    // has rows from before the key existed, and `reviewBranch.ts` fills it in
    // from the checkout. A row it cannot place keeps a null, which no
    // get-or-create ever matches — the review stays reachable by its id and is
    // never silently handed to work it does not belong to.
    sqlite: [
      ['notes_issued', 'notes_issued integer not null default 0'],
      ['branch', 'branch text'],
      ['prev_base_ref', 'prev_base_ref text'],
      ['prev_base_sha', 'prev_base_sha text'],
      // the merge request this review is of, at most one; see gitlab.ts on why
      // it is attached rather than imported
      ['mr_iid', 'mr_iid integer'],
      ['mr_project', 'mr_project text'],
    ],
    postgres: [
      ['notes_issued', 'notes_issued integer not null default 0'],
      ['branch', 'branch text'],
      ['prev_base_ref', 'prev_base_ref text'],
      ['prev_base_sha', 'prev_base_sha text'],
      // the merge request this review is of, at most one; see gitlab.ts on why
      // it is attached rather than imported
      ['mr_iid', 'mr_iid integer'],
      ['mr_project', 'mr_project text'],
    ],
  },
  threads: {
    sqlite: [
      ['pending', 'pending integer not null default 0'],
      ['origin', 'origin text'],
      ['external_id', 'external_id text'],
      ['actor_id', 'actor_id integer references actors(id)'],
      ['number', 'number integer'],
      // the merge-request discussion this note was started from, so the one
      // that exists can be found again rather than a second one started
      ['mr_discussion', 'mr_discussion text'],
    ],
    postgres: [
      ['pending', 'pending boolean not null default false'],
      ['origin', 'origin text'],
      ['external_id', 'external_id text'],
      ['actor_id', 'actor_id integer references actors(id)'],
      ['number', 'number integer'],
      // the merge-request discussion this note was started from, so the one
      // that exists can be found again rather than a second one started
      ['mr_discussion', 'mr_discussion text'],
    ],
  },
  messages: {
    sqlite: [['actor_id', 'actor_id integer references actors(id)']],
    postgres: [['actor_id', 'actor_id integer references actors(id)']],
  },
  actors: {
    sqlite: [['email', 'email text']],
    postgres: [['email', 'email text']],
  },
}

async function existingColumns(db: Db, table: string): Promise<Set<string>> {
  if (db.dialect === 'sqlite') {
    const rows = await db.all<{ name: string }>(`pragma table_info(${table})`)
    return new Set(rows.map((row) => row.name))
  }
  const rows = await db.all<{ column_name: string }>(
    'select column_name from information_schema.columns where table_name = ?',
    [table],
  )
  return new Set(rows.map((row) => row.column_name))
}

/**
 * A migration that has to ask git which branch a working tree is on, which the
 * database layer has no business knowing. The caller supplies it; without one,
 * a worktree review keeps a null branch rather than being placed wrongly.
 */
const no_branches: BranchResolver = () => Promise.resolve(null)

export async function applySchema(
  db: Db,
  branchOf: BranchResolver = no_branches,
): Promise<void> {
  await db.exec(db.dialect === 'sqlite' ? sqlite_schema : postgres_schema)
  for (const [table, per_dialect] of Object.entries(added_columns)) {
    const existing = await existingColumns(db, table)
    for (const [name, ddl] of per_dialect[db.dialect]) {
      if (!existing.has(name)) {
        await db.exec(`alter table ${table} add column ${ddl}`)
      }
    }
  }
  // after the columns exist: the merge it may perform reads threads and writes
  // activity, so both have to be in their final shape first
  const merged = await rekeySessions(db)
  // and after that merge, which is keyed on the columns this one replaces
  const rekeyed = await rekeyByBranch(db, branchOf)
  // and after both merges, which move notes between reviews: numbering them
  // first would leave two note 0s in whichever review absorbed another
  const numbered = await numberNotes(db)
  if (numbered > 0) {
    console.log(
      `stickie: numbered ${String(numbered)} ${numbered === 1 ? 'note' : 'notes'} within ${numbered === 1 ? 'its' : 'their'} review`,
    )
  }
  if (merged.length > 0) {
    const absorbed = merged.reduce((n, plan) => n + plan.absorbed.length, 0)
    console.log(
      `stickie: re-keyed reviews by base ref, merging ${String(absorbed)} duplicate ${absorbed === 1 ? 'session' : 'sessions'} into ${String(merged.length)}`,
    )
  }
  if (rekeyed !== null) {
    const absorbed = rekeyed.merged.reduce(
      (n, plan) => n + plan.absorbed.length,
      0,
    )
    console.log(
      `stickie: re-keyed reviews by branch — ${String(rekeyed.stamped)} placed` +
        (absorbed > 0
          ? `, ${String(absorbed)} merged into ${String(rekeyed.merged.length)}`
          : '') +
        (rekeyed.unplaced > 0
          ? `, ${String(rekeyed.unplaced)} left unplaced (open them by link)`
          : ''),
    )
  }
}
