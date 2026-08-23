import { useEffect, useState } from 'react'
import { Field, Mono, SaveRow, Section, field_classes } from './parts'
import type { SettingsAccess } from './useSettings'

export function GitLabSection({ state, save, saving }: SettingsAccess) {
  const [url, setUrl] = useState('')
  const [tokenEnv, setTokenEnv] = useState('')
  const [token, setToken] = useState('')
  const [clearToken, setClearToken] = useState(false)

  useEffect(() => {
    if (state === null) return
    setUrl(state.gitlabUrl ?? '')
    setTokenEnv(state.gitlabTokenEnv ?? '')
    setToken('')
    setClearToken(false)
  }, [state])

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
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>

      <Field
        label={stored && !clearToken ? 'Token (stored — empty keeps it)' : 'Token'}
        hint="The stored token lives in plaintext in the database."
      >
        <input
          type="password"
          className={field_classes}
          placeholder={stored ? '••••••••' : 'glpat-…'}
          value={token}
          onChange={(e) => {
            setToken(e.target.value)
            setClearToken(false)
          }}
        />
      </Field>

      {stored && (
        <label className="flex items-center gap-1.5 text-xs text-soft">
          <input
            type="checkbox"
            checked={clearToken}
            onChange={(e) => setClearToken(e.target.checked)}
          />
          clear the stored token
        </label>
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
          value={tokenEnv}
          onChange={(e) => setTokenEnv(e.target.value)}
        />
      </Field>

      <SaveRow
        saving={saving}
        onSave={() =>
          void save({
            gitlabUrl: url,
            gitlabTokenEnv: tokenEnv,
            // untouched unless a new value was typed or clearing was asked for
            ...(token !== '' ? { gitlabToken: token } : {}),
            ...(clearToken ? { gitlabToken: '' } : {}),
          })
        }
      />
    </Section>
  )
}
