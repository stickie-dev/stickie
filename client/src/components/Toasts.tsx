import { useReview } from '../store'
import { enter } from '../ui'

export function Toasts() {
  const toasts = useReview((s) => s.toasts)
  const dismissToast = useReview((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-12 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`${enter} rounded-lg px-3 py-2 text-left text-xs shadow-lifted ${
            toast.kind === 'error'
              ? 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
              : 'bg-panel text-ink'
          }`}
          title="dismiss"
          onClick={() => dismissToast(toast.id)}
        >
          {toast.text}
        </button>
      ))}
    </div>
  )
}
