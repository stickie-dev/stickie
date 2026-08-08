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

function startNote(side: Side, startLine: number, endLine: number): void {
  useReview.getState().startDraft(side, startLine, endLine)
}

function refToActiveNote(startLine: number, endLine: number): void {
  const state = useReview.getState()
  if (state.selectedPath === null) return
  state.insertDraftRef(state.selectedPath, startLine, endLine)
}

interface CaptureTarget {
  x: number
  y: number
  side: Side
  startLine: number
  endLine: number
}

function selectionLines(
  selection: ReturnType<editor.ICodeEditor['getSelection']>,
): { start: number; end: number } | null {
  if (selection === null || selection.isEmpty()) return null
  let end = selection.endLineNumber
  // a full-line selection ends at column 1 of the following line
  if (selection.endColumn === 1 && end > selection.startLineNumber) {
    end -= 1
  }
  return { start: selection.startLineNumber, end }
}

/**
 * Wires an editor's mouse events to the capture flow. A gutter gesture with
 * no drafts open starts a note directly; any other selection surfaces the
 * action buttons at the mouse position.
 */
function makeCaptureAttacher(
  setTarget: (target: CaptureTarget | null) => void,
) {
  return (instance: editor.ICodeEditor, side: Side) => {
    let gutter_armed = false
    instance.onMouseDown((event) => {
      const target_type = event.target.type
      gutter_armed =
        target_type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
        target_type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
    })
    instance.onMouseUp((event) => {
      const was_gutter = gutter_armed
      gutter_armed = false
      const lines = selectionLines(instance.getSelection())
      const no_drafts = useReview.getState().drafts.length === 0
      if (was_gutter && no_drafts) {
        const range =
          lines ??
          (event.target.position === null || event.target.position === undefined
            ? null
            : {
                start: event.target.position.lineNumber,
                end: event.target.position.lineNumber,
              })
        if (range !== null) startNote(side, range.start, range.end)
        setTarget(null)
        return
      }
      if (lines === null) return
      const browser = event.event.browserEvent
      setTarget({
        x: browser.clientX,
        y: browser.clientY,
        side,
        startLine: lines.start,
        endLine: lines.end,
      })
    })
    instance.onDidChangeCursorSelection((event) => {
      if (event.selection.isEmpty()) setTarget(null)
    })
    instance.onDidScrollChange(() => setTarget(null))
  }
}

/** Equal-width note/ref actions rendered just below the mouse position. */
function CaptureActions({
  target,
  onDone,
}: {
  target: CaptureTarget
  onDone: () => void
}) {
  const hasDraft = useReview((s) => s.drafts.length > 0)
  const span =
    target.startLine === target.endLine
      ? `L${target.startLine}`
      : `L${target.startLine}–L${target.endLine}`

  const button_classes =
    'px-3 py-1.5 text-xs whitespace-nowrap text-ink hover:bg-overlay'

  return (
    <div
      className="fixed z-50 grid -translate-x-1/2 grid-flow-col auto-cols-fr overflow-hidden rounded-md border border-edge bg-panel shadow-xl"
      style={{
        left: Math.min(Math.max(target.x, 120), window.innerWidth - 120),
        top: target.y + 12,
      }}
    >
      <button
        className={button_classes}
        onClick={() => {
          startNote(target.side, target.startLine, target.endLine)
          onDone()
        }}
      >
        + note {span}
      </button>
      {hasDraft && (
        <button
          className={`${button_classes} border-l border-edge`}
          onClick={() => {
            refToActiveNote(target.startLine, target.endLine)
            onDone()
          }}
        >
          ↗ ref {span}
        </button>
      )}
    </div>
  )
}

export function FileView() {
  const selectedPath = useReview((s) => s.selectedPath)
  const selectedStatus = useReview((s) => s.selectedStatus)
  const baseContent = useReview((s) => s.baseContent)
  const sourceContent = useReview((s) => s.sourceContent)
  const threads = useReview((s) => s.threads)
  const drafts = useReview((s) => s.drafts)
  const theme = useReview((s) => s.theme)
  const width = useWindowWidth()
  const [sideBySideOverride, setSideBySideOverride] = useState<boolean | null>(
    null,
  )
  const [collapseUnchanged, setCollapseUnchanged] = useState(true)
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(
    null,
  )
  const [originalEditor, setOriginalEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [modifiedEditor, setModifiedEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [singleEditor, setSingleEditor] = useState<editor.ICodeEditor | null>(
    null,
  )
  const attachCapture = makeCaptureAttacher(setCaptureTarget)

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

  useEffect(() => {
    setCaptureTarget(null)
  }, [selectedPath])

  if (selectedPath === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Select a file to review
      </div>
    )
  }

  const file_threads = (side: Side) =>
    threads.filter((t) => t.path === selectedPath && t.side === side)
  const file_drafts = (side: Side) =>
    drafts.filter((d) => d.path === selectedPath && d.side === side)

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
                attachCapture(original, 'base')
                attachCapture(modified, 'source')
              }}
            />
            <CommentLayer
              editorInstance={originalEditor}
              threads={file_threads('base')}
              drafts={file_drafts('base')}
            />
            <CommentLayer
              editorInstance={modifiedEditor}
              threads={file_threads('source')}
              drafts={file_drafts('source')}
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
                attachCapture(instance, single_side)
              }}
            />
            <CommentLayer
              editorInstance={singleEditor}
              threads={file_threads(single_side)}
              drafts={file_drafts(single_side)}
            />
          </>
        )}
      </div>
      {captureTarget !== null && (
        <CaptureActions
          target={captureTarget}
          onDone={() => setCaptureTarget(null)}
        />
      )}
    </div>
  )
}
