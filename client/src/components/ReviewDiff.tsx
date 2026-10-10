import { DiffEditor } from '@monaco-editor/react'
import type { DiffEditorProps } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { lineEdit } from '../lineEdit'

/** Writes new text into a model as the smallest edit that gets it there. */
function rewrite(model: editor.ITextModel, text: string): void {
  if (model.getValue() === text) return
  const edit = lineEdit(
    model.getLinesContent(),
    text.split(/\r\n|\r|\n/),
    model.getEOL(),
  )
  if (edit === null) return
  const { text: replacement, ...range } = edit
  model.applyEdits([{ range, text: replacement }])
}

/**
 * The diff editor, for a file whose text can change while it is on screen.
 *
 * `DiffEditor` updates a read-only editor with `setValue`, which throws away
 * every decoration in the model — and the diff editor keeps track of its
 * collapsed regions *with* decorations. With them gone, it works out which
 * regions the reader had open by finding none of them anywhere, decides
 * nothing was hidden, and opens the lot. So an agent editing a file it was
 * replying about unfolded the whole of it, while the menu still said
 * "collapsed" — and putting it right took switching the setting off and on.
 *
 * So the wrapper is only ever handed a document's first text, and never asked
 * to write content after that:
 *
 * - The same document with new text arrives as an edit to the lines that
 *   changed (`lineEdit`). Everything outside them keeps its decorations, so
 *   the regions keep whatever state the reader left them in.
 * - A different document gets a fresh editor. Its folding has nothing to
 *   carry over from the last file, and handing the old editor the new text
 *   is the same `setValue` by another door: switching files in the
 *   single-file view opened every region of the file switched to.
 *
 * `document` is what makes that call, so it has to change exactly when the
 * text stops being the same file. The single-file view keys it on the file
 * the loaded content says it is rather than the one just asked for, because
 * for a moment after a switch the two disagree.
 */
export function ReviewDiff({
  document,
  original = '',
  modified = '',
  onMount,
  ...rest
}: DiffEditorProps & { document: string }) {
  // what the wrapper was handed for this document; it only ever sees a
  // document's first text, so it never takes its own path to a later one
  const [loaded, setLoaded] = useState({ document, original, modified })
  if (loaded.document !== document) {
    setLoaded({ document, original, modified })
  }
  // which document the mounted editor holds: for the moment between a new
  // document and its editor mounting, the old one is already disposed
  const diff = useRef<{
    document: string
    editor: editor.IStandaloneDiffEditor
  } | null>(null)
  // the newest text, for the moment the editor finishes mounting: text that
  // arrived while Monaco was still loading would otherwise never be written
  const latest = useRef({ original, modified })
  latest.current = { original, modified }

  useEffect(() => {
    const mounted = diff.current
    if (mounted === null || mounted.document !== document) return
    const models = mounted.editor.getModel()
    if (models === null) return
    rewrite(models.original, original)
    rewrite(models.modified, modified)
  }, [document, original, modified])

  return (
    <DiffEditor
      {...rest}
      key={loaded.document}
      original={loaded.original}
      modified={loaded.modified}
      onMount={(instance, monaco) => {
        diff.current = { document: loaded.document, editor: instance }
        const models = instance.getModel()
        if (models !== null) {
          rewrite(models.original, latest.current.original)
          rewrite(models.modified, latest.current.modified)
        }
        onMount?.(instance, monaco)
      }}
    />
  )
}
