import { describe, expect, it } from 'vitest'
import {
  discussionsToNotes,
  discussionsToThreads,
  parseMrRef,
  projectFromRemote,
  signReply,
} from './gitlab.js'

describe('projectFromRemote', () => {
  it('parses ssh remotes', () => {
    expect(projectFromRemote('git@gitlab.example.com:group/proj.git')).toBe(
      'group/proj',
    )
  })

  it('parses https remotes with subgroups', () => {
    expect(
      projectFromRemote('https://gitlab.example.com/group/sub/proj.git'),
    ).toBe('group/sub/proj')
  })

  it('rejects garbage', () => {
    expect(projectFromRemote('not a remote')).toBeNull()
  })
})

describe('parseMrRef', () => {
  it('accepts bare and bang-prefixed iids', () => {
    expect(parseMrRef('123')).toEqual({ iid: 123, projectPath: null })
    expect(parseMrRef('!123')).toEqual({ iid: 123, projectPath: null })
  })

  it('extracts project and iid from full URLs', () => {
    expect(
      parseMrRef('https://gitlab.example.com/group/proj/-/merge_requests/42'),
    ).toEqual({ iid: 42, projectPath: 'group/proj' })
  })

  it('rejects other text', () => {
    expect(parseMrRef('branch-name')).toBeNull()
  })
})

describe('discussionsToNotes', () => {
  it('keeps unresolved diff discussions and joins authors', () => {
    const notes = discussionsToNotes([
      {
        id: 'abc',
        notes: [
          {
            resolvable: true,
            resolved: false,
            body: 'rename this',
            author: { username: 'jane' },
            position: { new_path: 'src/a.py', new_line: 7 },
          },
          { body: 'agree', author: { username: 'colleague' } },
        ],
      },
      {
        id: 'resolved',
        notes: [
          {
            resolvable: true,
            resolved: true,
            body: 'done already',
            position: { new_path: 'src/a.py', new_line: 9 },
          },
        ],
      },
      {
        id: 'general-comment',
        notes: [{ resolvable: false, body: 'nice MR' }],
      },
    ])
    expect(notes).toEqual([
      {
        externalId: 'abc',
        path: 'src/a.py',
        side: 'source',
        line: 7,
        messages: ['jane: rename this', 'colleague: agree'],
      },
    ])
  })

  it('maps deleted-line positions to the base side', () => {
    const notes = discussionsToNotes([
      {
        id: 'old',
        notes: [
          {
            resolvable: true,
            body: 'why removed?',
            position: { old_path: 'src/b.py', old_line: 12, new_line: null },
          },
        ],
      },
    ])
    expect(notes[0]?.side).toBe('base')
    expect(notes[0]?.line).toBe(12)
  })
})

describe('signReply', () => {
  it('says a person wrote it, and that it came through stickie', () => {
    const signed = signReply('looks right to me', 'user', 'Jane Doe')
    expect(signed).toContain('**Jane Doe**')
    expect(signed).toContain('via stickie')
    expect(signed).toContain('looks right to me')
  })

  it('says plainly when an agent wrote it', () => {
    const signed = signReply('renamed the field', 'agent', 'claude-code')
    // whoever reads this on the MR was not here; the one thing they must not
    // have to guess is whether a person wrote it
    expect(signed).toContain('🤖 claude-code')
    expect(signed).toContain('replied by an agent')
  })

  it('still signs an agent that did not name itself', () => {
    expect(signReply('done', 'agent', null)).toContain('🤖 agent')
  })
})

describe('discussionsToThreads', () => {
  const discussion = (over: Record<string, unknown> = {}) => ({
    id: 'abc123',
    notes: [
      {
        body: 'this needs a test',
        author: { username: 'colleague' },
        created_at: '2026-09-10T10:00:00Z',
        resolvable: true,
        resolved: false,
        position: { new_path: 'src/app.py', new_line: 12 },
        ...over,
      },
    ],
  })

  it('keeps where in the diff a discussion hangs', () => {
    const [thread] = discussionsToThreads([discussion()])
    expect(thread).toMatchObject({
      id: 'abc123',
      path: 'src/app.py',
      side: 'source',
      line: 12,
      resolved: false,
    })
    expect(thread?.messages[0]).toMatchObject({
      author: 'colleague',
      body: 'this needs a test',
    })
  })

  it('keeps resolved ones too, unlike the import it replaces', () => {
    // the tab shows the conversation, and half a conversation is not one
    const [thread] = discussionsToThreads([discussion({ resolved: true })])
    expect(thread?.resolved).toBe(true)
  })

  it('keeps a discussion that hangs on nothing, as a comment on the MR', () => {
    const [thread] = discussionsToThreads([
      discussion({ position: undefined, resolvable: false }),
    ])
    expect(thread?.path).toBe(null)
    expect(thread?.line).toBe(null)
  })

  it('reads an old-side discussion from the old side', () => {
    const [thread] = discussionsToThreads([
      discussion({ position: { old_path: 'src/gone.py', old_line: 4 } }),
    ])
    expect(thread).toMatchObject({ path: 'src/gone.py', side: 'base', line: 4 })
  })

  it('drops the system notes nobody wrote', () => {
    expect(
      discussionsToThreads([{ id: 'x', notes: [{ system: true, body: 'changed the title' }] }]),
    ).toEqual([])
  })
})
