import { useEffect, useState } from 'react'
import { Field, Mono, SaveRow, Section, field_classes } from './parts'
import type { SettingsAccess } from './useSettings'

const sources: Record<string, string> = {
  settings: 'the name set here',
  // git resolves local over global inside a repo, and this does not pay for a
  // second call to say which of the two answered
  git: 'git config, as that repository resolves it',
  'git-global': 'git config --global',
  environment: 'the USER environment variable',
  fallback: 'nothing — stickie had to guess',
}

export function IdentitySection({ state, save, saving }: SettingsAccess) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (state !== null) setName(state.identity.chosenName)
  }, [state])

  const rows = state?.identity.perRepo ?? []

  return (
    <Section
      title="Identity"
      blurb="The name your notes are recorded under. There is no login: stickie reads git config and takes your word for it, so this is a label on the record rather than a verified identity — and agents likewise name themselves when they post."
    >
      <Field
        label="Your name"
        hint="Empty asks git, per repository. Set a name here to use the same one everywhere."
      >
        <input
          className={field_classes}
          placeholder={state?.identity.fallback.name ?? ''}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <SaveRow saving={saving} onSave={() => void save({ actorName: name })} />

      <div className="pt-3">
        <h3 className="text-xs font-semibold tracking-wide text-soft uppercase">
          How a note would be attributed
        </h3>
        <p className="mt-1 text-xs text-faint">
          Per repository, the way git resolves an identity: a repository with
          its own <Mono>user.name</Mono> wins over the global one, exactly as it
          would for a commit made there.
        </p>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {rows.map((row) => (
              <tr key={row.repoId} className="border-t border-edge">
                <td className="py-1 pr-3 font-mono text-soft">
                  {row.repoName}
                </td>
                <td className="py-1 pr-3 text-ink">{row.name}</td>
                <td className="py-1 pr-3 font-mono text-faint">
                  {row.email ?? '—'}
                </td>
                <td className="py-1 text-faint">
                  {sources[row.source] ?? row.source}
                </td>
              </tr>
            ))}
            {rows.length === 0 && state !== null && (
              <tr className="border-t border-edge">
                <td className="py-1 pr-3 text-faint" colSpan={4}>
                  No repositories registered yet — a note would be recorded as{' '}
                  <span className="text-ink">{state.identity.fallback.name}</span>{' '}
                  from {sources[state.identity.fallback.source] ?? '—'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="pt-2 text-xs text-faint">
        Changing any of this does not rewrite what is already recorded — past
        notes keep the name they were written under, which is the point of
        keeping a record at all.
      </p>
    </Section>
  )
}
