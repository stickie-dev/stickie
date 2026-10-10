import { describe, expect, it } from 'vitest'
import { lineEdit } from './lineEdit'
import type { LineEdit } from './lineEdit'

/** Applies an edit the way the editor would, so a test checks the result. */
function apply(prev: string[], edit: LineEdit | null, eol: string): string {
  const text = prev.join(eol)
  if (edit === null) return text
  const offset = (line: number, column: number) => {
    let at = 0
    for (let i = 0; i < line - 1; i += 1) at += (prev[i] ?? '').length + eol.length
    return at + column - 1
  }
  const start = offset(edit.startLineNumber, edit.startColumn)
  const stop = offset(edit.endLineNumber, edit.endColumn)
  return text.slice(0, start) + edit.text + text.slice(stop)
}

const cases: [string, string[], string[]][] = [
  ['changes one line in the middle', ['a', 'b', 'c'], ['a', 'B', 'c']],
  ['appends to a file with no final newline', ['a', 'b'], ['a', 'b', 'c']],
  ['appends to a file ending in a newline', ['a', 'b', ''], ['a', 'b', 'c', '']],
  ['inserts at the start', ['b', 'c'], ['a', 'b', 'c']],
  ['inserts in the middle', ['a', 'c'], ['a', 'b', 'c']],
  ['deletes a line in the middle', ['a', 'b', 'c'], ['a', 'c']],
  ['deletes the first line', ['a', 'b', 'c'], ['b', 'c']],
  ['deletes lines running to the end', ['a', 'b', 'c'], ['a']],
  ['replaces everything', ['a', 'b'], ['x', 'y', 'z']],
  ['fills an empty file', [''], ['x']],
  ['empties a file', ['x', 'y'], ['']],
  ['grows a line into several', ['a', 'b', 'c'], ['a', 'b1', 'b2', 'b3', 'c']],
]

describe('lineEdit', () => {
  for (const eol of ['\n', '\r\n']) {
    const name = eol === '\n' ? 'LF' : 'CRLF'
    for (const [what, prev, next] of cases) {
      it(`${what} (${name})`, () => {
        expect(apply(prev, lineEdit(prev, next, eol), eol)).toBe(next.join(eol))
      })
    }
  }

  it('answers null when nothing changed', () => {
    expect(lineEdit(['a', 'b'], ['a', 'b'], '\n')).toBeNull()
  })

  it('leaves the lines above an append untouched', () => {
    // the case that unfolded a whole file: an agent adding to the bottom. Every
    // collapsed region above it is tracked by lines this edit must not touch
    const prev = Array.from({ length: 120 }, (_, i) => `line ${String(i)}`)
    const edit = lineEdit(prev, [...prev, 'an agent touched this'], '\n')
    expect(edit?.startLineNumber).toBe(120)
    expect(edit?.endLineNumber).toBe(120)
  })

  it('touches only the line that changed, however long the file', () => {
    const prev = Array.from({ length: 500 }, (_, i) => `line ${String(i)}`)
    const next = [...prev]
    next[250] = 'changed'
    const edit = lineEdit(prev, next, '\n')
    expect(edit).toEqual({
      startLineNumber: 251,
      startColumn: 1,
      endLineNumber: 251,
      endColumn: 'line 250'.length + 1,
      text: 'changed',
    })
  })
})
