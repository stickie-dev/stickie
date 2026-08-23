import { useEffect, useState } from 'react'
import { Field, Mono, SaveRow, Section, field_classes } from './parts'
import type { SettingsAccess } from './useSettings'

export function StorageSection({ state, save, saving }: SettingsAccess) {
  const [databaseUrl, setDatabaseUrl] = useState('')
  useEffect(() => {
    if (state !== null) setDatabaseUrl(state.storage.databaseUrl ?? '')
  }, [state])

  const from_env = state?.storage.fromEnv === true
  // the field is shown back redacted, so an untouched value must not be saved
  const changed =
    state !== null && databaseUrl !== (state.storage.databaseUrl ?? '')

  return (
    <Section
      title="Storage"
      blurb={
        <>
          Notes live in a local SQLite file unless you point stickie at Postgres.
          Now using <Mono>{state?.storage.active ?? '…'}</Mono>.
        </>
      }
    >
      <Field
        label="Postgres URL"
        hint={
          from_env ? (
            <>
              <Mono>STICKIE_DATABASE_URL</Mono> is set, so the environment decides
              and this field is read-only.
            </>
          ) : (
            <>
              Empty keeps the local file. Takes effect after a restart. The
              password is stored in plaintext in{' '}
              <Mono>~/.stickie/config.json</Mono> (owner-only) and shown back
              redacted — prefer <Mono>STICKIE_DATABASE_URL</Mono> on shared
              machines.
            </>
          )
        }
      >
        <input
          className={field_classes}
          placeholder="postgresql://user:password@host:5432/stickie"
          value={databaseUrl}
          disabled={from_env}
          onChange={(e) => setDatabaseUrl(e.target.value)}
        />
      </Field>
      {!from_env && (
        <SaveRow saving={saving} onSave={() => void save({ databaseUrl })}>
          {changed && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              a restart will be needed
            </span>
          )}
        </SaveRow>
      )}
    </Section>
  )
}
