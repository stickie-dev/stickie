// The README's GIFs. Each starts from a freshly reset showcase.
//   VW=1200 VH=760 node gifs.mjs [loop|refs]   (run.sh does this)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { base, connect, sleep } from './cdp.mjs'
import { out, repos, showcase, work } from './paths.mjs'

const web = repos.web
const which = process.argv.slice(2)
const want = (name) => which.length === 0 || which.includes(name)

const lineOf = (repo, file, needle) =>
  fs.readFileSync(path.join(repo, file), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1

async function mcp(name, args) {
  const res = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { actor: 'claude-code', ...args } } }),
  })
  const out = await res.json()
  if (out.error || out.result?.isError) throw new Error(`${name}: ${JSON.stringify(out)}`)
}

function reset() {
  execFileSync('bash', [path.join(showcase, 'reset.sh')], { stdio: 'ignore' })
}

async function fresh(p, url) {
  await p.clearState()
  await p.theme('light')
  await p.go(url, 3500)
  await p.move([980, 470], 1)
}

// ------------------------------------------------------------ the loop
if (want('loop')) {
  reset()
  const p = await connect()
  const file = 'src/components/OrderList.tsx'
  const n = lineOf(web, file, 'const { orders, error, reload } = useOrders(customer)')
  await fresh(p, `${base}/r/4/file/${file}`)
  await p.record(path.join(out, 'loop.gif'), async () => {
    await p.caption('<b>You</b> — leave a note on the agent\u2019s change, submit the review')
    await sleep(900)
    await p.selectLine(n, 52)
    await sleep(300)
    await p.click({ sel: 'button', text: 'note' })
    await sleep(300)
    await p.type('Log the 429s, so we can see how often customers hit the limit.', 24)
    await sleep(300)
    await p.key('Enter')
    await sleep(900)
    await p.click({ sel: 'button', text: 'Submit review' })
    await sleep(1200)
    await p.move([1100, 250])
    await p.caption('<b>claude-code</b>, over MCP — edits the file, replies, resolves. No reload.')
    // the agent's turn, out of sight: an edit in the working tree, then MCP
    const src = fs.readFileSync(path.join(web, file), 'utf8')
    fs.writeFileSync(
      path.join(web, file),
      src
        .replace("import { RateLimited } from '../api'", "import { useEffect } from 'react'\nimport { RateLimited } from '../api'")
        .replace(
          '  const { orders, error, reload } = useOrders(customer)\n',
          '  const { orders, error, reload } = useOrders(customer)\n  useEffect(() => {\n    if (error instanceof RateLimited) console.warn(\'orders: rate-limited\', error.retryAfter)\n  }, [error])\n',
        ),
    )
    await sleep(2200)
    await mcp('reply_to_note', { sessionId: 4, note: 3, body: 'Logged with console.warn whenever the order list is rate-limited.' })
    await sleep(1600)
    await mcp('resolve_note', { sessionId: 4, note: 3 })
    await sleep(1200)
  }, { tail: 2500, frames: path.join(work, 'frames') })
  await p.go('about:blank', 200)
  p.close()
}

// ------------------------------------------- a reference into the other repo
if (want('refs')) {
  reset()
  const p = await connect()
  const file = 'src/components/RetryBanner.tsx'
  const n = lineOf(web, file, 'useState(seconds)')
  const target = lineOf(repos.api, 'src/ratelimit.ts', "res.setHeader('Retry-After'")
  await fresh(p, `${base}/r/4/file/${file}`)
  await p.record(path.join(out, 'refs.gif'), async () => {
    await p.caption('<b>Writing a note in orbit-web</b> — point it at code in orbit-api')
    await sleep(900)
    await p.selectLine(n, 44)
    await sleep(300)
    await p.click({ sel: 'button', text: 'note' })
    await sleep(300)
    await p.type('Starts from Retry-After, which orbit-api sends in whole seconds ', 24)
    await sleep(400)
    await p.caption('Select code in <b>another repository</b> — <b>↗ ref</b> adds it to the note')
    await p.click({ sel: 'span,div,button', text: 'ratelimit.ts', exact: true })
    await sleep(1800)
    await p.scrollToLine(target, [266, 450])
    await sleep(400)
    await p.selectLine(target, 44)
    await sleep(500)
    await p.click({ sel: 'button', text: `ref L${target}` })
    await sleep(700)
    await p.click({ sel: 'button', text: 'back to note', exact: true })
    await sleep(1200)
    await p.caption('The note now links straight to <b>orbit-api:src/ratelimit.ts</b>')
    await p.eval(`const t = [...document.querySelectorAll('textarea')].find(x => x.placeholder.startsWith('What should change') && x.getClientRects().length); t.focus(); t.setSelectionRange(t.value.length, t.value.length)`)
    await p.type(' — no rounding needed here.', 24)
    await sleep(300)
    await p.key('Enter')
    await sleep(1200)
  }, { tail: 2500, frames: path.join(work, 'frames') })
  await p.go('about:blank', 200)
  p.close()
}
