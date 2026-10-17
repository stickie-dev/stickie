import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import type {
  BranchInfo,
  ChangedFile,
  FileChangeStatus,
  GitStatus,
  ReviewSource,
  WorktreeInfo,
} from '@stickie/shared'


async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', ['-C', repo, ...args])
  return stdout
}

async function gitOrNull(repo: string, args: string[]): Promise<string | null> {
  try {
    return await git(repo, args)
  } catch {
    return null
  }
}

export interface RevLabel {
  /** what to show: a branch name, "working tree", or a short sha */
  name: string
  /** the commit subject, truncated; null when git could not say */
  subject: string | null
}

const subject_max = 60

/** How many revisions one overview will look up; a bound, not a tuning knob. */
const rev_lookup_cap = 60

/**
 * Subjects for a set of revisions, one lookup each, run together. This is the
 * only place the overview touches git per review, which is why it is deduped
 * and capped: a page listing every review in the workspace must not turn into
 * an unbounded number of processes. A revision git cannot resolve simply has
 * no subject — a stale sha must not fail the page.
 */
export async function describeRevs(
  repo: string,
  revs: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(revs.filter((rev) => rev !== ''))].slice(
    0,
    rev_lookup_cap,
  )
  const found = await Promise.all(
    wanted.map(async (rev) => {
      const out = await gitOrNull(repo, [
        'log',
        '-1',
        '--format=%s',
        rev,
        '--',
      ])
      return [rev, out === null ? null : truncate(out.trim())] as const
    }),
  )
  const map = new Map<string, string>()
  for (const [rev, subject] of found) {
    if (subject !== null && subject !== '') map.set(rev, subject)
  }
  return map
}

function truncate(subject: string): string {
  return subject.length <= subject_max
    ? subject
    : `${subject.slice(0, subject_max - 1).trimEnd()}…`
}

/**
 * How much of a sha is ever shown. Eight is what stickie settled on everywhere,
 * and every one of these is read to compare against another rather than to
 * look something up, so there is no namespace for it to be ambiguous in.
 */
export const short_sha = 8

export function shortSha(sha: string): string {
  return sha.slice(0, short_sha)
}

/** A 40-hex sha, optionally with git's parent suffix. */
export function shortenRev(rev: string): string | null {
  const match = /^([0-9a-f]{40})(\^*)$/.exec(rev)
  if (match === null) return null
  return `${shortSha(match[1] ?? '')}${match[2] ?? ''}`
}

/**
 * A git config value, or null. With no repo it reads the global config, which
 * is where a person's own name and email normally live.
 */
export async function gitConfigValue(
  key: string,
  repo?: string,
): Promise<string | null> {
  const args =
    repo === undefined
      ? ['config', '--global', '--get', key]
      : ['-C', repo, 'config', '--get', key]
  try {
    const { stdout } = await execa('git', args)
    const value = stdout.trim()
    return value === '' ? null : value
  } catch {
    // exit 1 simply means the key is unset
    return null
  }
}

/** Resolve ~ and relative segments the way a shell would. */
export function expandUserPath(p: string): string {
  const trimmed = p.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

export function assertSafeRelativePath(p: string): void {
  if (path.isAbsolute(p) || p.split('/').includes('..')) {
    throw new Error(`unsafe path: ${p}`)
  }
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const out = await gitOrNull(dir, ['rev-parse', '--is-inside-work-tree'])
  return out === 'true'
}

export async function repoRoot(dir: string): Promise<string> {
  return git(dir, ['rev-parse', '--show-toplevel'])
}

export async function gitStatus(repo_path: string): Promise<GitStatus> {
  const stdout = await git(repo_path, ['status', '--porcelain=v2', '--branch'])
  let branch = ''
  let changed_files = 0
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length)
    } else if (line !== '' && !line.startsWith('#')) {
      changed_files += 1
    }
  }
  return {
    repoPath: repo_path,
    branch,
    changedFiles: changed_files,
    clean: changed_files === 0,
  }
}

export function parseWorktrees(porcelain: string, mainPath: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}
  const flush = () => {
    if (current.path !== undefined && current.head !== undefined) {
      result.push({
        path: current.path,
        head: current.head,
        branch: current.branch ?? null,
        isMain: current.path === mainPath,
      })
    }
    current = {}
  }
  for (const line of porcelain.split('\n')) {
    if (line === '') {
      flush()
    } else if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length)
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length)
    }
  }
  flush()
  return result
}

/**
 * Commit dates for a set of shas, in one spawn rather than one per sha. Every
 * open descriptor is paid for again by the next `fork`, so asking git once for
 * ten answers is not a tidiness preference.
 */
