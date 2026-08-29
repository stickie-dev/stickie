/**
 * The look, in one place: the class strings that make a button a button here.
 *
 * Every surface used to spell its own out, so a card in one panel had a
 * hairline and 4px corners while a card in the next had neither, and changing
 * the language meant finding fifteen copies of it. These are the language.
 *
 * The shape of it: depth from surface and shadow rather than from outlines,
 * corners at 8–12px, fills that appear on hover rather than borders that sit
 * there waiting, one easing curve, and type that stays compact — 11px where
 * density is the point, 12–13px for reading. A review surface showing twenty
 * files is not a landing page.
 */

/** Anything that moves, moves the same way. */
export const motion = 'transition-colors duration-150 ease-smooth'

/** A raised surface: notes, panels, rows that can be picked up. */
export const card = 'rounded-lg bg-panel shadow-soft'

/** A well: search fields, code gutters, anything set into the page. */
export const sunken = 'rounded-md bg-sunken'

/**
 * A quiet control — the default. No border: it takes a fill when the pointer
 * is on it, which says "pressable" at the moment that matters instead of
 * drawing a box around every verb on the screen.
 */
export const button = `rounded-md px-2 py-1 text-soft hover:bg-overlay hover:text-ink ${motion}`

/** The one thing on a surface that is the point of it. */
export const button_primary = `rounded-md bg-accent px-2.5 py-1 font-medium text-white shadow-soft hover:bg-accent-strong ${motion}`

/** A control that is currently on. */
export const button_on = `rounded-md bg-accent-soft px-2 py-1 text-accent ${motion}`

/** An icon-sized version of the same, square rather than wide. */
export const icon_button = `rounded-md p-1 text-soft hover:bg-overlay hover:text-ink ${motion}`

/**
 * Text entry and selects, filled rather than outlined, with the focus ring
 * doing what a permanent border was doing badly.
 */
export const field = `rounded-md border-0 bg-overlay px-2 py-1 text-ink outline-none ring-1 ring-transparent focus:ring-2 focus:ring-accent/50 ${motion}`

/** A badge: a state, not an action. Pill-shaped so it cannot read as a button. */
export const badge =
  'rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase'

/** A column heading: quiet, small, and out of the way of the data. */
export const th =
  'px-2 py-1.5 text-[10px] font-medium tracking-[0.08em] text-faint uppercase'

/** A row that can be opened. The tint on hover is the only affordance it needs. */
export const row = `border-b border-edge/50 last:border-b-0 hover:bg-overlay/60 ${motion}`

/** A section label above a group. */
export const eyebrow =
  'text-[10px] font-medium tracking-[0.08em] text-faint uppercase'

/** Content arriving: a short rise, once, rather than a fade on every render. */
export const enter = 'animate-rise'
