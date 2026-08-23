import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Where the review record lives has to be known before the database opens, so
 * it cannot itself be a row in that database. It comes from a small file next
 * to it — written by the settings page — with environment variables winning,
 * so a shared machine can override without editing anyone's home directory.
 */

interface FileConfig {
  databaseUrl?: string
}

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

export function setDatabaseUrl(url: string | null): void {
  const config = read()
  if (url === null || url.trim() === '') delete config.databaseUrl
  else config.databaseUrl = url.trim()
  const file = configPath()
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  })
  // an existing file keeps its own mode, and this one holds a password
  fs.chmodSync(file, 0o600)
}
