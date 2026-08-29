import {
  ApplyRow,
  Field,
  Mono,
  Section,
  field_classes,
  useFieldValue,
} from './parts'
import type { SettingsAccess } from './useSettings'

export function PromptSection({ state, save, saving }: SettingsAccess) {
  // twelve rows of prose: the one setting most obviously mid-thought while
  // something else is being saved, and the reason `useFieldValue` guards it
  const instructions = useFieldValue(state?.promptInstructions)

  const customised =
    state !== null &&
    instructions.value.trim() !== state.defaultPromptInstructions.trim()

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
          value={instructions.value}
          onChange={(e) => instructions.setValue(e.target.value)}
        />
      </Field>
      <ApplyRow
        saving={saving}
        onApply={() => void save({ promptInstructions: instructions.value })}
      >
        {customised && state !== null && (
          <button
            className="text-xs text-accent hover:underline"
            onClick={() => instructions.setValue(state.defaultPromptInstructions)}
          >
            restore the default
          </button>
        )}
      </ApplyRow>
    </Section>
  )
}
