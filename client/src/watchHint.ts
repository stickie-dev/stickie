import type { WatchProblem } from '@stickie/shared'

export type LiveState = 'watching' | 'not-watching' | 'disconnected'

/**
 * The status bar's dot: whether changes reach this page by themselves. Red
 * is the page's connection to the server; amber is the server connected but
 * not watching something it should be. Either way the edits an agent makes
 * stop appearing, which is the one thing the dot is there to say.
 */
export function liveState(
  connected: boolean,
  problems: WatchProblem[],
): LiveState {
  if (!connected) return 'disconnected'
  return problems.length > 0 ? 'not-watching' : 'watching'
}

const name = (target: string) =>
  target.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) ?? target

/** Why a watch failed, and what would let it work, for one error code. */
function diagnosis(
  problem: WatchProblem,
  mac: boolean,
): { cause: string; fix: string | null } {
  switch (problem.code) {
    case 'EPERM':
    case 'EACCES':
      return {
        cause: 'stickie is not allowed to read that folder',
        fix: mac
          ? 'allow stickie — or the terminal it runs in — under System Settings → Privacy & Security → Files and Folders, or Full Disk Access'
          : "check that folder's permissions",
      }
    case 'EMFILE':
    case 'ENFILE':
      return {
        cause: 'too many files are open on this machine',
        fix: 'quit programs you are not using, or raise the open-file limit (ulimit -n)',
      }
    case 'ENOSPC':
      return {
        cause: 'the system has no file watchers left',
        fix: mac
          ? 'quit other programs that watch files'
          : 'raise fs.inotify.max_user_watches, or quit other programs that watch files',
      }
    default:
      return {
        // node's messages usually begin with the code already
        cause:
          problem.code === null || problem.message.startsWith(problem.code)
            ? problem.message
            : `${problem.code}: ${problem.message}`,
        fix: null,
      }
  }
}

/**
 * What the dot says on hover: what is wrong, what it costs, and what to do
 * about it — a red or amber dot that only says "not connected" leaves the
 * reader to guess the rest.
 */
export function liveHint(
  connected: boolean,
  problems: WatchProblem[],
  mac: boolean,
): string {
  const state = liveState(connected, problems)
  if (state === 'disconnected') {
    return [
      'not connected to stickie',
      "changes won't appear until it is back: the server stopped, or is restarting",
      'this page reconnects by itself every 2 seconds; if it stays red, start stickie again — open the app, or run stickie in a terminal',
    ].join('\n')
  }
  if (state === 'watching') {
    return 'watching for changes\nconnected to stickie, and every open repository is watched: edits appear as they are made'
  }
  // a repository whose files and refs both failed is one repository, said once
  const by_repo = new Map<string, WatchProblem[]>()
  for (const problem of problems) {
    by_repo.set(problem.path, [...(by_repo.get(problem.path) ?? []), problem])
  }
  const lines = [...by_repo].map(([target, failed]) => {
    const parts = failed
      .map((problem) =>
        problem.what === 'files' ? 'its files' : 'its branches and commits',
      )
      .join(' and ')
    const causes = [
      ...new Set(failed.map((problem) => diagnosis(problem, mac).cause)),
    ].join('; ')
    return `${name(target)}: ${parts} — ${causes}`
  })
  const fixes = [
    ...new Set(
      problems
        .map((problem) => diagnosis(problem, mac).fix)
        .filter((fix): fix is string => fix !== null),
    ),
  ]
  return [
    by_repo.size === 1
      ? "not watching a repository — its changes won't appear by themselves"
      : `not watching ${String(by_repo.size)} repositories — their changes won't appear by themselves`,
    ...lines,
    ...fixes.map((fix) => `to fix: ${fix}`),
    'stickie tries again by itself and catches up when it can; reload (top bar) catches up now',
  ].join('\n')
}
