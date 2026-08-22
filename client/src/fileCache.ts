import type { FileContent, Side } from '@stickie/shared'
import { api } from './api'

/**
 * File contents keyed by the epoch they were read in, so switching back to a
 * file — or stepping through neighbours — costs nothing. A content epoch bump
 * (the working tree changed) makes every earlier entry unreachable, and the
 * map is trimmed so a long review cannot grow it without bound.
 */

const entries = new Map<string, Promise<FileContent>>()
const cap = 240

function key(
  sessionId: number,
  epoch: number,
  path: string,
  side: Side,
): string {
  return `${sessionId}:${epoch}:${side}:${path}`
}

export function cachedFile(
  sessionId: number,
  epoch: number,
  path: string,
  side: Side,
): Promise<FileContent> {
  const id = key(sessionId, epoch, path, side)
  const hit = entries.get(id)
  if (hit !== undefined) return hit
  const pending = api.file(sessionId, path, side).catch((error: unknown) => {
    // a failed read must not be remembered as the file's content
    entries.delete(id)
    throw error
  })
  entries.set(id, pending)
  if (entries.size > cap) {
    for (const stale of [...entries.keys()].slice(0, entries.size - cap)) {
      entries.delete(stale)
    }
  }
  return pending
}

/** Warms the cache without waiting; failures are the caller's problem later. */
export function prefetchFile(
  sessionId: number,
  epoch: number,
  path: string,
  side: Side,
): void {
  void cachedFile(sessionId, epoch, path, side).catch(() => undefined)
}

export function clearFileCache(): void {
  entries.clear()
}