export async function commitDates(
  repo: string,
  shas: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(shas)].filter((sha) => sha !== '')
  if (wanted.length === 0) return new Map()
  const out = await gitOrNull(repo, [
    'log',
    '--no-walk=unsorted',
    '--format=%H%x09%cI',
    ...wanted,
  ])
  const dates = new Map<string, string>()
  for (const line of (out ?? '').split('\n')) {
    const [sha = '', when = ''] = line.split('\t')
    if (sha !== '' && when !== '') dates.set(sha, when)
  }
  return dates
}

/**
 * Worktrees newest first, and the detached ones after all of the attached
 * ones. `git worktree list` answers in the order the administrative files
 * happen to be read, which reads as alphabetical and says nothing about which
 * one is being worked in — the reason to open the picker at all.
 *
 * A worktree whose date git would not give is sorted as the oldest rather than
 * dropped or floated: the picker's job is to list every one of them.
 */
export function orderWorktrees(
  worktrees: WorktreeInfo[],
  dates: Map<string, string>,
): WorktreeInfo[] {
  const rank = (wt: WorktreeInfo) => (wt.branch === null ? 1 : 0)
  return [...worktrees].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    const when_a = dates.get(a.head) ?? ''
    const when_b = dates.get(b.head) ?? ''
    if (when_a !== when_b) return when_a < when_b ? 1 : -1
    return a.path.localeCompare(b.path)
  })
}

export async function listWorktrees(repo: string): Promise<WorktreeInfo[]> {
  const out = await git(repo, ['worktree', 'list', '--porcelain'])
  const main = await repoRoot(repo)
  const worktrees = parseWorktrees(out, main)
  const dates = await commitDates(
    repo,
    worktrees.map((wt) => wt.head),
  )
  return orderWorktrees(worktrees, dates)
}

export async function listRecentBranches(
  repo: string,
  limit = 20,
): Promise<BranchInfo[]> {
  const out = await git(repo, [
    'for-each-ref',
    '--sort=-committerdate',
    `--count=${limit}`,
    '--format=%(refname:short)%09%(committerdate:iso-strict)',
    'refs/heads',
  ])
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [name = '', lastCommitAt = ''] = line.split('\t')
      return { name, lastCommitAt }
    })
}

/**
 * Ref names, one per line, as `--format=%(refname:short)` writes them. Its own
 * function because `git branch` decorates the checked-out one with a `*` in
 * every other format, and a branch called `* main` has bitten this before.
 */
export function parseRefNames(out: string): string[] {
  return out
    .split('\n')
    .map((line) => line.replace(/^[*+]\s+/, '').trim())
    .filter((name) => name !== '' && !name.includes(' -> '))
}

/**
 * When each local branch last had a commit, by name. One call for the whole
 * repository: the expiry sweep asks it of every repository it looks at, and
 * a commit on a review's branch is the review's work still going on.
 */
export async function branchTipDates(repo: string): Promise<Map<string, string>> {
  const out = await gitOrNull(repo, [
    'for-each-ref',
    '--format=%(refname:short)%09%(committerdate:iso-strict)',
    'refs/heads',
  ])
  const dates = new Map<string, string>()
  for (const line of (out ?? '').split('\n')) {
    const [name = '', when = ''] = line.split('\t')
    if (name !== '' && when !== '') dates.set(name, when)
  }
  return dates
}

/**
 * The repository's shared git directory — where the refs live for every
 * checkout of it, a linked worktree's `.git` being only a pointer.
 */
export async function gitCommonDir(repo: string): Promise<string | null> {
  const out = await gitOrNull(repo, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])
  return out === null || out === '' ? null : out
}

/** `rev-list --left-right --count a...b`: what a has that b lacks, and back. */
export function parseLeftRight(
  out: string,
): { ahead: number; behind: number } | null {
  const [left = '', right = ''] = out.trim().split(/\s+/)
  const ahead = Number(left)
  const behind = Number(right)
  if (left === '' || !Number.isInteger(ahead) || !Number.isInteger(behind)) {
    return null
  }
  return { ahead, behind }
}

/**
 * A local branch beside its upstream, read from the remote-tracking ref —
 * what the last fetch saw. Null for a branch with no upstream, or one whose
 * upstream is gone.
 */
export async function branchTracking(
  repo: string,
  branch: string,
): Promise<{ upstream: string; ahead: number; behind: number } | null> {
  const upstream = await gitOrNull(repo, [
    'for-each-ref',
    '--format=%(upstream:short)',
    `refs/heads/${branch}`,
  ])
  if (upstream === null || upstream === '') return null
  const counts = await gitOrNull(repo, [
    'rev-list',
    '--left-right',
    '--count',
    `refs/heads/${branch}...${upstream}`,
  ])
  const parsed = counts === null ? null : parseLeftRight(counts)
  return parsed === null ? null : { upstream, ...parsed }
}

