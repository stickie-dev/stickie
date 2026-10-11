/**
 * The desktop app, from the page's side.
 *
 * The same page runs in a browser tab and in stickie's own window; in the window
 * the app's preload puts `window.stickieDesktop` there, and that is the whole
 * difference. Everything here starts by asking whether it exists.
 *
 * stickie used to be installable as a browser's web app, with a manifest and a
 * service worker. That is gone: a browser's install button can only ever
 * install the page as the browser's own app, with the browser's buttons in
 * its title bar, and there is no way to point it at a real app instead. What
 * is left of it is undone here — a worker a browser registered before keeps
 * running until something unregisters it.
 */

export type CloseBehaviour = 'keep' | 'quit'

export interface DesktopBridge {
  about: () => Promise<{
    version: string
    platform: string
    /** whether the app runs the server, rather than using a terminal's */
    serving: boolean
    url: string
  }>
  closeBehaviour: () => Promise<CloseBehaviour | null>
  setCloseBehaviour: (value: CloseBehaviour) => Promise<void>
  setTitleBarColors: (colors: { color: string; symbolColor: string }) => void
  openInBrowser: () => void
  /** quits and starts again, for a setting that only applies at start */
  relaunch: () => void
  onCommand: (listener: (command: string) => void) => () => void
}

declare global {
  interface Window {
    stickieDesktop?: DesktopBridge
  }
}

/** The app around this page, or null in a browser tab. */
export const desktop: DesktopBridge | null = window.stickieDesktop ?? null

// the top bar leaves room for the window's own buttons, and which end they
// are at is known before anything is drawn (index.css, the title bar)
if (desktop !== null) {
  const mac = /Mac/.test(navigator.userAgent)
  document.documentElement.classList.add(
    'stickie-desktop',
    mac ? 'stickie-desktop-mac' : 'stickie-desktop-other',
  )
}

/**
 * Running as a browser's installed web app — the retired way of having stickie
 * in a window of its own. Its own window, and no app around it.
 */
export function inBrowserApp(): boolean {
  if (desktop !== null) return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches
  )
}

/** Unregisters the service worker a browser install left behind, if any. */
export function retireWorker(): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const registration of registrations) void registration.unregister()
    })
    .catch(() => undefined)
}
