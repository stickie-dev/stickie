import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { activeFiles, useReview, wrapFor } from '../store'
import type { ResolvedNotes } from '../api'
import {
  Columns,
  FoldLines,
  Inline,
  ResolvedFolded,
  ResolvedGutter,
  ResolvedShown,
  WrapLines,
} from '../icons'
import {
  eyebrow,
  glass,
  icon_button,
  icon_button_on,
  icon_button_part,
  motion,
} from '../ui'

/** Long enough to cross the bar without opening every panel on the way. */
const open_after = 250
/** Long enough to cross the gap into the panel without it closing. */
const close_after = 180

interface Option {
  label: string
  why: string
  on: boolean
  pick: () => void
}

/**
 * One toggle, and every choice it stands for.
 *
 * A click does the quick thing — flips the layout, folds or unfolds — which is
 * what a toggle is for. Hovering it, or reaching it with the keyboard, opens
 * the whole choice beside it: a three-way setting cannot be one click, and an
 * icon cannot say what its other states are, so the panel does both. It takes
 * the place of the button's hint, since it says more than the hint did.
 *
 * The panel hangs from the button inside one hover area, with no gap in it,
 * so the pointer can travel from one to the other without the panel closing
 * under it.
 */
function Toggle({
  name,
  quick,
  className,
  pressed,
  label,
  icon,
  options,
  disabled = false,
}: {
  name: string
  quick: () => void
  className: string
  pressed?: boolean | 'mixed'
  label: string
  icon: ReactNode
  options: Option[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const later = (fn: () => void, ms: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div
      className="relative"
      onPointerEnter={() => later(() => setOpen(true), open_after)}
      onPointerLeave={() => later(() => setOpen(false), close_after)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={open}
        disabled={disabled}
        onClick={quick}
      >
        {icon}
      </button>
      {open && !disabled && (
        <div className="absolute top-full right-0 z-50 pt-1">
          <div
            role="group"
            aria-label={name}
            className={`w-64 rounded-lg p-1 ${glass}`}
          >
            <p className={`px-2 pt-1 pb-1.5 ${eyebrow}`}>{name}</p>
            {options.map((option) => (
              <button
                key={option.label}
                aria-pressed={option.on}
                className={`flex w-full flex-col items-start rounded-md px-2 py-1 text-left ${motion} ${
                  option.on ? 'bg-accent-soft' : 'hover:bg-overlay'
                }`}
                onClick={() => {
                  option.pick()
                  setOpen(false)
                }}
              >
                <span
                  className={`text-xs ${option.on ? 'font-medium text-accent' : 'text-ink'}`}
                >
                  {option.label}
                </span>
                <span className="text-dense text-faint">{option.why}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * How every diff is drawn, as a few toggles in the top bar.
 *
 * They were a menu behind an unlabelled ⋮ at the end of the tabs, directly
 * under the browser's own ⋮ in an installed window. They are preferences for
 * the whole app rather than for one review, which is what the top bar holds,
 * and they show their state: the icon or the pressed look says how things are
 * without opening anything.
 */
export function ViewToggles() {
  const sideBySide = useReview((s) => s.sideBySide)
  const sideBySideShown = useReview((s) => s.sideBySideShown)
  const setSideBySide = useReview((s) => s.setSideBySide)
  const collapseUnchanged = useReview((s) => s.collapseUnchanged)
  const setCollapseUnchanged = useReview((s) => s.setCollapseUnchanged)
  const viewMode = useReview((s) => s.viewMode)
  const files = useReview(activeFiles)
  const selectedPath = useReview((s) => s.selectedPath)
  const wrapExtensions = useReview((s) => s.wrapExtensions)
  const wrapOverrides = useReview((s) => s.wrapOverrides)
  const toggleWrap = useReview((s) => s.toggleWrap)
  const setWrapAll = useReview((s) => s.setWrapAll)
  const resolvedNotes = useReview((s) => s.resolvedNotes)
  const setResolvedNotes = useReview((s) => s.setResolvedNotes)

  // a click always shows the other layout; the panel holds the third choice,
  // handing it back to the window
  const fits =
    sideBySide === null
      ? ` — the window fits ${sideBySideShown ? 'two columns' : 'one'} now`
      : ''

  const in_flow = viewMode === 'flow'
  const paths = files.map((file) => file.path)
  const wrapped = paths.filter((path) =>
    wrapFor(path, wrapExtensions, wrapOverrides),
  ).length
  const all_wrapped = wrapped === paths.length && paths.length > 0
  const file_wrapped =
    selectedPath !== null && wrapFor(selectedPath, wrapExtensions, wrapOverrides)
  const wrapThis = () => {
    if (selectedPath !== null) void toggleWrap(selectedPath)
  }

  // three states, each visibly different, so a click can walk them in turn
  const resolved_order: ResolvedNotes[] = ['shown', 'folded', 'gutter']
  const next_resolved =
    resolved_order[(resolved_order.indexOf(resolvedNotes) + 1) % 3] ?? 'folded'

  return (
    <div
      role="group"
      aria-label="how the diff is drawn"
      className="flex shrink-0 items-center gap-0.5"
    >
      <Toggle
        name="Diff layout"
        label={`show the diff ${sideBySideShown ? 'inline' : 'side by side'}`}
        className={icon_button}
        icon={sideBySideShown ? <Columns /> : <Inline />}
        quick={() => setSideBySide(!sideBySideShown)}
        options={[
          {
            label: 'Side by side',
            why: 'base on the left, source on the right',
            on: sideBySide === true,
            pick: () => setSideBySide(true),
          },
          {
            label: 'Inline',
            why: 'one column, changes in place',
            on: sideBySide === false,
            pick: () => setSideBySide(false),
          },
          {
            label: 'Whatever fits',
            why: `two columns when the window is wide enough${fits}`,
            on: sideBySide === null,
            pick: () => setSideBySide(null),
          },
        ]}
      />
      <Toggle
        name="Unchanged lines"
        label="fold unchanged lines"
        className={collapseUnchanged ? icon_button_on : icon_button}
        pressed={collapseUnchanged}
        icon={<FoldLines />}
        quick={() => setCollapseUnchanged(!collapseUnchanged)}
        options={[
          {
            label: 'Folded away',
            why: 'only the lines around each change',
            on: collapseUnchanged,
            pick: () => setCollapseUnchanged(true),
          },
          {
            label: 'Shown',
            why: 'every line of every file',
            on: !collapseUnchanged,
            pick: () => setCollapseUnchanged(false),
          },
        ]}
      />
      <Toggle
        name={in_flow ? 'Wrap long lines' : 'Wrap long lines in this file'}
        label="wrap long lines"
        className={
          in_flow
            ? all_wrapped
              ? icon_button_on
              : wrapped > 0
                ? icon_button_part
                : icon_button
            : file_wrapped
              ? icon_button_on
              : icon_button
        }
        pressed={
          in_flow
            ? all_wrapped
              ? true
              : wrapped > 0
                ? 'mixed'
                : false
            : file_wrapped
        }
        icon={<WrapLines />}
        disabled={!in_flow && selectedPath === null}
        quick={in_flow ? () => void setWrapAll(paths, !all_wrapped) : wrapThis}
        options={
          in_flow
            ? [
                {
                  label: 'Every file',
                  why: `${String(wrapped)} of ${String(paths.length)} wrapped now`,
                  on: all_wrapped,
                  pick: () => void setWrapAll(paths, true),
                },
                {
                  label: 'No file',
                  why: 'long lines run off to the right',
                  on: wrapped === 0,
                  pick: () => void setWrapAll(paths, false),
                },
              ]
            : [
                {
                  label: 'Wrapped',
                  why: 'long lines fold onto the next',
                  on: file_wrapped,
                  pick: () => {
                    if (!file_wrapped) wrapThis()
                  },
                },
                {
                  label: 'Not wrapped',
                  why: 'long lines run off to the right',
                  on: !file_wrapped,
                  pick: () => {
                    if (file_wrapped) wrapThis()
                  },
                },
              ]
        }
      />
      <Toggle
        name="Resolved notes"
        label={`resolved notes: ${resolvedNotes}`}
        className={icon_button}
        icon={
          resolvedNotes === 'shown' ? (
            <ResolvedShown />
          ) : resolvedNotes === 'folded' ? (
            <ResolvedFolded />
          ) : (
            <ResolvedGutter />
          )
        }
        quick={() => setResolvedNotes(next_resolved)}
        options={[
          {
            label: 'Shown',
            why: 'whole, where they were written',
            on: resolvedNotes === 'shown',
            pick: () => setResolvedNotes('shown'),
          },
          {
            label: 'Folded',
            why: 'a line or two each, where they were written',
            on: resolvedNotes === 'folded',
            pick: () => setResolvedNotes('folded'),
          },
          {
            label: 'In the gutter',
            why: 'out of the code — a mark on the line, click it to read',
            on: resolvedNotes === 'gutter',
            pick: () => setResolvedNotes('gutter'),
          },
        ]}
      />
    </div>
  )
}
