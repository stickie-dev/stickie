import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refPath, watchable, WatchHub } from './watcher.js'

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

describe('a watch that fails', () => {
  /** an fs.watch that refuses until told otherwise */
  function refusingWatch() {
    const control = { refuse: true, calls: 0 }
    const watch = (
      target: string,
      options: { recursive: boolean; persistent: boolean },
    ) => {
      control.calls += 1
      if (control.refuse) {
        throw Object.assign(new Error(`EPERM: operation not permitted, watch '${target}'`), {
          code: 'EPERM',
        })
      }
      return fs.watch(target, options)
    }
    return { control, watch }
  }

  let dir = ''
  let hub: WatchHub
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickie-watch-'))
  })
  afterEach(async () => {
    await hub.close()
    vi.useRealTimers()
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('is reported, retried, and caught up on once it works', async () => {
    const { control, watch } = refusingWatch()
    hub = new WatchHub({ watch })
    const events: unknown[] = []
    hub.onEvent((event) => events.push(event))

    hub.ensureWatch(dir)
    expect(hub.watchProblems()).toEqual([
      expect.objectContaining({ path: dir, what: 'files', code: 'EPERM' }),
    ])
    expect(events).toContainEqual({ type: 'watch', problems: hub.watchProblems() })

    // asked again while failing, it waits for its retry rather than trying now
    hub.ensureWatch(dir)
    expect(control.calls).toBe(1)

    // still refused at the first retry; then it waits twice as long
    await vi.advanceTimersByTimeAsync(5000)
    expect(control.calls).toBe(2)
    control.refuse = false
    await vi.advanceTimersByTimeAsync(9999)
    expect(control.calls).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(control.calls).toBe(3)

    expect(hub.watchProblems()).toEqual([])
    expect(events).toContainEqual({ type: 'watch', problems: [] })
    // what changed while it was not watching was never reported, so the page
    // is told to read the repository again
    expect(events).toContainEqual({ type: 'fs', repoPath: dir, paths: [] })
  })

  it('is not a problem when the folder is gone', () => {
    const { watch } = refusingWatch()
    hub = new WatchHub({ watch })
    hub.ensureWatch(path.join(dir, 'deleted-worktree'))
    expect(hub.watchProblems()).toEqual([])
  })

  it('stops being a problem when its repository is removed', () => {
    const { watch } = refusingWatch()
    hub = new WatchHub({ watch })
    hub.ensureWatch(dir)
    hub.forget(dir)
    expect(hub.watchProblems()).toEqual([])
  })
})
