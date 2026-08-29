import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import type { SettingsState } from '../../api'
import { useReview } from '../../store'

type SaveFields = Parameters<typeof api.saveSettings>[0]

export interface SettingsAccess {
  state: SettingsState | null
  /**
   * Stores only the fields it is given. The endpoint leaves anything omitted
   * untouched, which is what lets each section save on its own — a section
   * nobody opened cannot write a stale value over a fresh one.
   */
  save: (fields: SaveFields) => Promise<void>
  saving: boolean
}

export function useSettings(): SettingsAccess {
  const pushToast = useReview((s) => s.pushToast)
  const setWrapExtensions = useReview((s) => s.setWrapExtensions)
  const setRepinMode = useReview((s) => s.setRepinMode)
  const setSubmitKey = useReview((s) => s.setSubmitKey)
  const setNoteDefault = useReview((s) => s.setNoteDefault)
  const [state, setState] = useState<SettingsState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api
      .settings()
      .then(setState)
      .catch((error: unknown) =>
        pushToast(
          'error',
          `settings: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  }, [pushToast])

  const save = useCallback(
    async (fields: SaveFields) => {
      setSaving(true)
      try {
        const result = await api.saveSettings(fields)
        // re-read rather than patch: the server decides what a value resolved
        // to, and the token is only ever echoed back redacted
        const fresh = await api.settings()
        setState(fresh)
        setWrapExtensions(fresh.wrapExtensions)
        setRepinMode(fresh.repinMode)
        setSubmitKey(fresh.submitKey)
        setNoteDefault(fresh.noteDefault)
        pushToast(
          'info',
          result.restartRequired
            ? 'saved — restart stickie to use the new database'
            : 'saved',
        )
      } catch (error) {
        pushToast(
          'error',
          `settings: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        setSaving(false)
      }
    },
    [
      pushToast,
      setWrapExtensions,
      setRepinMode,
      setSubmitKey,
      setNoteDefault,
    ],
  )

  return { state, save, saving }
}
