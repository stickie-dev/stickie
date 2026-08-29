import { useEffect, useState } from 'react'
import { timeExact, timeLabel } from '../time'

/**
 * An age that keeps itself honest. One timer for the whole page rather than one
 * per timestamp: a review can have a hundred of them, and they all want the
 * same tick.
 */

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  timer ??= setInterval(() => {
    for (const listener of listeners) listener()
  }, 30_000)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function TimeAgo({
  at,
  className,
}: {
  at: string | null | undefined
  className?: string
}) {
  const [, tick] = useState(0)
  useEffect(() => subscribe(() => tick((n) => n + 1)), [])
  const label = timeLabel(at)
  if (label === '') return null
  return (
    <span className={className} title={timeExact(at)}>
      {label}
    </span>
  )
}
