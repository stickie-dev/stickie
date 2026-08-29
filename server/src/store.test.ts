import { describe, expect, it } from 'vitest'
import { applySchema } from './db/schema.js'
import { openSqlite } from './db/sqlite.js'
import { Store } from './store.js'

async function freshStore(): Promise<Store> {
  const db = openSqlite(':memory:')
  await applySchema(db)
  return new Store(db)
}

describe('Store', () => {
  it('registers a repository once', async () => {
    const store = await freshStore()
    const first = await store.addRepo('/tmp/repo')
    const again = await store.addRepo('/tmp/repo')
    expect(again.id).toBe(first.id)
    expect(await store.listRepos()).toHaveLength(1)
  })

  it('creates a note with its first message in one go', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    const thread = await store.createThread(
      session.id,
      'app/main.py',
      'source',
      4,
      6,
      null,
      'x = 1',
      'user',
      'rename this',
    )
    expect(thread.messages.map((m) => m.body)).toEqual(['rename this'])
    expect(thread.pending).toBe(false)
    expect(thread.createdAt).not.toBe('')
  })

  it('keeps pending notes out of the agent-visible count', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    const note = (pending: boolean) =>
      store.createThread(
        session.id,
        'app/main.py',
        'source',
        1,
        1,
        null,
        'x',
        'user',
        'look',
        { pending },
      )
    await note(true)
    await note(false)
    expect(await store.countOpenThreads(session.id)).toBe(1)
    expect(await store.postPending(session.id)).toBe(1)
    expect(await store.countOpenThreads(session.id)).toBe(2)
  })

  it('keeps every note on the review when its base is re-pinned', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const source = { kind: 'worktree' as const, value: '/tmp/repo' }
    const session = await store.getOrCreateSession(repo.id, source, 'master', 'aaa')
    const kept = await store.createThread(
      session.id, 'a.py', 'source', 1, 1, null, 'x', 'user', 'open one',
    )
    const done = await store.createThread(
      session.id, 'a.py', 'source', 2, 2, null, 'y', 'user', 'closed one',
    )
    await store.setThreadStatus(done.id, 'resolved')
    await store.repinSession(session.id, 'bbb')
    // resolved history stays with the review it belongs to, rather than being
    // left behind on a session nothing opens any more
    expect((await store.listThreads(session.id)).map((t) => t.id)).toEqual([
      kept.id,
      done.id,
    ])
  })

  it('deletes a note with its messages', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    const thread = await store.createThread(
      session.id, 'a.py', 'source', 1, 1, null, 'x', 'user', 'note',
    )
    await store.addMessage(thread.id, 'agent', 'done')
    expect(await store.countMessages(thread.id)).toBe(2)
    await store.deleteThread(thread.id)
    expect(await store.getThread(thread.id)).toBeUndefined()
    expect(await store.countMessages(thread.id)).toBe(0)
  })

  it('round-trips settings and clears them on empty', async () => {
    const store = await freshStore()
    await store.setSetting('gitlab_url', 'https://gitlab.example')
    expect(await store.getSetting('gitlab_url')).toBe('https://gitlab.example')
    await store.setSetting('gitlab_url', '')
    expect(await store.getSetting('gitlab_url')).toBeNull()
  })

  it('tracks viewed files per session', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    await store.setViewed(session.id, 'a.py', true)
    await store.setViewed(session.id, 'a.py', true)
    expect(await store.listViewed(session.id)).toEqual(['a.py'])
    await store.setViewed(session.id, 'a.py', false)
    expect(await store.listViewed(session.id)).toEqual([])
  })
})

