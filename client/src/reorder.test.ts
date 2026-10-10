import { describe, expect, it } from 'vitest'
import { dropAt, placeId } from './reorder'

describe('placeId', () => {
  it('moves an id to before its target', () => {
    expect(placeId([1, 2, 3, 4], 4, 2, false)).toEqual([1, 4, 2, 3])
  })

  it('moves an id to after its target', () => {
    expect(placeId([1, 2, 3, 4], 1, 3, true)).toEqual([2, 3, 1, 4])
  })

  it('can make an id the first or the last', () => {
    expect(placeId([1, 2, 3], 3, 1, false)).toEqual([3, 1, 2])
    expect(placeId([1, 2, 3], 1, 3, true)).toEqual([2, 3, 1])
  })

  it('places against a neighbour even past ids that are not shown', () => {
    // 2 and 4 are hidden: dropping 5 after 1 in a list of 1, 3, 5 lands it
    // right after 1, not after whatever was second
    expect(placeId([1, 2, 3, 4, 5], 5, 1, true)).toEqual([1, 5, 2, 3, 4])
  })

  it('leaves the order alone for a drop on itself or an unknown id', () => {
    expect(placeId([1, 2, 3], 2, 2, true)).toEqual([1, 2, 3])
    expect(placeId([1, 2, 3], 9, 2, true)).toEqual([1, 2, 3])
    expect(placeId([1, 2, 3], 2, 9, true)).toEqual([1, 2, 3])
  })
})

describe('dropAt', () => {
  const cards = [
    { id: 1, top: 0, bottom: 100 },
    { id: 2, top: 110, bottom: 210 },
  ]

  it('is before a card over its upper half and after it over its lower', () => {
    expect(dropAt(cards, 20)).toEqual({ id: 1, after: false })
    expect(dropAt(cards, 80)).toEqual({ id: 1, after: true })
    expect(dropAt(cards, 150)).toEqual({ id: 2, after: false })
  })

  it('counts the gap between two cards as the lower one', () => {
    expect(dropAt(cards, 105)).toEqual({ id: 2, after: false })
  })

  it('is before the first above the list and after the last below it', () => {
    expect(dropAt(cards, -40)).toEqual({ id: 1, after: false })
    expect(dropAt(cards, 400)).toEqual({ id: 2, after: true })
  })

  it('has nowhere to drop with no cards', () => {
    expect(dropAt([], 10)).toBeNull()
  })
})
