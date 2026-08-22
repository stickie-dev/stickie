#!/usr/bin/env node
// MCP stdio bridge to a running stickie server: `stickie-mcp [--url http://host:port]`
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const major = Number(process.versions.node.split('.')[0])
if (major < 22) {
  console.error(
    `stickie needs Node 22 or newer; found ${process.versions.node}`,
  )
  process.exit(1)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.resolve(here, '../server/dist/mcp-stdio.js')
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
