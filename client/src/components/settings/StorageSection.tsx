import {
  ApplyRow,
  Field,
  Mono,
  Section,
  field_classes,
  useFieldValue,
} from './parts'
import type { SettingsAccess } from './useSettings'

export function StorageSection({ state, save, saving }: SettingsAccess) {
  /*
   * The one field that still waits to be applied even though it is only a
   * field. Everything else here answers a question about this screen; this one
   * says where every note lives, takes a restart to happen, and would be a
   * strange thing to set in passing by tabbing out of a half-typed URL.
   */
  const databaseUrl = useFieldValue(state?.storage.databaseUrl ?? undefined)

  const from_env = state?.storage.fromEnv === true
  // the field is shown back redacted, so an untouched value must not be saved
  const changed = state !== null && databaseUrl.dirty

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
          value={databaseUrl.value}
          disabled={from_env}
          onChange={(e) => databaseUrl.setValue(e.target.value)}
        />
      </Field>
      {!from_env && (
        <ApplyRow
          saving={saving}
          onApply={() => void save({ databaseUrl: databaseUrl.value })}
        >
          {changed && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              a restart will be needed
            </span>
          )}
        </ApplyRow>
      )}
    </Section>
  )
}
