import { describe, expect, it } from 'vitest'
import { typeAheadIndex } from './typeAhead'

const branches = ['auto', 'HEAD', 'main', 'maintenance', 'master', 'feature']

describe('typeAheadIndex', () => {
  it('jumps to the first option starting with what was typed', () => {
    expect(typeAheadIndex(branches, 'f', 0)).toBe(5)
  })

  it('is deaf to case, in the list and in the typing', () => {
    expect(typeAheadIndex(branches, 'head', 0)).toBe(1)
    expect(typeAheadIndex(branches, 'HEA', 0)).toBe(1)
  })

  it('refines rather than walks away when the run grows', () => {
    // 'm' lands on main; 'ma' must be able to stay there
    const m = typeAheadIndex(branches, 'm', 0)
    expect(m).toBe(2)
    expect(typeAheadIndex(branches, 'ma', m)).toBe(2)
    expect(typeAheadIndex(branches, 'mas', m)).toBe(4)
  })

  it('cycles through the options sharing a letter when one is repeated', () => {
    expect(typeAheadIndex(branches, 'm', 0)).toBe(2)
    expect(typeAheadIndex(branches, 'mm', 2)).toBe(3)
    expect(typeAheadIndex(branches, 'mmm', 3)).toBe(4)
    // and round again
    expect(typeAheadIndex(branches, 'mmmm', 4)).toBe(2)
  })

  it('wraps past the end of the list', () => {
    expect(typeAheadIndex(branches, 'a', 4)).toBe(0)
  })

  it('answers -1 when nothing starts with it', () => {
    expect(typeAheadIndex(branches, 'zz', 0)).toBe(-1)
    expect(typeAheadIndex([], 'a', 0)).toBe(-1)
    expect(typeAheadIndex(branches, '', 0)).toBe(-1)
  })
})
