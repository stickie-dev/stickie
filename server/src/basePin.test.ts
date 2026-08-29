import { describe, expect, it } from 'vitest'
import { classifyBasePin } from './basePin.js'

describe('classifyBasePin', () => {
  it('says nothing when the base is where the pin is', () => {
    expect(classifyBasePin('aaa', 'aaa', true)).toEqual({
      stale: false,
      diverged: false,
      next: null,
    })
  })

  it('says nothing when git could not resolve the base', () => {
    expect(classifyBasePin('aaa', null, false)).toEqual({
      stale: false,
      diverged: false,
      next: null,
    })
  })

  it('is stale when the base moved on from the pin', () => {
    expect(classifyBasePin('aaa', 'bbb', true)).toEqual({
      stale: true,
      diverged: false,
      next: 'bbb',
    })
  })

  /*
   * The one that cost a review: a branch started from an older commit resolves
   * to a base the pinned commit is not in the history of. That is not this
   * review moving on, so it is never stale — nothing may follow it without
   * being asked.
   */
  it('is diverged, not stale, when the pin is not in the new base history', () => {
    expect(classifyBasePin('bbb', 'aaa', false)).toEqual({
      stale: false,
      diverged: true,
      next: 'aaa',
    })
  })

  it('never reports both', () => {
    for (const forward of [true, false]) {
      const state = classifyBasePin('aaa', 'bbb', forward)
      expect(state.stale && state.diverged).toBe(false)
    }
  })
})
