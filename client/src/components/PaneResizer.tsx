import { useRef } from 'react'
import type { PaneName } from '../panes'
import { panes, ratioFromPointer } from '../panes'
import { useReview } from '../store'

/**
 * The split between a side panel and the diff, and the handle that moves it.
 *
 * It *is* the rule between the two — the panes used to carry a `border-l` or
 * `border-r` of their own, and a second line beside a one-pixel border reads as
 * a seam rather than an edge. The hit area is wider than the line, because a
 * one-pixel target is a target you miss; only the line is painted, and it
 * takes the accent while it is being used.
 *
 * Draggable and typeable both: `separator` is a real role with a real value,
 * and a reader who cannot hold a pointer steady down a 1px line still has to
 * be able to move it.
 */
export function PaneResizer({
  pane,
  side,
  bounds,
}: {
  pane: PaneName
  /** which side of the workspace the pane it sizes is on */
  side: 'left' | 'right'
  /** the row the fractions are of; measured by the workspace, not by this */
  bounds: () => { left: number; width: number } | null
}) {
  const ratio = useReview((s) => s.paneRatios[pane])
  const setPaneRatio = useReview((s) => s.setPaneRatio)
  const dragging = useRef(false)

  const move = (clientX: number) => {
    const box = bounds()
    if (box === null || box.width === 0) return
    setPaneRatio(pane, ratioFromPointer(pane, side, clientX, box))
  }

  const step = (by: number) => {
    const box = bounds()
    setPaneRatio(
      pane,
      ratioFromPointer(
        pane,
        side,
        // where the edge is now, nudged: the same arithmetic either way, so a
        // key and a drag cannot disagree about what a ratio means
        (box?.left ?? 0) +
          (side === 'left'
            ? (ratio + by) * (box?.width ?? 0)
            : (1 - (ratio + by)) * (box?.width ?? 0)),
        box ?? { left: 0, width: 0 },
      ),
    )
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`resize the ${pane === 'tree' ? 'file list' : 'comments'}`}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={Math.round(panes[pane].ceiling * 100)}
      tabIndex={0}
      className="group relative z-10 -mx-[2px] w-[5px] shrink-0 cursor-col-resize outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
      }}
      onPointerMove={(event) => {
        if (dragging.current) move(event.clientX)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        dragging.current = false
      }}
      onDoubleClick={() => setPaneRatio(pane, panes[pane].initial)}
      onKeyDown={(event) => {
        const by = event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0
        if (by === 0) return
        event.preventDefault()
        step(side === 'left' ? by : -by)
      }}
    >
      {/* the line itself: one pixel, centred in a target you can hit */}
      <span className="pointer-events-none absolute inset-y-0 left-[2px] w-px bg-edge transition-colors duration-150 ease-smooth group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  )
}
