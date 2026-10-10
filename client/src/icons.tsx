import type { ReactNode } from 'react'

/**
 * The glyphs, in one place — for the same reason `ui.ts` holds the classes.
 *
 * When an icon replaces a word: only where the shape is the more recognisable
 * of the two. Settings, the theme, reload, close, the arrows that move you
 * about — a reader knows those at a glance and reads nothing. `Comments (3)`,
 * `Activity`, `Import MR` keep their words, because the word is carrying
 * something the shape cannot; sending gets both, since the label counts what
 * is about to go. A bar of pictograms is not denser than a bar of verbs, it is
 * just quieter about what it does.
 *
 * They are drawn here rather than installed: a set brings its own stroke, its
 * own grid and its own idea of how big an icon is, and this one is sized for
 * an 11–12px line. Everything is on a 24 grid, stroked in `currentColor`, so
 * an icon is whatever colour the button around it is, in either theme.
 */

/** 14px: the height of the text it sits beside, not the height of the button. */
const glyph = 'h-3.5 w-3.5 shrink-0'

interface IconProps {
  className?: string
}

function Icon({
  className = '',
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${glyph} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      // the button carries the label; the picture is not read out twice
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * Settings: the gear everyone looks for. It was sliders while it sat in the
 * top bar beside Sun, where a gear reads as a second sun; at the foot of the
 * panel bar it has nothing round beside it. Eight teeth, square-cut and
 * softened by the round joins, around an open hub.
 */
export function Gear(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.87 5.02L10.35 2.64L13.65 2.64L14.13 5.02A7.3 7.3 0 0 1 15.43 5.55L17.45 4.22L19.78 6.55L18.45 8.57A7.3 7.3 0 0 1 18.98 9.87L21.36 10.35L21.36 13.65L18.98 14.13A7.3 7.3 0 0 1 18.45 15.43L19.78 17.45L17.45 19.78L15.43 18.45A7.3 7.3 0 0 1 14.13 18.98L13.65 21.36L10.35 21.36L9.87 18.98A7.3 7.3 0 0 1 8.57 18.45L6.55 19.78L4.22 17.45L5.55 15.43A7.3 7.3 0 0 1 5.02 14.13L2.64 13.65L2.64 10.35L5.02 9.87A7.3 7.3 0 0 1 5.55 8.57L4.22 6.55L6.55 4.22L8.57 5.55A7.3 7.3 0 0 1 9.87 5.02Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

/** Reload: a turn of the circle, with the head filled so it reads at 14px. */
export function Refresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 5.07A8 8 0 1 1 8 5.07" />
      <path d="M9.13 4.42 7.12 7.54 5.42 4.6Z" fill="currentColor" />
    </Icon>
  )
}

/** Sending: to an agent, out of here — never for a note joining the batch. */
export function Send(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.5 3.5 13.9 20.5 10.4 13.6 3.5 10.1Z" />
      <path d="M20.5 3.5 10.4 13.6" />
    </Icon>
  )
}

export function Search(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="m15.2 15.2 4.8 4.8" />
    </Icon>
  )
}

export function Sun(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M18.2 12h2.4M16.38 16.38l1.7 1.7M12 18.2v2.4M7.62 16.38l-1.7 1.7M5.8 12H3.4M7.62 7.62l-1.7-1.7M12 5.8V3.4M16.38 7.62l1.7-1.7" />
    </Icon>
  )
}

export function Moon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.5 14.8A9 9 0 1 1 9.2 3.5 7 7 0 0 0 20.5 14.8Z" />
    </Icon>
  )
}

/**
 * Back and forward through where the reader has been — the cursor's own
 * history, across tabs and reviews. An arrow meeting a bar: the shape editors
 * use for jumping to a place, which plain arrows (leaving a page) and chevrons
 * (scrolling a strip of tabs) both say something else about.
 */
export function NavBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5v14M19.5 12H9M13.5 7.5 9 12l4.5 4.5" />
    </Icon>
  )
}

export function NavForward(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 5v14M4.5 12H15M10.5 7.5 15 12l-4.5 4.5" />
    </Icon>
  )
}

export function ChevronLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 6 8.5 12l6 6" />
    </Icon>
  )
}

