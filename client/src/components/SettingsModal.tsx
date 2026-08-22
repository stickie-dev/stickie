import { useEffect, useState } from 'react'
import { api } from '../api'
import type { SettingsState } from '../api'
import { useReview } from '../store'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const theme = useReview((s) => s.theme)
  const toggleTheme = useReview((s) => s.toggleTheme)
  const pushToast = useReview((s) => s.pushToast)

  const [state, setState] = useState<SettingsState | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [tokenEnv, setTokenEnv] = useState('')
  const [clearToken, setClearToken] = useState(false)

  useEffect(() => {
    void api.settings().then((s) => {
      setState(s)
      setUrl(s.gitlabUrl ?? '')
      setTokenEnv(s.gitlabTokenEnv ?? '')
    })
  }, [])

  const save = async () => {
    try {
      await api.saveSettings({
        gitlabUrl: url,
        gitlabTokenEnv: tokenEnv,
        // untouched unless a new value was typed or clearing was requested
        ...(token !== '' ? { gitlabToken: token } : {}),
        ...(clearToken ? { gitlabToken: '' } : {}),
      })
      pushToast('info', 'settings saved')
      onClose()
    } catch (error) {
      pushToast(
        'error',
        `settings: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const field_classes =
    'w-full rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[30rem] rounded-lg border border-edge bg-panel p-5 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="font-semibold text-ink">Settings</h2>
          <span className="grow" />
          <button className="text-soft hover:text-ink" onClick={onClose}>
            close
          </button>
        </div>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-soft uppercase">
            GitLab
          </h3>
          <label className="block text-xs text-soft">
            Instance URL
            <input
              className={`mt-1 ${field_classes}`}
              placeholder="https://gitlab.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="block text-xs text-soft">
            Token{' '}
            {state?.hasStoredToken === true && !clearToken && (
              <span className="text-emerald-600 dark:text-emerald-400">
                (stored — leave empty to keep)
              </span>
            )}
            <input
              type="password"
              className={`mt-1 ${field_classes}`}
              placeholder={
                state?.hasStoredToken === true ? '••••••••' : 'glpat-…'
              }
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setClearToken(false)
              }}
            />
          </label>
          {state?.hasStoredToken === true && (
            <label className="flex items-center gap-1.5 text-xs text-soft">
              <input
                type="checkbox"
                checked={clearToken}
                onChange={(e) => setClearToken(e.target.checked)}
              />
              clear the stored token
            </label>
          )}
          <label className="block text-xs text-soft">
            Token env var (used when no stored token)
            <input
              className={`mt-1 ${field_classes}`}
              placeholder="MY_GITLAB_TOKEN"
              value={tokenEnv}
              onChange={(e) => setTokenEnv(e.target.value)}
            />
          </label>
          <p className="text-xs text-faint">
            Resolution order: stored token → named env var →{' '}
            <span className="font-mono">GITLAB_TOKEN</span>.
            {state?.tokenSource != null && (
              <>
                {' '}
                Currently using:{' '}
                <span className="font-mono text-soft">
                  {state.tokenSource}
                </span>
                {state.effectiveUrl != null && (
                  <>
                    {' '}
                    against{' '}
                    <span className="font-mono text-soft">
                      {state.effectiveUrl}
                    </span>
                  </>
                )}
                .
              </>
            )}
            {state !== null && state.tokenSource === null && (
              <> No token is currently available.</>
            )}{' '}
            The stored token lives in plaintext in the local database.
          </p>
        </section>

        <section className="mt-5 space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-soft uppercase">
            Appearance
          </h3>
          <label className="flex items-center gap-2 text-xs text-soft">
            Theme
            <button
              className="rounded border border-edge px-2 py-1 text-ink hover:bg-overlay"
              onClick={toggleTheme}
            >
              {theme === 'dark' ? 'switch to light' : 'switch to dark'}
            </button>
          </label>
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-xs text-soft hover:text-ink"
            onClick={onClose}
          >
            cancel
          </button>
          <button
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
            onClick={() => void save()}
          >
            save
          </button>
        </div>
      </div>
    </div>
  )
}
