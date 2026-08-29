import { z } from '@hono/zod-openapi'

/**
 * The agent-facing REST surface, declared once as MCP tools. Each entry names
 * the route it stands for, so the tool list and the HTTP API cannot drift:
 * the tool only shapes arguments and reads the response.
 *
 * This speaks JSON-RPC over stdio (`stickie-mcp`), which is what agent runtimes
 * launch; it talks to a stickie server that is already running.
 */

export const protocol_version = '2025-06-18'

interface Call {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  /** text/plain routes hand their body back untouched */
  text?: boolean
}

export interface McpTool {
  name: string
  description: string
  /** no writes, so a runtime may call it without asking */
  readOnly: boolean
  input: z.ZodType
  request: (args: Record<string, unknown>) => Call
}

const session_id = z.object({
  sessionId: z.number().int().describe('id from list_reviews'),
})

/**
 * How a tool tells the record who is asking. Every one of these calls is an
 * agent, so the author is not in question — only which agent, and that is
 * optional so a runtime that passes nothing still gets attributed as an agent
 * rather than as the person at the machine.
 */
function claiming(actor: unknown): string {
  const name = typeof actor === 'string' ? actor.trim() : ''
  return `author=agent${name === '' ? '' : `&actor=${encodeURIComponent(name)}`}`
}

const actor_input = z
  .string()
  .max(64)
  .optional()
  .describe('what to call yourself in the record, e.g. "claude-code"')

/**
 * A note is named by its number inside its review, counting from 0 — the
 * number `list_notes` and the markdown export both carry. Numbers are never
 * reused, so one that no note holds is an error rather than the next note
 * along.
 */
const note_input = z
  .number()
  .int()
  .min(0)
  .describe('the note number within that review, from list_notes')

export const tools: McpTool[] = [
  {
    name: 'list_reviews',
    description:
      'List review sessions, newest first, with the repository under review ' +
      'and how many notes are waiting. Start here when no session id is known.',
    readOnly: true,
    input: z.object({}),
    request: () => ({ method: 'GET', path: '/api/sessions' }),
  },
  {
    name: 'get_review_notes',
    description:
      'The work order for one review as markdown: every unresolved note with ' +
      'its location, the code as captured, referenced code, and the ' +
      'discussion so far. Line numbers are re-anchored at read time.',
    readOnly: true,
    input: z.object({
      sessionId: z.number().int().describe('id from list_reviews'),
      actor: actor_input,
    }),
    // reading the notes is recorded, and an agent fetching them for itself is
    // not the human handing them over
    request: (args) => ({
      method: 'GET',
      path:
        `/api/sessions/${String(args.sessionId)}/prompt` +
        `?include_pending=0&${claiming(args.actor)}`,
      text: true,
    }),
  },
  {
    name: 'list_notes',
    description:
      'The same notes as structured JSON — numbers, paths, line ranges, ' +
      'status, messages — for filtering or exact line work. `number` is what ' +
      'the reply and resolve tools take. Status `detached` means the code a ' +
      'note was written against is gone: ask, never guess.',
    readOnly: true,
    input: session_id.extend({
      status: z
        .enum(['open', 'resolved', 'detached'])
        .optional()
        .describe('omit for every note'),
    }),
    request: (args) => {
      const status = args.status
      const query = typeof status === 'string' ? `?status=${status}` : ''
      return {
        method: 'GET',
        path: `/api/sessions/${String(args.sessionId)}/threads${query}`,
      }
    },
  },
  {
    name: 'reply_to_note',
    description:
      'Reply to one note as the agent. Say what changed, in one sentence. ' +
      'Reply and leave the note open when declining or unsure.',
    readOnly: false,
    input: session_id.extend({
      note: note_input,
      body: z.string().min(1).describe('what was done, or why it was not'),
      actor: actor_input,
    }),
    request: (args) => ({
      method: 'POST',
      path: `/api/reviews/${String(args.sessionId)}/notes/${String(args.note)}/reply`,
      body: {
        author: 'agent',
        body: args.body,
        ...(args.actor === undefined ? {} : { actor: args.actor }),
      },
    }),
  },
  {
    name: 'resolve_note',
    description:
      'Mark one note resolved, after replying to it. Only for notes actually ' +
      'addressed — the user reopens what they disagree with.',
    readOnly: false,
    input: session_id.extend({ note: note_input, actor: actor_input }),
    // an agent closing its own work and a human accepting it are different
    // facts; without saying which, the record used to credit the human
    request: (args) => ({
      method: 'POST',
      path:
        `/api/reviews/${String(args.sessionId)}/notes/${String(args.note)}` +
        `/resolve?${claiming(args.actor)}`,
    }),
  },
]

export function toolDefinitions(): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    annotations: { readOnlyHint: tool.readOnly },
  }))
}

interface Request {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

export type Fetcher = (
  call: Call,
) => Promise<{ ok: boolean; status: number; body: string }>

/** A fetcher against a running stickie server. */
export function httpFetcher(baseUrl: string): Fetcher {
  return async (call) => {
    const response = await fetch(`${baseUrl}${call.path}`, {
      method: call.method,
      ...(call.body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(call.body),
          }),
    })
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    }
  }
}

function result(id: Request['id'], value: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result: value })
}

function failure(id: Request['id'], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

function text(body: string, isError = false): unknown {
  return { content: [{ type: 'text', text: body }], isError }
}

/**
 * Handle one incoming message. Returns the line to write back, or null for
 * notifications, which take no reply.
 */
export async function handleMessage(
  raw: string,
  fetcher: Fetcher,
  version: string,
): Promise<string | null> {
  let request: Request
  try {
    request = JSON.parse(raw) as Request
  } catch {
    return failure(null, -32700, 'parse error')
  }
  const id = request.id
  const method = request.method
  if (method === undefined) return failure(id, -32600, 'no method')
  // notifications carry no id and expect no answer
  if (id === undefined || id === null) return null

  if (method === 'initialize') {
    return result(id, {
      protocolVersion: protocol_version,
      capabilities: { tools: {} },
      serverInfo: { name: 'stickie', version },
      instructions:
        'Review notes a human left on the code you are editing. Read them ' +
        'with get_review_notes, address each one, then reply and resolve.',
    })
  }
  if (method === 'ping') return result(id, {})
  if (method === 'tools/list') return result(id, { tools: toolDefinitions() })
  if (method !== 'tools/call') {
    return failure(id, -32601, `unknown method: ${method}`)
  }

  const name = request.params?.name
  const tool = tools.find((entry) => entry.name === name)
  if (tool === undefined) {
    return failure(id, -32602, `unknown tool: ${String(name)}`)
  }
  const parsed = tool.input.safeParse(request.params?.arguments ?? {})
  if (!parsed.success) {
    return result(id, text(`invalid arguments: ${parsed.error.message}`, true))
  }
  let response: Awaited<ReturnType<Fetcher>>
  try {
    response = await fetcher(tool.request(parsed.data as Record<string, unknown>))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return result(
      id,
      text(`stickie server unreachable: ${reason}`, true),
    )
  }
  if (!response.ok) {
    return result(
      id,
      text(`stickie returned ${response.status}: ${response.body}`, true),
    )
  }
  return result(id, text(response.body))
}
