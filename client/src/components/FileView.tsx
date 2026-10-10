import { useEffect, useRef, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { editor_font, monaco } from '../monacoSetup'
import type { ChangedFile, Side } from '@stickie/shared'
import { api } from '../api'
import type { NavHit } from '../api'
import { setFileEditor } from '../cursor'
import { flowJump, markFlowClick } from '../flowNav'
import { languageFor } from '../languages'
import { formatRoute } from '../routes'
import { activeFiles, collapsedFor, fontShift, useReview, wrapFor } from '../store'
import { CommentLayer } from './CommentLayer'
import { ReviewDiff } from './ReviewDiff'
import { CommitTimeline } from './CommitTimeline'
import { ContinuousDiff } from './ContinuousDiff'
import { Loading, SkeletonCode } from './Skeleton'
import { btn, reveal_line_count } from '../ui'
import { useNearPoint } from '../floating'
import { FileName } from './FileName'

const side_by_side_min_width = 1440

/** Anything a click is aimed at rather than aimed through. */
const interactive = 'input, textarea, select, button, a, [role="button"]'

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * `wrap` follows the file's type (or its own toggle): prose and data wrap,
 * code does not — and unwrapped code gets the usual width markers instead.
 */
function editorOptions(
  width: number,
  wrap: boolean,
  shift: number,
  markedGutter: boolean,
): editor.IStandaloneEditorConstructionOptions {
  // the ladder is the window's; the shift is the reader's, and 11 is the floor
  // — code is the content here, and it is the last thing that should be squinted
  // at to fit one more line
  const ladder = width < 1440 ? 11.5 : width < 1800 ? 12.5 : 13
  const fontSize = Math.max(11, ladder + shift)
  return {
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    glyphMargin: false,
    renderLineHighlight: 'none',
    fontSize,
    fontFamily: editor_font,
    fontLigatures: true,
    // compact buys its rows back here too, but gently: 1.7 is what makes a
    // diff readable rather than a wall, and 1.6 is as tight as that stays true
    lineHeight: Math.round(fontSize * (shift < 0 ? 1.6 : 1.7)),
    letterSpacing: 0.2,
    wordWrap: wrap ? 'on' : 'off',
    rulers: wrap ? [] : [80, 100, 120],
    padding: { top: 10, bottom: 10 },
    lineNumbersMinChars: 3,
    // room for the resolved-note mark when resolved notes live out here; 12px
    // fits a dot and nothing that reads as anything, and the column costs the
    // code its width, so it is only wide while something is drawn in it
    lineDecorationsWidth: markedGutter ? 20 : 12,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false,
    },
    guides: { indentation: true },
    renderWhitespace: 'none',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
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

/**
 * An address for one line, on the clipboard. Only a line and a side travel
 * with it: whoever follows it gets the file open at that line, and their own
 * tabs are left alone.
 */
async function copyLineLink(line: number, side: Side): Promise<void> {
  const state = useReview.getState()
  const { session, selectedPath } = state
  if (session === null || selectedPath === null) return
  // the review, not the repository: a repository has one address per (source,
  // base) pair it is reviewed under, and the recipient's own pickers must not
  // decide which of them this link opens
  const link = `${window.location.origin}${formatRoute({
    kind: 'review',
    reviewId: session.id,
    tab: { kind: 'file', path: selectedPath, line, side },
  })}`
  try {
    await navigator.clipboard.writeText(link)
    state.pushToast('info', 'link copied')
  } catch (error) {
    state.pushToast(
      'error',
      `clipboard: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
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
  let hits = await api.definitions(state.session.id, name, language)
  // nothing local: sweep every registered repo before giving up
  if (hits.length === 0) {
    hits = await api.definitions(state.session.id, name, language, 'workspace')
  }
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
  return (
    instance: editor.IStandaloneCodeEditor,
    side: Side,
    filePath?: string,
  ) => {
    let gutter_armed = false
    instance.onMouseDown((event) => {
      // clicking into a flow section makes its file the selected one so
      // note anchoring and navigation stay coherent
      if (
        filePath !== undefined &&
        useReview.getState().selectedPath !== filePath
      ) {
        markFlowClick()
        useReview.getState().flowSelect(filePath)
      }
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
      id: 'stickie.toggleWrap',
      label: 'Toggle soft wrap for this file',
      contextMenuGroupId: 'view',
      contextMenuOrder: 0,
      run: () => {
        const path = filePath ?? useReview.getState().selectedPath
        if (path !== null) useReview.getState().toggleWrap(path)
      },
    })
    instance.addAction({
      id: 'stickie.copyLineLink',
      label: 'Copy link to this line',
      contextMenuGroupId: 'view',
      contextMenuOrder: 1,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber
        if (line !== undefined) void copyLineLink(line, side)
      },
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
      // a mouse-up on a form inside a view zone is someone using that form,
      // not selecting the code behind it
      if (
        (event.event.browserEvent.target as HTMLElement | null)?.closest(
          interactive,
        ) != null
      ) {
        gutter_armed = false
        setTarget(null)
        return
      }
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
  const placed = useNearPoint<HTMLDivElement>(target.x, target.y)
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
      data-stickie-capture=""
      ref={placed.ref}
      className="fixed z-50 grid -translate-x-1/2 grid-flow-col auto-cols-fr overflow-hidden rounded-md border border-edge bg-panel shadow-xl"
      style={placed.style}
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
      <button
        className={`${button_classes} border-l border-edge`}
        title="copy an address that opens this file at this line"
        onClick={() => {
          void copyLineLink(target.startLine, target.side)
          onDone()
        }}
      >
        ⧉ link
      </button>
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
  const sideBySideChoice = useReview((s) => s.sideBySide)
  const collapseUnchanged = useReview((s) => s.collapseUnchanged)
  // resolved notes are drawn in the gutter, so the gutter needs the room
  const marked_gutter = useReview((s) => s.resolvedNotes === 'gutter')
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
  const activeRepoId = useReview((s) => s.activeRepoId)
  const viewed = useReview((s) => s.viewed)
  const toggleViewed = useReview((s) => s.toggleViewed)
  const files = useReview(activeFiles)
  const shift = useReview(fontShift)
  const openFile = useReview((s) => s.openFile)
  const fileLoading = useReview((s) => s.fileLoading)
  const commits = useReview((s) => s.commits)
  const wrapExtensions = useReview((s) => s.wrapExtensions)
  const wrapOverrides = useReview((s) => s.wrapOverrides)
  const toggleWrap = useReview((s) => s.toggleWrap)
  const wrap =
    selectedPath === null
      ? false
      : wrapFor(selectedPath, wrapExtensions, wrapOverrides)

  // review keyboard flow; inert while any input has focus
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // the workspace stays mounted under the other pages, and a window
      // listener fires there too — `inert` only withholds focus
      if (!useReview.getState().reviewActive) return
      const target = event.target as HTMLElement | null
      // monaco's hidden input carries key events from a clicked-in editor;
      // it must not mute the review keys the way a real note field does
      const monaco_input = target?.classList.contains('inputarea') === true
      if (
        target !== null &&
        !monaco_input &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const state = useReview.getState()
      const paths = activeFiles(state).map((f) => f.path)
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
            if (state.viewMode === 'flow') state.flowSelect(path)
            else void state.openFile(path)
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
          if (state.viewMode === 'flow') {
            // a folded file has no editors to step through, and skipping it
            // is what folding it asked for
            flowJump(
              event.key === 'n' ? 'next' : 'prev',
              paths.filter(
                (path) =>
                  path === state.selectedPath ||
                  !collapsedFor(
                    path,
                    state.collapsedFiles,
                    state.collapseFileOverrides,
                  ),
              ),
              state.selectedPath,
              (path) => state.flowSelect(path),
            )
            break
          }
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
        case '[': {
          void state.navBack()
          break
        }
        case ']': {
          void state.navForward()
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

  // the nav history asks this view where the reader's cursor is; it cannot
  // reach into a component's state, so the editor showing the file says so
  useEffect(() => {
    const instance = modifiedEditor ?? singleEditor
    if (selectedPath === null || instance === null) return
    setFileEditor(selectedPath, instance)
    return () => setFileEditor(selectedPath, null)
  }, [selectedPath, modifiedEditor, singleEditor])

  const sideBySide = sideBySideChoice ?? width >= side_by_side_min_width
  const monaco_theme = theme === 'dark' ? 'stickie-dark' : 'stickie-light'

  const viewMode = useReview((s) => s.viewMode)
  const setViewMode = useReview((s) => s.setViewMode)
  const session = useReview((s) => s.session)
  const activeTabId = useReview((s) => s.activeTabId)
  const reveal = useReview((s) => s.reveal)
  const clearReveal = useReview((s) => s.clearReveal)
  // a link can name the base side; everything else reveals in the source
  const reveal_editor =
    reveal?.side === 'base'
      ? (originalEditor ?? singleEditor)
      : (modifiedEditor ?? singleEditor)
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
    const timer = setTimeout(() => {
      // The cursor moves first and the scroll follows it. A line inside a
      // collapsed unchanged region is not laid out to be scrolled to, and
      // moving the cursor into one is exactly what asks the diff editor to
      // open it — that region, and only as far as this line. Scrolling first
      // aims at where the line sat while it was still folded away, which is
      // what this used to work around by unfolding the whole file: one note
      // opened every unchanged region in it.
      //
      // a find match knows its column, so select the match itself rather than
      // centring the line and leaving the reader to spot which word it was
      if (reveal.column !== undefined && reveal.length !== undefined) {
        const range = {
          startLineNumber: reveal.line,
          startColumn: reveal.column,
          endLineNumber: reveal.line,
          endColumn: reveal.column + reveal.length,
        }
        reveal_editor.setSelection(range)
        reveal_editor.revealRangeInCenterIfOutsideViewport(range)
      } else {
        reveal_editor.setPosition({ lineNumber: reveal.line, column: 1 })
        reveal_editor.revealLineInCenter(reveal.line)
      }
      clearReveal()
    }, 50)
    return () => clearTimeout(timer)
  }, [reveal, selectedPath, reveal_editor, content_ready, clearReveal])

  useEffect(() => {
    setCaptureTarget(null)
    setDefinitionPick(null)
  }, [selectedPath])

  // Monaco says when a selection is cleared inside an editor and nothing says
  // when the reader simply went elsewhere, so the note/ref bar used to sit over
  // whatever was clicked next — including a note's own form, which lives in a
  // view zone and is therefore inside the editor. Any press outside the bar
  // takes it down; one that turns out to be a selection puts it back on
  // mouse-up, so nothing is lost by being blunt here.
  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-stickie-capture]')) {
        return
      }
      setCaptureTarget(null)
      setDefinitionPick(null)
    }
    window.addEventListener('mousedown', dismiss, true)
    return () => window.removeEventListener('mousedown', dismiss, true)
  }, [])

  // the editor instance outlives a file switch, so its scroll offset has to
  // be reset by hand — once per file, and never because a reveal just ended
  const scrolled_path = useRef<string | null>(null)
  useEffect(() => {
    if (selectedPath === null || scrolled_path.current === selectedPath) return
    scrolled_path.current = selectedPath
    if (reveal !== null) return
    for (const instance of [originalEditor, modifiedEditor, singleEditor]) {
      instance?.setScrollTop(0)
    }
  }, [selectedPath, reveal, originalEditor, modifiedEditor, singleEditor])

  // every tab closes, so closing the last one is somewhere a reader can be.
  // Asked of the review rather than of the tabs, because before one resolves
  // there is no tab yet either, and "nothing is open" is the wrong thing to
  // say to someone still waiting for it.
  if (session !== null && activeTabId === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        No tab open
      </div>
    )
  }

  if (viewMode === 'commits') {
    return (
      <CommitTimeline
        commits={commits}
        options={editorOptions(width, false, shift, marked_gutter)}
        theme={monaco_theme}
      />
    )
  }

  if (viewMode === 'flow') {
    // a review that has not resolved yet is not a review with nothing in it,
    // and saying "no changes" while git is still being asked is a small lie
    // that reads as an answer
    if (session === null) {
      return (
        <Loading what="the review">
          <SkeletonCode lines={20} />
        </Loading>
      )
    }
    if (files.length === 0) {
      // "no changes to review" is an answer about the code, and it is the
      // wrong one twice over: a review whose branch has been removed has no
      // code to answer about, and one whose work has all landed is finished
      // rather than empty. Both used to read as a diff that had lost its
      // files, which is what sends a reader looking for what went missing.
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-faint">
          {session.sourceGone === true
            ? 'What this review is of is no longer in the repository. Its notes are kept — point the source above at something else to carry on.'
            : session.merged === true
              ? `Everything this review is of is already in ${session.baseRef}.`
              : 'No changes to review'}
        </div>
      )
    }
    return (
      // no header row of its own: the counts it carried are in the status bar
      // and the choices are in the view menu at the end of the tabs, which
      // leaves the whole height for the diff
      <div className="flex h-full flex-col">
        <div className="min-h-0 grow">
          <ContinuousDiff
            files={files}
            sessionId={session.id}
            repoId={activeRepoId ?? -1}
            options={editorOptions(width, false, shift, marked_gutter)}
            sideBySide={sideBySide}
            theme={monaco_theme}
            attach={attachCapture}
          />
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
      </div>
    )
  }

  if (selectedPath === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Select a file to review
      </div>
    )
  }

  // line 0 notes have no anchor to hang a zone on; the panel shows them
  const file_threads = (side: Side) =>
    threads.filter(
      (t) => t.path === selectedPath && t.side === side && t.startLine > 0,
    )
  const file_drafts = (side: Side) =>
    drafts.filter(
      (d) =>
        d.repoId === activeRepoId &&
        d.path === selectedPath &&
        d.side === side,
    )

  const binary = baseContent?.binary === true || sourceContent?.binary === true
  const language = languageFor(selectedPath)
  const has_any =
    baseContent?.content != null || sourceContent?.content != null
  // side-by-side renders one-sided files as a diff so added content sits
  // right and deleted content sits left; inline keeps the plain editor
  const has_both =
    (baseContent?.content != null && sourceContent?.content != null) ||
    (sideBySide && has_any)
  const loading = !binary && baseContent === null && sourceContent === null

  const single_side: Side = sourceContent?.content != null ? 'source' : 'base'
  const single_content =
    single_side === 'source' ? sourceContent?.content : baseContent?.content

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-3 py-1.5 text-xs">
        <FileName path={selectedPath} />
        <span className="shrink-0 rounded bg-overlay px-1.5 py-0.5 text-soft">
          {selectedStatus}
        </span>
        {fileLoading && <span className="shrink-0 text-faint">loading…</span>}
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
          className={`shrink-0 ${btn()}`}
          title="keyboard shortcuts"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
        {/* wrap, view mode and unchanged lines are in the view menu now, at
            the end of the tabs, where the diff can reach them too */}
      </div>
      <div className="min-h-0 grow">
        {binary && (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            Binary file — nothing to review
          </div>
        )}
        {loading && (
          <Loading what={selectedPath ?? 'the file'}>
            <SkeletonCode lines={22} />
          </Loading>
        )}
        {!binary && !loading && has_both && (
          <>
            <ReviewDiff
              document={`${String(session?.id ?? 0)}:${sourceContent?.path ?? baseContent?.path ?? ''}`}
              original={baseContent?.content ?? ''}
              modified={sourceContent?.content ?? ''}
              language={language}
              theme={monaco_theme}
              options={{
                ...editorOptions(width, wrap, shift, marked_gutter),
                renderSideBySide: sideBySide,
                hideUnchangedRegions: {
                  enabled: collapseUnchanged,
                  contextLineCount: 2,
                  minimumLineCount: 4,
                  revealLineCount: reveal_line_count,
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
              value={single_content}
              language={language}
              theme={monaco_theme}
              options={editorOptions(width, wrap, shift, marked_gutter)}
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
          <div className="w-80 rounded-lg bg-panel p-4 text-sm shadow-lifted">
            <h2 className="mb-2 font-semibold text-ink">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-[4rem_1fr] gap-y-1 text-xs">
              <dt className="font-mono text-soft">⌘F</dt>
              <dd className="text-ink">find in this review</dd>
              <dt className="font-mono text-soft">⌘⇧F</dt>
              <dd className="text-ink">search every repository</dd>
              <dt className="font-mono text-soft">j / k</dt>
              <dd className="text-ink">next / previous changed file</dd>
              <dt className="font-mono text-soft">n / p</dt>
              <dd className="text-ink">next / previous change</dd>
              <dt className="font-mono text-soft">v</dt>
              <dd className="text-ink">toggle viewed for current file</dd>
              <dt className="font-mono text-soft">[ / ]</dt>
              <dd className="text-ink">navigate back / forward</dd>
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
  const placed = useNearPoint<HTMLDivElement>(pick.x, pick.y)
  const openHit = useReview((s) => s.openHit)
  const openHitSide = useReview((s) => s.openHitSide)
  const repos = useReview((s) => s.repos)
  const repoLabel = (hit: NavHit) =>
    repos.find(
      (r) => r.path === hit.repoPath || hit.repoPath.startsWith(r.path + '/'),
    )?.name ?? hit.repoPath.split('/').at(-1)
  return (
    <div className="fixed inset-0 z-50" onMouseDown={onDone}>
    <div
      ref={placed.ref}
      className="fixed z-50 max-h-64 w-[30rem] -translate-x-1/2 overflow-y-auto rounded-md border border-edge bg-panel text-xs shadow-xl"
      style={placed.style}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center border-b border-edge px-3 py-1.5">
        <span className="text-soft">
          {pick.hits.length === 0
            ? `No definition found for `
            : `${pick.hits.length} definitions of `}
          <span className="font-mono text-ink">{pick.name}</span>
        </span>
        <span className="grow" />
        <button className={btn()} onClick={onDone}>
          close
        </button>
      </div>
      {pick.hits.map((hit) => (
        <div
          key={`${hit.path}:${hit.line}`}
          className="group flex w-full items-center gap-2 px-3 py-1 hover:bg-overlay"
        >
          <button
            className="flex min-w-0 grow items-center gap-2 text-left font-mono"
            onClick={() => {
              void openHit(hit)
              onDone()
            }}
          >
            <span className="shrink-0 rounded bg-overlay px-1 text-meta text-faint">
              {repoLabel(hit)}
            </span>
            <span className="shrink-0 text-soft">
              {hit.path}:{hit.line}
            </span>
            <span className="truncate text-faint">{hit.preview.trim()}</span>
          </button>
          <button
            className={`hidden shrink-0 text-xs group-hover:inline ${btn()}`}
            title="open beside the diff"
            onClick={() => {
              openHitSide(hit)
              onDone()
            }}
          >
            side ▸
          </button>
        </div>
      ))}
    </div>
    </div>
  )
}
