import { describe, expect, it } from 'vitest'
import { postsComment } from './keys'

const press = (over: Partial<Parameters<typeof postsComment>[0]> = {}) => ({
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})

describe('postsComment', () => {
  it('posts on a bare Enter when that is the mode', () => {
    expect(postsComment(press(), 'enter')).toBe(true)
  })

  it('leaves shift+Enter to make a new line', () => {
    expect(postsComment(press({ shiftKey: true }), 'enter')).toBe(false)
    expect(postsComment(press({ altKey: true }), 'enter')).toBe(false)
  })

  it('leaves a bare Enter alone in the other mode', () => {
    expect(postsComment(press(), 'mod-enter')).toBe(false)
    expect(postsComment(press({ shiftKey: true }), 'mod-enter')).toBe(false)
  })

  it('always posts on the modifier, in either mode', () => {
    for (const mode of ['enter', 'mod-enter'] as const) {
      expect(postsComment(press({ metaKey: true }), mode)).toBe(true)
      expect(postsComment(press({ ctrlKey: true }), mode)).toBe(true)
    }
  })

  it('ignores anything that is not Enter', () => {
    expect(postsComment(press({ key: 'a' }), 'enter')).toBe(false)
  })
})
