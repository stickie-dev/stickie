import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * What the app remembers about itself, apart from everything stickie keeps in
 * its database: these are about this window on this machine, not about any
 * review, and they belong to the app whether it runs its own server or uses
 * one a terminal started.
 */
export interface Preferences {
  /**
   * What closing the window does while this app is the server: keep serving
   * from the menu bar, or quit. Unset until asked, the first time it matters.
   */
  onClose?: 'keep' | 'quit'
  bounds?: { x: number; y: number; width: number; height: number }
  maximized?: boolean
}

const file = () => path.join(app.getPath('userData'), 'preferences.json')

export function readPreferences(): Preferences {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Preferences)
      : {}
  } catch {
    // missing or unreadable is the same as never having chosen anything
    return {}
  }
}

export function writePreferences(change: Partial<Preferences>): Preferences {
  const next = { ...readPreferences(), ...change }
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), `${JSON.stringify(next, null, 2)}\n`)
  return next
}
