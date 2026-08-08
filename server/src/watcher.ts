import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FsEvent } from '@stickie/shared'

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
])

const debounce_ms = 300

export class WatchHub {
  private watchers = new Map<string, FSWatcher>()
  private pending = new Map<string, Set<string>>()
  private timers = new Map<string, NodeJS.Timeout>()
  private listeners = new Set<(event: FsEvent) => void>()

  onEvent(listener: (event: FsEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  ensureWatch(repoPath: string): void {
    if (this.watchers.has(repoPath)) return
    const watcher = chokidar.watch(repoPath, {
      ignoreInitial: true,
      ignored: (candidate) => {
        const rel = path.relative(repoPath, candidate)
        if (rel === '' || rel.startsWith('..')) return false
        return rel.split(path.sep).some((part) => ignored_dirs.has(part))
      },
    })
    watcher.on('all', (_event, filePath) => {
      this.queue(repoPath, path.relative(repoPath, filePath))
    })
    this.watchers.set(repoPath, watcher)
  }

  async close(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
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
