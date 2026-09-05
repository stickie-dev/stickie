import { describe, expect, it } from 'vitest'
import { clampRatio, paneWidth, panes, ratioFromPointer } from './panes'

describe('clampRatio', () => {
  const wide = 1600

  it('leaves a ratio between the floor and the ceiling alone', () => {
    expect(clampRatio('tree', 0.2, wide)).toBe(0.2)
  })

  it('holds the file list to a quarter of the workspace', () => {
    expect(clampRatio('tree', 0.8, wide)).toBe(panes.tree.ceiling)
  })

  it('holds the comments to half of it', () => {
    expect(clampRatio('comments', 0.9, wide)).toBe(panes.comments.ceiling)
  })

  it('keeps a pane readable when the ratio would make it a column of dots', () => {
    // 2% of 1600 is 32px; the floor is what a name needs, not a proportion
    expect(clampRatio('tree', 0.02, wide)).toBeCloseTo(panes.tree.floor / wide)
  })

  it('lets the floor win when the window is too narrow for both limits', () => {
    // a quarter of 600px is 150px, under the tree's 180px floor: a readable
    // pane matters more than a proportion, and `clamp()` says the same
    expect(clampRatio('tree', 0.01, 600)).toBeCloseTo(panes.tree.floor / 600)
  })

  it('falls back to the opening width rather than passing on a NaN', () => {
    expect(clampRatio('tree', Number.NaN, wide)).toBe(panes.tree.initial)
  })

  it('survives being asked before anything has been measured', () => {
    expect(clampRatio('comments', 0.3, 0)).toBe(0.3)
    expect(clampRatio('comments', 0.9, 0)).toBe(panes.comments.ceiling)
  })
})

describe('ratioFromPointer', () => {
  const bounds = { left: 100, width: 1000 }

  it('measures a left pane from the left edge', () => {
    expect(ratioFromPointer('tree', 'left', 300, bounds)).toBeCloseTo(0.2)
  })

  it('measures a right pane from the right edge', () => {
    // 700px along a 1000px workspace leaves 300px of comments
    expect(ratioFromPointer('comments', 'right', 800, bounds)).toBeCloseTo(0.3)
  })

  it('clamps a drag past the ceiling rather than following it', () => {
    expect(ratioFromPointer('tree', 'left', 900, bounds)).toBe(panes.tree.ceiling)
  })

  it('clamps a drag past the floor rather than collapsing the pane', () => {
    expect(ratioFromPointer('tree', 'left', 100, bounds)).toBeCloseTo(
      panes.tree.floor / bounds.width,
    )
  })

  it('clamps a drag that has left the workspace entirely', () => {
    expect(ratioFromPointer('comments', 'right', -500, bounds)).toBe(
      panes.comments.ceiling,
    )
  })
})

describe('paneWidth', () => {
  it('hands the browser the floor, the wish and the ceiling', () => {
    expect(paneWidth('tree', 0.2)).toBe('clamp(180px, 20%, 25%)')
    expect(paneWidth('comments', 0.26)).toBe('clamp(260px, 26%, 50%)')
  })

  it('lets CSS hold the ceiling rather than pre-clamping it', () => {
    // over the ceiling is still expressed: `clamp` is what enforces it, and
    // the stored ratio is the reader's, not something to quietly rewrite
    expect(paneWidth('tree', 0.9)).toBe('clamp(180px, 90%, 25%)')
  })

  it('falls back to the opening width rather than emitting NaN%', () => {
    expect(paneWidth('tree', Number.NaN)).toBe('clamp(180px, 17%, 25%)')
  })
})
