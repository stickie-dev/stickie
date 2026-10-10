import type { ResolvedNotes } from '../../api'
import type { FontScale } from '../../store'
import { useReview } from '../../store'
import { Field, Section, field_classes, useFieldValue } from './parts'
import type { SettingsAccess } from './useSettings'
import { btn } from '../../ui'

/**
 * Comfort is what stickie is drawn at; compact takes a pixel off each of those
 * numbers and leaves everything else alone. The two are listed with the sizes
 * they mean, because "compact" on its own is a promise about nothing.
 */
const font_choices: { value: FontScale; label: string; why: string }[] = [
  {
    value: 'comfort',
    label: 'Comfort',
    why: '12px for what is read, 11 for the tree and the status bar, 10 for badges',
  },
  {
    value: 'compact',
    label: 'Compact',
    why: 'one pixel off each of those, for a laptop screen — same spacing, same icons, more rows',
  },
]

const layout_choices: { value: boolean | null; label: string; why: string }[] =
  [
    {
      value: null,
      label: 'Whatever fits',
      why: 'two columns when the window is wide enough, one when it is not',
    },
    {
      value: true,
      label: 'Side by side',
      why: 'base on the left, source on the right',
    },
    { value: false, label: 'Inline', why: 'one column, changes in place' },
  ]

const resolved_choices: {
  value: ResolvedNotes
  label: string
  why: string
}[] = [
  {
    value: 'shown',
    label: 'Shown',
    why: 'whole, where it was written',
  },
  {
    value: 'folded',
    label: 'Folded',
    why: 'a line or two, where it was written — click it to read the rest',
  },
  {
    value: 'gutter',
    label: 'In the gutter',
    why: 'out of the code, as a mark on the line it was written against — click one to read it',
  },
]

export function AppearanceSection({ state, save, saving }: SettingsAccess) {
  const theme = useReview((s) => s.theme)
  const toggleTheme = useReview((s) => s.toggleTheme)
  const fontScale = useReview((s) => s.fontScale)
  const setFontScale = useReview((s) => s.setFontScale)
  const wrap = useFieldValue(state?.wrapExtensions)
  const collapsed = useFieldValue(state?.collapsedFiles)
  const setCollapsedFiles = useReview((s) => s.setCollapsedFiles)
  const resolvedNotes = useReview((s) => s.resolvedNotes)
  const sideBySide = useReview((s) => s.sideBySide)
  const setSideBySide = useReview((s) => s.setSideBySide)
  const setResolvedNotes = useReview((s) => s.setResolvedNotes)

  return (
    <Section
      title="Appearance"
      blurb="Light and dark themes built for diffs, which file types open soft-wrapped, and which open folded away."
    >
      <Field label="Theme">
        <button
          className={`text-xs ${btn('outline')}`}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? 'switch to light' : 'switch to dark'}
        </button>
      </Field>

      {/* takes effect as it is chosen, like the theme: a size you cannot see
          until you save is a size you cannot choose */}
      <Field
        label="Font"
        hint="The code in a diff keeps its own size, which follows the width of the window."
      >
        <div className="space-y-2">
          {font_choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="font-scale"
                className="mt-0.5 shrink-0"
                checked={fontScale === choice.value}
                onChange={() => setFontScale(choice.value)}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      {/* the top bar's toggles flip between two; here is the whole choice,
          including handing it back to the window */}
      <Field label="Diff layout">
        <div className="space-y-2">
          {layout_choices.map((choice) => (
            <label
              key={String(choice.value)}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="diff-layout"
                className="mt-0.5 shrink-0"
                checked={sideBySide === choice.value}
                onChange={() => setSideBySide(choice.value)}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Resolved notes"
        hint="Where a note goes once it is resolved. Either way it can be opened again from where it sits."
      >
        <div className="space-y-2">
          {resolved_choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="resolved-notes"
                className="mt-0.5 shrink-0"
                checked={resolvedNotes === choice.value}
                onChange={() => setResolvedNotes(choice.value)}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Soft-wrap these extensions (comma separated)"
        hint="Any file can be wrapped or unwrapped on the spot from the header button or the editor's right-click menu. Anything unwrapped gets width rulers at 80, 100 and 120."
      >
        {/* a list is finished when you leave it, not on every comma */}
        <input
          className={field_classes}
          placeholder="md,txt,json"
          value={wrap.value}
          onChange={(e) => wrap.setValue(e.target.value)}
          onBlur={() => {
            if (wrap.dirty) {
              void save({ wrapExtensions: wrap.value }, { quiet: true })
            }
          }}
        />
      </Field>

      <Field
        label="Open these files folded (comma separated)"
        hint="Machine-written files, matched by name or by ending — a lockfile is read to see that it changed, not line by line, and twenty thousand lines of one between two source files is the whole review scrolled past. Any file folds and unfolds from the arrow in its header."
      >
        <input
          className={field_classes}
          placeholder="uv.lock,pnpm-lock.yaml,.min.js"
          value={collapsed.value}
          onChange={(e) => collapsed.setValue(e.target.value)}
          onBlur={() => {
            if (collapsed.dirty) {
              // the diff reads this from the store, not from the settings page
              setCollapsedFiles(collapsed.value)
              void save({ collapsedFiles: collapsed.value }, { quiet: true })
            }
          }}
        />
      </Field>
    </Section>
  )
}