describe('Store actors', () => {
  it('returns the same actor for a name it has already seen', async () => {
    const store = await freshStore()
    const first = await store.getOrCreateActor('human', 'Jane Doe', 'jane@doe.com')
    const again = await store.getOrCreateActor('human', 'Jane Doe')
    expect(again.id).toBe(first.id)
    expect(again.email).toBe('jane@doe.com')
    expect(await store.listActors()).toHaveLength(1)
  })

  it('keeps a human and an agent of the same name apart', async () => {
    const store = await freshStore()
    const human = await store.getOrCreateActor('human', 'stickie')
    const agent = await store.getOrCreateActor('agent', 'stickie')
    expect(agent.id).not.toBe(human.id)
    expect(agent.kind).toBe('agent')
  })

  it('carries the actor name onto the thread and every message', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    const human = await store.getOrCreateActor('human', 'Jane Doe')
    const agent = await store.getOrCreateActor('agent', 'claude-code')
    const thread = await store.createThread(
      session.id,
      'a.ts',
      'source',
      1,
      1,
      null,
      'x',
      'user',
      'rename this',
      { actorId: human.id },
    )
    await store.addMessage(thread.id, 'agent', 'done', agent.id)

    const [read] = await store.listThreads(session.id)
    expect(read?.actorName).toBe('Jane Doe')
    expect(read?.messages.map((m) => [m.author, m.actorName])).toEqual([
      ['user', 'Jane Doe'],
      ['agent', 'claude-code'],
    ])
  })

  it('leaves the actor name null when nothing was attributed', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    const thread = await store.createThread(
      session.id,
      'a.ts',
      'source',
      1,
      1,
      null,
      'x',
      'user',
      'imported note',
      { origin: 'gitlab', externalId: 'gl-1' },
    )
    expect(thread.actorName).toBeNull()
    expect(thread.messages[0]?.actorName).toBeNull()
  })
})

describe('Store activity', () => {
  const setup = async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    return { store, repo, session }
  }

  it('appends in order and reads back newest first', async () => {
    const { store, repo, session } = await setup()
    const actor = await store.getOrCreateActor('human', 'Jane Doe')
    for (const action of ['created', 'replied', 'resolved'] as const) {
      await store.recordActivity({
        subject: 'note',
        action,
        actorId: actor.id,
        repoId: repo.id,
        sessionId: session.id,
        threadId: 7,
      })
    }
    const rows = await store.listActivity({ sessionId: session.id })
    expect(rows.map((r) => r.action)).toEqual(['resolved', 'replied', 'created'])
    expect(rows.every((r) => r.actorName === 'Jane Doe')).toBe(true)
  })

  it('round-trips the detail blob', async () => {
    const { store, repo, session } = await setup()
    await store.recordActivity({
      subject: 'review',
      action: 'submitted',
      repoId: repo.id,
      sessionId: session.id,
      detail: { posted: 3, baseSha: 'abc123' },
    })
    const [row] = await store.listActivity({ sessionId: session.id })
    expect(row?.detail).toEqual({ posted: 3, baseSha: 'abc123' })
    expect(row?.actorName).toBeNull()
  })

  it('keeps a row after the note it points at is deleted', async () => {
    const { store, repo, session } = await setup()
    const thread = await store.createThread(
      session.id,
      'a.ts',
      'source',
      1,
      1,
      null,
      'x',
      'user',
      'note',
    )
    await store.recordActivity({
      subject: 'note',
      action: 'created',
      repoId: repo.id,
      sessionId: session.id,
      threadId: thread.id,
      detail: { path: 'a.ts' },
    })
    await store.deleteThread(thread.id)
    const rows = await store.listActivity({ sessionId: session.id })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.threadId).toBe(thread.id)
  })

  it('answers whether a session has already recorded something', async () => {
    const { store, session } = await setup()
    expect(await store.hasActivity(session.id, 'review', 'opened')).toBe(false)
    await store.recordActivity({
      subject: 'review',
      action: 'opened',
      sessionId: session.id,
    })
    expect(await store.hasActivity(session.id, 'review', 'opened')).toBe(true)
    expect(await store.hasActivity(session.id, 'review', 'submitted')).toBe(false)
  })

  it('honours the limit', async () => {
    const { store, session } = await setup()
    for (let i = 0; i < 5; i++) {
      await store.recordActivity({
        subject: 'file',
        action: 'viewed',
        sessionId: session.id,
        detail: { path: `f${String(i)}.ts` },
      })
    }
    expect(await store.listActivity({ sessionId: session.id }, 2)).toHaveLength(2)
  })
})

