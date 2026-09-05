/**
 * How wide the panels either side of the diff are allowed to be.
 *
 * Kept as a *fraction* of the workspace rather than a pixel width, so a window
 * that changes size keeps the shape the reader arranged rather than handing
 * every pixel to the diff — and so the ceilings can be stated as what they
 * are: the file list is never worth more than a quarter of the screen, and the
 * comments never worth more than half of it. Past those the diff stops being
 * the thing you are looking at.
 *
 * The floor is in pixels, because it is a different kind of limit: a file tree
 * narrower than about eleven characters is not a smaller tree, it is a column
 * of ellipses, and that is true on any size of screen.
 */

export interface Pane {
  /** fraction of the workspace it opens at */
  initial: number
  /** narrowest it is worth being, in px */
  floor: number
  /** widest it may be, as a fraction */
  ceiling: number
}

export const panes = {
  tree: { initial: 0.17, floor: 180, ceiling: 0.25 },
  comments: { initial: 0.26, floor: 260, ceiling: 0.5 },
} as const satisfies Record<string, Pane>

export type PaneName = keyof typeof panes

/**
 * The width to give a pane, as CSS.
 *
 * `clamp()` rather than a measured number: the browser is already resolving
 * the percentage against the row, on every frame of a window drag, and a
 * ResizeObserver feeding the same figure back through React can only ever
 * agree with it a moment later. The floor and the ceiling are exactly what
 * `clamp` means by min and max.
 *
 * When the two cross — a window too narrow for both to hold — `clamp` returns
 * the minimum, which is the answer we want anyway: a readable pane matters
 * more than a proportion, and the alternative is a pane that exists and cannot
 * be read.
 */
export function paneWidth(pane: PaneName, ratio: number): string {
  const { floor, ceiling, initial } = panes[pane]
  const wanted = Number.isFinite(ratio) ? Math.max(ratio, 0) : initial
  return `clamp(${String(floor)}px, ${String(wanted * 100)}%, ${String(ceiling * 100)}%)`
}

/**
 * The fraction a pane may actually take, for the code that has to reason about
 * one rather than hand it to the browser — a drag, and a stored width being
 * read back. Same limits, same crossing rule.
 */
export function clampRatio(
  pane: PaneName,
  ratio: number,
  workspaceWidth: number,
): number {
  const { floor, ceiling } = panes[pane]
  if (!Number.isFinite(ratio)) return panes[pane].initial
  if (workspaceWidth <= 0) return Math.min(Math.max(ratio, 0), ceiling)
  const lowest = floor / workspaceWidth
  if (lowest > ceiling) return lowest
  return Math.min(Math.max(ratio, lowest), ceiling)
}

/** What a drag to `x` means for a pane on one side of the workspace. */
export function ratioFromPointer(
  pane: PaneName,
  side: 'left' | 'right',
  pointerX: number,
  bounds: { left: number; width: number },
): number {
  const offset = pointerX - bounds.left
  const raw = side === 'left' ? offset : bounds.width - offset
  return clampRatio(pane, raw / bounds.width, bounds.width)
}
