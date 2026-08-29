import type { Db } from './db/driver.js'
import { toBool, toText } from './db/driver.js'
import type {
  Actor,
  ActorKind,
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

interface ActorRow {
  id: number
  kind: string
  name: string
  email: string | null
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
  /** 0/1 from sqlite, boolean from postgres */
  pending: number | boolean
  origin: string | null
  external_id: string | null
  created_at: string | Date
  /** from the left join, not a column of threads */
  actor_name: string | null
}

interface MessageRow {
  id: number
  thread_id: number
  author: string
  body: string
  created_at: string | Date
  /** from the left join, not a column of messages */
  actor_name: string | null
}

/**
 * Every read of a thread or a message carries the actor's name, so no caller
 * has to remember a second query. A left join because the column is nullable
 * by design: rows written before there were actors, and imported ones whose
 * author was somebody else's account, have none.
 */
const thread_select =
  'select t.*, a.name as actor_name from threads t left join actors a on a.id = t.actor_id'

const message_select =
  'select m.*, a.name as actor_name from messages m left join actors a on a.id = m.actor_id'

export class Store {
  constructor(private db: Db) {}

  /** Where the record lives, safe to show: never carries credentials. */
  get describe(): string {
    return this.db.describe
  }

  listRepos(): Promise<RepoRow[]> {
    return this.db.all<RepoRow>('select id, path from repos order by path')
  }

  getRepo(id: number): Promise<RepoRow | undefined> {
    return this.db.get<RepoRow>('select id, path from repos where id = ?', [id])
  }

  async addRepo(path: string): Promise<RepoRow> {
    await this.db.run(
      'insert into repos (path) values (?) on conflict do nothing',
      [path],
    )
    const row = await this.db.get<RepoRow>(
      'select id, path from repos where path = ?',
      [path],
    )
    if (row === undefined) throw new Error('repo insert failed')
    return row
  }

  async removeRepo(id: number): Promise<void> {
    await this.db.run('delete from repos where id = ?', [id])
  }

  async getOrCreateSession(
    repoId: number,
    source: ReviewSource,
    baseRef: string,
    baseSha: string,
  ): Promise<Session> {
    await this.db.run(
      `insert into sessions (repo_id, source_kind, source_value, base_ref, base_sha)
       values (?, ?, ?, ?, ?) on conflict do nothing`,
      [repoId, source.kind, source.value, baseRef, baseSha],
    )
    const row = await this.db.get<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id
       where s.repo_id = ? and s.source_kind = ? and s.source_value = ? and s.base_sha = ?`,
      [repoId, source.kind, source.value, baseSha],
    )
    if (row === undefined) throw new Error('session insert failed')
    return sessionFromRow(row)
  }

  async getSession(id: number): Promise<Session | undefined> {
    const row = await this.db.get<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id where s.id = ?`,
      [id],
    )
    return row === undefined ? undefined : sessionFromRow(row)
  }

  /** Newest first, so an agent handed no id can take the obvious one. */
  async listSessions(): Promise<Session[]> {
    const rows = await this.db.all<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id order by s.id desc`,
    )
    return rows.map(sessionFromRow)
  }

  async countOpenThreads(sessionId: number): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      `select count(*) as n from threads
       where session_id = ? and status != 'resolved' and pending = ?`,
      [sessionId, this.falseValue],
    )
    return Number(row?.n ?? 0)
  }

  /** Postgres wants a real boolean where SQLite wants 0/1. */
  private get falseValue(): boolean | number {
    return this.db.dialect === 'postgres' ? false : 0
  }

  private get trueValue(): boolean | number {
    return this.db.dialect === 'postgres' ? true : 1
  }

  /**
   * The actor for a (kind, name) pair, creating it the first time it is seen.
   * The email is written only on creation: a name that later gains one keeps
   * pointing at the same actor rather than quietly restating the past.
   */
  async getOrCreateActor(
    kind: ActorKind,
    name: string,
    email?: string | null,
  ): Promise<Actor> {
    await this.db.run(
      'insert into actors (kind, name, email) values (?, ?, ?) on conflict do nothing',
      [kind, name, email ?? null],
    )
    const row = await this.db.get<ActorRow>(
      'select id, kind, name, email from actors where kind = ? and name = ?',
      [kind, name],
    )
    if (row === undefined) throw new Error('actor insert failed')
    return actorFromRow(row)
  }

  listActors(): Promise<Actor[]> {
    return this.db
      .all<ActorRow>(
        'select id, kind, name, email from actors order by kind, name',
      )
      .then((rows) => rows.map(actorFromRow))
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
    options: {
      pending?: boolean
      origin?: string
      externalId?: string
      actorId?: number | null
    } = {},
  ): Promise<Thread> {
    // the note and its first message are one act; a reader must never find a
    // thread with no message in it
    return this.db.transaction(async () => {
      const threadId = await this.db.insert(
        `insert into threads (session_id, path, side, start_line, end_line, blob_sha, snippet, pending, origin, external_id, actor_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          path,
          side,
          startLine,
          endLine,
          blobSha,
          snippet,
          options.pending === true ? this.trueValue : this.falseValue,
          options.origin ?? null,
          options.externalId ?? null,
          options.actorId ?? null,
        ],
      )
      await this.addMessage(threadId, author, body, options.actorId)
      const thread = await this.getThread(threadId)
      if (thread === undefined) throw new Error('thread insert failed')
      return thread
    })
  }

  async getThread(id: number): Promise<Thread | undefined> {
    const row = await this.db.get<ThreadRow>(
      `${thread_select} where t.id = ?`,
      [id],
    )
    if (row === undefined) return undefined
    return this.threadFromRow(row)
  }

  async listThreads(
    sessionId: number,
    status?: ThreadStatus,
  ): Promise<Thread[]> {
    const rows =
      status === undefined
        ? await this.db.all<ThreadRow>(
            `${thread_select} where t.session_id = ? order by t.id`,
            [sessionId],
          )
        : await this.db.all<ThreadRow>(
            `${thread_select} where t.session_id = ? and t.status = ? order by t.id`,
            [sessionId, status],
          )
    const threads: Thread[] = []
    for (const row of rows) threads.push(await this.threadFromRow(row))
    return threads
  }

  async addMessage(
    threadId: number,
    author: Author,
    body: string,
    actorId?: number | null,
  ): Promise<ThreadMessage> {
    const id = await this.db.insert(
      'insert into messages (thread_id, author, body, actor_id) values (?, ?, ?, ?)',
      [threadId, author, body, actorId ?? null],
    )
    const row = await this.db.get<MessageRow>(
      `${message_select} where m.id = ?`,
      [id],
    )
    if (row === undefined) throw new Error('message insert failed')
    return messageFromRow(row)
  }

  async getMessage(
    id: number,
  ): Promise<{ id: number; threadId: number; author: Author } | undefined> {
    const row = await this.db.get<{
      id: number
      thread_id: number
      author: string
    }>('select id, thread_id, author from messages where id = ?', [id])
    if (row === undefined) return undefined
    return { id: row.id, threadId: row.thread_id, author: row.author as Author }
  }

  async updateMessage(id: number, body: string): Promise<void> {
    await this.db.run('update messages set body = ? where id = ?', [body, id])
  }

  async deleteMessage(id: number): Promise<void> {
    await this.db.run('delete from messages where id = ?', [id])
  }

  async countMessages(threadId: number): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      'select count(*) as n from messages where thread_id = ?',
      [threadId],
    )
    return Number(row?.n ?? 0)
  }

  async deleteThread(id: number): Promise<void> {
    await this.db.run('delete from threads where id = ?', [id])
  }

  async setThreadStatus(threadId: number, status: ThreadStatus): Promise<void> {
    await this.db.run('update threads set status = ? where id = ?', [
      status,
      threadId,
    ])
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>(
      'select value from settings where key = ?',
      [key],
    )
    return row?.value ?? null
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    if (value === null || value === '') {
      await this.db.run('delete from settings where key = ?', [key])
      return
    }
    await this.db.run(
      'insert into settings (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
      [key, value],
    )
  }

  /** Post every pending note of a session; returns how many were posted. */
  async postPending(sessionId: number): Promise<number> {
    const result = await this.db.run(
      'update threads set pending = ? where session_id = ? and pending = ?',
      [this.falseValue, sessionId, this.trueValue],
    )
    return result.changes
  }

  async setThreadPending(threadId: number, pending: boolean): Promise<void> {
    await this.db.run('update threads set pending = ? where id = ?', [
      pending ? this.trueValue : this.falseValue,
      threadId,
    ])
  }

  async findThreadByExternalId(
    sessionId: number,
    externalId: string,
  ): Promise<Thread | undefined> {
    const row = await this.db.get<ThreadRow>(
      `${thread_select} where t.session_id = ? and t.external_id = ?`,
      [sessionId, externalId],
    )
    return row === undefined ? undefined : this.threadFromRow(row)
  }

  async setViewed(
    sessionId: number,
    path: string,
    viewed: boolean,
  ): Promise<void> {
    if (viewed) {
      await this.db.run(
        'insert into viewed_files (session_id, path) values (?, ?) on conflict do nothing',
        [sessionId, path],
      )
      return
    }
    await this.db.run(
      'delete from viewed_files where session_id = ? and path = ?',
      [sessionId, path],
    )
  }

  async listViewed(sessionId: number): Promise<string[]> {
    const rows = await this.db.all<{ path: string }>(
      'select path from viewed_files where session_id = ?',
      [sessionId],
    )
    return rows.map((r) => r.path)
  }

  /** Carry unresolved threads over to a re-pinned session. */
  async moveOpenThreads(
    fromSessionId: number,
    toSessionId: number,
  ): Promise<number> {
    const result = await this.db.run(
      `update threads set session_id = ? where session_id = ? and status != 'resolved'`,
      [toSessionId, fromSessionId],
    )
    return result.changes
  }

  async setThreadAnchor(
    threadId: number,
    startLine: number,
    endLine: number,
  ): Promise<void> {
    await this.db.run(
      'update threads set start_line = ?, end_line = ? where id = ?',
      [startLine, endLine, threadId],
    )
  }

  private async threadFromRow(row: ThreadRow): Promise<Thread> {
    const rows = await this.db.all<MessageRow>(
      `${message_select} where m.thread_id = ? order by m.id`,
      [row.id],
    )
    const messages = rows.map(messageFromRow)
    return {
      id: row.id,
      sessionId: row.session_id,
      path: row.path,
      side: row.side as Side,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.snippet,
      status: row.status as ThreadStatus,
      pending: toBool(row.pending),
      origin: row.origin,
      createdAt: toText(row.created_at),
      actorName: row.actor_name,
      messages,
    }
  }
}

function actorFromRow(row: ActorRow): Actor {
  return {
    id: row.id,
    kind: row.kind as ActorKind,
    name: row.name,
    email: row.email,
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
    createdAt: toText(row.created_at),
    actorName: row.actor_name,
  }
}
