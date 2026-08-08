import { useEffect, useState } from 'react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { monaco } from '../monacoSetup'
import type { Side } from '@stickie/shared'
import { languageFor } from '../languages'
import { useReview } from '../store'
import { CommentLayer } from './CommentLayer'

const side_by_side_min_width = 1440

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

function editorOptions(
  width: number,
): editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    glyphMargin: false,
    renderLineHighlight: 'none',
    fontSize: width < 1440 ? 11 : width < 1800 ? 12 : 13,
    wordWrap: 'on',
  }
}

/**
 * With no draft open, a capture gesture starts one. With a draft in
 * progress (any file), the same gesture inserts a path:Lx-Ly reference
 * into it instead.
 */
function captureRange(side: Side, startLine: number, endLine: number): void {
  const state = useReview.getState()
  if (state.draft !== null && state.selectedPath !== null) {
    state.insertDraftRef(state.selectedPath, startLine, endLine)
    return
  }
  state.startDraft(side, startLine, endLine)
}

function useGutterDraft() {
  return (instance: editor.ICodeEditor, side: Side) => {
    let armed = false
    instance.onMouseDown((event) => {
      const target_type = event.target.type
      armed =
        target_type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
        target_type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
    })
    // the draft opens on mouseup so a drag across line numbers becomes a
    // range note; reading the selection at mousedown races Monaco's own
    // click-selects-line handling
    instance.onMouseUp((event) => {
      if (!armed) return
      armed = false
      const selection = instance.getSelection()
      if (selection !== null && !selection.isEmpty()) {
        let end = selection.endLineNumber
        // a full-line gutter selection ends at column 1 of the next line
        if (selection.endColumn === 1 && end > selection.startLineNumber) {
          end -= 1
        }
        captureRange(side, selection.startLineNumber, end)
        return
      }
      const line = event.target.position?.lineNumber
      if (line !== undefined) {
        captureRange(side, line, line)
      }
    })
  }
}

/**
 * Floating "+ note" button that follows a non-empty selection. Gutter clicks
 * race against Monaco's own selection handling; a content widget on the live
 * selection is the reliable path to range comments.
 */
function useSelectionNote(
  instance: editor.ICodeEditor | null,
  side: Side,
  hasDraft: boolean,
): void {
  useEffect(() => {
    if (instance === null) return
    const node = document.createElement('div')
    node.className = 'stickie-selection-note'
    const button = document.createElement('button')
    node.appendChild(button)
    let range: { start: number; end: number } | null = null

    const widget: editor.IContentWidget = {
      getId: () => `stickie-selection-note-${side}`,
      getDomNode: () => node,
      getPosition: () => {
        if (range === null) return { position: null, preference: [] }
        const column =
          instance.getModel()?.getLineMaxColumn(range.end) ?? 1
        return {
          position: { lineNumber: range.end, column },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.BELOW,
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
          ],
        }
      },
    }
    instance.addContentWidget(widget)

    const subscription = instance.onDidChangeCursorSelection((event) => {
      const selection = event.selection
      if (selection.isEmpty()) {
        range = null
      } else {
        let end = selection.endLineNumber
        // a full-line selection ends at column 1 of the following line
        if (selection.endColumn === 1 && end > selection.startLineNumber) {
          end -= 1
        }
        range = { start: selection.startLineNumber, end }
        const span =
          range.end === range.start
            ? `L${range.start}`
            : `L${range.start}–L${range.end}`
        button.textContent = hasDraft ? `+ ref ${span}` : `+ note ${span}`
      }
      instance.layoutContentWidget(widget)
    })

    button.onmousedown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (range === null) return
      captureRange(side, range.start, range.end)
      range = null
      instance.layoutContentWidget(widget)
    }

    return () => {
      subscription.dispose()
      try {
        instance.removeContentWidget(widget)
      } catch {
        // editor already disposed
      }
    }
  }, [instance, side, hasDraft])
}

