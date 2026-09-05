import { describe, expect, it } from 'vitest'
import type { Session, Thread } from '@stickie/shared'
import type { ReviewListing } from './export.js'
import {
  buildPrompt,
  fenceLanguage,
  filterReviews,
  parseRefs,
  renderReviewList,
} from './export.js'

describe('parseRefs', () => {
  it('finds @-prefixed single-line and range refs', () => {
    expect(
      parseRefs('same bug as @src/parser.py:L42 and @lib/util.ts:L10-L20'),
    ).toEqual([
      { repo: null, path: 'src/parser.py', startLine: 42, endLine: 42 },
      { repo: null, path: 'lib/util.ts', startLine: 10, endLine: 20 },
    ])
  })

  it('accepts L10-20 shorthand for ranges', () => {
    expect(parseRefs('see @a/b.py:L10-12')).toEqual([
      { repo: null, path: 'a/b.py', startLine: 10, endLine: 12 },
    ])
  })

  it('parses repo-prefixed cross-repo refs', () => {
    expect(parseRefs('pattern in @orbit-lib:src/jobs/tasks.py:L40-L60')).toEqual([
      {
        repo: 'orbit-lib',
        path: 'src/jobs/tasks.py',
        startLine: 40,
        endLine: 60,
      },
    ])
  })

  it('leaves bare paths as free text', () => {
    expect(parseRefs('mentioned in src/parser.py:L42 casually')).toEqual([])
  })

  it('ignores inverted ranges and plain prose', () => {
    expect(parseRefs('broken @x.py:L9-L3 and nothing else here')).toEqual([])
  })
})

describe('fenceLanguage', () => {
  it('maps extensions to markdown info strings', () => {
    expect(fenceLanguage('app/main.py')).toBe('python')
    expect(fenceLanguage('deploy/values.yml')).toBe('yaml')
    expect(fenceLanguage('src/store.ts')).toBe('typescript')
  })

  it('recognises files named without an extension', () => {
    expect(fenceLanguage('docker/Dockerfile')).toBe('dockerfile')
  })

  it('stays empty for anything unknown', () => {
    expect(fenceLanguage('data/blob.xyz')).toBe('')
    expect(fenceLanguage('LICENSE')).toBe('')
  })
})

const session: Session = {
  id: 1,
  repoId: 1,
  repoPath: '/repo',
  branch: 'master',
  source: { kind: 'worktree', value: '/repo' },
  baseRef: 'master',
  baseSha: 'abcdef1234',
}

function thread(over: Partial<Thread>): Thread {
  return {
    id: 1,
    sessionId: 1,
    number: 0,
    path: 'app/main.py',
    side: 'source',
    startLine: 4,
    endLine: 4,
    snippet: 'x = 1',
    blobSha: 'ab12cd34ef56ab78cd90',
    status: 'open',
    pending: false,
    origin: null,
    createdAt: '2026-08-22 10:00:00',
    actorName: null,
    messages: [
      { id: 1, author: 'user', body: 'rename this', createdAt: '', actorName: null },
    ],
    ...over,
  }
}

const noSource = async () => null

describe('buildPrompt', () => {
  it('tags snippet fences with the file language', async () => {
    const text = await buildPrompt(session, [thread({})], 'http://x', noSource)
    expect(text).toContain('```python')
  })

  it('reports an unanchored note by its scope instead of a line', async () => {
    const whole_file = thread({
      id: 2,
      number: 1,
      startLine: 0,
      endLine: 0,
      snippet: '',
    })
    const review = thread({
      id: 3,
      number: 2,
      path: '',
      startLine: 0,
      endLine: 0,
      snippet: '',
    })
    const text = await buildPrompt(
      session,
      [whole_file, review],
      'http://x',
      noSource,
    )
    expect(text).toContain('](http://x/r/1/n/1) — app/main.py (whole file)')
    expect(text).toContain('](http://x/r/1/n/2) — whole review')
    expect(text).not.toContain('Code at capture time')
  })

  it('marks notes that are still in the pending batch', async () => {
    const text = await buildPrompt(
      session,
      [thread({ pending: true })],
      'http://x',
      noSource,
    )
    expect(text).toContain('[not yet submitted]')
  })

  it('substitutes the api address into the instructions', async () => {
    const text = await buildPrompt(
      session,
      [thread({})],
      'http://localhost:4899',
      noSource,
      'reply at {api}/api/threads/<id>/reply',
    )
    expect(text).toContain('reply at http://localhost:4899/api/threads/<id>/reply')
  })
})

