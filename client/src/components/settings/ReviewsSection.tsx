import { useEffect, useState } from 'react'
import type { RepinMode } from '../../api'
import { Field, Mono, SaveRow, Section } from './parts'
import type { SettingsAccess } from './useSettings'

const choices: { value: RepinMode; label: string; why: string }[] = [
  {
    value: 'always',
    label: 'Move it automatically',
    why: 'An agent committing mid-review is the normal case, and stopping to press a button for it is friction.',
  },
  {
    value: 'when-clear',
    label: 'Only while no notes are open',
    why: 'Moving the base can leave a note without the code it was written against, so hold off while any note is unresolved or still a draft.',
  },
  {
    value: 'never',
    label: 'Leave it to me',
    why: 'The review keeps its base until you press re-pin.',
  },
]

export function ReviewsSection({ state, save, saving }: SettingsAccess) {
  const [mode, setMode] = useState<RepinMode>('always')
  useEffect(() => {
    if (state !== null) setMode(state.repinMode)
  }, [state])

  return (
    <Section
      title="Reviews"
      blurb="A review is a working tree or a branch against a base, and the commit that base is pinned to is what the diff is measured from. When the branch moves on, that pin has to move with it — or not."
    >
      <Field
        label="When the base moves on"
        hint={
          <>
            Whichever it is, both shas are kept in the record, and a re-pin that
            leaves a note without its code says so rather than passing quietly.
            A note that cannot be found again turns <Mono>detached</Mono>.
          </>
        }
      >
        <div className="space-y-2">
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="repin-mode"
                className="mt-0.5 shrink-0"
                checked={mode === choice.value}
                onChange={() => setMode(choice.value)}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      <SaveRow saving={saving} onSave={() => void save({ repinMode: mode })} />
    </Section>
  )
}
