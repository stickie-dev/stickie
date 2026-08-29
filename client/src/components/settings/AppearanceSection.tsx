import { useEffect, useState } from 'react'
import { useReview } from '../../store'
import { Field, SaveRow, Section, field_classes } from './parts'
import type { SettingsAccess } from './useSettings'
import { btn } from '../../ui'

export function AppearanceSection({ state, save, saving }: SettingsAccess) {
  const theme = useReview((s) => s.theme)
  const toggleTheme = useReview((s) => s.toggleTheme)
  const [wrapExtensions, setWrapExtensions] = useState('')
  useEffect(() => {
    if (state !== null) setWrapExtensions(state.wrapExtensions)
  }, [state])

  return (
    <Section
      title="Appearance"
      blurb="Light and dark themes built for diffs, and which file types open soft-wrapped."
    >
      <Field label="Theme">
        <button
          className={`text-xs ${btn('outline')}`}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? 'switch to light' : 'switch to dark'}
        </button>
      </Field>

      <Field
        label="Soft-wrap these extensions (comma separated)"
        hint="Any file can be wrapped or unwrapped on the spot from the header button or the editor's right-click menu. Anything unwrapped gets width rulers at 80, 100 and 120."
      >
        <input
          className={field_classes}
          placeholder="md,txt,json"
          value={wrapExtensions}
          onChange={(e) => setWrapExtensions(e.target.value)}
        />
      </Field>

      <SaveRow saving={saving} onSave={() => void save({ wrapExtensions })} />
    </Section>
  )
}
