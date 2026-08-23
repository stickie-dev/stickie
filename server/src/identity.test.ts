import { describe, expect, it } from 'vitest'
import { agentName } from './identity.js'

describe('agentName', () => {
  it('falls back to one shared name when an agent says nothing', () => {
    expect(agentName(undefined)).toBe('agent')
    expect(agentName('')).toBe('agent')
    expect(agentName('   ')).toBe('agent')
  })

  it('trims what an agent claims', () => {
    expect(agentName('  claude-code ')).toBe('claude-code')
  })

  it('caps a claimed name so one caller cannot fill the table', () => {
    expect(agentName('x'.repeat(200))).toHaveLength(64)
  })
})
