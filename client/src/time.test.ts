import { describe, expect, it } from 'vitest'
import { timeExact, timeLabel, timeValue } from './time'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('timeLabel', () => {
  it('says so plainly under a minute, rather than "just now ago"', () => {
    expect(timeLabel(ago(5_000))).toBe('just now')
  })

  it('counts in short units while a review is live', () => {
    expect(timeLabel(ago(5 * 60_000))).toBe('5m ago')
    expect(timeLabel(ago(3 * 3_600_000))).toBe('3h ago')
    expect(timeLabel(ago(26 * 3_600_000))).toBe('1d ago')
  })

  it('gives the date once an age stops meaning anything', () => {
    expect(timeLabel(ago(5 * 86_400_000))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('is empty for nothing at all', () => {
    expect(timeLabel(null)).toBe('')
    expect(timeLabel('not a date')).toBe('')
  })
})

describe('timeExact', () => {
  it('shows hundredths, since a tooltip is read not measured', () => {
    expect(timeExact('2026-08-24T09:11:44.125Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:44\.12$/,
    )
  })
})

describe('timeValue', () => {
  it('orders by instant, not by how the string was written', () => {
    expect(timeValue('2026-08-24T09:11:44Z')).toBe(
      timeValue('2026-08-24T11:11:44+02:00'),
    )
    expect(timeValue(null)).toBe(0)
  })
})
