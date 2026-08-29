/**
 * Installing stickie as an app.
 *
 * A browser only offers this once it has a manifest and a registered service
 * worker, and it decides for itself when to offer it — the event may fire
 * before any component is mounted, or never (already installed, or a browser
 * that does not do this). So the event is caught at import time and held, and
 * anything that wants to offer a button subscribes.
 */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let waiting: InstallPrompt | null = null
const listeners = new Set<(available: boolean) => void>()

function announce(): void {
  for (const listener of listeners) listener(waiting !== null)
}

window.addEventListener('beforeinstallprompt', (event) => {
  // holding it is what lets stickie offer the choice in its own interface rather
  // than leaving it in a browser menu nobody opens
  event.preventDefault()
  waiting = event as InstallPrompt
  announce()
})

window.addEventListener('appinstalled', () => {
  waiting = null
  announce()
})

export function installable(): boolean {
  return waiting !== null
}

/** True when stickie is already running as its own window. */
export function installed(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true)
  )
}

export function onInstallable(listener: (available: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = waiting
  if (prompt === null) return 'unavailable'
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  // a prompt is single-use whichever way it went
  waiting = null
  announce()
  return outcome
}

export function registerWorker(): void {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // no worker means the browser may not offer to install, which is a
      // missing nicety rather than a broken review surface — but swallowing
      // the reason turns a five-second diagnosis into a hunt
      console.warn(
        'stickie: could not register the service worker, so this browser may not offer to install stickie as an app.',
        error,
      )
    })
  })
}
