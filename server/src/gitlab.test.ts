import { describe, expect, it } from 'vitest'
import { discussionsToNotes, parseMrRef, projectFromRemote } from './gitlab.js'

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
