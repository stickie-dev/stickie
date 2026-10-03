import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from '../icons'
import { field, glass, motion } from '../ui'

export interface PickerOption {
  value: string
  label: string
  /** shown after the label, quietly — a branch, a state, a reason */
  hint?: string
}

export interface PickerGroup {
  label?: string
  options: PickerOption[]
}

/**
 * A chooser for one of a list, drawn by us rather than by the platform.
 *
 * These were `<select>`, and the two that matter sit in the top bar — which,
 * installed, *is* the window's title bar. A native popup is placed so that the
 * chosen option lands over the control, so choosing the fifteenth of twenty
 * branches asks for fourteen rows above a control that is already at the top
 * of the screen. What the reader gets is a list opening off the top edge, and
 * no amount of CSS reaches a popup the platform draws.
 *
 * So it opens downward from the trigger, always, and takes only the height it
 * has room for. That is the whole reason this exists — everything else here is
 * what a `<select>` already gave us and had to be written out again: the
 * keyboard, the selected state, closing on a click elsewhere.
 */
export function Picker({
  value,
  groups,
  onChange,
  title,
  label,
  className = '',
}: {
  value: string
  groups: PickerGroup[]
  onChange: (value: string) => void
  title?: string
  /** names the control for a screen reader, since there is no `<label>` on it */
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const flat = groups.flatMap((group) => group.options)
  const chosen = flat.find((option) => option.value === value)

  // the list opens on what is chosen, which is where a reader looks first
  useEffect(() => {
    if (!open) return
    const index = flat.findIndex((option) => option.value === value)
    setAt(index < 0 ? 0 : index)
  }, [open, value, flat.length])

  // focus moves to the list so the arrows reach it; without this the keyboard
  // opens a menu it cannot then walk
  useEffect(() => {
    if (open) list.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    list.current
      ?.querySelector('[data-at="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, at])

  const choose = (next: string) => {
    setOpen(false)
    trigger.current?.focus()
    if (next !== value) onChange(next)
  }

  const step = (delta: number) => {
    if (flat.length === 0) return
    setAt((was) => Math.min(Math.max(was + delta, 0), flat.length - 1))
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={title}
        className={`flex w-full items-center gap-1 ${field} py-0.5 text-left`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="min-w-0 truncate">{chosen?.label ?? value}</span>
        <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={list}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            // downward from the trigger, and never taller than the room under
            // it: the one thing the platform's own popup would not do here
            className={`absolute top-full left-0 z-50 mt-1 max-h-[min(24rem,calc(100vh-5rem))] w-max min-w-full overflow-y-auto rounded-lg py-1 ${glass}`}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
                trigger.current?.focus()
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                step(1)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                step(-1)
              }
              if (e.key === 'Home') {
                e.preventDefault()
                setAt(0)
              }
              if (e.key === 'End') {
                e.preventDefault()
                setAt(flat.length - 1)
              }
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const option = flat[at]
                if (option !== undefined) choose(option.value)
              }
            }}
          >
            {groups.map((group, index) => (
              <div key={group.label ?? `group-${String(index)}`}>
                {group.label !== undefined && (
                  <div className="px-2 pt-1.5 pb-0.5 text-meta tracking-[0.08em] text-faint uppercase">
                    {group.label}
                  </div>
                )}
                {group.options.map((option) => {
                  const here = flat.indexOf(option) === at
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      data-at={here}
                      className={`flex w-full items-center gap-2 px-2 py-1 text-left ${motion} ${
                        option.value === value ? 'text-ink' : 'text-soft'
                      } ${here ? 'bg-overlay' : 'hover:bg-overlay/70'}`}
                      onMouseEnter={() => setAt(flat.indexOf(option))}
                      onClick={() => choose(option.value)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      {option.hint !== undefined && (
                        <span className="ml-auto shrink-0 text-meta text-faint">
                          {option.hint}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
