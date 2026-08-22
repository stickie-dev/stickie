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
let pending: { path: string; edge: Edge; expires: number } | null = null
let jumping_until = 0

/** Sections must not self-scroll on selection while a jump is landing. */
export function flowJumpInFlight(): boolean {
  return performance.now() < jumping_until
}

export function setFlowScroller(el: HTMLElement | null): void {
  scroller = el
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
    const line = (want.edge === 'first' ? starts[0] : starts.at(-1)) ?? 1
    jumping_until = performance.now() + 500
    revealLine(entry, line)
    for (const delay of [120, 360]) {
      setTimeout(() => {
        if (pending === want) revealLine(entry, line)
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

function revealLine(entry: Entry, line: number): void {
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
  modified.setPosition({ lineNumber: line, column: 1 })
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
  const forward = direction === 'next'
  const start_index = selectedPath === null ? -1 : paths.indexOf(selectedPath)
  const index = start_index === -1 ? (forward ? 0 : paths.length - 1) : start_index
  const current_path = paths[index]
  const current = current_path === undefined ? undefined : entries.get(current_path)

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
