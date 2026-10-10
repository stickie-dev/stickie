import { activeFiles, useReview, wrapFor } from '../store'
import { Columns, FoldLines, Inline, ResolvedGutter, WrapLines } from '../icons'
import { icon_button, icon_button_on, icon_button_part } from '../ui'

/**
 * How every diff is drawn, as a few toggles in the top bar.
 *
 * They were a menu behind an unlabelled ⋮ at the end of the tabs, directly
 * under the browser's own ⋮ in an installed window — so the way to change how
 * the diff looked was to know which of two identical glyphs to open. They are
 * preferences for the whole app rather than for one review, which is what the
 * top bar now holds, and shown as their state: pressed is on, so a glance says
 * whether unchanged lines are folded without opening anything.
 *
 * Icons rather than words, to keep the bar to one line. Each says in its
 * title what it is now and what a click will make it, since a shape alone
 * says neither.
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
  const in_gutter = resolvedNotes === 'gutter'

  // What is drawn, and the other one. It cycled through three states, one of
  // them "whatever fits" — which on a wide window is side by side, so two
  // clicks in every three changed the icon and nothing else. Now a click is
  // always the other layout; "whatever fits" is in Settings for whoever wants
  // the choice handed back to the window.
  const layout = sideBySideShown
    ? { icon: <Columns />, now: 'side by side', then: 'inline' }
    : { icon: <Inline />, now: 'inline', then: 'side by side' }
  const fitted =
    sideBySide === null ? '\nchosen to fit the window until you pick one' : ''

  // in the diff, wrapping is every file at once; on one file, that file
  const in_flow = viewMode === 'flow'
  const paths = files.map((file) => file.path)
  const wrapped = paths.filter((path) =>
    wrapFor(path, wrapExtensions, wrapOverrides),
  ).length
  const file_wrapped =
    selectedPath !== null && wrapFor(selectedPath, wrapExtensions, wrapOverrides)
  const wrap = in_flow
    ? wrapped === paths.length && paths.length > 0
      ? { cls: icon_button_on, pressed: true, title: 'every file wrapped — click to unwrap them all', run: () => void setWrapAll(paths, false) }
      : wrapped > 0
        ? { cls: icon_button_part, pressed: 'mixed' as const, title: `${String(wrapped)} of ${String(paths.length)} files wrapped — click to wrap every file`, run: () => void setWrapAll(paths, true) }
        : { cls: icon_button, pressed: false, title: 'no file wrapped — click to wrap every file', run: () => void setWrapAll(paths, true) }
    : file_wrapped
      ? { cls: icon_button_on, pressed: true, title: 'this file is wrapped — click to unwrap it', run: () => { if (selectedPath !== null) void toggleWrap(selectedPath) } }
      : { cls: icon_button, pressed: false, title: 'this file is not wrapped — click to wrap it', run: () => { if (selectedPath !== null) void toggleWrap(selectedPath) } }

  return (
    <div
      role="group"
      aria-label="how the diff is drawn"
      className="flex shrink-0 items-center gap-0.5"
    >
      <button
        className={icon_button}
        title={`diff ${layout.now} — click for ${layout.then}${fitted}`}
        aria-label={`show the diff ${layout.then}`}
        onClick={() => setSideBySide(!sideBySideShown)}
      >
        {layout.icon}
      </button>
      <button
        className={collapseUnchanged ? icon_button_on : icon_button}
        title={
          collapseUnchanged
            ? 'unchanged lines folded away — click to show them'
            : 'unchanged lines shown — click to fold them away'
        }
        aria-label="fold unchanged lines"
        aria-pressed={collapseUnchanged}
        onClick={() => setCollapseUnchanged(!collapseUnchanged)}
      >
        <FoldLines />
      </button>
      <button
        className={wrap.cls}
        title={wrap.title}
        aria-label="wrap long lines"
        aria-pressed={wrap.pressed}
        disabled={!in_flow && selectedPath === null}
        onClick={wrap.run}
      >
        <WrapLines />
      </button>
      <button
        className={in_gutter ? icon_button_on : icon_button}
        title={
          in_gutter
            ? 'resolved notes in the gutter, out of the code — click to fold them back into the diff'
            : 'resolved notes folded into the diff — click to move them to the gutter'
        }
        aria-label="resolved notes in the gutter"
        aria-pressed={in_gutter}
        onClick={() => setResolvedNotes(in_gutter ? 'folded' : 'gutter')}
      >
        <ResolvedGutter />
      </button>
    </div>
  )
}
