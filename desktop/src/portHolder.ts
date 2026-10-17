import { execFile } from 'node:child_process'

export interface PortHolder {
  name: string
  pid: number
}

/** A command's output, or '' if it is missing, fails or takes too long. */
function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2000, windowsHide: true }, (error, stdout) =>
      resolve(error === null ? stdout : ''),
    )
  })
}

/** `lsof -F pc`: a `p<pid>` line, then a `c<command>` line for it. */
export function parseLsof(text: string): PortHolder | null {
  const pid = /^p(\d+)$/m.exec(text)?.[1]
  const name = /^c(.+)$/m.exec(text)?.[1]
  return pid === undefined || name === undefined
    ? null
    : { name, pid: Number(pid) }
}

/** `ss -p`: `users:(("python3",pid=51234,fd=3))`. */
export function parseSs(text: string): PortHolder | null {
  const [, name, pid] = /users:\(\("([^"]+)",pid=(\d+)/.exec(text) ?? []
  return name === undefined || pid === undefined
    ? null
    : { name, pid: Number(pid) }
}

/** `netstat -ano`: the pid at the end of the line listening on the port. */
export function parseNetstat(text: string, port: number): number | null {
  for (const line of text.split(/\r?\n/)) {
    const [, local, , state, pid_text] = line.trim().split(/\s+/)
    if (state !== 'LISTENING' || local?.endsWith(`:${String(port)}`) !== true) {
      continue
    }
    const pid = Number(pid_text)
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

/** `tasklist /fo csv /nh`: the image name, first of the quoted columns. */
export function parseTasklist(text: string): string | null {
  return /^"([^"]+)"/m.exec(text.trim())?.[1] ?? null
}

/**
 * What is listening on a local port, so a dialog can name it rather than
 * saying "another program". Best effort: the tools differ by platform, may
 * not be installed, and on macOS do not see another user's processes —
 * null, then, and the dialog says less.
 */
export async function portHolder(port: number): Promise<PortHolder | null> {
  if (process.platform === 'win32') {
    const pid = parseNetstat(await output('netstat', ['-ano', '-p', 'TCP']), port)
    if (pid === null) return null
    const name = parseTasklist(
      await output('tasklist', ['/fi', `PID eq ${String(pid)}`, '/fo', 'csv', '/nh']),
    )
    return name === null ? null : { name, pid }
  }
  // `+c 0`: the whole command name, not its first nine characters
  const from_lsof = parseLsof(
    await output('lsof', [
      '-nP', '+c', '0', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpc',
    ]),
  )
  if (from_lsof !== null || process.platform === 'darwin') return from_lsof
  // plenty of Linux installs have no lsof; ss comes with the system
  return parseSs(
    await output('ss', ['-ltnpH', 'sport', '=', `:${String(port)}`]),
  )
}
