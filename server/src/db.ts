import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const schema = `
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

const thread_columns: [string, string][] = [
  ['pending', 'pending integer not null default 0'],
  ['origin', 'origin text'],
  ['external_id', 'external_id text'],
]

function ensureColumns(db: DatabaseSync): void {
  const existing = new Set(
    (
      db.prepare(`pragma table_info(threads)`).all() as unknown as {
        name: string
      }[]
    ).map((c) => c.name),
  )
  for (const [name, ddl] of thread_columns) {
    if (!existing.has(name)) {
      db.exec(`alter table threads add column ${ddl}`)
    }
  }
}

export function defaultDbPath(): string {
  const dir = path.join(os.homedir(), '.stickie')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'stickie.sqlite')
}

export function openDb(file: string = defaultDbPath()): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  db.exec(schema)
  ensureColumns(db)
  return db
}
