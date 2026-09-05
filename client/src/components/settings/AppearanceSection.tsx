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

export function AppearanceSection({ state, save, saving }: SettingsAccess) {
  const theme = useReview((s) => s.theme)
  const toggleTheme = useReview((s) => s.toggleTheme)
  const fontScale = useReview((s) => s.fontScale)
  const setFontScale = useReview((s) => s.setFontScale)
  const wrap = useFieldValue(state?.wrapExtensions)
  const collapsed = useFieldValue(state?.collapsedFiles)
  const setCollapsedFiles = useReview((s) => s.setCollapsedFiles)

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
