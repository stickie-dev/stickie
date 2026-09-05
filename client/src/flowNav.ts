import type { editor } from 'monaco-editor'

/**
 * Change-to-change navigation for the continuous flow, where every file is a
 * separate content-sized editor inside one scroller: the editors never scroll
 * themselves, so revealing a line means scrolling the flow container, and the
 * next file's editor may not exist yet when the jump is requested.
 */

interface Entry {
  section: HTMLElement
  diff: editor.IStandaloneDiffEditor | null
  modified: editor.ICodeEditor | null
}

type Edge = 'first' | 'last'

const entries = new Map<string, Entry>()
let scroller: HTMLElement | null = null
/** A range on one line, for selecting a found word. */
export interface Select {
  column: number
  length: number
}

/**
 * A jump waiting for its file's editors. `edge` is for stepping through
 * changes, where the destination is "the first change in that file"; `line`
 * and `select` are for a caller that already knows exactly where it means.
 */
let pending: {
  path: string
  edge: Edge
  expires: number
  line?: number
  select?: Select
} | null = null
let jumping_until = 0
let clicked_until = 0

/** Sections must not self-scroll on selection while a jump is landing. */
export function flowJumpInFlight(): boolean {
  return performance.now() < jumping_until
}

/**
 * Clicking (or selecting) inside a section makes that file the current one,
 * which must not then scroll the file's own top into view under the reader.
 */
export function markFlowClick(): void {
  clicked_until = performance.now() + 400
}

export function flowClickInFlight(): boolean {
  return performance.now() < clicked_until
}

export function setFlowScroller(el: HTMLElement | null): void {
  scroller = el
}

export function flowScroller(): HTMLElement | null {
  return scroller
}

export function registerFlowSection(
  path: string,
  section: HTMLElement,
): () => void {
  entries.set(path, { section, diff: null, modified: null })
  return () => {
    entries.delete(path)
    if (pending?.path === path) pending = null
  }
}

/**
 * Called once a section's editors exist. A jump aimed at this file waits here
 * for the diff to be computed, and re-applies while the section is still
 * growing to its content height.
 */
export function registerFlowEditors(
  path: string,
  diff: editor.IStandaloneDiffEditor | null,
  modified: editor.ICodeEditor,
): void {
  const entry = entries.get(path)
  if (entry === undefined) return
  entry.diff = diff
  entry.modified = modified
  const want = pending
  if (want === null || want.path !== path) return
  if (performance.now() > want.expires) {
    pending = null
    return
  }
  const land = () => {
    if (pending !== want) return
    const starts = changeStarts(entry)
    const line =
      want.line ?? ((want.edge === 'first' ? starts[0] : starts.at(-1)) ?? 1)
    jumping_until = performance.now() + 500
    revealLine(entry, line, want.select)
    for (const delay of [120, 360]) {
      setTimeout(() => {
        if (pending === want) revealLine(entry, line, want.select)
      }, delay)
    }
    setTimeout(() => {
      if (pending === want) pending = null
    }, 400)
  }
  if (diff === null) land()
  else {
    const listener = diff.onDidUpdateDiff(() => {
      listener.dispose()
      land()
    })
    // an already-computed diff never fires the event again
    setTimeout(() => {
      if (pending === want) {
        listener.dispose()
        land()
      }
    }, 250)
  }
}

/** The cursor's line in one file of the flow, if that file has mounted. */
export function flowCursorLine(path: string): number | null {
  const entry = entries.get(path)
  return entry?.modified?.getPosition()?.lineNumber ?? null
}

/** Modified-side start line of every change; one-sided files count as one. */
function changeStarts(entry: Entry): number[] {
  if (entry.diff === null) return entry.modified === null ? [] : [1]
  const changes = entry.diff.getLineChanges() ?? []
  return changes.map((change) =>
    change.modifiedStartLineNumber > 0
      ? change.modifiedStartLineNumber
      : Math.max(1, change.modifiedEndLineNumber),
  )
}

