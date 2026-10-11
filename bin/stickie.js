#!/usr/bin/env node
import { spawn } from 'node:child_process'

const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
  console.error(
    `stickie needs Node 22 or newer (for node:sqlite); found ${process.versions.node}`,
  )
  process.exit(1)
}

const usage = `usage: stickie [path] [options]

  path          git repository to register (default: current directory)
  --port <n>    listen port (default: as set in Settings, else 4870)
  --host <h>    bind address (default 127.0.0.1)
  --db <file>   sqlite database path (default ~/.stickie/stickie.sqlite)
  --no-open     do not open the browser
  --help        show this help
`

let repo_path
let open_browser = true
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  switch (arg) {
    case '--port':
      process.env.PORT = args[++i]
      break
    case '--host':
      process.env.STICKIE_HOST = args[++i]
      break
    case '--db':
      process.env.STICKIE_DB = args[++i]
      break
    case '--no-open':
      open_browser = false
      break
    case '--help':
    case '-h':
      console.log(usage)
      process.exit(0)
      break
    default:
      if (arg.startsWith('-')) {
        console.error(`unknown option: ${arg}\n${usage}`)
        process.exit(1)
      }
      repo_path = arg
  }
}

process.env.STICKIE_ADD_REPO ??= repo_path ?? process.cwd()
// --port, then STICKIE_PORT, then the port set in Settings, then 4870
const { configuredPort } = await import('../server/dist/config.js')
const port = String(configuredPort())
const url = `http://localhost:${port}`

function openBrowser() {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
}

/**
 * Whether a stickie is already serving this port — the desktop app, or another
 * `stickie` in a terminal. Asked rather than finding out from a failed listen,
 * because two servers on one database is what must not happen, and the one
 * that is running can take the repository just as well.
 */
async function runningStickie() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return false
    const body = await response.json()
    return typeof body === 'object' && body !== null && 'mcpCommand' in body
  } catch {
    return false
  }
}

if (await runningStickie()) {
  // hand it the repository; one that is not a git repository is refused
  // there, which is the same as starting a server with it would have done
  await fetch(`http://127.0.0.1:${port}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: process.env.STICKIE_ADD_REPO }),
  }).catch(() => undefined)
  console.log(`stickie is already running on ${url}`)
  if (open_browser) openBrowser()
  process.exit(0)
}

await import('../server/dist/index.js')

if (open_browser) setTimeout(openBrowser, 500)
