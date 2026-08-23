import { useEffect, useState } from 'react'
import { Field, Mono, SaveRow, Section, field_classes } from './parts'
import type { SettingsAccess } from './useSettings'

const sources: Record<string, string> = {
  settings: 'the name you set here',
  'git-global': 'git config --global user.name',
  'git-repo': "a registered repository's git config",
  environment: 'the USER environment variable',
  fallback: 'nothing — stickie had to guess',
}

export function IdentitySection({ state, save, saving }: SettingsAccess) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (state !== null) setName(state.identity.chosenName)
  }, [state])

  const source = state === null ? '' : (sources[state.identity.source] ?? '')

  return (
    <Section
      title="Identity"
      blurb="The name your notes are recorded under. There is no login: stickie reads git config and takes your word for it, so this is a label on the record rather than a verified identity — and agents likewise name themselves when they post."
    >
      <Field
        label="Your name"
        hint={
          <>
            Empty falls back to git config. Notes are currently recorded as{' '}
            <Mono>{state?.identity.name ?? '…'}</Mono>
            {source !== '' && <> from {source}</>}.
          </>
        }
      >
        <input
          className={field_classes}
          placeholder={state?.identity.name ?? ''}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <SaveRow saving={saving} onSave={() => void save({ actorName: name })} />
      <p className="pt-2 text-xs text-faint">
        Changing this does not rewrite anything already recorded — past notes
        keep the name they were written under, which is the point of keeping a
        record at all.
      </p>
    </Section>
  )
}
