import type { SubmitKey } from './api'

interface EnterEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Whether this Enter posts what is being written. One rule for every box —
 * note, reply and edit — so the same keystroke never means two things.
 *
 * ⌘/ctrl+Enter always posts whatever the setting says: it has never meant a
 * new line anywhere, so honouring it costs nothing and saves the muscle memory
 * of anyone who set the other mode.
 */
export function postsComment(event: EnterEvent, mode: SubmitKey): boolean {
  if (event.key !== 'Enter') return false
  if (event.metaKey || event.ctrlKey) return true
  return mode === 'enter' && !event.shiftKey && !event.altKey
}
