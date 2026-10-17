import { Command, Mono, Section } from './parts'
import type { SettingsAccess } from './useSettings'

const mcp_tools: [string, string, string][] = [
  ['list_reviews', 'GET /api/sessions', 'read-only'],
  ['get_review_notes', 'GET /api/sessions/:id/prompt', 'read-only'],
  ['list_notes', 'GET /api/sessions/:id/threads', 'read-only'],
  ['reply_to_note', 'POST /api/threads/:id/reply', 'writes'],
  ['resolve_note', 'POST /api/threads/:id/resolve', 'writes'],
]

/** Reference only: nothing here is stored, so there is nothing to save. */
export function AgentsSection({ state }: SettingsAccess) {
  const origin = window.location.origin
  // where agents find stickie: the configured port, which is not this page's
  // when the page is on Vite, or on a port this run stood in on
  const mcp_url =
    state === null
      ? `${origin}/mcp`
      : `http://localhost:${String(state.port.configured)}/mcp`

  return (
    <Section
      title="Agents"
      blurb="How an agent reads the notes and answers them. Any agent that can speak HTTP works; MCP is the shortcut for the ones that speak that."
    >
      <div className="space-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-soft uppercase">
          This server
        </h3>
        <p className="text-xs text-faint">
          API base <Mono>{origin}</Mono> — interactive docs at{' '}
          <a
            className="text-accent hover:underline"
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
          >
            /api/docs
          </a>
          , machine spec at{' '}
          <a
            className="text-accent hover:underline"
            href="/api/openapi.json"
            target="_blank"
            rel="noreferrer"
          >
            /api/openapi.json
          </a>
          . It binds 127.0.0.1 only.
        </p>
      </div>

      <div className="space-y-1 pt-2">
        <h3 className="text-xs font-semibold tracking-wide text-soft uppercase">
          MCP
        </h3>
        <p className="text-xs text-faint">
          This server speaks MCP itself, so a client that speaks streamable HTTP
          needs no bridge at all:
        </p>
        <Command text={`claude mcp add --transport http stickie ${mcp_url}`} />
        <p className="pt-1 text-xs text-faint">
          For a client that only speaks stdio, <Mono>stickie-mcp</Mono> bridges to
          the same tools against a <em>running</em> stickie — it starts nothing
          itself.
        </p>
        <Command text={state?.mcpCommand ?? '…'} />
        <table className="mt-2 w-full text-xs">
          <tbody>
            {mcp_tools.map(([tool, route, kind]) => (
              <tr key={tool} className="border-t border-edge">
                <td className="py-1 pr-3 font-mono text-ink">{tool}</td>
                <td className="py-1 pr-3 font-mono text-soft">{route}</td>
                <td className="py-1 text-faint">{kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pt-1 text-xs text-faint">
          Point the bridge elsewhere with <Mono>--url</Mono> or{' '}
          <Mono>STICKIE_URL</Mono>.
        </p>
      </div>

      <div className="space-y-1 pt-2">
        <h3 className="text-xs font-semibold tracking-wide text-soft uppercase">
          No integration at all
        </h3>
        <p className="text-xs text-faint">
          <strong className="font-medium text-soft">Copy prompt</strong> puts
          every unresolved note — pending batch included — on the clipboard as
          markdown with language-tagged code fences, ready to paste into
          anything. The instruction block it appends lives under Copy prompt.
        </p>
      </div>
    </Section>
  )
}
