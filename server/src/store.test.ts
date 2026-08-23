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

  it('carries unresolved notes to a re-pinned session', async () => {
    const store = await freshStore()
    const repo = await store.addRepo('/tmp/repo')
    const source = { kind: 'worktree' as const, value: '/tmp/repo' }
    const before = await store.getOrCreateSession(repo.id, source, 'master', 'aaa')
    const kept = await store.createThread(
      before.id, 'a.py', 'source', 1, 1, null, 'x', 'user', 'open one',
    )
    const done = await store.createThread(
      before.id, 'a.py', 'source', 2, 2, null, 'y', 'user', 'closed one',
    )
    await store.setThreadStatus(done.id, 'resolved')
    const after = await store.getOrCreateSession(repo.id, source, 'master', 'bbb')
    expect(await store.moveOpenThreads(before.id, after.id)).toBe(1)
    expect((await store.listThreads(after.id)).map((t) => t.id)).toEqual([
      kept.id,
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
