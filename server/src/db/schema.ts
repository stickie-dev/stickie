import type { Db, Dialect } from './driver.js'

/**
 * The schema, per dialect. Two literals rather than a generated one: the
 * differences are few and worth reading side by side, and a home-made DDL
 * abstraction would hide more than it saves.
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
  base_ref text not null,
  base_sha text not null,
  created_at text not null default (datetime('now')),
  unique (repo_id, source_kind, source_value, base_sha)
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
  base_ref text not null,
  base_sha text not null,
  created_at timestamptz not null default now(),
  unique (repo_id, source_kind, source_value, base_sha)
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
`

/** Columns added after the first release, per dialect. */
const thread_columns: Record<Dialect, [string, string][]> = {
  sqlite: [
    ['pending', 'pending integer not null default 0'],
    ['origin', 'origin text'],
    ['external_id', 'external_id text'],
  ],
  postgres: [
    ['pending', 'pending boolean not null default false'],
    ['origin', 'origin text'],
    ['external_id', 'external_id text'],
  ],
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

export async function applySchema(db: Db): Promise<void> {
  await db.exec(db.dialect === 'sqlite' ? sqlite_schema : postgres_schema)
  const existing = await existingColumns(db, 'threads')
  for (const [name, ddl] of thread_columns[db.dialect]) {
    if (!existing.has(name)) {
      await db.exec(`alter table threads add column ${ddl}`)
    }
  }
}
