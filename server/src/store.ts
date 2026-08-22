import type { DatabaseSync } from 'node:sqlite'
import type {
  Author,
  ReviewSource,
  Session,
  Side,
  Thread,
  ThreadMessage,
  ThreadStatus,
} from '@stickie/shared'

interface RepoRow {
  id: number
  path: string
}

interface SessionRow {
  id: number
  repo_id: number
  repo_path: string
  source_kind: string
  source_value: string
  base_ref: string
  base_sha: string
}

interface ThreadRow {
  id: number
  session_id: number
  path: string
  side: string
  start_line: number
  end_line: number
  blob_sha: string | null
  snippet: string
  status: string
  pending: number
  origin: string | null
  external_id: string | null
  created_at: string
}

interface MessageRow {
  id: number
  thread_id: number
  author: string
  body: string
  created_at: string
}

export class Store {
  constructor(private db: DatabaseSync) {}

  listRepos(): RepoRow[] {
    return this.db
      .prepare('select id, path from repos order by path')
      .all() as unknown as RepoRow[]
  }

  getRepo(id: number): RepoRow | undefined {
    return this.db
      .prepare('select id, path from repos where id = ?')
      .get(id) as unknown as RepoRow | undefined
  }

  addRepo(path: string): RepoRow {
    this.db
      .prepare('insert into repos (path) values (?) on conflict do nothing')
      .run(path)
    return this.db
      .prepare('select id, path from repos where path = ?')
      .get(path) as unknown as RepoRow
  }

  removeRepo(id: number): void {
    this.db.prepare('delete from repos where id = ?').run(id)
  }

  getOrCreateSession(
    repoId: number,
    source: ReviewSource,
    baseRef: string,
    baseSha: string,
  ): Session {
    this.db
      .prepare(
        `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
         values (?, ?, ?, ?, ?) on conflict do nothing`,
      )
      .run(repoId, source.kind, source.value, baseRef, baseSha)
    const row = this.db
      .prepare(
        `select s.*, r.path as repo_path from sessions s
         join repos r on r.id = s.repo_id
         where s.repo_id = ? and s.source_kind = ? and s.source_value = ? and s.base_sha = ?`,
      )
      .get(repoId, source.kind, source.value, baseSha) as unknown as SessionRow
    return sessionFromRow(row)
  }

  getSession(id: number): Session | undefined {
    const row = this.db
      .prepare(
        `select s.*, r.path as repo_path from sessions s
         join repos r on r.id = s.repo_id where s.id = ?`,
      )
      .get(id) as unknown as SessionRow | undefined
    return row === undefined ? undefined : sessionFromRow(row)
  }