function revealLine(entry: Entry, line: number, select?: Select): void {
  const modified = entry.modified
  const node = modified?.getDomNode() ?? null
  if (scroller === null || modified == null || node === null) return
  const in_editor = modified.getTopForLineNumber(line) - modified.getScrollTop()
  const editor_rect = node.getBoundingClientRect()
  const scroll_rect = scroller.getBoundingClientRect()
  const target = editor_rect.top + in_editor
  // a third of the way down clears the sticky file header and shows context
  const wanted = scroll_rect.top + scroll_rect.height * 0.3
  scroller.scrollTop += target - wanted
  if (select === undefined) {
    modified.setPosition({ lineNumber: line, column: 1 })
    return
  }
  // a found word is selected, not merely scrolled to: on a long line the
  // reader would otherwise have to spot which of them matched
  modified.setSelection({
    startLineNumber: line,
    startColumn: select.column,
    endLineNumber: line,
    endColumn: select.column + select.length,
  })
}

/**
 * Put one line of one file on screen, and select part of it. The flow's
 * editors are not the single-file view's, so the reveal that view listens for
 * never reached them — a reference or a find match aimed into the flow scrolled
 * nothing.
 */
export function flowReveal(path: string, line: number, select?: Select): void {
  const entry = entries.get(path)
  pending = {
    path,
    edge: 'first',
    line,
    select,
    expires: performance.now() + 5000,
  }
  jumping_until = performance.now() + 500
  if (entry === undefined) return
  if (entry.modified == null) {
    // not mounted yet: get its placeholder on screen and let
    // registerFlowEditors finish the job when the editors exist
    entry.section.scrollIntoView({ block: 'start' })
    return
  }
  pending = null
  // and again shortly: a section that has just mounted is still growing to its
  // content height, so one reveal aimed at a line that has since moved lands
  // short. The same retries the change-stepping path makes, for the same reason.
  revealLine(entry, line, select)
  for (const delay of [120, 360]) {
    setTimeout(() => {
      const still = entries.get(path)
      if (still !== undefined) revealLine(still, line, select)
    }, delay)
  }
}

/**
 * Move to the next (or previous) change across the whole flow, crossing into
 * neighbouring files — mounted or not — when the current one is exhausted.
 * `onFile` keeps the rest of the app's idea of the current file in step.
 */
export function flowJump(
  direction: 'next' | 'prev',
  paths: string[],
  selectedPath: string | null,
  onFile: (path: string) => void,
): void {
  if (paths.length === 0) return
  // a jump into a file whose editor is still loading owns the keys until it
  // lands; otherwise a second press races past the file it was fetching
  if (pending !== null && performance.now() < pending.expires) return
  const forward = direction === 'next'
  const start_index = selectedPath === null ? -1 : paths.indexOf(selectedPath)
  const index = start_index === -1 ? (forward ? 0 : paths.length - 1) : start_index
  const current_path = paths[index]
  const current = current_path === undefined ? undefined : entries.get(current_path)

  if (current_path !== undefined && current?.modified == null) {
    // nothing is known about where the reader is inside a file that has not
    // rendered yet, so start at its own edge rather than skipping over it
    onFile(current_path)
    jumpToFile(current_path, forward ? 'first' : 'last')
    return
  }

  if (current?.modified != null && current_path !== undefined) {
    const starts = changeStarts(current)
    const line = current.modified.getPosition()?.lineNumber ?? 0
    const next = forward
      ? starts.find((s) => s > line)
      : [...starts].reverse().find((s) => s < line)
    if (next !== undefined) {
      pending = null
      jumping_until = performance.now() + 300
      revealLine(current, next)
      return
    }
  }

  const step = forward ? 1 : -1
  const wrapped = (index + step + paths.length) % paths.length
  const target_path = paths[wrapped]
  if (target_path === undefined) return
  onFile(target_path)
  jumpToFile(target_path, forward ? 'first' : 'last')
}

function jumpToFile(path: string, edge: Edge): void {
  const entry = entries.get(path)
  pending = { path, edge, expires: performance.now() + 5000 }
  jumping_until = performance.now() + 500
  if (entry === undefined) return
  if (entry.modified == null) {
    // mounting is driven by visibility, so get the placeholder on screen and
    // let registerFlowEditors finish the jump
    entry.section.scrollIntoView({ block: 'start' })
    return
  }
  const starts = changeStarts(entry)
  const line = (edge === 'first' ? starts[0] : starts.at(-1)) ?? 1
  pending = null
  revealLine(entry, line)
}
