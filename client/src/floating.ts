import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/** Kept clear of the window's edges, so a box never sits flush against one. */
const margin = 8
/** Below the point by default: the pointer is there, and it should not be covered. */
const gap = 12

/**
 * Where a box of this size goes, for a point in a window of this size.
 *
 * Below the point when it fits, above it when there is more room there, and
 * flush to the top when it fits in neither — a box taller than the window has
 * to start somewhere, and the top is the end a reader reads from. Horizontally
 * the box is centred on the point, so the clamp is of its half-width.
 */
export function placeNearPoint(
  point: { x: number; y: number },
  box: { width: number; height: number },
  window_size: { width: number; height: number },
): { left: number; top: number } {
  const room_below = window_size.height - (point.y + gap) - margin
  const room_above = point.y - gap - margin
  const top =
    box.height <= room_below
      ? point.y + gap
      : room_above > room_below
        ? Math.max(margin, point.y - gap - box.height)
        : Math.max(margin, window_size.height - margin - box.height)
  const half = box.width / 2
  return {
    left: Math.min(
      Math.max(point.x, half + margin),
      window_size.width - half - margin,
    ),
    top,
  }
}

/**
 * Places a box next to the point that summoned it, and keeps it on screen.
 *
 * Three of these are anchored to where the reader clicked — the note actions
 * over a selection, the definition picker, the reference offer in the side
 * pane — and all three clamped `left` and left `top` alone. On the last line
 * of a file, which is exactly where someone finishes reading and writes a
 * note, "just below the pointer" is past the bottom of the window: the box
 * was drawn, correctly, somewhere nobody could reach.
 *
 * Measured after it is drawn rather than guessed at, because a box's height is
 * its content's — a picker with one hit and one with twenty are different
 * boxes — and nothing here knows that in advance. It flips above the point
 * when there is more room there, and clamps when there is room in neither, so
 * a box taller than the window still starts at the top of it rather than
 * hanging off the bottom.
 */
export function useNearPoint<T extends HTMLElement>(
  x: number,
  y: number,
): { ref: RefObject<T | null>; style: CSSProperties } {
  const ref = useRef<T>(null)
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    const next = placeNearPoint(
      { x, y },
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    )
    setPlaced((was) =>
      was !== null && was.left === next.left && was.top === next.top
        ? was
        : next,
    )
  }, [x, y])

  return {
    ref,
    // drawn where it was asked for until it has been measured, and moved once
    // if that turns out to be off the screen — one frame, before paint
    style: { left: placed?.left ?? x, top: placed?.top ?? y + gap },
  }
}
