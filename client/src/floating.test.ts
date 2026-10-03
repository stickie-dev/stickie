import { describe, expect, it } from 'vitest'
import { placeNearPoint } from './floating'

const window_size = { width: 1400, height: 900 }
const box = { width: 300, height: 200 }

describe('placeNearPoint', () => {
  it('sits just below the point when there is room', () => {
    expect(placeNearPoint({ x: 700, y: 300 }, box, window_size).top).toBe(312)
  })

  it('flips above the point rather than off the bottom', () => {
    // a note started on the last line of a file: 12px below 870 is past the
    // window, and the box was drawn there anyway
    const { top } = placeNearPoint({ x: 700, y: 870 }, box, window_size)
    expect(top).toBe(658)
    expect(top + box.height).toBeLessThanOrEqual(window_size.height)
  })

  it('clamps to the top when it fits neither way', () => {
    const tall = { width: 300, height: 880 }
    const { top } = placeNearPoint({ x: 700, y: 500 }, tall, window_size)
    expect(top).toBe(8)
  })

  it('keeps a box centred on the point clear of the left and right edges', () => {
    expect(placeNearPoint({ x: 4, y: 300 }, box, window_size).left).toBe(158)
    expect(placeNearPoint({ x: 1396, y: 300 }, box, window_size).left).toBe(
      1242,
    )
  })

  it('leaves a point with room on both sides where it is', () => {
    expect(placeNearPoint({ x: 700, y: 300 }, box, window_size).left).toBe(700)
  })
})
