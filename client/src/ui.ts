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

/**
 * A surface that floats over the page — a menu, the find bar, the draft pill,
 * an overlay, a dialog. Translucent and blurred, so what it covers stays
 * legible as context while clearly being behind it.
 *
 * Only what floats. The diff never gets this: blurring the surface a reader is
 * reading code on costs legibility and buys nothing.
 */
export const glass = 'stickie-glass shadow-lifted'

/** A well: search fields, code gutters, anything set into the page. */
export const sunken = 'rounded-md bg-sunken'

/**
 * Every button in the app is one of four kinds, and nothing else.
 *
 * `primary` and `secondary` are the only two filled colours — accent for the
 * thing a surface is for, emerald for sending a review, which is the one other
 * act with its own weight. `outline` is a control that needs an edge to be
 * findable in a crowded row; `text` is the default, taking a fill only when the
 * pointer is on it, so a screen full of verbs is not a screen full of boxes.
 *
 * Disabled is the same colour, lighter — never a greyed-out shape of a
 * different kind, and never the same as enabled with a cursor that says no.
 * Buttons sit a radius step tighter than the surfaces holding them.
 */
export type ButtonKind = 'primary' | 'secondary' | 'outline' | 'text'

/*
 * No `not-allowed` cursor on a disabled button. The colour already says it is
 * not ready, and a crossed-out pointer says something stronger and less true —
 * that the reader is doing something wrong, when usually they have simply not
 * typed anything yet.
 */
const button_base = 'rounded-sm px-2 py-1 stickie-focus'

const button_kinds: Record<ButtonKind, string> = {
  // `stickie-lit` is the fall of light over a filled button; the two colours
  // that carry an action are the two that get it
  primary:
    'stickie-lit bg-accent font-medium text-white hover:bg-accent-strong disabled:bg-accent/35 disabled:text-white/80',
  secondary:
    'stickie-lit bg-emerald-600 font-medium text-white hover:bg-emerald-500 disabled:bg-emerald-600/35 disabled:text-white/80',
  outline:
    'text-soft ring-1 ring-edge hover:bg-overlay hover:text-ink disabled:text-faint disabled:ring-edge/40 disabled:hover:bg-transparent',
  text: 'text-soft hover:bg-overlay hover:text-ink disabled:text-faint disabled:hover:bg-transparent',
}

/** The classes for a button of one kind, plus anything a caller adds. */
export function btn(kind: ButtonKind = 'text', extra = ''): string {
  return `${button_base} ${button_kinds[kind]} ${motion} ${extra}`.trim()
}

/** A control that is currently on — a toggle showing its state, not a colour. */
export const button_on = `${button_base} bg-accent-soft text-accent ${motion}`

/**
 * Square rather than wide, for a single glyph — and the glyph is bigger here
 * than one sitting beside a word, because here it is the whole button. 16px in
 * 6px of padding is a 28px target, which is what a browser draws its own
 * title-bar buttons at, and these sit next to those in an installed window.
 */
export const icon_button = `rounded-sm p-1.5 text-soft stickie-focus hover:bg-overlay hover:text-ink disabled:text-faint [&>svg]:h-4 [&>svg]:w-4 ${motion}`

/**
 * Text entry and selects, filled rather than outlined, with the focus ring
 * doing what a permanent border was doing badly. One pixel, not two: a card
 * that is already ringed as the active note, holding a field ringed twice as
 * thickly, is three lines around one place to type.
 */
export const field = `rounded-md border-0 bg-overlay px-2 py-1 text-ink outline-none stickie-focus ${motion}`

/**
 * The same field with no line of its own, for one sitting inside something
 * already outlined — a note being typed is in a card that rings itself the
 * moment the field takes focus, and two rings around one place to type is a
 * border twice as thick as anyone asked for.
 */
export const field_flush = `rounded-md border-0 bg-overlay px-2 py-1 text-ink outline-none stickie-focus ${motion}`

/** A badge: a state, not an action. Pill-shaped so it cannot read as a button. */
export const badge =
  'rounded-full px-2 py-0.5 text-meta font-medium tracking-wide uppercase'

/** A column heading: quiet, small, and out of the way of the data. */
export const th =
  'px-2 py-1.5 text-meta font-medium tracking-[0.08em] text-faint uppercase'

/** A row that can be opened. The tint on hover is the only affordance it needs. */
export const row = `border-b border-edge/50 last:border-b-0 hover:bg-overlay/60 ${motion}`

/** A section label above a group. */
export const eyebrow =
  'text-meta font-medium tracking-[0.08em] text-faint uppercase'

/**
 * The frame every full page is laid out in: fluid, so a laptop has no gutters
 * at all, with a ceiling so a table on a 34-inch screen does not stretch to
 * the width of the desk. One token because the overview and settings had
 * 72rem and 64rem, which made the left edge jump when you moved between them —
 * the thing a reader notices even when neither width is wrong.
 *
 * Prose and fields keep their own measure inside it (`Section` is 2xl): a
 * table wants width, a paragraph wants about eighty characters, and one frame
 * can hold both as long as it does not force either.
 */
export const page = 'mx-auto w-full max-w-[100rem] px-6'

/**
 * The bar across the top of a page, and the line under it.
 *
 * Half a pixel, not one: on a 2× screen that is a single device pixel and on a
 * 1× one it is lighter than a hairline. Enough to make the chrome read as a
 * title bar over the page, not enough to read as the edge of a box — which is
 * what a full `border-edge` did here, especially on the review, where the tab
 * strip's own rule sits a few pixels below it.
 */
export const title_bar =
  'stickie-titlebar border-b-[0.5px] border-edge bg-surface'

/** Content arriving: a short rise, once, rather than a fade on every render. */
export const enter = 'animate-rise'

/**
 * How many lines one click on a collapsed region opens, in whichever
 * direction was clicked.
 *
 * A collapsed region is a claim that nothing in it is worth reading, and the
 * click that disagrees is usually asking about the few lines just past the
 * edge — what this function is called from, what this branch does. Opening the
 * whole region to answer that buries the change the reader came for, however
 * many hundred lines it holds. Monaco keeps the whole of it a double-click
 * away on the line count itself, and the unfold button beside it, so nothing
 * is out of reach — it is only no longer the first thing a click does.
 *
 * One number for all three surfaces, though they each hold their own context
 * and minimum line counts: how dense a diff is depends on where it is drawn,
 * but how much a click opens is the same question everywhere.
 */
export const reveal_line_count = 15
