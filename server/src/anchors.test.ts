import { describe, expect, it } from 'vitest'
import { extractSnippet, reanchor } from './anchors.js'

const content = ['def a():', '    return 1', '', 'def b():', '    return 2'].join(
  '\n',
)

describe('extractSnippet', () => {
  it('extracts an inclusive 1-indexed range', () => {
    expect(extractSnippet(content, 4, 5)).toBe('def b():\n    return 2')
  })
})

describe('reanchor', () => {
  it('keeps position when content is unchanged', () => {
    expect(reanchor('def b():\n    return 2', content, 4)).toEqual({
      startLine: 4,
      endLine: 5,
    })
  })

  it('follows the snippet when lines are inserted above', () => {
    const shifted = `import os\n\n${content}`
    expect(reanchor('def b():\n    return 2', shifted, 4)).toEqual({
      startLine: 6,
      endLine: 7,
    })
  })

  it('matches with whitespace drift via trimmed fallback', () => {
    const reindented = content.replace('    return 2', '        return 2')
    expect(reanchor('def b():\n    return 2', reindented, 4)).toEqual({
      startLine: 4,
      endLine: 5,
    })
  })

  it('returns null when the snippet is gone', () => {
    expect(reanchor('def gone():', content, 1)).toBeNull()
  })

  it('picks the occurrence closest to the previous anchor', () => {
    const dup = ['x = 1', 'y = 2', 'x = 1', 'z = 3', 'x = 1'].join('\n')
    expect(reanchor('x = 1', dup, 5)).toEqual({ startLine: 5, endLine: 5 })
    expect(reanchor('x = 1', dup, 1)).toEqual({ startLine: 1, endLine: 1 })
  })
})
