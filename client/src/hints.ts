/** Long enough not to flicker past while the pointer travels; short enough to be asked for. */
const show_after = 350
/** Between a hint and its element, and between a hint and the window's edge. */
const gap = 6
const margin = 8

/**
 * Hover hints, for every element that carries a `title`.
 *
 * The platform's own tooltip comes late — a second or more — in whatever font
 * and size the operating system likes, and in an installed window's title bar
 * not reliably at all. With most of the top bar now icons that say nothing on
 * their own, a hint that does not appear is a control that cannot be learned.
 *
 * So `title` stays the one way to write a hint, and this draws it: quickly,
 * in stickie's own surface, beside the element, inside the window. The attribute
 * is moved aside while it is shown so the platform's tooltip never doubles
 * it, and an element whose only name was its title is given that as its
 * accessible name first, so moving it costs a screen reader nothing.
 *
 * One listener for the whole page, so a control added tomorrow has a hint the
 * moment it has a title.
 */
export function installHints(): void {
  const tip = document.createElement('div')
  tip.setAttribute('role', 'tooltip')
  tip.className =
    'stickie-glass shadow-lifted pointer-events-none fixed z-[200] max-w-80 rounded-md px-2 py-1 text-dense leading-snug text-ink whitespace-pre-line'
  tip.hidden = true
  document.body.append(tip)

  let over: HTMLElement | null = null
  let timer: number | undefined

  /** The hint an element carries, taking it from `title` if it is still there. */
  const hintOf = (el: HTMLElement): string => {
    const title = el.getAttribute('title')
    if (title !== null && title !== '') {
      const named =
        el.hasAttribute('aria-label') ||
        el.hasAttribute('aria-labelledby') ||
        (el.textContent ?? '').trim() !== ''
      if (!named) el.setAttribute('aria-label', title)
      el.dataset.hint = title
      el.removeAttribute('title')
    }
    return el.dataset.hint ?? ''
  }

  const hide = () => {
    window.clearTimeout(timer)
    tip.hidden = true
  }

  const show = (el: HTMLElement) => {
    const text = hintOf(el)
    if (text === '' || !el.isConnected) return
    tip.textContent = text
    tip.hidden = false
    const at = el.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    // below the element and centred on it; above it when the window ends
    // first — the footer's hints — measured from the element's own edges, so
    // a hint never sits on the control it describes
    const below = at.bottom + gap
    const top =
      below + box.height <= window.innerHeight - margin
        ? below
        : Math.max(margin, at.top - gap - box.height)
    const left = Math.min(
      Math.max(margin, at.left + at.width / 2 - box.width / 2),
      window.innerWidth - box.width - margin,
    )
    tip.style.left = `${String(Math.round(left))}px`
    tip.style.top = `${String(Math.round(top))}px`
  }

  document.addEventListener(
    'pointerover',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const el = target.closest<HTMLElement>('[title], [data-hint]')
      if (el === over) return
      over = el
      hide()
      if (el === null) return
      // taken now rather than when shown, or the platform's tooltip starts its
      // own clock on the same hover
      hintOf(el)
      timer = window.setTimeout(() => show(el), show_after)
    },
    true,
  )

  // a toggle's hint says what a click will do, so after the click it is out of
  // date: re-read it, from the title the new state has just written
  document.addEventListener(
    'click',
    () => {
      // the press has already hidden it, so whether it was showing cannot be
      // asked here; what matters is that the pointer is still on the element
      const el = over
      if (el === null) return
      window.setTimeout(() => {
        if (over === el) show(el)
      }, 0)
    },
    true,
  )

  for (const ends of ['pointerdown', 'keydown', 'scroll', 'blur'] as const) {
    window.addEventListener(
      ends,
      () => {
        // a click keeps the element under the pointer: its hint comes back with
        // the click handler above rather than being dropped for good
        hide()
      },
      true,
    )
  }
  document.addEventListener(
    'pointerout',
    (event) => {
      if (event.relatedTarget === null) {
        over = null
        hide()
      }
    },
    true,
  )
}
