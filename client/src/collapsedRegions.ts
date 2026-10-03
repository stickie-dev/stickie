import { reveal_line_count } from './ui'

/**
 * The diff editor's collapsed-region band, by the classes it is built from.
 * The band carries a drag strip at each end that steps by `revealLineCount`,
 * the hidden line count in the middle, and — at the left, where the gutter
 * would be — one anchor whose single click opens the whole region.
 */
const band = '.monaco-editor .diff-hidden-lines'
const unfold_all = `${band} a`

const step_title =
  `show ${String(reveal_line_count)} more lines at each end — ` +
  'double-click the line count to open the whole region'

/**
 * One step of the band's own "show more" gesture.
 *
 * It is driven by mousedown and mouseup rather than by click, because dragging
 * the same strip resizes the region — so a click is what the widget infers
 * from a press and a release with no movement between them, and that is what
 * has to be sent rather than a `click` event it never listens for.
 */
function step(strip: Element): void {
  const at = strip.getBoundingClientRect()
  const shape = {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: Math.round(at.left + at.width / 2),
    clientY: Math.round(at.top + at.height / 2),
  }
  strip.dispatchEvent(new MouseEvent('mousedown', shape))
  strip.dispatchEvent(new MouseEvent('mouseup', shape))
}

/**
 * Makes the one button on a collapsed region open a few lines rather than all
 * of them.
 *
 * The band has three targets and they are not equally findable: two four-pixel
 * drag strips that step by `reveal_line_count`, and an icon that opens the
 * entire region. The icon is the only one of the three that looks like
 * something to press, so it is the one that gets pressed — and a click meant
 * to peek at a collapsed region opened nine hundred lines of it. Lowering
 * `revealLineCount` did nothing about that, because the icon never asked.
 *
 * So the icon steps both ends instead, and says so. The whole region is still
 * one double-click away on the line count, which is the editor's own gesture
 * and its own tooltip — the point is that opening all of it is now something
 * asked for rather than the first thing a click does.
 *
 * Installed once, in the capture phase, on the document: the bands belong to
 * whichever diff editors happen to be mounted, they come and go with the
 * files on screen, and there are three surfaces drawing them. One listener
 * that names them by selector outlives all of that.
 */
export function tameUnfoldAll(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest(unfold_all)
      const widget = anchor?.closest(band) ?? null
      if (widget === null) return
      // capture, so the anchor's own handler never runs
      event.preventDefault()
      event.stopPropagation()
      for (const edge of ['.top', '.bottom']) {
        const strip = widget.querySelector(edge)
        if (strip !== null) step(strip)
      }
    },
    true,
  )

  // The band writes its title once, when it is built, so correcting it has to
  // happen where a tooltip is actually asked for. Cheap, and it cannot be
  // wrong for long: the reader is hovering the thing being described.
  document.addEventListener(
    'pointerover',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest(unfold_all)
      if (anchor instanceof HTMLElement && anchor.title !== step_title) {
        anchor.title = step_title
      }
    },
    true,
  )
}