describe('the heading of a note', () => {
  it('names the blob the code came from, so it can be read back', async () => {
    const text = await buildPrompt(session, [thread({})], 'http://x', noSource)
    expect(text).toContain('## [note 0](http://x/r/1/n/0) — app/main.py:L4 @ blob ab12cd34')
  })

  it('says nothing about a blob for a note with no code', async () => {
    const whole_file = thread({ startLine: 0, endLine: 0, snippet: '' })
    const text = await buildPrompt(session, [whole_file], 'http://x', noSource)
    expect(text).toContain('## [note 0](http://x/r/1/n/0) — app/main.py (whole file)')
    expect(text).not.toContain('blob')
  })

  it('counts within the review, not across the database', async () => {
    // the number an agent is told to act on, and the row id it must never be
    // handed: a review of thirteen notes reads 0..12, whatever the ids are
    const text = await buildPrompt(
      session,
      [thread({ id: 34, number: 3 })],
      'http://x',
      noSource,
    )
    expect(text).toContain('## [note 3]')
    expect(text).not.toContain('note 34')
  })

  it('names the review, since the instructions cannot be followed without it', async () => {
    const text = await buildPrompt(session, [thread({})], 'http://x', noSource)
    expect(text).toContain('Review 1 — /repo')
  })

  it('no longer claims a capture time it cannot substantiate', async () => {
    const text = await buildPrompt(session, [thread({})], 'http://x', noSource)
    expect(text).not.toContain('Code at capture time')
  })
})

describe('filterReviews', () => {
  const listing = (
    id: number,
    over: Partial<Session>,
    openNotes = 0,
  ): ReviewListing => ({
    session: { ...session, id, ...over },
    openNotes,
  })

  const all = [
    listing(1, {
      repoPath: '/src/orbit-api',
      branch: 'master',
      source: { kind: 'worktree', value: '/src/orbit-api' },
    }),
    listing(
      2,
      {
        repoPath: '/src/orbit-api',
        branch: 'feature/per-item-errors',
        source: { kind: 'worktree', value: '/src/orbit-api/.worktrees/x' },
      },
      3,
    ),
    listing(3, {
      repoPath: '/src/orbit-lib',
      branch: 'master',
      source: { kind: 'ref', value: 'master' },
    }),
  ]

  const ids = (rows: ReviewListing[]) => rows.map((r) => r.session.id)

  it('keeps everything when nothing is asked', () => {
    expect(ids(filterReviews(all, {}))).toEqual([1, 2, 3])
  })

  it('matches a repository on part of its name', () => {
    expect(ids(filterReviews(all, { repo: 'lib' }))).toEqual([3])
  })

  it('matches on a worktree path, which is where an agent actually is', () => {
    // the worktree's path is the review's source, not the repository's path
    expect(ids(filterReviews(all, { repo: '.worktrees/x' }))).toEqual([2])
  })

  it('ignores case and surrounding space', () => {
    expect(ids(filterReviews(all, { repo: '  Orbit-API ' }))).toEqual([1, 2])
  })

  it('matches part of a branch name', () => {
    expect(ids(filterReviews(all, { branch: 'per-item' }))).toEqual([2])
  })

  it('combines the filters', () => {
    expect(ids(filterReviews(all, { repo: 'api', branch: 'master' }))).toEqual([1])
  })

  it('keeps only what has notes waiting', () => {
    expect(ids(filterReviews(all, { withNotes: true }))).toEqual([2])
  })

  it('answers with nothing when nothing matches', () => {
    expect(filterReviews(all, { repo: 'no-such-repo' })).toEqual([])
  })
})

describe('renderReviewList', () => {
  it('repeats the key on every line rather than heading a table', () => {
    const text = renderReviewList([
      {
        session: {
          ...session,
          id: 631,
          repoPath: '/src/orbit-api',
          branch: 'feature/x',
        },
        openNotes: 2,
      },
    ])
    expect(text).toContain('- review: 631')
    expect(text).toContain('  repo: orbit-api')
    expect(text).toContain('  branch: feature/x')
    expect(text).toContain('  unresolved: 2')
    // the full path as well as the name: one is for reading, one for matching
    expect(text).toContain('  path: /src/orbit-api')
  })

  it('says so, and how to widen it, when a filter matches nothing', () => {
    expect(renderReviewList([])).toContain('Omit the filters')
  })
})
