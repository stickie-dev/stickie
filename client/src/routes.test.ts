import { describe, expect, it } from 'vitest'
import type { Page } from './routes'
import { formatRoute, isReviewRoute, parseRoute, sameTab } from './routes'

describe('parseRoute', () => {
  it('reads the root as home', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' })
    expect(parseRoute('')).toEqual({ kind: 'home' })
  })

  it('reads a settings section, defaulting a bare /settings', () => {
    expect(parseRoute('/settings/gitlab')).toEqual({
      kind: 'settings',
      section: 'gitlab',
    })
    expect(parseRoute('/settings')).toEqual({
      kind: 'settings',
      section: 'identity',
    })
  })

  it('rejects a settings section it does not serve', () => {
    expect(parseRoute('/settings/nope')).toBeNull()
    expect(parseRoute('/settings/gitlab/extra')).toBeNull()
  })

  it('reads the diff and commits tabs', () => {
    expect(parseRoute('/r/3/diff')).toEqual({
      kind: 'review',
      repoId: 3,
      tab: { kind: 'diff' },
    })
    expect(parseRoute('/r/3')).toEqual({
      kind: 'review',
      repoId: 3,
      tab: { kind: 'diff' },
    })
    expect(parseRoute('/r/3/commits')).toEqual({
      kind: 'review',
      repoId: 3,
      tab: { kind: 'commits' },
    })
  })

  it('reads a file tab with its line and side', () => {
    expect(parseRoute('/r/12/file/src/db/store.ts', '?line=42&side=base')).toEqual(
      {
        kind: 'review',
        repoId: 12,
        tab: { kind: 'file', path: 'src/db/store.ts', line: 42, side: 'base' },
      },
    )
  })

  it('leaves line and side out when the query is junk', () => {
    expect(parseRoute('/r/1/file/a.ts', '?line=0&side=both')).toEqual({
      kind: 'review',
      repoId: 1,
      tab: { kind: 'file', path: 'a.ts' },
    })
  })

  it('decodes path segments', () => {
    expect(parseRoute('/r/1/file/src/a%20b/c%23d.ts')).toEqual({
      kind: 'review',
      repoId: 1,
      tab: { kind: 'file', path: 'src/a b/c#d.ts' },
    })
  })

  it('rejects a traversal or an empty segment in a file path', () => {
    expect(parseRoute('/r/1/file/../etc/passwd')).toBeNull()
    expect(parseRoute('/r/1/file/')).toBeNull()
  })

  it('rejects a repo id that is not a positive integer', () => {
    expect(parseRoute('/r/0/diff')).toBeNull()
    expect(parseRoute('/r/3x/diff')).toBeNull()
    expect(parseRoute('/r/-1/diff')).toBeNull()
  })

  it('rejects an unknown page', () => {
    expect(parseRoute('/elsewhere')).toBeNull()
    expect(parseRoute('/r/1/timeline')).toBeNull()
  })
})

describe('formatRoute', () => {
  const cases: [Page, string][] = [
    [{ kind: 'home' }, '/'],
    [{ kind: 'settings', section: 'agents' }, '/settings/agents'],
    [{ kind: 'review', repoId: 3, tab: { kind: 'diff' } }, '/r/3/diff'],
    [{ kind: 'review', repoId: 3, tab: { kind: 'commits' } }, '/r/3/commits'],
    [
      { kind: 'review', repoId: 3, tab: { kind: 'file', path: 'src/a.ts' } },
      '/r/3/file/src/a.ts',
    ],
    [
      {
        kind: 'review',
        repoId: 3,
        tab: { kind: 'file', path: 'src/a b.ts', line: 7, side: 'source' },
      },
      '/r/3/file/src/a%20b.ts?line=7&side=source',
    ],
  ]

  for (const [page, path] of cases) {
    it(`writes ${path}`, () => {
      expect(formatRoute(page)).toBe(path)
    })
  }

  it('round-trips every address it writes', () => {
    for (const [page, path] of cases) {
      const [pathname, search] = path.split('?')
      expect(parseRoute(pathname ?? '/', search ?? '')).toEqual(page)
    }
  })
})

describe('isReviewRoute', () => {
  it('is true only for the review workspace', () => {
    expect(isReviewRoute({ kind: 'review', repoId: 1, tab: { kind: 'diff' } })).toBe(
      true,
    )
    expect(isReviewRoute({ kind: 'home' })).toBe(false)
    expect(isReviewRoute(null)).toBe(false)
  })
})

describe('sameTab', () => {
  it('matches by kind', () => {
    expect(sameTab({ kind: 'diff' }, { kind: 'diff' })).toBe(true)
    expect(sameTab({ kind: 'diff' }, { kind: 'commits' })).toBe(false)
  })

  it('matches file tabs by path, ignoring line and side', () => {
    expect(
      sameTab(
        { kind: 'file', path: 'a.ts' },
        { kind: 'file', path: 'a.ts', line: 9, side: 'base' },
      ),
    ).toBe(true)
    expect(
      sameTab({ kind: 'file', path: 'a.ts' }, { kind: 'file', path: 'b.ts' }),
    ).toBe(false)
  })
})

describe('a note address', () => {
  it('reads as a note, not as a tab', () => {
    expect(parseRoute('/r/1/t/7')).toEqual({
      kind: 'note',
      repoId: 1,
      threadId: 7,
    })
  })

  it('writes and reads back the same', () => {
    const page: Page = { kind: 'note', repoId: 3, threadId: 12 }
    expect(formatRoute(page)).toBe('/r/3/t/12')
    expect(parseRoute('/r/3/t/12')).toEqual(page)
  })

  it('rejects a thread id that is not a positive integer', () => {
    expect(parseRoute('/r/1/t/0')).toBeNull()
    expect(parseRoute('/r/1/t/abc')).toBeNull()
    expect(parseRoute('/r/1/t')).toBeNull()
    expect(parseRoute('/r/1/t/7/extra')).toBeNull()
  })

  it('keeps the workspace on screen while it resolves', () => {
    expect(isReviewRoute({ kind: 'note', repoId: 1, threadId: 7 })).toBe(true)
  })
})
