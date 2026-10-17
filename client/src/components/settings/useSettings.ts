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
  save: (fields: SaveFields, options?: { quiet?: boolean }) => Promise<void>
  saving: boolean
}

export function useSettings(): SettingsAccess {
  const pushToast = useReview((s) => s.pushToast)
  const setWrapExtensions = useReview((s) => s.setWrapExtensions)
  const setRepinMode = useReview((s) => s.setRepinMode)
  const setSubmitKey = useReview((s) => s.setSubmitKey)
  const setNoteDefault = useReview((s) => s.setNoteDefault)
  const setPortState = useReview((s) => s.setPortState)
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

  /**
   * `quiet` is for a control that saved itself. A radio that has moved, or a
   * field you have just left, has already shown you what it did; a toast on
   * top of that is the interface reading its own work back to you, once per
   * click. A failure still speaks, because that is the case where the control
   * is showing something that did not happen.
   */
  const save = useCallback(
    async (fields: SaveFields, options?: { quiet?: boolean }) => {
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
        setPortState(fresh.port)
        if (result.restartRequired) {
          pushToast('info', 'saved — it takes effect when stickie is started again')
        } else if (options?.quiet !== true) {
          pushToast('info', 'saved')
        }
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
      setPortState,
    ],
  )

  return { state, save, saving }
}
