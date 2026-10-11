import { spawnSync } from 'node:child_process'

const marker = '__STICKIE_PATH__'

/**
 * Takes the PATH a login shell would have.
 *
 * An app started from the Dock or Finder gets the system's bare PATH, not the
 * one a terminal has — so git from Homebrew, or anything else stickie shells out
 * to, is simply not there, and a review fails with "command not found" in an
 * app that works from the command line. Asking the user's own shell once, at
 * start, is what every editor does about it. Windows has no such split.
 */
export function adoptShellPath(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
  const result = spawnSync(
    shell,
    ['-ilc', `printf '${marker}%s${marker}' "$PATH"`],
    { encoding: 'utf8', timeout: 3000 },
  )
  // a profile that prints a greeting is fine; one that hangs is cut off, and
  // the bare PATH is still better than not starting
  const found = new RegExp(`${marker}(.*)${marker}`).exec(result.stdout ?? '')
  const from_shell = found?.[1]
  if (from_shell === undefined || from_shell === '') return
  const merged = new Set([
    ...from_shell.split(':'),
    ...(process.env.PATH ?? '').split(':'),
  ])
  process.env.PATH = [...merged].filter((entry) => entry !== '').join(':')
}
