#!/usr/bin/env node
import { spawn } from 'node:child_process'

process.env.STICKIE_ADD_REPO ??= process.cwd()
const port = process.env.PORT ?? '4870'

await import('../server/dist/index.js')

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