describe('Store.summarizeSessions', () => {
  const seed = async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    return { store, repo, session }
  }

  const note = (
    store: Awaited<ReturnType<typeof freshStore>>,
    sessionId: number,
    path: string,
    options: { pending?: boolean } = {},
  ) =>
    store.createThread(
      sessionId,
      path,
      'source',
      1,
      1,
      null,
      'x',
      'user',
      'look at this',
      options,
    )

  it('counts notes by status and pending', async () => {
    const { store, session } = await seed()
    const open = await note(store, session.id, 'a.ts')
    await note(store, session.id, 'b.ts', { pending: true })
    const done = await note(store, session.id, 'c.ts')
    await store.setThreadStatus(done.id, 'resolved')

    const summary = (await store.summarizeSessions()).get(session.id)
    expect(summary?.notes).toEqual({
      total: 3,
      open: 2,
      pending: 1,
      resolved: 1,
      detached: 0,
    })
    expect(open.status).toBe('open')
  })

  it('says a review is waiting on you once an agent has answered', async () => {
    const { store, session } = await seed()
    const thread = await note(store, session.id, 'a.ts')
    expect((await store.summarizeSessions()).get(session.id)?.awaiting).toBe(
      'agent',
    )
    await store.addMessage(thread.id, 'agent', 'done')
    expect((await store.summarizeSessions()).get(session.id)?.awaiting).toBe(
      'you',
    )
  })

  it('waits on nobody when every note is resolved', async () => {
    const { store, session } = await seed()
    const thread = await note(store, session.id, 'a.ts')
    await store.setThreadStatus(thread.id, 'resolved')
    expect(
      (await store.summarizeSessions()).get(session.id)?.awaiting,
    ).toBeNull()
  })

  it('ignores pending notes when deciding who is waiting', async () => {
    const { store, session } = await seed()
    await note(store, session.id, 'a.ts', { pending: true })
    expect(
      (await store.summarizeSessions()).get(session.id)?.awaiting,
    ).toBeNull()
  })

  it('counts files read and agent replies, and reports the last action', async () => {
    const { store, repo, session } = await seed()
    const agent = await store.getOrCreateActor('agent', 'claude-code')
    await store.setViewed(session.id, 'a.ts', true)
    await store.setViewed(session.id, 'b.ts', true)
    await store.recordActivity({
      subject: 'note',
      action: 'replied',
      actorId: agent.id,
      repoId: repo.id,
      sessionId: session.id,
    })
    await store.recordActivity({
      subject: 'review',
      action: 'submitted',
      repoId: repo.id,
      sessionId: session.id,
    })

    const summary = (await store.summarizeSessions()).get(session.id)
    expect(summary?.filesRead).toBe(2)
    expect(summary?.agentReplies).toBe(1)
    expect(summary?.lastAction).toBe('review.submitted')
  })

  it('keeps two sessions apart', async () => {
    const { store, repo, session } = await seed()
    const other = await store.getOrCreateSession(
      repo.id,
      { kind: 'ref', value: 'feature/x' },
      'master',
      'def456',
    )
    await note(store, session.id, 'a.ts')
    await note(store, other.id, 'b.ts')
    await note(store, other.id, 'c.ts')
    const summary = await store.summarizeSessions()
    expect(summary.get(session.id)?.notes.total).toBe(1)
    expect(summary.get(other.id)?.notes.total).toBe(2)
  })
})

describe('session identity', () => {
  const open = (
    store: Awaited<ReturnType<typeof freshStore>>,
    repoId: number,
    baseSha: string,
  ) =>
    store.getOrCreateSession(
      repoId,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      baseSha,
    )

  it('is the ref, not the commit the ref pointed at', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const first = await open(store, repo.id, 'aaa')
    // the branch moved and a fresh visit resolved a different merge-base
    const again = await open(store, repo.id, 'bbb')
    expect(again.id).toBe(first.id)
    expect(await store.listSessions()).toHaveLength(1)
  })

  it('keeps a different base ref apart when the commits differ', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const against_master = await open(store, repo.id, 'aaa')
    const against_head = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'HEAD',
      'bbb',
    )
    expect(against_head.id).not.toBe(against_master.id)
  })

  it('keeps two refs apart even when they point at the same commit', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const against_master = await open(store, repo.id, 'aaa')
    const against_head = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'HEAD',
      'aaa',
    )
    expect(against_head.id).not.toBe(against_master.id)
  })

  it('answers with the base a review is pinned to, not the one just resolved', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    await open(store, repo.id, 'aaa')
    // the caller resolved a fresh merge-base; the review keeps its own pin
    expect((await open(store, repo.id, 'zzz')).baseSha).toBe('aaa')
  })

  it('re-pins in place, keeping the notes on the same review', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await open(store, repo.id, 'aaa')
    await store.createThread(
      session.id,
      'a.ts',
      'source',
      1,
      1,
      null,
      'x',
      'user',
      'note',
    )
    await store.repinSession(session.id, 'ccc')
    const after = await store.getSession(session.id)
    expect(after?.baseSha).toBe('ccc')
    expect(await store.listThreads(session.id)).toHaveLength(1)
    expect(await store.listSessions()).toHaveLength(1)
  })
})

