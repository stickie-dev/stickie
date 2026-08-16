import { useEffect, useState } from 'react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { monaco } from '../monacoSetup'
import type { Side } from '@stickie/shared'
import { api } from '../api'
import type { NavHit } from '../api'
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

interface DefinitionPick {
  x: number
  y: number
  name: string
  hits: NavHit[]
}

/**
 * Cmd/ctrl+click on an identifier: one grep-grade definition jumps
 * directly; several open a candidate picker; none flashes a notice.
 */
async function goToDefinition(
  name: string,
  x: number,
  y: number,
  setPick: (pick: DefinitionPick | null) => void,
): Promise<void> {
  const state = useReview.getState()
  if (state.session === null || state.selectedPath === null) return
  const language = languageFor(state.selectedPath)
  const hits = await api.definitions(state.session.id, name, language)
  if (hits.length === 1 && hits[0] !== undefined) {
    await state.openHit(hits[0])
    return
  }
  setPick({ x, y, name, hits })
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
  setPick: (pick: DefinitionPick | null) => void,
) {
  return (instance: editor.IStandaloneCodeEditor, side: Side) => {
    let gutter_armed = false
    instance.onMouseDown((event) => {
      const target_type = event.target.type
      if (
        (event.event.metaKey || event.event.ctrlKey) &&
        target_type === monaco.editor.MouseTargetType.CONTENT_TEXT &&
        event.target.position != null
      ) {
        const word = instance
          .getModel()
          ?.getWordAtPosition(event.target.position)
        if (word != null) {
          const browser = event.event.browserEvent
          void goToDefinition(
            word.word,
            browser.clientX,
            browser.clientY,
            setPick,
          )
        }
        gutter_armed = false
        return
      }
      gutter_armed =
        target_type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
        target_type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
    })
    instance.addAction({
      id: 'stickie.findUsages',
      label: 'Find usages',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: (ed) => {
        const position = ed.getPosition()
        const word =
          position === null
            ? null
            : ed.getModel()?.getWordAtPosition(position)
        if (word != null) {
          void useReview.getState().openUsages(word.word, 'repo')
        }
      },
    })
    instance.addAction({
      id: 'stickie.goToDefinition',
      label: 'Go to definition (⌘click)',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      run: (ed) => {
        const position = ed.getPosition()
        const word =
          position === null
            ? null
            : ed.getModel()?.getWordAtPosition(position)
        if (word != null) {
          const coords =
            position === null
              ? { left: 200, top: 200 }
              : ed.getScrolledVisiblePosition(position) ?? { left: 200, top: 200 }
          const dom = ed.getDomNode()?.getBoundingClientRect()
          void goToDefinition(
            word.word,
            (dom?.x ?? 0) + coords.left,
            (dom?.y ?? 0) + coords.top + 20,
            setPick,
          )
        }
      },
    })
    instance.onMouseUp((event) => {
      const was_gutter = gutter_armed
      gutter_armed = false
      const lines = selectionLines(instance.getSelection())
      const capture_state = useReview.getState()
      const no_target =
        capture_state.drafts.length === 0 &&
        capture_state.activeReplyId === null
      if (was_gutter && no_target) {
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
  const hasDraft = useReview(
    (s) => s.drafts.length > 0 || s.activeReplyId !== null,
  )
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
  const [definitionPick, setDefinitionPick] = useState<DefinitionPick | null>(
    null,
  )
  const [originalEditor, setOriginalEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [modifiedEditor, setModifiedEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [singleEditor, setSingleEditor] = useState<editor.ICodeEditor | null>(
    null,
  )
  const [diffEditor, setDiffEditor] =
    useState<editor.IStandaloneDiffEditor | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const attachCapture = makeCaptureAttacher(setCaptureTarget, setDefinitionPick)
  const viewed = useReview((s) => s.viewed)
  const toggleViewed = useReview((s) => s.toggleViewed)
  const files = useReview((s) => s.files)
  const openFile = useReview((s) => s.openFile)

  // review keyboard flow; inert while any input has focus
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const state = useReview.getState()
      const paths = state.files.map((f) => f.path)
      const index = state.selectedPath === null
        ? -1
        : paths.indexOf(state.selectedPath)
      switch (event.key) {
        case 'j':
        case 'k': {
          if (paths.length === 0) return
          const next =
            event.key === 'j'
              ? Math.min(index + 1, paths.length - 1)
              : Math.max(index - 1, 0)
          const path = paths[next]
          if (path !== undefined && path !== state.selectedPath) {
            void state.openFile(path)
          }
          break
        }
        case 'v': {
          if (state.selectedPath !== null) {
            void state.toggleViewed(state.selectedPath)
          }
          break
        }
        case 'n':
        case 'p': {
          const diff = diffEditor
          if (diff === null) return
          const changes = diff.getLineChanges() ?? []
          if (changes.length === 0) return
          const modified = diff.getModifiedEditor()
          const line = modified.getPosition()?.lineNumber ?? 1
          const starts = changes.map((change) =>
            change.modifiedStartLineNumber > 0
              ? change.modifiedStartLineNumber
              : Math.max(1, change.modifiedEndLineNumber),
          )
          const targetLine =
            event.key === 'n'
              ? (starts.find((s) => s > line) ?? starts[0])
              : ([...starts].reverse().find((s) => s < line) ?? starts.at(-1))
          if (targetLine !== undefined) {
            modified.revealLineInCenter(targetLine)
            modified.setPosition({ lineNumber: targetLine, column: 1 })
            modified.focus()
          }
          break
        }
        case '?': {
          setHelpOpen((open) => !open)
          break
        }
        case 'Escape': {
          setHelpOpen(false)
          break
        }
        default:
          return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [diffEditor])

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
    // a collapsed unchanged region swallows reveals into it; expand first
    // and let the effect re-run once the option has applied
    if (collapseUnchanged && modifiedEditor !== null) {
      setCollapseUnchanged(false)
      return
    }
    const timer = setTimeout(() => {
      reveal_editor.revealLineInCenter(reveal.line)
      reveal_editor.setPosition({ lineNumber: reveal.line, column: 1 })
      clearReveal()
    }, 50)
    return () => clearTimeout(timer)
  }, [
    reveal,
    selectedPath,
    reveal_editor,
    content_ready,
    clearReveal,
    collapseUnchanged,
    modifiedEditor,
  ])

  useEffect(() => {
    setCaptureTarget(null)
    setDefinitionPick(null)
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
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-soft hover:text-ink">
          <input
            type="checkbox"
            checked={viewed.has(selectedPath)}
            onChange={() => void toggleViewed(selectedPath)}
          />
          viewed
        </label>
        <span className="grow" />
        <button
          className="shrink-0 text-faint hover:text-ink"
          title="keyboard shortcuts"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
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
                setDiffEditor(diff)
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
      {definitionPick !== null && (
        <DefinitionPicker
          pick={definitionPick}
          onDone={() => setDefinitionPick(null)}
        />
      )}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setHelpOpen(false)}
        >
          <div className="w-80 rounded-lg border border-edge bg-panel p-4 text-sm shadow-2xl">
            <h2 className="mb-2 font-semibold text-ink">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-[3rem_1fr] gap-y-1 text-xs">
              <dt className="font-mono text-soft">j / k</dt>
              <dd className="text-ink">next / previous changed file</dd>
              <dt className="font-mono text-soft">n / p</dt>
              <dd className="text-ink">next / previous change in file</dd>
              <dt className="font-mono text-soft">v</dt>
              <dd className="text-ink">toggle viewed for current file</dd>
              <dt className="font-mono text-soft">⌘click</dt>
              <dd className="text-ink">go to definition</dd>
              <dt className="font-mono text-soft">?</dt>
              <dd className="text-ink">this help</dd>
              <dt className="font-mono text-soft">esc</dt>
              <dd className="text-ink">close overlays / discard draft</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

/** Candidate list when a symbol has several (or zero) grep-grade matches. */
function DefinitionPicker({
  pick,
  onDone,
}: {
  pick: DefinitionPick
  onDone: () => void
}) {
  const openHit = useReview((s) => s.openHit)
  return (
    <div
      className="fixed z-50 max-h-64 w-[28rem] -translate-x-1/2 overflow-y-auto rounded-md border border-edge bg-panel text-xs shadow-xl"
      style={{
        left: Math.min(Math.max(pick.x, 240), window.innerWidth - 240),
        top: pick.y + 12,
      }}
    >
      <div className="flex items-center border-b border-edge px-3 py-1.5">
        <span className="text-soft">
          {pick.hits.length === 0
            ? `No definition found for `
            : `${pick.hits.length} definitions of `}
          <span className="font-mono text-ink">{pick.name}</span>
        </span>
        <span className="grow" />
        <button className="text-soft hover:text-ink" onClick={onDone}>
          close
        </button>
      </div>
      {pick.hits.map((hit) => (
        <button
          key={`${hit.path}:${hit.line}`}
          className="flex w-full gap-2 px-3 py-1 text-left font-mono hover:bg-overlay"
          onClick={() => {
            void openHit(hit)
            onDone()
          }}
        >
          <span className="shrink-0 text-soft">
            {hit.path}:{hit.line}
          </span>
          <span className="truncate text-faint">{hit.preview.trim()}</span>
        </button>
      ))}
    </div>
  )
}
