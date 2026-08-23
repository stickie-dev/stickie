import { useEffect, useState } from 'react'
import { Field, Mono, SaveRow, Section, field_classes } from './parts'
import type { SettingsAccess } from './useSettings'

export function PromptSection({ state, save, saving }: SettingsAccess) {
  const [instructions, setInstructions] = useState('')
  useEffect(() => {
    if (state !== null) setInstructions(state.promptInstructions)
  }, [state])

  const customised =
    state !== null &&
    instructions.trim() !== state.defaultPromptInstructions.trim()

  return (
    <Section
      title="Copy prompt"
      blurb="What Copy prompt appends after the notes. The notes themselves are always included — every unresolved one, pending batch and all."
    >
      <Field
        label="Instructions"
        hint={
          <>
            <Mono>{'{api}'}</Mono> becomes this server's address.
          </>
        }
      >
        <textarea
          rows={12}
          className={`${field_classes} resize-y`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>
      <SaveRow
        saving={saving}
        onSave={() => void save({ promptInstructions: instructions })}
      >
        {customised && state !== null && (
          <button
            className="text-xs text-accent hover:underline"
            onClick={() => setInstructions(state.defaultPromptInstructions)}
          >
            restore the default
          </button>
        )}
      </SaveRow>
    </Section>
  )
}
