import { describe, expect, it } from 'vitest'
import type { WatchProblem } from '@stickie/shared'
import { liveHint, liveState } from './watchHint'

const refused: WatchProblem = {
  path: '/Users/me/Documents/api',
  what: 'files',
  code: 'EPERM',
  message: "EPERM: operation not permitted, watch '/Users/me/Documents/api'",
}

describe('the live dot', () => {
  it('is red when the page has lost the server, whatever else is wrong', () => {
    expect(liveState(false, [refused])).toBe('disconnected')
    expect(liveHint(false, [], true)).toMatch(/reconnects by itself/)
    expect(liveHint(false, [], true)).toMatch(/start stickie again/)
  })

  it('is amber when connected but a watch is down', () => {
    expect(liveState(true, [refused])).toBe('not-watching')
  })

  it('is green only when connected and nothing is unwatched', () => {
    expect(liveState(true, [])).toBe('watching')
  })

  it('names the repository, the cause and the fix', () => {
    const hint = liveHint(true, [refused], true)
    expect(hint).toMatch(/^not watching a repository/)
    expect(hint).toMatch(/api: its files — stickie is not allowed to read that folder/)
    expect(hint).toMatch(/to fix: .*Privacy & Security/)
    expect(hint).toMatch(/reload \(top bar\) catches up now/)
  })

  it('gives each fix once, however many repositories need it', () => {
    const other = { ...refused, path: '/Users/me/Documents/web' }
    const hint = liveHint(true, [refused, other], true)
    expect(hint).toMatch(/^not watching 2 repositories/)
    expect(hint.match(/to fix:/g)).toHaveLength(1)
  })

  it('counts a repository once when its files and its refs both failed', () => {
    const refs: WatchProblem = { ...refused, what: 'refs' }
    const hint = liveHint(true, [refused, refs], true)
    expect(hint).toMatch(/^not watching a repository/)
    expect(hint).toMatch(
      /api: its files and its branches and commits — stickie is not allowed to read that folder\n/,
    )
  })

  it('says what the system said when it has no better advice', () => {
    const odd: WatchProblem = { ...refused, what: 'refs', code: 'EIO', message: 'i/o error' }
    const hint = liveHint(true, [odd], false)
    expect(hint).toMatch(/api: its branches and commits — EIO: i\/o error/)
    expect(hint).not.toMatch(/to fix:/)
  })
})
