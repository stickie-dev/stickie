import type { editor } from 'monaco-editor'
import { flowCursorLine } from './flowNav'

/**
 * Where the reader is inside a file, so back and forward return to the line
 * they left rather than to the top of it.
 *
 * The two views hold their editors differently — the flow keeps one per file
 * in `flowNav`'s registry, the single-file view has one at a time — so neither
 * of them alone can answer "what line is the reader on". This asks whichever
 * view is showing the file.
 */

let file_view: { path: string; editor: editor.ICodeEditor } | null = null

/** The single-file view's editor, while it is showing `path`. */
export function setFileEditor(
  path: string,
  instance: editor.ICodeEditor | null,
): void {
  if (instance === null) {
    if (file_view?.path === path) file_view = null
    return
  }
  file_view = { path, editor: instance }
}

/**
 * The cursor's line in `path`, or null when nothing is showing that file. A
 * cursor moves on a click or a keypress, not on a scroll, so this is where the
 * reader last put themselves rather than what happens to be on screen.
 */
export function cursorLine(path: string, mode: 'flow' | 'file'): number | null {
  if (mode === 'flow') return flowCursorLine(path)
  if (file_view?.path !== path) return null
  return file_view.editor.getPosition()?.lineNumber ?? null
}
