import { describe, expect, it } from 'vitest'
import type { Fetcher } from './mcp.js'
import {
  handleMessage,
  protocol_version,
  toolDefinitions,
  tools,
} from './mcp.js'

const recorder = () => {
  const calls: unknown[] = []
  const fetcher: Fetcher = (call) => {
    calls.push(call)
    return Promise.resolve({ ok: true, status: 200, body: 'done' })
  }
  return { calls, fetcher }
}

const ask = async (message: unknown, fetcher: Fetcher) => {
  const answer = await handleMessage(JSON.stringify(message), fetcher, '0.0.0')
  return answer === null ? null : (JSON.parse(answer) as Record<string, any>)
}

describe('mcp', () => {
  it('announces tools on initialize', async () => {
    const { fetcher } = recorder()
    const answer = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize' }, fetcher)
    expect(answer?.result.protocolVersion).toBe(protocol_version)
    expect(answer?.result.capabilities.tools).toEqual({})
  })

  it('answers nothing to a notification', async () => {
    const { fetcher } = recorder()
    expect(
      await ask({ jsonrpc: '2.0', method: 'notifications/initialized' }, fetcher),
    ).toBeNull()
  })

  it('describes every tool with an input schema', () => {
    for (const tool of toolDefinitions() as Record<string, any>[]) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('maps a tool call onto its rest route', async () => {
    const { calls, fetcher } = recorder()
    const answer = await ask(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'list_notes', arguments: { sessionId: 7, status: 'open' } },
      },
      fetcher,
    )
    expect(calls).toEqual([
      { method: 'GET', path: '/api/sessions/7/threads?status=open' },
    ])
    expect(answer?.result.content[0].text).toBe('done')
  })

  it('replies as the agent', async () => {
    const { calls, fetcher } = recorder()
    await ask(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'reply_to_note',
          arguments: { sessionId: 12, note: 4, body: 'fixed' },
        },
      },
      fetcher,
    )
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/reviews/12/notes/4/reply',
        body: { author: 'agent', body: 'fixed' },
      },
    ])
  })

  it('reports bad arguments as a tool error, not a protocol error', async () => {
    const { calls, fetcher } = recorder()
    const answer = await ask(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'resolve_note', arguments: {} },
      },
      fetcher,
    )
    expect(calls).toEqual([])
    expect(answer?.result.isError).toBe(true)
  })

  it('surfaces a server failure as tool output', async () => {
    const failing: Fetcher = () =>
      Promise.resolve({ ok: false, status: 404, body: 'unknown session' })
    const answer = await ask(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_review_notes', arguments: { sessionId: 99 } },
      },
      failing,
    )
    expect(answer?.result.isError).toBe(true)
    expect(answer?.result.content[0].text).toContain('404')
  })

  it('rejects an unknown method', async () => {
    const { fetcher } = recorder()
    const answer = await ask({ jsonrpc: '2.0', id: 6, method: 'nope' }, fetcher)
    expect(answer?.error.code).toBe(-32601)
  })
})

describe('who a tool says it is', () => {
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)
    if (tool === undefined) throw new Error(`no tool ${name}`)
    return tool.request(args)
  }

  it('resolves as the agent, not as whoever runs the server', () => {
    expect(call('resolve_note', { sessionId: 12, note: 7 }).path).toBe(
      '/api/reviews/12/notes/7/resolve?author=agent',
    )
  })

  it('names the agent when it says who it is', () => {
    expect(
      call('resolve_note', { sessionId: 12, note: 7, actor: 'claude-code' })
        .path,
    ).toBe('/api/reviews/12/notes/7/resolve?author=agent&actor=claude-code')
  })

  it('reads the notes as the agent that asked for them', () => {
    expect(call('get_review_notes', { sessionId: 3, actor: 'codex' }).path).toBe(
      '/api/sessions/3/prompt?include_pending=0&author=agent&actor=codex',
    )
  })

  it('escapes a name that would otherwise break the query', () => {
    expect(
      call('resolve_note', { sessionId: 1, note: 1, actor: 'a&b c' }).path,
    ).toBe('/api/reviews/1/notes/1/resolve?author=agent&actor=a%26b%20c')
  })

  it('ignores a blank name rather than sending an empty one', () => {
    expect(
      call('resolve_note', { sessionId: 1, note: 1, actor: '   ' }).path,
    ).toBe('/api/reviews/1/notes/1/resolve?author=agent')
  })
})
