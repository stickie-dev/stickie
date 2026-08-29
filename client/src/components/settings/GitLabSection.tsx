import { useState } from 'react'
import { ask } from '../../confirm'
import { Field, Mono, Section, field_classes, useFieldValue } from './parts'
import type { SettingsAccess } from './useSettings'

export function GitLabSection({ state, save }: SettingsAccess) {
  const url = useFieldValue(state?.gitlabUrl ?? undefined)
  const tokenEnv = useFieldValue(state?.gitlabTokenEnv ?? undefined)
  // write-only: the stored one is never read back, so there is nothing to hold
  const [token, setToken] = useState('')

  const stored = state?.hasStoredToken === true

  return (
    <Section
      title="GitLab"
      blurb="Where the MR import reads from, and how it authenticates. Import is the only outbound call stickie ever makes, and only when you trigger it."
    >
      <Field label="Instance URL">
        <input
          className={field_classes}
          placeholder="https://gitlab.com"
          value={url.value}
          onChange={(e) => url.setValue(e.target.value)}
          onBlur={() => {
            if (url.dirty) void save({ gitlabUrl: url.value }, { quiet: true })
          }}
        />
      </Field>

      <Field
        label={stored ? 'Token (stored — empty keeps it)' : 'Token'}
        hint="The stored token lives in plaintext in the database."
      >
        {/* stored when you leave the field, and cleared from the box: what is
            typed here is a secret, not a draft to come back to */}
        <input
          type="password"
          className={field_classes}
          placeholder={stored ? '••••••••' : 'glpat-…'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onBlur={() => {
            if (token === '') return
            void save({ gitlabToken: token }, { quiet: true })
            setToken('')
          }}
        />
      </Field>

      {/*
        A button rather than a checkbox that waits for a save. It asks first,
        because it used to take two deliberate acts — tick, then save — and one
        click that quietly deletes a secret is not the same offer.
      */}
      {stored && (
        <button
          className="text-xs text-soft hover:text-ink"
          onClick={() =>
            void (async () => {
              const sure = await ask({
                title: 'Forget the stored token?',
                detail:
                  'stickie falls back to the named environment variable, or to ' +
                  'GITLAB_TOKEN. Pasting a token here stores one again.',
                confirmLabel: 'Forget it',
                danger: true,
              })
              if (sure) await save({ gitlabToken: '' }, { quiet: true })
            })()
          }
        >
          forget the stored token
        </button>
      )}

      <Field
        label="Token env var (used when no token is stored)"
        hint={
          <>
            Resolution order: stored token → named env var →{' '}
            <Mono>GITLAB_TOKEN</Mono>.
            {state !== null && state.tokenSource !== null && (
              <>
                {' '}
                Currently using <Mono>{state.tokenSource}</Mono>
                {state.effectiveUrl !== null && (
                  <>
                    {' '}
                    against <Mono>{state.effectiveUrl}</Mono>
                  </>
                )}
                .
              </>
            )}
            {state !== null && state.tokenSource === null && (
              <> No token is currently available.</>
            )}
          </>
        }
      >
        <input
          className={field_classes}
          placeholder="MY_GITLAB_TOKEN"
          value={tokenEnv.value}
          onChange={(e) => tokenEnv.setValue(e.target.value)}
          onBlur={() => {
            if (tokenEnv.dirty) {
              void save({ gitlabTokenEnv: tokenEnv.value }, { quiet: true })
            }
          }}
        />
      </Field>
    </Section>
  )
}
