// Fills the showcase's own stickie (port 4879) with invented reviews of the
// invented orbit repos. Human notes go through the REST API the way the page
// sends them; every agent move goes through the MCP endpoint, as an agent's
// would. Run by reset.sh, against a fresh scratch database.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { repos, showcase } from './paths.mjs'

const base = process.env.STICKIE_URL ?? 'http://localhost:4879'


async function api(method, route, body) {
  const res = await fetch(base + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text}`)
  return text === '' ? null : JSON.parse(text)
}

let rpc = 0
async function mcp(name, args) {
  rpc += 1
  const out = await api('POST', '/mcp', {
    jsonrpc: '2.0',
    id: rpc,
    method: 'tools/call',
    params: { name, arguments: { actor: 'claude-code', ...args } },
  })
  if (out.error || out.result?.isError) throw new Error(`${name}: ${JSON.stringify(out)}`)
  return out.result
}

/** the line `needle` is on, in `file` at `ref` of a repo */
function lineOf(repo, ref, file, needle) {
  const text = execFileSync('git', ['-C', repo, 'show', `${ref}:${file}`], { encoding: 'utf8' })
  const at = text.split('\n').findIndex((line) => line.includes(needle))
  if (at < 0) throw new Error(`no "${needle}" in ${ref}:${file}`)
  return at + 1
}

async function note(review, file, ref, repo, needle, body, opts = {}) {
  const start = file === '' ? 0 : lineOf(repo, ref, file, needle)
  const end = opts.span ? start + opts.span : start
  return api('POST', `/api/sessions/${review.id}/threads`, {
    path: file,
    side: 'source',
    startLine: start,
    endLine: end,
    body,
    author: 'user',
  })
}

const reply = (review, n, body) => mcp('reply_to_note', { sessionId: review.id, note: n, body })
const resolve = (review, n) => mcp('resolve_note', { sessionId: review.id, note: n })

// ------------------------------------------------------------------ repos
const known = await api('GET', '/api/repos')
const repo = {}
for (const [key, at] of Object.entries(repos)) {
  repo[key] = known.find((r) => r.path === at) ?? (await api('POST', '/api/repos', { path: at }))
}

// ------------------------------------------- 1. a branch that is done: clear
const currency = await api('POST', '/api/sessions', {
  repoId: repo.web.id,
  source: { kind: 'ref', value: 'chore/currency' },
})
await note(currency, 'src/components/OrderList.tsx', 'chore/currency', repos.web,
  "new Intl.NumberFormat('en-IE'",
  'Format with the customer\'s locale rather than en-IE — `navigator.language` is enough here.')
await api('POST', `/api/sessions/${currency.id}/submit-review?author=user`, {})
await reply(currency, 0, 'Now uses navigator.language, falling back to en-IE when it is unset.')
await resolve(currency, 0)

// --------------------------------------------- 2. still being written: draft
const paging = await api('POST', '/api/sessions', {
  repoId: repo.api.id,
  source: { kind: 'ref', value: 'fix/pagination' },
})
await note(paging, 'src/db.ts', 'fix/pagination', repos.api, 'Math.min(limit, 100)',
  'A client asking for 500 silently gets 100. Say so — a `limit` field in the response, or a 400 above the cap.')
await note(paging, 'src/db.ts', 'fix/pagination', repos.api, '.sort((a, b)',
  'Sorting the whole list per request is fine at this size, but `findIndex` on `after` now depends on that order — worth a test with two orders at the same `createdAt`.',
  { span: 0 })

// ---------------------------------- 4. the agent has answered: needs you
const limit = await api('POST', '/api/sessions', {
  repoId: repo.api.id,
  source: { kind: 'worktree', value: repos.api },
})
await note(limit, 'src/ratelimit.ts', 'feat/rate-limit', repos.api, 'const buckets = new Map',
  'This map only grows: one bucket per customer, never evicted. Drop buckets that have refilled to capacity, or cap the map.')
await note(limit, 'src/ratelimit.ts', 'feat/rate-limit', repos.api, "req.header('x-customer') ?? req.ip",
  '`x-customer` is sent by the client, so anyone can reset their limit by changing it. Key on `req.ip` until API keys land.')
await note(limit, 'src/ratelimit.ts', 'feat/rate-limit', repos.api, "res.setHeader('Retry-After'",
  `orbit-web turns this into a countdown (@orbit-web:src/api.ts:L${lineOf(repos.web, 'feat/retry-banner', 'src/api.ts', "res.headers.get('Retry-After')")}) — keep it whole seconds, and say so in the doc comment.`,
  { span: 1 })
await note(limit, 'test/ratelimit.test.ts', 'feat/rate-limit', repos.api, "it('answers 429 once the bucket is empty'",
  'Add a case for the refill: wait, and the next request passes again. Fake timers make it instant.')
await api('POST', `/api/sessions/${limit.id}/submit-review?author=user`, {})

execFileSync('bash', [path.join(showcase, 'agent-round.sh')], { stdio: 'inherit' })
await reply(limit, 0, 'Full buckets are now swept once a minute. Would you rather have an LRU cap instead? A sweep keeps the code shorter.')
await reply(limit, 1, 'Keyed on req.ip, with a TODO pointing at the API-key work.')
await resolve(limit, 1)
await reply(limit, 2, 'Kept as integer seconds and documented on rateLimit().')
await resolve(limit, 2)
await reply(limit, 3, 'Added "lets a request through again after the refill", using vi.useFakeTimers().')

// ---------------------------- 5. sent to the agent, no answer yet: with agent
const banner = await api('POST', '/api/sessions', {
  repoId: repo.web.id,
  source: { kind: 'worktree', value: repos.web },
})
await note(banner, 'src/api.ts', 'feat/retry-banner', repos.web, "res.headers.get('Retry-After')",
  `orbit-api sends whole seconds (@orbit-api:src/ratelimit.ts:L${lineOf(repos.api, 'HEAD', 'src/ratelimit.ts', "res.setHeader('Retry-After'")}), but a proxy in between may not. Guard against NaN here rather than waiting 0s and hammering it again.`)
await note(banner, 'src/components/RetryBanner.tsx', 'feat/retry-banner', repos.web, 'if (left <= 0) return onRetry()',
  'A second 429 while the banner is up keeps the old countdown. Key the banner on the error so it starts over.')
await note(banner, '', 'feat/retry-banner', repos.web, '',
  'Copy check: "Too many requests" reads like the user did something wrong. Something like "Busy right now" would be kinder.')
await api('POST', `/api/sessions/${banner.id}/submit-review?author=user`, {})

const ids = { currency: currency.id, paging: paging.id, banner: banner.id, limit: limit.id }
console.log(JSON.stringify(ids))