  createThread(
    sessionId: number,
    path: string,
    side: Side,
    startLine: number,
    endLine: number,
    blobSha: string | null,
    snippet: string,
    author: Author,
    body: string,
    options: { pending?: boolean; origin?: string; externalId?: string } = {},
  ): Thread {
    const result = this.db
      .prepare(
        `insert into threads (session_id, path, side, start_line, end_line, blob_sha, snippet, pending, origin, external_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        path,
        side,
        startLine,
        endLine,
        blobSha,
        snippet,
        options.pending === true ? 1 : 0,
        options.origin ?? null,
        options.externalId ?? null,
      )
    const threadId = Number(result.lastInsertRowid)
    this.addMessage(threadId, author, body)
    const thread = this.getThread(threadId)
    if (thread === undefined) throw new Error('thread insert failed')
    return thread
  }

  getThread(id: number): Thread | undefined {
    const row = this.db
      .prepare('select * from threads where id = ?')
      .get(id) as unknown as ThreadRow | undefined
    if (row === undefined) return undefined
    return this.threadFromRow(row)
  }

  listThreads(sessionId: number, status?: ThreadStatus): Thread[] {
    const rows = (
      status === undefined
        ? this.db
            .prepare('select * from threads where session_id = ? order by id')
            .all(sessionId)
        : this.db
            .prepare(
              'select * from threads where session_id = ? and status = ? order by id',
            )
            .all(sessionId, status)
    ) as unknown as ThreadRow[]
    return rows.map((row) => this.threadFromRow(row))
  }

  addMessage(threadId: number, author: Author, body: string): ThreadMessage {
    const result = this.db
      .prepare('insert into messages (thread_id, author, body) values (?, ?, ?)')
      .run(threadId, author, body)
    const row = this.db
      .prepare('select * from messages where id = ?')
      .get(Number(result.lastInsertRowid)) as unknown as MessageRow
    return messageFromRow(row)
  }

  setThreadStatus(threadId: number, status: ThreadStatus): void {
    this.db
      .prepare('update threads set status = ? where id = ?')
      .run(status, threadId)
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare('select value from settings where key = ?')
      .get(key) as unknown as { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string | null): void {
    if (value === null || value === '') {
      this.db.prepare('delete from settings where key = ?').run(key)
    } else {
      this.db
        .prepare(
          'insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
        )
        .run(key, value)
    }
  }

  /** Post every pending note of a session; returns how many were posted. */
  postPending(sessionId: number): number {
    const result = this.db
      .prepare(
        'update threads set pending = 0 where session_id = ? and pending = 1',
      )
      .run(sessionId)
    return Number(result.changes)
  }

  setThreadPending(threadId: number, pending: boolean): void {
    this.db
      .prepare('update threads set pending = ? where id = ?')
      .run(pending ? 1 : 0, threadId)
  }

  findThreadByExternalId(sessionId: number, externalId: string): Thread | undefined {
    const row = this.db
      .prepare(
        'select * from threads where session_id = ? and external_id = ?',
      )
      .get(sessionId, externalId) as unknown as ThreadRow | undefined
    return row === undefined ? undefined : this.threadFromRow(row)
  }

  setViewed(sessionId: number, path: string, viewed: boolean): void {
    if (viewed) {
      this.db
        .prepare(
          'insert into viewed_files (session_id, path) values (?, ?) on conflict do nothing',
        )
        .run(sessionId, path)
    } else {
      this.db
        .prepare('delete from viewed_files where session_id = ? and path = ?')
        .run(sessionId, path)
    }
  }

  listViewed(sessionId: number): string[] {
    return (
      this.db
        .prepare('select path from viewed_files where session_id = ?')
        .all(sessionId) as unknown as { path: string }[]
    ).map((r) => r.path)
  }

  /** Carry unresolved threads over to a re-pinned session. */
  moveOpenThreads(fromSessionId: number, toSessionId: number): number {
    const result = this.db
      .prepare(
        `update threads set session_id = ? where session_id = ? and status != 'resolved'`,
      )
      .run(toSessionId, fromSessionId)
    return Number(result.changes)
  }

  setThreadAnchor(threadId: number, startLine: number, endLine: number): void {
    this.db
      .prepare('update threads set start_line = ?, end_line = ? where id = ?')
      .run(startLine, endLine, threadId)
  }

  private threadFromRow(row: ThreadRow): Thread {
    const messages = (
      this.db
        .prepare('select * from messages where thread_id = ? order by id')
        .all(row.id) as unknown as MessageRow[]
    ).map(messageFromRow)
    return {
      id: row.id,
      sessionId: row.session_id,
      path: row.path,
      side: row.side as Side,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.snippet,
      status: row.status as ThreadStatus,
      pending: row.pending === 1,
      origin: row.origin,
      createdAt: row.created_at,
      messages,
    }
  }
}

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    repoId: row.repo_id,
    repoPath: row.repo_path,
    source: {
      kind: row.source_kind as ReviewSource['kind'],
      value: row.source_value,
    },
    baseRef: row.base_ref,
    baseSha: row.base_sha,
  }
}

function messageFromRow(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    author: row.author as Author,
    body: row.body,
    createdAt: row.created_at,
  }
}
