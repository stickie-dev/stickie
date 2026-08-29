import { useEffect, useState } from 'react'
import { install, installable, installed, onInstallable } from '../../install'
import { useReview } from '../../store'
import { Mono, Section } from './parts'

/**
 * Running stickie in its own window. Nothing here is stored: whether the offer can
 * be made is the browser's decision, so this reports what it will allow rather
 * than keeping a setting of its own.
 */
export function AppSection() {
  const pushToast = useReview((s) => s.pushToast)
  const [available, setAvailable] = useState(installable())
  const standalone = installed()

  useEffect(() => onInstallable(setAvailable), [])

  return (
    <Section
      title="App"
      blurb="stickie can run in its own window instead of a browser tab — its own icon, no address bar, and the tab you keep losing stops being a tab."
    >
      {standalone ? (
        <p className="text-xs text-soft">
          Already running as an app. Remove it the way your browser removes any
          installed app.
        </p>
      ) : available ? (
        <div className="space-y-2">
          <button
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong"
            onClick={() => {
              void install().then((outcome) => {
                if (outcome === 'dismissed') pushToast('info', 'not installed')
              })
            }}
          >
            Install stickie
          </button>
          <p className="text-xs text-faint">
            Opens your browser's own install prompt.
          </p>
        </div>
      ) : (
        <p className="text-xs text-faint">
          Your browser is not offering to install this page right now. Chrome and
          Edge put the same thing in the address bar or under their menu as
          &ldquo;Install&rdquo;; Safari calls it &ldquo;Add to Dock&rdquo;.
          Firefox does not install desktop web apps at all.
        </p>
      )}

      <p className="pt-2 text-xs text-faint">
        Installed or not, stickie is the same local server on the same port — the
        window is the only difference, and it still needs{' '}
        <Mono>stickie</Mono> running to have anything to show.
      </p>
    </Section>
  )
}
