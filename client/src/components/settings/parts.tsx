import type { ReactNode } from 'react'
import { btn, field, sunken } from '../../ui'

export const field_classes = `w-full py-1.5 font-mono text-xs ${field}`

export function Section({
  title,
  blurb,
  children,
}: {
  title: string
  blurb?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="max-w-2xl">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {blurb !== undefined && (
        <p className="mt-1 text-xs text-faint">{blurb}</p>
      )}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block text-xs text-soft">
      {label}
      <div className="mt-1">{children}</div>
      {hint !== undefined && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </label>
  )
}

/** Each section saves on its own, so each section carries its own button. */
export function SaveRow({
  saving,
  onSave,
  children,
}: {
  saving: boolean
  onSave: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        className={`text-xs ${btn('primary', 'px-3 py-1.5')}`}
        disabled={saving}
        onClick={onSave}
      >
        {saving ? 'saving…' : 'save'}
      </button>
      {children}
    </div>
  )
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-soft">{children}</span>
}

/** A shell command, on one line, selectable and copyable. */
export function Command({ text }: { text: string }) {
  return (
    <pre className={`overflow-x-auto px-2 py-1.5 font-mono text-xs text-ink ${sunken}`}>
      {text}
    </pre>
  )
}
