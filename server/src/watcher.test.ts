import { describe, expect, it } from 'vitest'
import { refPath, watchable } from './watcher.js'

describe('what a repository watch reports', () => {
  it('reports source files, however deep', () => {
    expect(watchable('app.py')).toBe(true)
    expect(watchable('app/jobs/batch/manager.py')).toBe(true)
  })

  it('says nothing about churn that cannot change a diff', () => {
    expect(watchable('node_modules/react/index.js')).toBe(false)
    expect(watchable('.git/index')).toBe(false)
    expect(watchable('app/__pycache__/main.cpython-312.pyc')).toBe(false)
    expect(watchable('coverage/lcov-report/index.html')).toBe(false)
  })

  it('ignores another checkout of the same repository living inside it', () => {
    // one of these holds 3,385 files; watching them from the parent is what
    // took the descriptor count to 8,300 and made every git call slow
    expect(watchable('.worktrees/lazy-import/app/main.py')).toBe(
      false,
    )
    expect(watchable('.claude/worktrees/funny-hypatia/app.py')).toBe(false)
  })

  it('ignores the repository root itself, which is not a change', () => {
    expect(watchable('')).toBe(false)
  })
})

describe('what a refs watch reports', () => {
  it('reports a branch, a tag, a remote branch and the packed refs', () => {
    expect(refPath('refs/heads/main')).toBe(true)
    expect(refPath('refs/heads/feature/x')).toBe(true)
    expect(refPath('refs/remotes/origin/main')).toBe(true)
    expect(refPath('refs/tags/v1')).toBe(true)
    expect(refPath('packed-refs')).toBe(true)
  })

  it('reports a checkout, a linked worktree moving, and a fetch', () => {
    expect(refPath('HEAD')).toBe(true)
    expect(refPath('worktrees/feature/HEAD')).toBe(true)
    expect(refPath('FETCH_HEAD')).toBe(true)
  })

  it('ignores what churns on every operation', () => {
    expect(refPath('objects/ab/cdef')).toBe(false)
    expect(refPath('index')).toBe(false)
    expect(refPath('logs/HEAD')).toBe(false)
    expect(refPath('refs/heads/main.lock')).toBe(false)
    expect(refPath('worktrees/feature/index')).toBe(false)
  })
})
