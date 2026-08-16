import { useReview } from '../store'

export function Toasts() {
  const toasts = useReview((s) => s.toasts)
  const dismissToast = useReview((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-12 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          className={`rounded-md border px-3 py-2 text-left text-xs shadow-xl ${
            toast.kind === 'error'
              ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200'
              : 'border-edge bg-panel text-ink'
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
