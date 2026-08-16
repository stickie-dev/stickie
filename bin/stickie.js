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
  --port <n>    listen port (default 4870)
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
const port = process.env.PORT ?? '4870'

await import('../server/dist/index.js')

if (open_browser) {
  setTimeout(() => {
    const url = `http://localhost:${port}`
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open'
    spawn(opener, [url], { stdio: 'ignore', detached: true }).unref()
  }, 500)
}
