import { useEffect, useState } from 'react'
import type { CloseBehaviour } from '../../desktop'
import { desktop, inBrowserApp } from '../../desktop'
import { Command, Field, Mono, Section } from './parts'
import type { SettingsAccess } from './useSettings'
import { field } from '../../ui'

const close_choices: { value: CloseBehaviour; label: string; why: string }[] = [
  {
    value: 'keep',
    label: 'Keep stickie running in the menu bar',
    why: 'Agents and browser tabs keep reaching it. Quit from the menu-bar icon, or with ⌘Q.',
  },
  {
    value: 'quit',
    label: 'Quit stickie',
    why: 'The server stops with the window, and agents lose it until stickie is opened again.',
  },
]

/** In stickie's own window: what closing it does, and where it is being served. */
function InTheApp({ bridge }: { bridge: NonNullable<typeof desktop> }) {
  const [about, setAbout] = useState<Awaited<
    ReturnType<typeof bridge.about>
  > | null>(null)
  const [onClose, setOnClose] = useState<CloseBehaviour | null>(null)

  useEffect(() => {
    void bridge.about().then(setAbout)
    void bridge.closeBehaviour().then(setOnClose)
  }, [bridge])

  return (
    <>
      <p className="text-xs text-soft">
        {about === null
          ? 'Running as an app.'
          : `stickie ${about.version}, serving ${about.url}${
              about.serving ? '' : ' from a stickie started in a terminal'
            }.`}{' '}
        <button
          className="text-accent hover:underline"
          onClick={() => bridge.openInBrowser()}
        >
          Open in a browser tab
        </button>
      </p>
      {about?.serving !== false && (
        <Field
          label="When the window closes"
          hint="Asked the first time the window closes, if it has not been chosen here."
        >
          <div className="space-y-2">
            {close_choices.map((choice) => (
              <label
                key={choice.value}
                className="flex cursor-pointer gap-2 text-xs"
              >
                <input
                  type="radio"
                  name="close-behaviour"
                  className="mt-0.5 shrink-0"
                  checked={onClose === choice.value}
                  onChange={() => {
                    setOnClose(choice.value)
                    void bridge.setCloseBehaviour(choice.value)
                  }}
                />
                <span>
                  <span className="text-ink">{choice.label}</span>
                  <span className="block text-faint">{choice.why}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      )}
    </>
  )
}

/**
 * Where stickie listens. Kept in ~/.stickie/config.json beside the database's
 * location, because everything that reaches stickie has to know it before it
 * can ask stickie anything: `stickie`, the desktop app, the MCP bridge an agent
 * starts, and Vite. Taking effect means starting again, so the app offers to
 * do that; a terminal's `stickie` has to be started again by hand.
 *
 * The one thing that does not follow is an MCP connector added over HTTP: its
 * address is written into the agent's own configuration. So a change says
 * so, and gives the command to add it again.
 */
function Port({ state, save }: SettingsAccess) {
  const [text, setText] = useState('')
  // the port agents were added with, as far as this page knows: what was
  // configured when it opened, so a change away from it shows the command
  const [before, setBefore] = useState<number | null>(null)
  const [about, setAbout] = useState<{ serving: boolean } | null>(null)
  useEffect(() => {
    if (state === null) return
    setText(String(state.port.configured))
    setBefore((known) => known ?? state.port.configured)
  }, [state])
  useEffect(() => {
    void desktop?.about().then(setAbout)
  }, [])
  if (state === null) return null
  const { configured, running, fromEnv } = state.port

  const value = Number(text.trim())
  const bad = !(Number.isInteger(value) && value >= 1024 && value <= 65535)
  const pending = configured !== running

  return (
    <Field
      label="Port"
      hint={
        fromEnv ? (
          <>
            Set by <Mono>STICKIE_PORT</Mono> in the environment stickie was started
            from, so it cannot be changed here.
          </>
        ) : (
          <>
            Used from the next start, by <Mono>stickie</Mono>, the desktop app and
            the stdio MCP bridge alike. An MCP connector added over HTTP has
            the address written into it, so it has to be added again; a
            browser tab on the old address stops working when stickie restarts.
          </>
        )
      }
    >
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink">localhost:</span>
        <input
          // not `field_classes`: that is full width
          className={`w-20 py-1.5 font-mono text-xs ${field}`}
          inputMode="numeric"
          aria-label="port stickie listens on"
          disabled={fromEnv}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!bad && value !== configured) {
              void save({ port: value }, { quiet: true })
            }
          }}
        />
        {pending &&
          (desktop !== null && about?.serving === true ? (
            <button
              className="text-accent hover:underline"
              onClick={() => desktop?.relaunch()}
            >
              restart stickie to use {configured}
            </button>
          ) : (
            <span className="text-faint">
              running on {running} until stickie is started again
            </span>
          ))}
      </span>
      {bad && (
        <p className="mt-1 text-xs text-rose-500">
          A port from 1024 to 65535.
        </p>
      )}
      {before !== null && before !== configured && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-faint">
            An agent that reaches stickie over HTTP needs adding again — remove
            the old one first (<Mono>claude mcp remove stickie</Mono>):
          </p>
          <Command
            text={`claude mcp add --transport http stickie http://localhost:${String(configured)}/mcp`}
          />
        </div>
      )}
    </Field>
  )
}

/**
 * stickie as an app of its own. In the app, how it behaves; in a browser, where
 * to get it — and, in what is left of a browser's install of it, that it is
 * the old way.
 */
export function AppSection(access: SettingsAccess) {
  return (
    <Section
      title="App"
      blurb="stickie runs in a browser tab, or in a window of its own with its own icon and menu-bar presence. Either way it is the same local server on the same port, and both can be open at once."
    >
      {desktop !== null ? (
        <InTheApp bridge={desktop} />
      ) : (
        <>
          {inBrowserApp() && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              This window is your browser's install of stickie, which is no longer
              offered. Remove it the way your browser removes an installed app,
              and use the desktop app or a tab instead.
            </p>
          )}
          <Field
            label="The desktop app"
            hint={
              <>
                Built from this repository: <Mono>pnpm desktop:dist</Mono>{' '}
                writes installers for this machine to{' '}
                <Mono>desktop/release</Mono> — a <Mono>.dmg</Mono> on macOS, an
                installer on Windows, an AppImage on Linux. It is not signed, so
                macOS asks before opening it the first time: right-click it and
                choose Open.
              </>
            }
          >
            <p className="text-xs text-soft">
              It runs the server itself, so it replaces <Mono>stickie</Mono> in a
              terminal; a <Mono>stickie</Mono> started while the app is open hands
              its repository to the app and opens a tab on it.
            </p>
          </Field>
        </>
      )}
      <Port {...access} />
      <p className="pt-2 text-xs text-faint">
        Agents reach stickie through <Mono>stickie-mcp</Mono>, which talks to
        whichever server is running — the app's or a terminal's.
      </p>
    </Section>
  )
}
