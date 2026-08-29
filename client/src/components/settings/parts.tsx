import { useEffect, useRef, useState } from 'react'
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

/**
 * The button for the few settings that are not applied as they are touched: a
 * name, the prompt instructions, the database behind everything. Those are
 * written rather than chosen, and a half-written one is not an answer — so
 * they wait to be applied, and everything else saves itself.
 */
export function ApplyRow({
  saving,
  onApply,
  children,
}: {
  saving: boolean
  onApply: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button
        className={`text-xs ${btn('primary', 'px-3 py-1.5')}`}
        disabled={saving}
        onClick={onApply}
      >
        {saving ? 'applying…' : 'apply'}
      </button>
      {children}
    </div>
  )
}

/**
 * A field's local copy of a setting.
 *
 * Every save re-reads the whole settings object, and now that most of them
 * save themselves that happens while someone is in the middle of typing
 * somewhere else — a radio in Reviews would have reset a half-written prompt
 * to what the server still had. So the answer from the server is adopted only
 * when the box still holds what the server last said. What a reader typed
 * outranks what the reader has not changed.
 */
export function useFieldValue(saved: string | undefined) {
  const [value, setValue] = useState(saved ?? '')
  /** what the server last said, which is what "untouched" means here */
  const shown = useRef(saved)

  useEffect(() => {
    if (saved === undefined) return
    setValue((current) => (current === (shown.current ?? '') ? saved : current))
    shown.current = saved
  }, [saved])

  return { value, setValue, dirty: value !== (saved ?? '') }
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
