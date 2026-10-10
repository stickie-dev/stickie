import type {
  ActivityEntry,
  ActivityInput,
  ActivitySubject,
} from './activity.js'
import type { Db } from './db/driver.js'
import { toBool, toText } from './db/driver.js'
import type {
  Actor,
  ActorKind,
  Author,
  NoteCounts,
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
  branch: string | null
  base_ref: string
  base_sha: string
  prev_base_ref: string | null
  mr_iid: number | null
  mr_project: string | null
  archived_at: string | Date | null
  kept_at: string | Date | null
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
  /**
   * Never null in practice: assigned on insert, and `numberNotes` fills in
   * anything older on every start, so a read cannot get ahead of it.
   */
  number: number
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
  mr_discussion: string | null
  prompt_position: number | null
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

  /**
   * The registered repositories. A repository that was unregistered rather
   * than deleted keeps its row, and its reviews with it, so re-adding the same
   * path finds the notes again — but it is not in the workspace, and nothing
   * that lists what is in the workspace may show it.
   */
  listRepos(): Promise<RepoRow[]> {
    return this.db.all<RepoRow>(
      'select id, path from repos where removed_at is null order by path',
    )
  }

  getRepo(id: number): Promise<RepoRow | undefined> {
    return this.db.get<RepoRow>(
      'select id, path from repos where id = ? and removed_at is null',
      [id],
    )
  }

  /**
   * A path's row whether or not it is in the workspace, so a caller can tell a
   * repository joining it from one that was already there. `getRepo` cannot
   * answer that: an unregistered repository reads as absent, which is the
   * point of it.
   */
  repoByPath(
    path: string,
  ): Promise<{ id: number; removed_at: string | null } | undefined> {
    return this.db.get<{ id: number; removed_at: string | null }>(
      'select id, removed_at from repos where path = ?',
      [path],
    )
  }

  async addRepo(path: string): Promise<RepoRow> {
    await this.db.run(
      'insert into repos (path) values (?) on conflict do nothing',
      [path],
    )
    // adding a path that was unregistered brings it back, reviews and notes
    // included — which is the whole reason unregistering keeps the row
    await this.db.run(
      'update repos set removed_at = null where path = ? and removed_at is not null',
      [path],
    )
    const row = await this.db.get<RepoRow>(
      'select id, path from repos where path = ?',
      [path],
    )
    if (row === undefined) throw new Error('repo insert failed')
    return row
  }

  /** How many notes would go with this repository. Nothing else counts them. */
  async countNotesInRepo(repoId: number): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      `select count(*) as n from threads t
       join sessions s on s.id = t.session_id
       where s.repo_id = ?`,
      [repoId],
    )
    return Number(row?.n ?? 0)
  }

  /**
   * Takes a repository out of the workspace, one of two ways.
   *
   * `delete` removes the row, and the foreign keys take its reviews, notes and
   * replies with it. `unregister` stamps `removed_at` and keeps all of it.
   * Either way its `activity` rows stay: those keys are plain integers with no
   * cascade, so the record of what was reviewed here outlives the reviews.
   *
   * A repository with no notes is deleted whichever way is asked for — there
   * is nothing to keep, and a hidden row nobody can see is worse than no row.
   */
  async removeRepo(
    id: number,
    mode: 'delete' | 'unregister',
  ): Promise<{ deleted: boolean; notes: number }> {
    const notes = await this.countNotesInRepo(id)
    if (mode === 'delete' || notes === 0) {
      await this.db.run('delete from repos where id = ?', [id])
      return { deleted: true, notes }
    }
    await this.db.run('update repos set removed_at = ? where id = ?', [
      new Date().toISOString(),
      id,
    ])
    return { deleted: false, notes }
  }

  /**
   * A review is identified by what is being reviewed and against what *ref* —
   * not against which commit that ref happened to point at. The pinned sha is
   * state, not identity: every commit to the reviewed branch used to move the
   * merge-base and so mint a brand-new review on the next page load, splitting
   * one person's notes across a row per commit.
   *
   * A base that has since moved is not hidden by this — `baseStale` still
   * reports it and re-pinning still moves the pin deliberately.
   *
   * The insert relies on the table's unique key being that same tuple; see
   * `db/sessionKey.ts`, which moves an older database onto it.
   */
  async getOrCreateSession(
    repoId: number,
    branch: string,
    source: ReviewSource,
    baseRef: string,
    baseSha: string,
  ): Promise<Session> {
    await this.db.run(
      `insert into sessions (repo_id, branch, source_kind, source_value, base_ref, base_sha)
       values (?, ?, ?, ?, ?, ?) on conflict do nothing`,
      [repoId, branch, source.kind, source.value, baseRef, baseSha],
    )
    // selected by the key, so an existing review comes back with the base it is
    // already pinned to rather than the one just resolved
    const row = await this.db.get<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id
       where s.repo_id = ? and s.branch = ?`,
      [repoId, branch],
    )
    if (row === undefined) throw new Error('session insert failed')
    // the branch moved: reviewed in a worktree, now checked out in the main
    // clone, or the other way about. Same work, same review, new place to read
    // it from — the source is a location, not an identity.
    if (
      row.source_kind !== source.kind ||
      row.source_value !== source.value
    ) {
      await this.db.run(
        'update sessions set source_kind = ?, source_value = ? where id = ?',
        [source.kind, source.value, row.id],
      )
      row.source_kind = source.kind
      row.source_value = source.value
    }
    return sessionFromRow(row)
  }

  /**
   * A review found by where it is read from, rather than by what it is of.
   *
   * The key is `(repo, branch)`, and the branch of a worktree review is what
   * that checkout answers — so once the worktree is removed there is nothing
   * left to ask, and the review cannot be found the usual way. It is still a
   * review: the notes on it are about work that was really done.
   *
   * Narrowed by base when one was asked for, and otherwise the most recent, so
   * a source read against two bases answers with the one last made rather than
   * with whichever the query planner reached first.
   */
  async getSessionBySource(
    repoId: number,
    source: ReviewSource,
    baseRef?: string,
  ): Promise<Session | undefined> {
    const row = await this.db.get<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id
       where s.repo_id = ? and s.source_kind = ? and s.source_value = ?
         and (? is null or s.base_ref = ?)
       order by s.id desc`,
      [repoId, source.kind, source.value, baseRef ?? null, baseRef ?? null],
    )
    return row === undefined ? undefined : sessionFromRow(row)
  }

  /**
   * Moves a review's base, keeping the one it had so the move can be undone.
   *
   * The base is a lens on one piece of work — the same branch read against
   * `HEAD` or against `master` is the same review — so changing it moves the
   * review rather than forking a second one to strand the notes in.
   */
  async slideBase(
    sessionId: number,
    baseRef: string,
    baseSha: string,
  ): Promise<void> {
    await this.db.run(
      `update sessions
       set prev_base_ref = base_ref, prev_base_sha = base_sha,
           base_ref = ?, base_sha = ?
       where id = ? and (base_ref != ? or base_sha != ?)`,
      [baseRef, baseSha, sessionId, baseRef, baseSha],
    )
  }

  /**
   * Attaches a merge request to this review, or takes it off. One per review:
   * a review is of one branch, and a branch's work is one merge request.
   */
  async setReviewMr(
    sessionId: number,
    mr: { iid: number; projectPath: string } | null,
  ): Promise<void> {
    await this.db.run(
      'update sessions set mr_iid = ?, mr_project = ? where id = ?',
      [mr?.iid ?? null, mr?.projectPath ?? null, sessionId],
    )
  }

  /** Puts the base back where it was. One step: it is an undo, not a history. */
  async undoBase(sessionId: number): Promise<Session | undefined> {
    await this.db.run(
      `update sessions
       set base_ref = prev_base_ref, base_sha = prev_base_sha,
           prev_base_ref = base_ref, prev_base_sha = base_sha
       where id = ? and prev_base_ref is not null`,
      [sessionId],
    )
    return this.getSession(sessionId)
  }

  /** Moves the pin, in place: re-pinning continues a review, it does not fork one. */
  async repinSession(sessionId: number, baseSha: string): Promise<void> {
    await this.db.run('update sessions set base_sha = ? where id = ?', [
      baseSha,
      sessionId,
    ])
  }

  /**
   * A review of an unregistered repository reads as gone, the same way its
   * files do: it is not in the workspace, so neither an address nor an agent
   * should reach it. Re-adding the path brings both back.
   */
  async getSession(id: number): Promise<Session | undefined> {
    const row = await this.db.get<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id
       where s.id = ? and r.removed_at is null`,
      [id],
    )
    return row === undefined ? undefined : sessionFromRow(row)
  }

  /** Newest first, so an agent handed no id can take the obvious one. */
  async listSessions(): Promise<Session[]> {
    const rows = await this.db.all<SessionRow>(
      `select s.*, r.path as repo_path from sessions s
       join repos r on r.id = s.repo_id
       where r.removed_at is null order by s.id desc`,
    )
    return rows.map(sessionFromRow)
  }

  /** Puts a review away from the overview, or brings it back. Deletes nothing. */
  async setArchived(
    sessionId: number,
    archived: boolean,
    at = new Date(),
  ): Promise<void> {
    await this.db.run('update sessions set archived_at = ? where id = ?', [
      archived ? at.toISOString() : null,
      sessionId,
    ])
  }

  /** Keeps a review from expiring, or lets it go again. */
  async setKept(sessionId: number, kept: boolean): Promise<void> {
    await this.db.run('update sessions set kept_at = ? where id = ?', [
      kept ? new Date().toISOString() : null,
      sessionId,
    ])
  }

  /** The review was opened: looking at it is using it. */
  async markSeen(sessionId: number): Promise<void> {
    await this.db.run('update sessions set seen_at = ? where id = ?', [
      new Date().toISOString(),
      sessionId,
    ])
  }

  /**
   * Deletes a review with its notes, replies and read marks. Its activity
   * rows stay: they are plain ids, not foreign keys, so the record of what
   * happened outlives what it happened to.
   */
  async deleteSession(sessionId: number): Promise<void> {
    await this.db.run('delete from sessions where id = ?', [sessionId])
  }

  /**
   * What the expiry policy needs about every review, in one query: when it
   * was made, last opened, last had anything recorded, archived and kept, and
   * how many notes it holds.
   *
   * An archive stickie made on its own is left out of "last recorded": it is
   * not anyone using the review, and counting it would restart the clock it
   * was the first step of. One a person made counts, as does bringing it back.
   */
  async expiryFacts(): Promise<ExpiryFacts[]> {
    const rows = await this.db.all<{
      id: number
      repo_id: number
      repo_path: string
      branch: string | null
      created_at: string | Date
      seen_at: string | Date | null
      archived_at: string | Date | null
      kept_at: string | Date | null
      last_at: string | Date | null
      notes: number | string
    }>(
      `select s.id, s.repo_id, r.path as repo_path, s.branch, s.created_at,
         s.seen_at, s.archived_at, s.kept_at,
         (select max(a.at) from activity a
            where a.session_id = s.id
              and not (a.subject = 'review' and a.action = 'archived'
                       and a.actor_id is null)) as last_at,
         (select count(*) from threads t where t.session_id = s.id) as notes
       from sessions s join repos r on r.id = s.repo_id
       where r.removed_at is null`,
    )
    const text = (value: string | Date | null) =>
      value == null ? null : toText(value)
    return rows.map((row) => ({
      sessionId: row.id,
      repoId: row.repo_id,
      repoPath: row.repo_path,
      branch: row.branch,
      createdAt: toText(row.created_at),
      seenAt: text(row.seen_at),
      archivedAt: text(row.archived_at),
      keptAt: text(row.kept_at),
      lastRecordedAt: text(row.last_at),
      notes: Number(row.notes),
    }))
  }

  /**
   * The order this review's notes go into the prompt in. `ids` is the whole
   * arrangement: a note of this review left out of it goes back to following
   * the placed ones by age, and an id of another review's note is ignored.
   */
  async setPromptOrder(sessionId: number, ids: number[]): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        'update threads set prompt_position = null where session_id = ?',
        [sessionId],
      )
      for (const [position, id] of ids.entries()) {
        await this.db.run(
          'update threads set prompt_position = ? where id = ? and session_id = ?',
          [position, id, sessionId],
        )
      }
    })
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
      mrDiscussion?: string
      actorId?: number | null
    } = {},
  ): Promise<Thread> {
    // the note and its first message are one act; a reader must never find a
    // thread with no message in it
    return this.db.transaction(async () => {
      // A number is never handed out twice, so an agent told to address note 2
      // finds note 2 there afterwards whatever has been deleted since. The
      // review's own counter is what guarantees that — max+1 over the notes
      // still present would hand the top number back the moment that note is
      // deleted. The higher of the two is taken so a review from before the
      // counter existed carries on above its notes rather than back at 0.
      // Inside the transaction, which keeps the read and the insert together.
      const seq = await this.db.get<{
        top: number | null
        issued: number | null
      }>(
        `select (select max(number) from threads where session_id = ?) as top,
                (select notes_issued from sessions where id = ?) as issued`,
        [sessionId, sessionId],
      )
      const number = Math.max(
        Number(seq?.issued ?? 0),
        seq?.top == null ? 0 : Number(seq.top) + 1,
      )
      await this.db.run('update sessions set notes_issued = ? where id = ?', [
        number + 1,
        sessionId,
      ])
      const threadId = await this.db.insert(
        `insert into threads (session_id, number, path, side, start_line, end_line, blob_sha, snippet, pending, origin, external_id, mr_discussion, actor_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          number,
          path,
          side,
          startLine,
          endLine,
          blobSha,
          snippet,
          options.pending === true ? this.trueValue : this.falseValue,
          options.origin ?? null,
          options.externalId ?? null,
          options.mrDiscussion ?? null,
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

  /**
   * A note by the number it carries inside its review. Numbers are never
   * reused, so a number no note holds is nothing rather than the next note
   * along — the caller's 404 has to say so.
   */
  async getThreadByNumber(
    sessionId: number,
    number: number,
  ): Promise<Thread | undefined> {
    const row = await this.db.get<ThreadRow>(
      `${thread_select} where t.session_id = ? and t.number = ?`,
      [sessionId, number],
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

  /**
   * Appends to the record. Nothing in this class updates or deletes an
   * activity row; there is deliberately no method to.
   */
  async recordActivity(entry: ActivityInput): Promise<void> {
    await this.db.run(
      `insert into activity
         (actor_id, subject, action, repo_id, session_id, thread_id, message_id, detail)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.actorId ?? null,
        entry.subject,
        entry.action,
        entry.repoId ?? null,
        entry.sessionId ?? null,
        entry.threadId ?? null,
        entry.messageId ?? null,
        entry.detail === undefined ? null : JSON.stringify(entry.detail),
      ],
    )
  }

  /**
   * Per-session rollups for the overview, in a few grouped queries rather than
   * a handful per review: a landing page listing every review in the workspace
   * cannot afford to be N+1, which `listSessions` plus `countOpenThreads` in a
   * loop already was.
   */
  async summarizeSessions(): Promise<Map<number, SessionRollup>> {
    const out = new Map<number, SessionRollup>()
    const at = (id: number): SessionRollup => {
      const found = out.get(id)
      if (found !== undefined) return found
      const fresh: SessionRollup = {
        notes: { total: 0, open: 0, pending: 0, resolved: 0, detached: 0 },
        filesRead: 0,
        agentReplies: 0,
        lastActivityAt: null,
        lastAction: null,
        lastActorName: null,
        awaiting: null,
      }
      out.set(id, fresh)
      return fresh
    }

    const counts = await this.db.all<{
      session_id: number
      total: number
      open: number
      pending: number
      resolved: number
      detached: number
    }>(
      `select session_id,
              count(*) as total,
              sum(case when status = 'open' then 1 else 0 end) as open,
              sum(case when pending = ? then 1 else 0 end) as pending,
              sum(case when status = 'resolved' then 1 else 0 end) as resolved,
              sum(case when status = 'detached' then 1 else 0 end) as detached
       from threads group by session_id`,
      [this.trueValue],
    )
    for (const row of counts) {
      at(row.session_id).notes = {
        total: Number(row.total),
        open: Number(row.open),
        pending: Number(row.pending),
        resolved: Number(row.resolved),
        detached: Number(row.detached),
      }
    }

    const read = await this.db.all<{ session_id: number; n: number }>(
      'select session_id, count(*) as n from viewed_files group by session_id',
    )
    for (const row of read) at(row.session_id).filesRead = Number(row.n)

    // the last message of each open, submitted note decides who it is sitting
    // with: an agent answer nobody has read yet is waiting on the human
    const waiting = await this.db.all<{
      session_id: number
      answered: number
      open_notes: number
    }>(
      `select t.session_id,
              sum(case when m.author = 'agent' then 1 else 0 end) as answered,
              count(*) as open_notes
       from threads t
       join messages m on m.id = (select max(id) from messages where thread_id = t.id)
       where t.status = 'open' and t.pending = ?
       group by t.session_id`,
      [this.falseValue],
    )
    for (const row of waiting) {
      const entry = at(row.session_id)
      entry.awaiting =
        Number(row.answered) > 0
          ? 'you'
          : Number(row.open_notes) > 0
            ? 'agent'
            : null
    }

    const totals = await this.db.all<{
      session_id: number
      replies: number
      last_at: string | Date | null
    }>(
      `select v.session_id,
              sum(case when v.subject = 'note' and v.action = 'replied' and a.kind = 'agent' then 1 else 0 end) as replies,
              max(v.at) as last_at
       from activity v
       left join actors a on a.id = v.actor_id
       where v.session_id is not null
       group by v.session_id`,
    )
    for (const row of totals) {
      const entry = at(row.session_id)
      entry.agentReplies = Number(row.replies)
      entry.lastActivityAt = row.last_at === null ? null : toText(row.last_at)
    }

    // max() over subject and action separately would splice two different rows
    // together, so the newest entry per session is fetched as itself
    const latest = await this.db.all<{
      session_id: number
      subject: string
      action: string
      actor_name: string | null
    }>(
      `select v.session_id, v.subject, v.action, a.name as actor_name
       from activity v
       left join actors a on a.id = v.actor_id
       where v.id in (
         select max(id) from activity where session_id is not null group by session_id
       )`,
    )
    for (const row of latest) {
      const entry = at(row.session_id)
      entry.lastAction = `${row.subject}.${row.action}`
      entry.lastActorName = row.actor_name
    }

    return out
  }

  /**
   * Whether a session already carries one of these. The get-or-create routes
   * are called on every visit, so "has this been recorded once" is what keeps
   * them from writing a row per page load.
   */
  async hasActivity(
    sessionId: number,
    subject: ActivitySubject,
    action: string,
  ): Promise<boolean> {
    const row = await this.db.get<{ id: number }>(
      'select id from activity where session_id = ? and subject = ? and action = ? limit 1',
      [sessionId, subject, action],
    )
    return row !== undefined
  }

  /** Newest first, since that is the order anyone reading it wants. */
  async listActivity(
    where: { sessionId?: number; repoId?: number },
    limit = 200,
  ): Promise<ActivityEntry[]> {
    const clauses: string[] = []
    const params: unknown[] = []
    if (where.sessionId !== undefined) {
      clauses.push('v.session_id = ?')
      params.push(where.sessionId)
    }
    if (where.repoId !== undefined) {
      clauses.push('v.repo_id = ?')
      params.push(where.repoId)
    }
    const filter = clauses.length === 0 ? '' : `where ${clauses.join(' and ')}`
    params.push(limit)
    const rows = await this.db.all<ActivityRow>(
      `select v.*, a.name as actor_name from activity v
       left join actors a on a.id = v.actor_id
       ${filter} order by v.id desc limit ?`,
      params,
    )
    return rows.map(activityFromRow)
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
      number: Number(row.number),
      path: row.path,
      side: row.side as Side,
      startLine: row.start_line,
      endLine: row.end_line,
      snippet: row.snippet,
      blobSha: row.blob_sha,
      status: row.status as ThreadStatus,
      pending: toBool(row.pending),
      origin: row.origin,
      mrDiscussion: row.mr_discussion,
      promptPosition:
        row.prompt_position == null ? null : Number(row.prompt_position),
      createdAt: toText(row.created_at),
      actorName: row.actor_name,
      messages,
    }
  }
}

export interface ExpiryFacts {
  sessionId: number
  repoId: number
  repoPath: string
  branch: string | null
  createdAt: string
  seenAt: string | null
  archivedAt: string | null
  keptAt: string | null
  lastRecordedAt: string | null
  notes: number
}

export interface SessionRollup {
  notes: NoteCounts
  filesRead: number
  agentReplies: number
  lastActivityAt: string | null
  lastAction: string | null
  lastActorName: string | null
  awaiting: 'you' | 'agent' | null
}

interface ActivityRow {
  id: number
  at: string | Date
  subject: string
  action: string
  repo_id: number | null
  session_id: number | null
  thread_id: number | null
  message_id: number | null
  detail: string | null
  actor_name: string | null
}

function activityFromRow(row: ActivityRow): ActivityEntry {
  let detail: Record<string, unknown> | null = null
  if (row.detail !== null) {
    try {
      detail = JSON.parse(row.detail) as Record<string, unknown>
    } catch {
      // a row whose detail cannot be read is still a row that happened
      detail = null
    }
  }
  return {
    id: row.id,
    at: toText(row.at),
    subject: row.subject as ActivitySubject,
    action: row.action,
    actorName: row.actor_name,
    repoId: row.repo_id,
    sessionId: row.session_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    detail,
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
    // a review from before the branch key, which nothing could place; it is
    // reachable by its id and never handed back by a branch lookup
    branch: row.branch ?? '',
    source: {
      kind: row.source_kind as ReviewSource['kind'],
      value: row.source_value,
    },
    baseRef: row.base_ref,
    baseSha: row.base_sha,
    prevBaseRef: row.prev_base_ref,
    mr:
      row.mr_iid == null || row.mr_project == null
        ? null
        : { iid: Number(row.mr_iid), projectPath: row.mr_project },
    archivedAt: row.archived_at == null ? null : toText(row.archived_at),
    keptAt: row.kept_at == null ? null : toText(row.kept_at),
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