describe('taking a repository out of the workspace', () => {
  const withNote = async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const session = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    await store.createThread(
      session.id,
      'a.ts',
      'source',
      1,
      1,
      null,
      'x',
      'user',
      'note',
    )
    return { store, repo, session }
  }

  it('deleting takes the reviews and the notes with it', async () => {
    const { store, repo, session } = await withNote()
    expect(await store.removeRepo(repo.id, 'delete')).toEqual({
      deleted: true,
      notes: 1,
    })
    expect(await store.listRepos()).toHaveLength(0)
    expect(await store.getSession(session.id)).toBeUndefined()
    expect(await store.listThreads(session.id)).toHaveLength(0)
  })

  it('unregistering keeps them, out of reach until the path comes back', async () => {
    const { store, repo, session } = await withNote()
    expect(await store.removeRepo(repo.id, 'unregister')).toEqual({
      deleted: false,
      notes: 1,
    })
    // out of the workspace: not listed, not findable, and neither are its
    // reviews — an address or an agent holding one gets nothing
    expect(await store.listRepos()).toHaveLength(0)
    expect(await store.getRepo(repo.id)).toBeUndefined()
    expect(await store.listSessions()).toHaveLength(0)
    expect(await store.getSession(session.id)).toBeUndefined()
    // but kept: adding the same path back brings all of it again
    const again = await store.addRepo('/tmp/repo')
    expect(again.id).toBe(repo.id)
    expect(await store.getSession(session.id)).toBeDefined()
    expect(await store.listThreads(session.id)).toHaveLength(1)
  })

  it('deletes a repository with no notes whichever is asked for', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/empty')
    expect(await store.removeRepo(repo.id, 'unregister')).toEqual({
      deleted: true,
      notes: 0,
    })
    // deleted, not hidden: a row nobody can see, holding nothing, is worse
    expect(await store.repoByPath('/tmp/empty')).toBeUndefined()
  })
})

describe('numbering notes within a review', () => {
  const note = (store: Store, sessionId: number, body: string) =>
    store.createThread(
      sessionId,
      'a.ts',
      'source',
      1,
      1,
      null,
      'x',
      'user',
      body,
    )

  const twoReviews = async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const first = await store.getOrCreateSession(
      repo.id,
      { kind: 'worktree', value: '/tmp/repo' },
      'master',
      'abc123',
    )
    const second = await store.getOrCreateSession(
      repo.id,
      { kind: 'ref', value: 'feature' },
      'master',
      'abc123',
    )
    return { store, first, second }
  }

  it('counts from 0, per review', async () => {
    const { store, first, second } = await twoReviews()
    expect((await note(store, first.id, 'one')).number).toBe(0)
    expect((await note(store, first.id, 'two')).number).toBe(1)
    // a second review starts again at 0: the number says which note of this
    // review, not which note of the database
    expect((await note(store, second.id, 'one')).number).toBe(0)
    expect((await note(store, first.id, 'three')).number).toBe(2)
  })

  it('never reuses a number a deleted note held', async () => {
    const { store, first } = await twoReviews()
    await note(store, first.id, 'one')
    const second_note = await note(store, first.id, 'two')
    await store.deleteThread(second_note.id)
    // 2, not 1: an agent told to address note 1 must not find a different
    // note there afterwards
    expect((await note(store, first.id, 'three')).number).toBe(2)
  })

  it('finds a note by its number, and nothing at a number no note holds', async () => {
    const { store, first, second } = await twoReviews()
    const raised = await note(store, first.id, 'one')
    const found = await store.getThreadByNumber(first.id, 0)
    expect(found?.id).toBe(raised.id)
    expect(await store.getThreadByNumber(second.id, 0)).toBeUndefined()
    expect(await store.getThreadByNumber(first.id, 1)).toBeUndefined()
  })
})
