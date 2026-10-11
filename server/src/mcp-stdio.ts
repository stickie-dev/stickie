import { createInterface } from 'node:readline'
import { configuredPort } from './config.js'
import { handleMessage, httpFetcher } from './mcp.js'

/**
 * MCP over stdio: newline-delimited JSON-RPC in, the same out. The stickie
 * server is expected to be running already — this process only translates.
 */

const version = '0.1.0'
const flag = process.argv.indexOf('--url')
const base =
  (flag === -1 ? undefined : process.argv[flag + 1]) ??
  process.env.STICKIE_URL ??
  // the port stickie is set to, which an agent's MCP setup should not have to
  // repeat: changing it in Settings is then changing it here too
  `http://localhost:${String(configuredPort())}`

const fetcher = httpFetcher(base.replace(/\/$/, ''))
const lines = createInterface({ input: process.stdin })

// answers are queued so a slow call cannot interleave with a later one
let tail: Promise<void> = Promise.resolve()

lines.on('line', (line) => {
  if (line.trim() === '') return
  tail = tail.then(async () => {
    const answer = await handleMessage(line, fetcher, version)
    if (answer !== null) process.stdout.write(`${answer}\n`)
  })
})

lines.on('close', () => {
  void tail.then(() => process.exit(0))
})
