import { describe, expect, it } from 'vitest'
import {
  parseNameStatus,
  parseWorktrees,
  shortenRev,
  shortSha,
} from './git.js'

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

describe('shortenRev', () => {
  const sha = 'b5d063d60fc4cd1a2cc1e52732570e71f61ebcca'

  it('shortens a full sha to eight characters', () => {
    expect(shortenRev(sha)).toBe('b5d063d6')
  })

  it('keeps git parent suffixes', () => {
    expect(shortenRev(`${sha}^`)).toBe('b5d063d6^')
    expect(shortenRev(`${sha}^^`)).toBe('b5d063d6^^')
  })

  it('leaves anything that is not a full sha alone', () => {
    expect(shortenRev('main')).toBeNull()
    expect(shortenRev('HEAD')).toBeNull()
    expect(shortenRev('feature/b5d063d6')).toBeNull()
    expect(shortenRev(sha.slice(0, 12))).toBeNull()
  })
})

describe('shortSha', () => {
  it('shows the same amount everywhere', () => {
    expect(shortSha('c45e78221bb7009e8e54c6598f6530a04cd992b2')).toBe('c45e7822')
    expect(shortSha('c45e78221bb7009e8e54c6598f6530a04cd992b2')).toHaveLength(8)
  })

  it('agrees with what shortenRev abbreviates to', () => {
    const sha = 'c45e78221bb7009e8e54c6598f6530a04cd992b2'
    expect(shortenRev(sha)).toBe(shortSha(sha))
  })
})
