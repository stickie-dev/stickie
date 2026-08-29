import { describe, expect, it } from 'vitest'
import { activity_actions, isActivityPair } from './activity.js'

describe('isActivityPair', () => {
  it('accepts every declared pair', () => {
    for (const [subject, actions] of Object.entries(activity_actions)) {
      for (const action of actions) {
        expect(isActivityPair(subject, action)).toBe(true)
      }
    }
  })

  it('rejects an action from another subject', () => {
    expect(isActivityPair('file', 'submitted')).toBe(false)
    expect(isActivityPair('note', 'viewed')).toBe(false)
  })

  it('rejects a subject it does not know', () => {
    expect(isActivityPair('repo', 'created')).toBe(false)
  })
})