export function FileView() {
  const selectedPath = useReview((s) => s.selectedPath)
  const selectedStatus = useReview((s) => s.selectedStatus)
  const baseContent = useReview((s) => s.baseContent)
  const sourceContent = useReview((s) => s.sourceContent)
  const threads = useReview((s) => s.threads)
  const draft = useReview((s) => s.draft)
  const theme = useReview((s) => s.theme)
  const attachGutter = useGutterDraft()
  const width = useWindowWidth()
  const [sideBySideOverride, setSideBySideOverride] = useState<boolean | null>(
    null,
  )
  const [collapseUnchanged, setCollapseUnchanged] = useState(true)
  const [originalEditor, setOriginalEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [modifiedEditor, setModifiedEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [singleEditor, setSingleEditor] = useState<editor.ICodeEditor | null>(
    null,
  )

  const sideBySide = sideBySideOverride ?? width >= side_by_side_min_width
  const monaco_theme = theme === 'dark' ? 'vs-dark' : 'vs'

  const reveal = useReview((s) => s.reveal)
  const clearReveal = useReview((s) => s.clearReveal)
  const reveal_editor = modifiedEditor ?? singleEditor
  const content_ready = sourceContent !== null || baseContent !== null
  useEffect(() => {
    if (
      reveal === null ||
      reveal.path !== selectedPath ||
      reveal_editor === null ||
      !content_ready
    ) {
      return
    }
    reveal_editor.revealLineInCenter(reveal.line)
    reveal_editor.setPosition({ lineNumber: reveal.line, column: 1 })
    clearReveal()
  }, [reveal, selectedPath, reveal_editor, content_ready, clearReveal])

  const has_draft = draft !== null
  useSelectionNote(originalEditor, 'base', has_draft)
  useSelectionNote(modifiedEditor, 'source', has_draft)
  useSelectionNote(
    singleEditor,
    sourceContent?.content != null ? 'source' : 'base',
    has_draft,
  )

  if (selectedPath === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Select a file to review
      </div>
    )
  }

  const file_threads = (side: Side) =>
    threads.filter((t) => t.path === selectedPath && t.side === side)
  const file_draft = (side: Side) =>
    draft !== null && draft.path === selectedPath && draft.side === side
      ? draft
      : null

  const binary = baseContent?.binary === true || sourceContent?.binary === true
  const language = languageFor(selectedPath)
  const has_both =
    baseContent?.content != null && sourceContent?.content != null
  const loading = !binary && baseContent === null && sourceContent === null

  const single_side: Side = sourceContent?.content != null ? 'source' : 'base'
  const single_content =
    single_side === 'source' ? sourceContent?.content : baseContent?.content

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-3 py-1.5 text-xs">
        <span className="truncate font-mono text-ink">{selectedPath}</span>
        <span className="rounded bg-overlay px-1.5 py-0.5 text-soft">
          {selectedStatus}
        </span>
        <span className="grow" />
        {has_both && (
          <button
            className="shrink-0 text-soft hover:text-ink"
            onClick={() => setCollapseUnchanged(!collapseUnchanged)}
          >
            {collapseUnchanged ? 'expand unchanged' : 'collapse unchanged'}
          </button>
        )}
        {has_both && (
          <button
            className="shrink-0 text-soft hover:text-ink"
            onClick={() => setSideBySideOverride(!sideBySide)}
          >
            {sideBySide ? 'inline view' : 'side-by-side view'}
          </button>
        )}
      </div>
      <div className="min-h-0 grow">
        {binary && (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            Binary file — nothing to review
          </div>
        )}
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            loading…
          </div>
        )}
        {!binary && !loading && has_both && (
          <>
            <DiffEditor
              key={selectedPath}
              original={baseContent?.content ?? ''}
              modified={sourceContent?.content ?? ''}
              language={language}
              theme={monaco_theme}
              options={{
                ...editorOptions(width),
                renderSideBySide: sideBySide,
                hideUnchangedRegions: {
                  enabled: collapseUnchanged,
                  contextLineCount: 2,
                  minimumLineCount: 4,
                  revealLineCount: 20,
                },
              }}
              onMount={(diff) => {
                const original = diff.getOriginalEditor()
                const modified = diff.getModifiedEditor()
                setOriginalEditor(original)
                setModifiedEditor(modified)
                attachGutter(original, 'base')
                attachGutter(modified, 'source')
              }}
            />
            <CommentLayer
              editorInstance={originalEditor}
              threads={file_threads('base')}
              draft={file_draft('base')}
            />
            <CommentLayer
              editorInstance={modifiedEditor}
              threads={file_threads('source')}
              draft={file_draft('source')}
            />
          </>
        )}
        {!binary && !loading && !has_both && single_content != null && (
          <>
            <Editor
              key={selectedPath}
              value={single_content}
              language={language}
              theme={monaco_theme}
              options={editorOptions(width)}
              onMount={(instance) => {
                setSingleEditor(instance)
                attachGutter(instance, single_side)
              }}
            />
            <CommentLayer
              editorInstance={singleEditor}
              threads={file_threads(single_side)}
              draft={file_draft(single_side)}
            />
          </>
        )}
      </div>
    </div>
  )
}
