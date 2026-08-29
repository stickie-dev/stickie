import { useEffect, useRef, useSyncExternalStore } from 'react'
import { answer, current, subscribe } from '../confirm'
import { btn, enter } from '../ui'

/**
 * The window for `ask()`. Mounted once, above everything, showing whichever
 * question is open.
 *
 * Escape and the backdrop both mean no, because the safe answer is the one a
 * stray keypress should give. Focus moves to the dialog so the keyboard can
 * answer it, and returns to whatever had it when the question is closed —
 * otherwise a delete taken from a note card leaves the reader's focus nowhere.
 */
export function ConfirmDialog() {
  const request = useSyncExternalStore(subscribe, current, () => null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    if (request === null) return
    opener.current = document.activeElement
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        answer(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const back = opener.current
      if (back instanceof HTMLElement) back.focus()
    }
  }, [request])

  if (request === null) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/25 pt-32"
      onClick={() => answer(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        className={`w-[26rem] rounded-lg bg-panel p-4 shadow-lifted ${enter}`}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-note font-semibold text-ink">{request.title}</p>
        {request.detail !== undefined && (
          <p className="mt-1.5 text-xs leading-relaxed text-soft">
            {request.detail}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className={`text-xs ${btn()}`} onClick={() => answer(false)}>
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            className={`text-xs ${
              request.danger === true
                ? btn(
                    'primary',
                    'bg-rose-600 hover:bg-rose-500 disabled:bg-rose-600/35',
                  )
                : btn('primary')
            }`}
            onClick={() => answer(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
