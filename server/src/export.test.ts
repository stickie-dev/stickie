import { describe, expect, it } from 'vitest'
import { parseRefs } from './export.js'

describe('parseRefs', () => {
  it('finds single-line and range refs', () => {
    expect(
      parseRefs('same bug as src/parser.py:L42 and lib/util.ts:L10-L20'),
    ).toEqual([
      { path: 'src/parser.py', startLine: 42, endLine: 42 },
      { path: 'lib/util.ts', startLine: 10, endLine: 20 },
    ])
  })

  it('accepts L10-20 shorthand for ranges', () => {
    expect(parseRefs('see a/b.py:L10-12')).toEqual([
      { path: 'a/b.py', startLine: 10, endLine: 12 },
    ])
  })

  it('ignores inverted ranges and plain prose', () => {
    expect(parseRefs('broken x.py:L9-L3 and nothing else here')).toEqual([])
  })
})
