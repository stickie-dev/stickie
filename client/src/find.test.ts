import { describe, expect, it } from 'vitest'
import { fileCount, findMatches } from './find'

const hay = (path: string, content: string) =>
  ({ path, side: 'source', content }) as const

describe('finding text across a diff', () => {
  it('finds every occurrence on a line, not just the first', () => {
    const { matches } = findMatches([hay('a.ts', 'foo foo bar foo')], 'foo', false)
    expect(matches.map((m) => m.column)).toEqual([1, 5, 13])
  })

  it('reads file by file, then down the lines', () => {
    const { matches } = findMatches(
      [hay('a.ts', 'x\nneedle'), hay('b.ts', 'needle')],
      'needle',
      false,
    )
    expect(matches.map((m) => [m.path, m.line])).toEqual([
      ['a.ts', 2],
      ['b.ts', 1],
    ])
  })

  it('ignores case unless asked', () => {
    const lines = [hay('a.ts', 'Needle needle NEEDLE')]
    expect(findMatches(lines, 'needle', false).matches).toHaveLength(3)
    expect(findMatches(lines, 'needle', true).matches).toHaveLength(1)
  })

  it('finds nothing for an empty query rather than everything', () => {
    expect(findMatches([hay('a.ts', 'anything')], '', false).matches).toEqual([])
  })

  it('cannot be walked forever by a query inside itself', () => {
    // "aa" in "aaaa" is two matches at 1 and 3, not four overlapping ones
    const { matches } = findMatches([hay('a.ts', 'aaaa')], 'aa', false)
    expect(matches.map((m) => m.column)).toEqual([1, 3])
  })

  it('stops counting somewhere, and says it stopped', () => {
    const { matches, capped } = findMatches(
      [hay('a.ts', 'a\n'.repeat(600))],
      'a',
      false,
    )
    expect(capped).toBe(true)
    expect(matches).toHaveLength(500)
  })

  it('counts the files the matches are in', () => {
    const { matches } = findMatches(
      [hay('a.ts', 'q'), hay('b.ts', 'q q')],
      'q',
      false,
    )
    expect(fileCount(matches)).toBe(2)
  })
})
