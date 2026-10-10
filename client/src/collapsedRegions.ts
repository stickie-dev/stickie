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

/** Marks a band's middle row once its actions have been added. */
const decorated = 'stickieActions'

/**
 * Says on the band what a click on it does.
 *
 * The band's own gestures are real but invisible: two four-pixel strips that
 * step, an icon that steps both ends, a double-click on the line count that
 * opens everything. A reader who has never been told any of that sees "100
 * hidden lines" and nothing to press. So the three of them are written out
 * beside the count, as words, and each does what the hidden gesture does —
 * nothing here has its own idea of how much to open.
 *
 * Only on the side being read: side by side, both editors draw a band for the
 * same region, and one set of actions is enough to drive it.
 */
function decorate(center: HTMLElement): void {
  if (center.dataset[decorated] !== undefined) return
  const widget = center.parentElement
  const count = center.children[1]
  if (widget === null || count === undefined) return
  center.dataset[decorated] = ''
  const actions = document.createElement('span')
  actions.className = 'ml-3 inline-flex items-center gap-1.5 text-meta text-faint'
  const add = (label: string, run: () => void) => {
    if (actions.childElementCount > 0) {
      const dot = document.createElement('span')
      dot.textContent = '·'
      dot.setAttribute('aria-hidden', 'true')
      actions.append(dot)
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.className = 'hover:text-ink hover:underline'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      run()
    })
    actions.append(button)
  }
  const n = String(reveal_line_count)
  add(`show ${n} above`, () => {
    const strip = widget.querySelector(':scope > .top')
    if (strip !== null) step(strip)
  })
  add(`show ${n} below`, () => {
    const strip = widget.querySelector(':scope > .bottom')
    if (strip !== null) step(strip)
  })
  add('show all', () => {
    // the editor's own way of opening the whole region, so this and the
    // double-click on the count can never disagree about what "all" is
    count.querySelector('span')?.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, button: 0 }),
    )
  })
  center.append(actions)
}

const bands_to_decorate = `.editor.modified ${band} > .center`

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
  // Bands come and go with the files on screen, and the editor builds them
  // whenever it likes, so they are found as they appear: one pass per burst of
  // changes, and a pass that finds every band already decorated does nothing.
  // A timer rather than a frame, because this needs the DOM and not a paint —
  // a band built while the tab is in the background is ready when it returns.
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      for (const center of document.querySelectorAll<HTMLElement>(
        bands_to_decorate,
      )) {
        decorate(center)
      }
    }, 0)
  }).observe(document.body, { childList: true, subtree: true })

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
