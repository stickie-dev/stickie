import { describe, expect, it } from 'vitest'
import { parseNameStatus, parseWorktrees } from './git.js'

describe('parseNameStatus', () => {
  it('maps status letters', () => {
    const out = ['M\tsrc/a.py', 'A\tsrc/b.py', 'D\tsrc/c.py'].join('\n')
    expect(parseNameStatus(out)).toEqual([
      { path: 'src/a.py', status: 'modified' },
      { path: 'src/b.py', status: 'added' },
      { path: 'src/c.py', status: 'deleted' },
    ])
  })

  it('handles renames with similarity score', () => {
    expect(parseNameStatus('R087\told.py\tnew.py')).toEqual([
      { path: 'new.py', oldPath: 'old.py', status: 'renamed' },
    ])
  })

  it('returns empty for empty output', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('parseWorktrees', () => {
  it('parses porcelain blocks and flags the main worktree', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD aaaa',
      'branch refs/heads/master',
      '',
      'worktree /repo/.worktrees/fix',
      'HEAD bbbb',
      'branch refs/heads/hotfix',
      '',
      'worktree /repo/.worktrees/detached',
      'HEAD cccc',
      'detached',
      '',
    ].join('\n')
    expect(parseWorktrees(porcelain, '/repo')).toEqual([
      { path: '/repo', head: 'aaaa', branch: 'master', isMain: true },
      {
        path: '/repo/.worktrees/fix',
        head: 'bbbb',
        branch: 'hotfix',
        isMain: false,
      },
      {
        path: '/repo/.worktrees/detached',
        head: 'cccc',
        branch: null,
        isMain: false,
      },
    ])
  })
})
