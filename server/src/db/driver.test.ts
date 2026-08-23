import { describe, expect, it } from 'vitest'
import { Lock, toBool, toPositional, toText } from './driver.js'

describe('toPositional', () => {
  it('numbers the placeholders in order', () => {
    expect(toPositional('select * from t where a = ? and b = ?')).toBe(
      'select * from t where a = $1 and b = $2',
    )
  })

  it('leaves question marks inside strings alone', () => {
    expect(toPositional(`select '?' as q where a = ?`)).toBe(
      `select '?' as q where a = $1`,
    )
  })

  it('survives quoted identifiers', () => {
    expect(toPositional('select "od?d" from t where a = ?')).toBe(
      'select "od?d" from t where a = $1',
    )
  })
})

describe('row helpers', () => {
  it('reads booleans from either dialect', () => {
    expect([toBool(1), toBool(true), toBool(0), toBool(false)]).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  it('formats postgres timestamps like sqlite ones', () => {
    expect(toText(new Date('2026-08-23T10:11:12.500Z'))).toBe(
      '2026-08-23 10:11:12',
    )
    expect(toText('2026-08-23 10:11:12')).toBe('2026-08-23 10:11:12')
  })
})

describe('Lock', () => {
  it('runs queued work one at a time', async () => {
    const lock = new Lock()
    const order: string[] = []
    const slow = lock.run(async () => {
      order.push('first in')
      await new Promise((r) => setTimeout(r, 20))
      order.push('first out')
    })
    const quick = lock.run(async () => {
      order.push('second in')
    })
    await Promise.all([slow, quick])
    expect(order).toEqual(['first in', 'first out', 'second in'])
  })

  it('keeps the queue moving after a failure', async () => {
    const lock = new Lock()
    await expect(
      lock.run(() => Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope')
    await expect(lock.run(() => Promise.resolve('fine'))).resolves.toBe('fine')
  })
})
