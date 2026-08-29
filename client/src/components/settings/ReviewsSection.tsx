import { useEffect, useState } from 'react'
import type { RepinMode, SubmitKey } from '../../api'
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

const submit_choices: { value: SubmitKey; label: string; why: string }[] = [
  {
    value: 'enter',
    label: 'Enter posts, Shift+Enter makes a new line',
    why: 'A note is usually one sentence.',
  },
  {
    value: 'mod-enter',
    label: '⌘/Ctrl+Enter posts, Enter makes a new line',
    why: 'For notes that are usually several lines.',
  },
]

export function ReviewsSection({ state, save, saving }: SettingsAccess) {
  const [mode, setMode] = useState<RepinMode>('always')
  const [submit, setSubmit] = useState<SubmitKey>('enter')
  useEffect(() => {
    if (state !== null) {
      setMode(state.repinMode)
      setSubmit(state.submitKey)
    }
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
      <Field
        label="Posting a comment"
        hint={
          <>
            Applies to notes, replies and edits alike. <Mono>⌘/Ctrl+Enter</Mono>{' '}
            posts either way — it has never meant a new line.
          </>
        }
      >
        <div className="space-y-2">
          {submit_choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer gap-2 text-xs"
            >
              <input
                type="radio"
                name="submit-key"
                className="mt-0.5 shrink-0"
                checked={submit === choice.value}
                onChange={() => setSubmit(choice.value)}
              />
              <span>
                <span className="text-ink">{choice.label}</span>
                <span className="block text-faint">{choice.why}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <SaveRow
        saving={saving}
        onSave={() => void save({ repinMode: mode, submitKey: submit })}
      />
    </Section>
  )
}
