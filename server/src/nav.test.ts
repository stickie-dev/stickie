import { describe, expect, it } from 'vitest'
import { definitionPattern, parseRgJson } from './nav.js'

describe('definitionPattern', () => {
  it('matches python defs, classes, and module assignments', () => {
    const pattern = new RegExp(definitionPattern('python', 'mul'))
    expect(pattern.test('def mul(a, b):')).toBe(true)
    expect(pattern.test('async def mul(a):')).toBe(true)
    expect(pattern.test('class mul:')).toBe(true)
    expect(pattern.test('mul = lambda a, b: a * b')).toBe(true)
    expect(pattern.test('result = mul(2, 3)')).toBe(false)
  })

  it('matches typescript declaration forms', () => {
    const pattern = new RegExp(definitionPattern('typescript', 'openDb'))
    expect(pattern.test('export function openDb(file: string) {')).toBe(true)
    expect(pattern.test('const openDb = (file) => {')).toBe(true)
    expect(pattern.test('const db = openDb()')).toBe(false)
  })

  it('escapes regex metacharacters in names', () => {
    expect(() =>
      new RegExp(definitionPattern('python', 'a.b$c')),
    ).not.toThrow()
  })
})

describe('parseRgJson', () => {
  it('extracts matches and skips other event types', () => {
    const stdout = [
      JSON.stringify({ type: 'begin', data: { path: { text: 'a.py' } } }),
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/calc.py' },
          line_number: 14,
          lines: { text: '    result = 0\n' },
        },
      }),
      JSON.stringify({ type: 'end', data: {} }),
      'not json',
    ].join('\n')
    expect(parseRgJson(stdout, '/repo')).toEqual([
      {
        repoPath: '/repo',
        path: 'src/calc.py',
        line: 14,
        preview: '    result = 0',
      },
    ])
  })
})