export function ChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 6 15.5 12l-6 6" />
    </Icon>
  )
}

export function ChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 14.5 12 8.5l6 6" />
    </Icon>
  )
}

export function ChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9.5 12 15.5l6-6" />
    </Icon>
  )
}

/*
 * How a diff is drawn. Each is a frame with what is inside it changed, so the
 * pair reads as one family in the top bar and the difference is the content:
 * two panes, or one column.
 */

export function Columns(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M12 5v14" />
    </Icon>
  )
}

export function Inline(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M7.5 9.5h9M7.5 12h6M7.5 14.5h9" />
    </Icon>
  )
}

/** Unchanged lines folded away: the edges of a file, squeezed towards each other. */
export function FoldLines(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5h14M5 19h14M12 7.5v3M10 9l2 2 2-2M12 16.5v-3M10 15l2-2 2 2" />
    </Icon>
  )
}

/*
 * Where resolved notes go: the whole note, a line or two of it, or only a mark
 * in the gutter. The bubble shrinks with what is left of the note, so the three
 * read as one setting turned down, not three unrelated things.
 */
export function ResolvedShown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 4.5H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3.5V20l4.5-3.5h8a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1Z" />
      <path d="M7 8.5h10M7 11h10M7 13.5h6" />
    </Icon>
  )
}

export function ResolvedFolded(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 7H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h3.5V17l4.5-3h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z" />
      <path d="M7 10.5h10" />
    </Icon>
  )
}

/** Resolved notes moved out of the code: a gutter edge, and a tick beside it. */
export function ResolvedGutter(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4v16M11 12.5l2.5 2.5L19 9.5" />
    </Icon>
  )
}

export function WrapLines(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h12.5a3 3 0 0 1 0 6H12M14 16l-2 2 2 2M4 17h4" />
    </Icon>
  )
}

/** Archive: a box with its lid on, put away rather than thrown away. */
export function Archive(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16v4H4zM5.5 9v9.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" />
    </Icon>
  )
}

/** Keep: a bookmark — this one stays, whatever the expiry setting says. */
export function Keep(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.5h10v15.5l-5-3.5-5 3.5z" />
    </Icon>
  )
}

/** Bring back from the archive: the same box, with something coming out. */
export function Unarchive(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16v4H4zM5.5 9v9.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V9M12 17.5V12M9.5 14.5 12 12l2.5 2.5" />
    </Icon>
  )
}

/** Lines in an order that can be changed: the prompt order. */
export function Reorder(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h10M4 12h10M4 17h10M19 5v14M16.5 7.5 19 5l2.5 2.5M16.5 16.5 19 19l2.5-2.5" />
    </Icon>
  )
}

/** Something to take hold of and drag. */
export function Grip(props: IconProps) {
  return (
    <Icon {...props}>
      <g fill="currentColor" stroke="none">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </g>
    </Icon>
  )
}

/**
 * Copy prompt: a clipboard with a terminal's prompt on it — what is copied is
 * for pasting into an agent, not a plain copy of what is on screen.
 */
export function CopyPrompt(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M16 5.5h1.5A1.5 1.5 0 0 1 19 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5V7a1.5 1.5 0 0 1 1.5-1.5H8" />
      <path d="m8.5 11 2.5 2.5L8.5 16M13 16h3" />
    </Icon>
  )
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.5 12.5 10 17l8.5-9.5" />
    </Icon>
  )
}

/*
 * The panel bar: one shape per place a panel lives, so the bar reads as a
 * list of where things are rather than a row of actions.
 */

export function Files(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 3.5h5.5L19 8v9.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.5V8H19M5 7v12.5a1 1 0 0 0 1 1h9" />
    </Icon>
  )
}

export function Commit(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M3 12h5.5M15.5 12H21" />
    </Icon>
  )
}

/** The record of what happened: a clock turning back. */
export function History(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3h3M12 8v4.5l3 2" />
    </Icon>
  )
}

export function Comment(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 4.5H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3.5V20l4.5-3.5h8a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1Z" />
    </Icon>
  )
}

/** The same reach as `Close`, so the two read as a pair in the tab strip. */
export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Icon>
  )
}

export function Close(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2" />
    </Icon>
  )
}
