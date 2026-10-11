import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Where the review record lives has to be known before the database opens, so
 * it cannot itself be a row in that database. It comes from a small file next
 * to it — written by the settings page — with environment variables winning,
 * so a shared machine can override without editing anyone's home directory.
 *
 * The port is here for the same reason, and for one more: everything that
 * reaches the server has to agree on it before any of them can ask the
 * server — `stickie`, the desktop app, the MCP bridge an agent starts, and Vite.
 */

interface FileConfig {
  databaseUrl?: string
  /** where the server listens */
  port?: number
  /** where Vite serves the client while stickie itself is being worked on */
  devPort?: number
}

export const default_port = 4870
export const default_dev_port = 5173

export type DatabaseTarget =
  | { kind: 'sqlite'; file: string }
  | { kind: 'postgres'; url: string }

function configPath(): string {
  const named = process.env.STICKIE_CONFIG
  if (named !== undefined && named !== '') return named
  const dir = path.join(os.homedir(), '.stickie')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'config.json')
}

function read(): FileConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as FileConfig
  } catch {
    return {}
  }
}

/** The url the user configured, if any; the environment takes precedence. */
export function configuredDatabaseUrl(): string | null {
  const from_env = process.env.STICKIE_DATABASE_URL
  if (from_env !== undefined && from_env !== '') return from_env
  const stored = read().databaseUrl
  return stored === undefined || stored === '' ? null : stored
}

export function databaseTarget(): DatabaseTarget {
  const url = configuredDatabaseUrl()
  if (url !== null) return { kind: 'postgres', url }
  const file = process.env.STICKIE_DB
  return {
    kind: 'sqlite',
    file:
      file === undefined || file === ''
        ? path.join(os.homedir(), '.stickie', 'stickie.sqlite')
        : file,
  }
}

/** True when the environment decides, and the settings page cannot. */
export function databaseFromEnv(): boolean {
  const from_env = process.env.STICKIE_DATABASE_URL
  return from_env !== undefined && from_env !== ''
}

function write(config: FileConfig): void {
  const file = configPath()
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  })
  // an existing file keeps its own mode, and this one can hold a password
  fs.chmodSync(file, 0o600)
}

export function setDatabaseUrl(url: string | null): void {
  const config = read()
  if (url === null || url.trim() === '') delete config.databaseUrl
  else config.databaseUrl = url.trim()
  write(config)
}

/** A usable TCP port, or null for anything else. */
export function validPort(value: unknown): number | null {
  const port = typeof value === 'string' ? Number(value) : value
  const usable =
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535
  return usable ? port : null
}

/** The first of these environment variables that names a port. */
function portFromEnvironment(...names: string[]): number | null {
  for (const name of names) {
    const port = validPort(process.env[name])
    if (port !== null) return port
  }
  return null
}

/**
 * Where the server listens: `STICKIE_PORT` (or the older `PORT`), else the file,
 * else 4870. `stickie --port` sets the environment, so it wins too.
 */
export function configuredPort(): number {
  return (
    portFromEnvironment('STICKIE_PORT', 'PORT') ??
    validPort(read().port) ??
    default_port
  )
}

/** True when the environment decides the port, and the settings page cannot. */
export function portFromEnv(): boolean {
  return portFromEnvironment('STICKIE_PORT', 'PORT') !== null
}

/** Stores the port for the next start; null goes back to 4870. */
export function setPort(port: number | null): void {
  const config = read()
  if (port === null || port === default_port) delete config.port
  else config.port = port
  write(config)
}

/** Vite's port, for working on stickie: `STICKIE_DEV_PORT`, else the file, else 5173. */
export function configuredDevPort(): number {
  return (
    portFromEnvironment('STICKIE_DEV_PORT') ??
    validPort(read().devPort) ??
    default_dev_port
  )
}