/** When anything last fetched into this repository, from FETCH_HEAD. */
export async function lastFetchedAt(repo: string): Promise<string | null> {
  const dir = await gitCommonDir(repo)
  if (dir === null) return null
  try {
    const stat = await fs.stat(path.join(dir, 'FETCH_HEAD'))
    return stat.mtime.toISOString()
  } catch {
    return null
  }
}

/**
 * Fetches every remote. The one network call stickie makes on git's behalf, and
 * only when asked; credentials it would have to prompt for make it fail
 * rather than hang, since there is no terminal to type them into.
 */
export async function fetchRemotes(repo: string): Promise<void> {
  await execa('git', ['-C', repo, 'fetch', '--all', '--prune'], {
    env: { GIT_TERMINAL_PROMPT: '0' },
    timeout: 60_000,
  })
}

/**
 * Moves a local branch up to its upstream, only if that is a fast-forward:
 * nothing is merged, so nothing can conflict. A branch checked out somewhere
 * is moved there, by `merge --ff-only`, which also refuses to overwrite
 * uncommitted changes in that checkout; one checked out nowhere has its ref
 * moved, compare-and-swap, so a ref that moved meanwhile is left alone.
 */
export async function fastForward(
  repo: string,
  branch: string,
): Promise<{ from: string; to: string; upstream: string }> {
  const tracking = await branchTracking(repo, branch)
  if (tracking === null) {
    throw new Error(`${branch} has no upstream to pull from`)
  }
  if (tracking.ahead > 0) {
    throw new Error(
      `${branch} has ${String(tracking.ahead)} ` +
        `${tracking.ahead === 1 ? 'commit' : 'commits'} ${tracking.upstream} ` +
        'does not — that is a merge, not a fast-forward',
    )
  }
  const from = await resolveRef(repo, `refs/heads/${branch}`)
  const to = await resolveRef(repo, tracking.upstream)
  if (from === to) return { from, to, upstream: tracking.upstream }
  const checkout = (await listWorktrees(repo)).find(
    (wt) => wt.branch === branch,
  )
  if (checkout !== undefined) {
    await git(checkout.path, ['merge', '--ff-only', tracking.upstream])
  } else {
    await git(repo, ['update-ref', `refs/heads/${branch}`, to, from])
  }
  return { from, to, upstream: tracking.upstream }
}

/** Every local branch, for asking whether one still exists. */
export async function listBranchNames(repo: string): Promise<string[]> {
  const out = await gitOrNull(repo, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
  ])
  return out === null ? [] : parseRefNames(out)
}

/**
 * The local branches already contained in `base` — everything that has landed
 * there. One call answers for every branch in the repository, which is the
 * only reason the overview can ask this at all: asked per review it would be a
 * git spawn per row, and that page is thirty rows on a good day.
 */
export async function mergedBranches(
  repo: string,
  base: string,
): Promise<string[]> {
  const out = await gitOrNull(repo, [
    'branch',
    '--merged',
    base,
    '--format=%(refname:short)',
  ])
  return out === null ? [] : parseRefNames(out)
}

export async function listRecentCommits(
  repo: string,
  limit = 15,
): Promise<{ sha: string; shortSha: string; subject: string }[]> {
  const out = await gitOrNull(repo, [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x09%h%x09%s',
  ])
  if (out === null) return []
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', shortSha = '', ...rest] = line.split('\t')
      return { sha, shortSha, subject: rest.join('\t') }
    })
}

export interface CommitBetween {
  sha: string
  shortSha: string
  parentSha: string
  subject: string
}

export async function listCommitsBetween(
  root: string,
  baseSha: string,
  head: string,
  limit = 200,
): Promise<CommitBetween[]> {
  const out = await gitOrNull(root, [
    'log',
    `--max-count=${limit}`,
    '--first-parent',
    '--format=%H%x09%h%x09%P%x09%s',
    `${baseSha}..${head}`,
  ])
  if (out === null) return []
  return out
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', shortSha = '', parents = '', ...rest] = line.split('\t')
      return {
        sha,
        shortSha,
        parentSha: parents.split(' ')[0] ?? '',
        subject: rest.join('\t'),
      }
    })
}

export async function defaultBranch(repo: string): Promise<string> {
  const origin_head = await gitOrNull(repo, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
  ])
  if (origin_head !== null) {
    return origin_head.replace('refs/remotes/origin/', '')
  }
  for (const candidate of ['master', 'main']) {
    const exists = await gitOrNull(repo, [
      'show-ref',
      '--verify',
      `refs/heads/${candidate}`,
    ])
    if (exists !== null) {
      return candidate
    }
  }
  return git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/**
 * Whether `older` is in `newer`'s history — `git merge-base --is-ancestor`,
 * which exits 1 for "no" and non-zero for a ref it cannot resolve alike, so an
 * unresolvable ref reads as "no" rather than as an error. The caller is asking
 * whether moving from one to the other keeps the first one's code, and "cannot
 * tell" and "no" lead to the same place.
 */
