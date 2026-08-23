import type { RepoInfo, Side } from '@stickie/shared'
import type { Draft, Tab } from './store'

/**
 * What survives a reload, and how. Repositories are keyed by path rather than
 * id so a rebuilt database cannot resurrect the wrong file, and both snapshots
 * are read once at import time — before the store can write its empty starting
 * state over them.
 */

const tabs_key = 'stickie-tabs'
const drafts_key = 'stickie-drafts'

interface StoredTab {
  kind: Tab['kind']
  repo: string
  path?: string
}

interface StoredDraft {
  repo: string
  path: string
  side: Side
  startLine: number
  endLine: number
  body: string
}

function parse<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function readTabs(): { tabs: StoredTab[]; active: number } | null {
  const parsed = parse<{ tabs?: unknown; active?: unknown }>(tabs_key)
  if (parsed === null || !Array.isArray(parsed.tabs)) return null
  const tabs = parsed.tabs.filter(
    (entry): entry is StoredTab =>
      typeof entry === 'object' &&
      entry !== null &&
      ((entry as StoredTab).kind === 'flow' ||
        (entry as StoredTab).kind === 'file' ||
        (entry as StoredTab).kind === 'commits') &&
      typeof (entry as StoredTab).repo === 'string',
  )
  return {
    tabs,
    active: typeof parsed.active === 'number' ? parsed.active : -1,
  }
}

function readDrafts(): StoredDraft[] {
  const parsed = parse<unknown>(drafts_key)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (entry): entry is StoredDraft =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as StoredDraft).repo === 'string' &&
      typeof (entry as StoredDraft).path === 'string' &&
      typeof (entry as StoredDraft).body === 'string' &&
      typeof (entry as StoredDraft).startLine === 'number',
  )
}

export const previous_tabs = readTabs()
export const previous_drafts = readDrafts()

export function storeTabs(
  tabs: Tab[],
  activeTabId: number | null,
  repos: RepoInfo[],
): string {
  const payload = JSON.stringify({
    tabs: tabs.flatMap((tab) => {
      const repo = repos.find((r) => r.id === tab.repoId)
      if (repo === undefined) return []
      return [
        {
          kind: tab.kind,
          repo: repo.path,
          ...(tab.path === undefined ? {} : { path: tab.path }),
        },
      ]
    }),
    active: tabs.findIndex((tab) => tab.id === activeTabId),
  })
  localStorage.setItem(tabs_key, payload)
  return payload
}

export function storeDrafts(drafts: Draft[], repos: RepoInfo[]): string {
  const payload = JSON.stringify(
    drafts.flatMap((draft) => {
      const repo = repos.find((r) => r.id === draft.repoId)
      // an empty note is not worth keeping across a reload
      if (repo === undefined || draft.body.trim() === '') return []
      return [
        {
          repo: repo.path,
          path: draft.path,
          side: draft.side,
          startLine: draft.startLine,
          endLine: draft.endLine,
          body: draft.body,
        },
      ]
    }),
  )
  localStorage.setItem(drafts_key, payload)
  return payload
}

/** Stored drafts as live ones, dropping any whose repo is gone. */
export function restoredDrafts(
  repos: RepoInfo[],
  sessionOf: (repoId: number) => number | undefined,
  nextId: () => number,
): Draft[] {
  return previous_drafts.flatMap((entry) => {
    const repo = repos.find((r) => r.path === entry.repo)
    if (repo === undefined) return []
    const sessionId = sessionOf(repo.id)
    if (sessionId === undefined) return []
    return [
      {
        id: nextId(),
        repoId: repo.id,
        sessionId,
        path: entry.path,
        side: entry.side === 'base' ? 'base' : 'source',
        startLine: entry.startLine,
        endLine: entry.endLine,
        body: entry.body,
      },
    ]
  })
}
