import type { Side } from '@stickie/shared'

/**
 * The URL, as data. No React and no store here, so the mapping between an
 * address and what the app shows can be read and tested on its own.
 *
 * What an address carries: the page, the *review*, and the *active* tab —
 * for a file tab, its path and optionally a line and a side. What it never
 * carries: the tab set, scroll positions, selections, drafts or viewed state.
 * The tab set is a per-machine concern that localStorage already owns, and a
 * link nobody can paste is not a link.
 *
 * `/r/` is the review — a session id, what the API calls a session and a
 * person calls a review. It named the *repository* until it turned out a
 * repository has as many reviews as it has (source, base) pairs, so
 * `/r/4/file/x.py` opened whichever of them the reader's workspace happened to
 * have active: the same link, two different reviews, no way to tell. Naming
 * the review also lets a note be addressed by its number within it.
 */

export const settings_sections = [
  'identity',
  'reviews',
  'storage',
  'gitlab',
  'prompt',
  'appearance',
  'agents',
  'app',
] as const

export type SettingsSection = (typeof settings_sections)[number]

/**
 * `diff` is the continuous scroll of every changed file — the tab bar has
 * always called it "diff", so the address says diff too. The store still calls
 * that view mode `flow` internally; renaming it there is a wide mechanical
 * change with nothing user-visible in it.
 */
export type TabRef =
  | { kind: 'diff' }
  | { kind: 'commits' }
  | { kind: 'file'; path: string; line?: number; side?: Side }

/**
 * Two ways to address a note, and the difference is which number is in hand.
 *
 * `/r/631/n/3` is note 3 of review 631 — the numbers a person reads and the
 * export writes. It opens the file the note sits on, highlights the note, and
 * *stays*: a note link reads as a note link until the reader moves off it, at
 * which point the mirror writes the file address instead.
 *
 * `/t/34` is the same note by row id, which is global and needs no review to
 * find. It resolves and replaces itself with the number form. Note links
 * already pasted into prompts carry a row id, including under the older
 * `/r/<repo>/t/34`, where the leading segment can be ignored: an id says which
 * review on its own.
 */
export type Page =
  | { kind: 'home' }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'review'; reviewId: number; tab: TabRef }
  | { kind: 'note'; reviewId: number; note: number }
  | { kind: 'note-by-id'; threadId: number }

/** Path segments are encoded one at a time so the slashes stay readable. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function decodePath(segments: string[]): string | null {
  if (segments.length === 0) return null
  const parts = segments.map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return null
    }
  })
  if (parts.some((part) => part === null || part === '' || part === '..')) {
    return null
  }
  return parts.join('/')
}

function isSettingsSection(value: string): value is SettingsSection {
  return (settings_sections as readonly string[]).includes(value)
}

/** A positive integer, or null: "3x" and "-1" are not ids. */
function id(segment: string): number | null {
  if (!/^[1-9][0-9]*$/.test(segment)) return null
  return Number(segment)
}

/** A note number, which counts from 0, so the id parser cannot be reused. */
function noteNumber(segment: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(segment)) return null
  return Number(segment)
}

/** null for an address this app does not serve; the shell sends those home. */
export function parseRoute(pathname: string, search = ''): Page | null {
  const segments = pathname.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) return { kind: 'home' }

  if (segments[0] === 'settings') {
    if (segments.length === 1) return { kind: 'settings', section: 'identity' }
    const section = segments[1] ?? ''
    if (segments.length === 2 && isSettingsSection(section)) {
      return { kind: 'settings', section }
    }
    return null
  }

  // a note by row id, with no review to name: `/t/34`, and the older
  // `/r/<anything>/t/34` from links already pasted into prompts
  if (segments[0] === 't') {
    const threadId = id(segments[1] ?? '')
    return threadId === null || segments.length !== 2
      ? null
      : { kind: 'note-by-id', threadId }
  }

  if (segments[0] === 'r') {
    const reviewId = id(segments[1] ?? '')
    if (reviewId === null) return null
    const kind = segments[2]
    if (kind === undefined || kind === 'diff') {
      return segments.length <= 3
        ? { kind: 'review', reviewId, tab: { kind: 'diff' } }
        : null
    }
    if (kind === 'n') {
      const note = noteNumber(segments[3] ?? '')
      return note === null || segments.length !== 4
        ? null
        : { kind: 'note', reviewId, note }
    }
    if (kind === 't') {
      const threadId = id(segments[3] ?? '')
      return threadId === null || segments.length !== 4
        ? null
        : { kind: 'note-by-id', threadId }
    }
    if (kind === 'commits') {
      return segments.length === 3
        ? { kind: 'review', reviewId, tab: { kind: 'commits' } }
        : null
    }
    if (kind === 'file') {
      const path = decodePath(segments.slice(3))
      if (path === null) return null
      const params = new URLSearchParams(search)
      const raw_line = params.get('line')
      const line =
        raw_line !== null && /^[1-9][0-9]*$/.test(raw_line)
          ? Number(raw_line)
          : undefined
      const raw_side = params.get('side')
      const side: Side | undefined =
        raw_side === 'base' || raw_side === 'source' ? raw_side : undefined
      return {
        kind: 'review',
        reviewId,
        tab: {
          kind: 'file',
          path,
          ...(line === undefined ? {} : { line }),
          ...(side === undefined ? {} : { side }),
        },
      }
    }
    return null
  }

  return null
}

export function formatRoute(page: Page): string {
  if (page.kind === 'home') return '/'
  if (page.kind === 'settings') return `/settings/${page.section}`
  if (page.kind === 'note-by-id') return `/t/${page.threadId}`
  const base = `/r/${page.reviewId}`
  if (page.kind === 'note') return `${base}/n/${page.note}`
  const { tab } = page
  if (tab.kind === 'diff') return `${base}/diff`
  if (tab.kind === 'commits') return `${base}/commits`
  const params = new URLSearchParams()
  if (tab.line !== undefined) params.set('line', String(tab.line))
  if (tab.side !== undefined) params.set('side', tab.side)
  const query = params.toString()
  return `${base}/file/${encodePath(tab.path)}${query === '' ? '' : `?${query}`}`
}

/**
 * Whether two addresses name the same tab. Line and side are deliberately
 * not part of it: they are what a link asks for on arrival, not something the
 * open tab can be out of step with, so comparing them would have the mirror
 * strip `?line=` off the address the moment it was followed.
 */
export function sameTab(a: TabRef, b: TabRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind !== 'file') return true
  return b.kind === 'file' && a.path === b.path
}

/**
 * Whether the review workspace is the thing on screen at this address. A note
 * address counts: it is one, or is about to become one, and covering the
 * workspace only to uncover it again would flash.
 */
export function isReviewRoute(page: Page | null): boolean {
  return (
    page?.kind === 'review' ||
    page?.kind === 'note' ||
    page?.kind === 'note-by-id'
  )
}
