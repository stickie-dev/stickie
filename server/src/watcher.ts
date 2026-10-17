import fs from 'node:fs'
import path from 'node:path'
import type { FsEvent, RefsEvent } from '@stickie/shared'
import { gitCommonDir } from './git.js'

/**
 * Watches a reviewed repository so the diff can follow an agent editing it.
 *
 * One recursive watch per repository, which is one descriptor per repository.
 * This used to be a chokidar watch, which watches each *file* — on a workspace
 * of four repositories that came to 8,300 open descriptors, and the cost of
 * that is not memory but `fork`: every `git` stickie runs inherits the descriptor
 * table, so a spawn went from 10ms to 181ms and the overview page took ten
 * seconds to answer. Measured, both ways round.
 *
 * The trade is that a recursive watch cannot be told what to skip, so the
 * filtering happens here on the way in. That costs a string comparison per
 * event rather than a descriptor per file.
 */

/** Directories whose churn is never something to re-read a diff for. */
const ignored_dirs = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.terraform',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.idea',
  '.vscode',
  /**
   * Linked worktrees and agent scratch checkouts. Each is a whole other
   * checkout of the same repository living inside it, so watching it from the
   * parent counts every file twice — one repository here keeps 3,385 files
   * that way. Reviewing what is in one of them watches it as its own source.
   */
  '.worktrees',
  '.claude',
])

const debounce_ms = 300

/** Whether a path inside the repository is worth telling anyone about. */
/**
 * Whether a path inside the git directory is one that moves a ref: a branch
 * or a tag, HEAD (a checkout), the packed refs, a linked worktree's HEAD, or
 * FETCH_HEAD (a fetch, which is also when "behind origin" can change). Not
 * the objects, the index or the logs, which churn on every operation and say
 * nothing a review reads.
 */
export function refPath(relPath: string): boolean {
  const parts = relPath.split(path.sep)
  if (parts.length === 1) {
    return ['HEAD', 'packed-refs', 'FETCH_HEAD'].includes(relPath)
  }
  if (parts[0] === 'refs') return !relPath.endsWith('.lock')
  return parts[0] === 'worktrees' && parts[2] === 'HEAD'
}

export function watchable(relPath: string): boolean {
  if (relPath === '') return false
  return !relPath.split(path.sep).some((part) => ignored_dirs.has(part))
}

export class WatchHub {
  private watchers = new Map<string, fs.FSWatcher>()
  private pending = new Map<string, Set<string>>()
  private timers = new Map<string, NodeJS.Timeout>()
  private listeners = new Set<(event: FsEvent | RefsEvent) => void>()
  /** one per repository's git directory, however many checkouts share it */
  private ref_watchers = new Map<string, fs.FSWatcher>()
  private ref_timers = new Map<string, NodeJS.Timeout>()

  onEvent(listener: (event: FsEvent | RefsEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  ensureWatch(repoPath: string): void {
    void this.watchRefs(repoPath)
    if (this.watchers.has(repoPath)) return
    let watcher: fs.FSWatcher
    try {
      watcher = fs.watch(repoPath, { recursive: true, persistent: true })
    } catch (error) {
      // a repository that has been moved or unmounted is not worth failing a
      // request over; the diff simply stops following it
      console.warn(`stickie: not watching ${repoPath}: ${String(error)}`)
      return
    }
    watcher.on('change', (_event, filename) => {
      if (filename === null) return
      const rel = typeof filename === 'string' ? filename : filename.toString()
      if (!watchable(rel)) return
      this.queue(repoPath, rel)
    })
    watcher.on('error', (error) => {
      console.warn(`stickie: watch of ${repoPath} failed: ${String(error)}`)
      this.watchers.delete(repoPath)
      watcher.close()
    })
    this.watchers.set(repoPath, watcher)
  }

  /**
   * Watches the refs a checkout reads, which live in the repository's shared
   * git directory and not in any working tree: `.git` is left out of the file
   * watch above, so a pull of the base in another checkout, a commit, or a
   * fetch moved what a review is measured against without a word reaching it.
   */
  private async watchRefs(checkout: string): Promise<void> {
    const dir = await gitCommonDir(checkout)
    if (dir === null || this.ref_watchers.has(dir)) return
    // the repository is named by its root, which is what a review knows it by
    const root = path.basename(dir) === '.git' ? path.dirname(dir) : dir
    let watcher: fs.FSWatcher
    try {
      watcher = fs.watch(dir, { recursive: true, persistent: true })
    } catch (error) {
      console.warn(`stickie: not watching the refs of ${root}: ${String(error)}`)
      return
    }
    watcher.on('change', (_type, filename) => {
      if (filename === null) return
      const rel = typeof filename === 'string' ? filename : filename.toString()
      if (!refPath(rel)) return
      const existing = this.ref_timers.get(dir)
      if (existing !== undefined) clearTimeout(existing)
      this.ref_timers.set(
        dir,
        setTimeout(() => {
          this.ref_timers.delete(dir)
          const event: RefsEvent = { type: 'refs', repoPath: root }
          for (const listener of this.listeners) listener(event)
        }, debounce_ms),
      )
    })
    watcher.on('error', () => {
      this.ref_watchers.delete(dir)
      watcher.close()
    })
    this.ref_watchers.set(dir, watcher)
  }

  /** Stops watching one repository — it left the workspace. */
  forget(repoPath: string): void {
    const watcher = this.watchers.get(repoPath)
    if (watcher === undefined) return
    watcher.close()
    this.watchers.delete(repoPath)
    const timer = this.timers.get(repoPath)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(repoPath)
    this.pending.delete(repoPath)
  }

  close(): Promise<void> {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    for (const watcher of this.ref_watchers.values()) watcher.close()
    this.ref_watchers.clear()
    for (const timer of this.ref_timers.values()) clearTimeout(timer)
    this.ref_timers.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    return Promise.resolve()
  }

  private queue(repoPath: string, relPath: string): void {
    const bucket = this.pending.get(repoPath) ?? new Set()
    bucket.add(relPath)
    this.pending.set(repoPath, bucket)
    const existing = this.timers.get(repoPath)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.set(
      repoPath,
      setTimeout(() => this.flush(repoPath), debounce_ms),
    )
  }

  private flush(repoPath: string): void {
    const bucket = this.pending.get(repoPath)
    this.pending.delete(repoPath)
    this.timers.delete(repoPath)
    if (bucket === undefined || bucket.size === 0) return
    const event: FsEvent = { type: 'fs', repoPath, paths: [...bucket] }
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
