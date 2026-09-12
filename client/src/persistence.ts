import type { RepoInfo, Side } from '@stickie/shared'
import type { PaneName } from './panes'
import { clampRatio, panes } from './panes'
import type { CommentsTab, Draft, DraftSurface, Tab } from './store'

/**
 * What survives a reload, and how. Repositories are keyed by path rather than
 * id so a rebuilt database cannot resurrect the wrong file, and both snapshots
 * are read once at import time — before the store can write its empty starting
 * state over them.
 */

const tabs_key = 'stickie-tabs'
const drafts_key = 'stickie-drafts'
const panes_key = 'stickie-panes'
const tree_key = 'stickie-tree'
const comments_tab_key = 'stickie-comments-tab'

interface StoredTab {
  kind: Tab['kind']
  repo: string
  /**
   * The review the tab was of. Repository ids differ between machines, which
   * is why the repo is stored as a path — a review id does not: it names a row
   * in the same local database the rest of this client talks to, and a tab
   * whose review is gone is dropped on the way back in.
   */
  review: number
  path?: string
}

interface StoredDraft {
  repo: string
  path: string
  side: Side
  startLine: number
  endLine: number
  body: string
  /** where it was being written; absent in anything stored before this */
  surface?: DraftSurface
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
      typeof (entry as StoredTab).repo === 'string' &&
      typeof (entry as StoredTab).review === 'number',
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

/**
 * How wide the reader dragged each panel. Clamped on the way back in as well
 * as on the way out: the limits can change with a release, and a stored width
 * from before one must not outlive it.
 */
function readPanes(): Record<PaneName, number> {
  const parsed = parse<Partial<Record<PaneName, unknown>>>(panes_key) ?? {}
  const ratios = {} as Record<PaneName, number>
  for (const name of Object.keys(panes) as PaneName[]) {
    const stored = parsed[name]
    ratios[name] =
      typeof stored === 'number' && Number.isFinite(stored)
        ? clampRatio(name, stored, 0)
        : panes[name].initial
  }
  return ratios
}

/**
 * Which folders are shut, per repository path. A tree that reopens itself
 * fully expanded on every reload is a tree the reader closes again every
 * morning.
 */
function readTree(): { collapsed: Record<string, string[]> } {
  const parsed = parse<{ collapsed?: unknown }>(tree_key)
  const collapsed: Record<string, string[]> = {}
  const stored = parsed?.collapsed
  if (typeof stored === 'object' && stored !== null) {
    for (const [repo, dirs] of Object.entries(stored)) {
      if (!Array.isArray(dirs)) continue
      collapsed[repo] = dirs.filter((dir): dir is string => typeof dir === 'string')
    }
  }
  return { collapsed }
}

/** Which of the comments panel's tabs was last being read. */
function readCommentsTab(): CommentsTab {
  const stored = localStorage.getItem(comments_tab_key)
  return stored === 'all' || stored === 'mr' || stored === 'unresolved'
    ? stored
    : 'unresolved'
}

export function storeCommentsTab(tab: CommentsTab): string {
  localStorage.setItem(comments_tab_key, tab)
  return tab
}

export const previous_comments_tab = readCommentsTab()
export const previous_tabs = readTabs()
export const previous_drafts = readDrafts()
export const previous_panes = readPanes()
export const previous_tree = readTree()

export function storePanes(ratios: Record<PaneName, number>): string {
  const payload = JSON.stringify(ratios)
  localStorage.setItem(panes_key, payload)
  return payload
}

/** Repositories are keyed by path here for the same reason tabs are. */
export function storeTree(
  collapsedDirs: Record<number, string[]>,
  repos: RepoInfo[],
): string {
  const collapsed: Record<string, string[]> = {}
  for (const [repoId, dirs] of Object.entries(collapsedDirs)) {
    const repo = repos.find((r) => r.id === Number(repoId))
    if (repo === undefined || dirs.length === 0) continue
    collapsed[repo.path] = dirs
  }
  const payload = JSON.stringify({ collapsed })
  localStorage.setItem(tree_key, payload)
  return payload
}

/** The stored folders as live ones, dropping any whose repository is gone. */
export function restoredTree(repos: RepoInfo[]): Record<number, string[]> {
  const collapsedDirs: Record<number, string[]> = {}
  for (const [path, dirs] of Object.entries(previous_tree.collapsed)) {
    const repo = repos.find((r) => r.path === path)
    if (repo !== undefined) collapsedDirs[repo.id] = dirs
  }
  return collapsedDirs
}

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
          // a tab is of one review, and a repository has one per branch: the
          // path alone would reopen whichever of them happened to be current
          review: tab.reviewId,
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
          surface: draft.surface,
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
        // a draft written before this was stored has no surface; the single
        // file is where "back to note" used to land, so nothing moves for it
        surface: entry.surface ?? 'file',
      },
    ]
  })
}
