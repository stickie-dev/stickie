import { desktop } from '../desktop'
import { useReview } from '../store'

/**
 * The configured port was taken when the desktop app started, and it was
 * asked to run on another for now (desktop/src/main.ts). The port stays
 * where it was set, because agents' MCP connectors are configured with it —
 * so for as long as this run lasts they cannot reach it, and that has to be
 * on screen rather than left to an agent failing somewhere else.
 *
 * It goes once the two agree: started again on the configured port, or the
 * port moved in Settings → App to this one.
 */
export function StandInBanner() {
  const port = useReview((s) => s.port)
  if (port === null || !port.standIn || port.configured === port.running) {
    return null
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">
      <span>
        Agents can't reach this stickie: it is on port {port.running} this time
        because {port.configured} was taken, and they expect{' '}
        {port.configured}.
      </span>
      {desktop !== null ? (
        <button
          className="font-medium hover:underline"
          onClick={() => desktop?.relaunch()}
        >
          Restart stickie on {port.configured}
        </button>
      ) : (
        <span>Start stickie again once {port.configured} is free.</span>
      )}
    </div>
  )
}
