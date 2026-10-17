import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  orderWorktrees,
  parseLeftRight,
  parseNameStatus,
  parseRefNames,
  parseWorktrees,
  shortSha,
  shortenRev,
  workingTreeStatus,
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

describe('parseRefNames', () => {
  it('reads one name per line', () => {
    expect(parseRefNames('main\nfeature\nfix/thing\n')).toEqual([
      'main',
      'feature',
      'fix/thing',
    ])
  })

  it('drops the marker git puts on the checked-out branch', () => {
    // `--format` is meant to suppress it and does not in every git; a branch
    // read as "* main" matches nothing and reads as deleted
    expect(parseRefNames('* main\n  feature\n+ shared\n')).toEqual([
      'main',
      'feature',
      'shared',
    ])
  })

  it('drops a symbolic ref rather than taking it for a branch', () => {
    expect(parseRefNames('main\norigin/HEAD -> origin/main\n')).toEqual([
      'main',
    ])
  })

  it('returns nothing for empty output', () => {
    expect(parseRefNames('')).toEqual([])
  })
})

describe('orderWorktrees', () => {
  const wt = (path: string, head: string, branch: string | null) => ({
    path,
    head,
    branch,
    isMain: path === '/repo',
  })

  it('puts the newest checkout first and detached ones last', () => {
    const list = [
      wt('/repo', 'aaaa', 'master'),
      wt('/repo/.worktrees/alpha', 'bbbb', 'alpha'),
      wt('/repo/.worktrees/zeta', 'cccc', 'zeta'),
      wt('/repo/.worktrees/spike', 'dddd', null),
    ]
    const dates = new Map([
      ['aaaa', '2026-09-01T10:00:00+02:00'],
      ['bbbb', '2026-09-20T10:00:00+02:00'],
      ['cccc', '2026-09-28T10:00:00+02:00'],
      // newer than every attached one, and still sorted after them
      ['dddd', '2026-09-29T10:00:00+02:00'],
    ])
    expect(orderWorktrees(list, dates).map((w) => w.path)).toEqual([
      '/repo/.worktrees/zeta',
      '/repo/.worktrees/alpha',
      '/repo',
      '/repo/.worktrees/spike',
    ])
  })

  it('keeps a worktree git gave no date for, as the oldest of its kind', () => {
    const list = [
      wt('/repo/.worktrees/unknown', 'eeee', 'unknown'),
      wt('/repo', 'aaaa', 'master'),
    ]
    const dates = new Map([['aaaa', '2026-09-01T10:00:00+02:00']])
    expect(orderWorktrees(list, dates).map((w) => w.path)).toEqual([
      '/repo',
      '/repo/.worktrees/unknown',
    ])
  })

  it('orders two checkouts of the same commit by path, not by chance', () => {
    const list = [
      wt('/repo/.worktrees/b', 'aaaa', 'b'),
      wt('/repo/.worktrees/a', 'aaaa', 'a'),
    ]
    const dates = new Map([['aaaa', '2026-09-01T10:00:00+02:00']])
    expect(orderWorktrees(list, dates).map((w) => w.path)).toEqual([
      '/repo/.worktrees/a',
      '/repo/.worktrees/b',
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

describe('parseLeftRight', () => {
  it('reads what each side has that the other lacks', () => {
    expect(parseLeftRight('2\t5\n')).toEqual({ ahead: 2, behind: 5 })
    expect(parseLeftRight('0 0')).toEqual({ ahead: 0, behind: 0 })
  })

  it('gives up on anything that is not two counts', () => {
    expect(parseLeftRight('')).toBeNull()
    expect(parseLeftRight('fatal: bad revision')).toBeNull()
  })
})

describe('workingTreeStatus', () => {
  it('reads a repository that is there', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickie-git-'))
    execFileSync('git', ['init', '-q', '-b', 'main', dir])
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
    const status = await workingTreeStatus(dir)
    expect([status.missing, status.branch, status.changedFiles]).toEqual([false, 'main', 1])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('says a folder that has gone is missing, rather than failing', async () => {
    const dir = path.join(os.tmpdir(), `stickie-gone-${String(process.pid)}`)
    const status = await workingTreeStatus(dir)
    expect([status.missing, status.branch, status.clean]).toEqual([true, '', true])
  })
})