export async function isAncestor(
  repo: string,
  older: string,
  newer: string,
): Promise<boolean> {
  const out = await gitOrNull(repo, [
    'merge-base',
    '--is-ancestor',
    older,
    newer,
  ])
  return out !== null
}

export async function gitOrigin(repo: string): Promise<string | null> {
  return gitOrNull(repo, ['remote', 'get-url', 'origin'])
}

export async function resolveRef(repo: string, ref: string): Promise<string> {
  return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`])
}

export async function mergeBase(
  repo: string,
  a: string,
  b: string,
): Promise<string | null> {
  return gitOrNull(repo, ['merge-base', a, b])
}

function mapStatus(code: string): FileChangeStatus {
  switch (code[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    default:
      return 'modified'
  }
}

export function parseNameStatus(out: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const line of out.split('\n')) {
    if (line === '') continue
    const parts = line.split('\t')
    const code = parts[0] ?? ''
    const status = mapStatus(code)
    if (status === 'renamed' && parts.length >= 3) {
      files.push({ path: parts[2] ?? '', oldPath: parts[1], status })
    } else {
      files.push({ path: parts[1] ?? '', status })
    }
  }
  return files
}

export async function changedFiles(
  repo: string,
  source: ReviewSource,
  baseSha: string,
): Promise<ChangedFile[]> {
  if (source.kind === 'worktree') {
    const wt = source.value
    const tracked = await git(wt, ['diff', '--name-status', '-M', baseSha, '--'])
    const untracked = await git(wt, [
      'ls-files',
      '--others',
      '--exclude-standard',
    ])
    const files = parseNameStatus(tracked)
    for (const p of untracked.split('\n')) {
      if (p !== '') files.push({ path: p, status: 'untracked' })
    }
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }
  const out = await git(repo, [
    'diff',
    '--name-status',
    '-M',
    baseSha,
    source.value,
    '--',
  ])
  return parseNameStatus(out).sort((a, b) => a.path.localeCompare(b.path))
}

/** What one commit changed against its first parent. */
export async function commitFiles(
  repo: string,
  sha: string,
): Promise<ChangedFile[]> {
  const out = await git(repo, [
    'diff',
    '--name-status',
    '-M',
    `${sha}^`,
    sha,
    '--',
  ]).catch(() =>
    // a root commit has no parent to diff against
    git(repo, ['show', '--name-status', '--format=', '-M', sha, '--']),
  )
  return parseNameStatus(out).sort((a, b) => a.path.localeCompare(b.path))
}

export async function listAllFiles(
  repo: string,
  source: ReviewSource,
): Promise<string[]> {
  if (source.kind === 'worktree') {
    const out = await git(source.value, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ])
    return out.split('\n').filter((p) => p !== '')
  }
  const out = await git(repo, ['ls-tree', '-r', '--name-only', source.value])
  return out.split('\n').filter((p) => p !== '')
}

function looksBinary(buf: Uint8Array): boolean {
  return buf.subarray(0, 8000).includes(0)
}

export interface BlobResult {
  content: string | null
  blobSha: string | null
  binary: boolean
}

export async function fileAtRef(
  repo: string,
  ref: string,
  filePath: string,
): Promise<BlobResult> {
  assertSafeRelativePath(filePath)
  const sha = await gitOrNull(repo, ['rev-parse', `${ref}:${filePath}`])
  if (sha === null) {
    return { content: null, blobSha: null, binary: false }
  }
  const { stdout } = await execa(
    'git',
    ['-C', repo, 'cat-file', 'blob', sha],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  )
  if (looksBinary(stdout)) {
    return { content: null, blobSha: sha, binary: true }
  }
  return {
    content: new TextDecoder().decode(stdout),
    blobSha: sha,
    binary: false,
  }
}

export async function fileInWorktree(
  worktree: string,
  filePath: string,
): Promise<BlobResult> {
  assertSafeRelativePath(filePath)
  const abs = path.join(worktree, filePath)
  let buf: Buffer
  try {
    buf = await fs.readFile(abs)
  } catch {
    return { content: null, blobSha: null, binary: false }
  }
  if (looksBinary(buf)) {
    return { content: null, blobSha: null, binary: true }
  }
  const sha = await gitOrNull(worktree, ['hash-object', '--', abs])
  return { content: buf.toString('utf8'), blobSha: sha, binary: false }
}

export async function fileAtSide(
  repo: string,
  source: ReviewSource,
  baseSha: string,
  side: 'base' | 'source',
  filePath: string,
): Promise<BlobResult> {
  if (side === 'base') {
    return fileAtRef(repo, baseSha, filePath)
  }
  if (source.kind === 'worktree') {
    return fileInWorktree(source.value, filePath)
  }
  return fileAtRef(repo, source.value, filePath)
}
