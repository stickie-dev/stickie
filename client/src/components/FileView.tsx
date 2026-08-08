import { useState } from 'react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { monaco } from '../monacoSetup'
import type { Side } from '@stickie/shared'
import { languageFor } from '../languages'
import { useReview } from '../store'
import { CommentLayer } from './CommentLayer'

const editor_options: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  glyphMargin: false,
  renderLineHighlight: 'none',
  fontSize: 12,
}

function useGutterDraft() {
  const startDraft = useReview((s) => s.startDraft)
  return (instance: editor.ICodeEditor, side: Side) => {
    instance.onMouseDown((event) => {
      const target_type = event.target.type
      if (
        target_type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
        target_type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      ) {
        return
      }
      const line = event.target.position?.lineNumber
      if (line === undefined) return
      const selection = instance.getSelection()
      let start = line
      let end = line
      if (
        selection !== null &&
        !selection.isEmpty() &&
        selection.startLineNumber <= line &&
        line <= selection.endLineNumber
      ) {
        start = selection.startLineNumber
        end = selection.endLineNumber
      }
      startDraft(side, start, end)
    })
  }
}

export function FileView() {
  const selectedPath = useReview((s) => s.selectedPath)
  const selectedStatus = useReview((s) => s.selectedStatus)
  const baseContent = useReview((s) => s.baseContent)
  const sourceContent = useReview((s) => s.sourceContent)
  const threads = useReview((s) => s.threads)
  const draft = useReview((s) => s.draft)
  const attachGutter = useGutterDraft()
  const [sideBySide, setSideBySide] = useState(true)
  const [originalEditor, setOriginalEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [modifiedEditor, setModifiedEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [singleEditor, setSingleEditor] =
    useState<editor.ICodeEditor | null>(null)

  if (selectedPath === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
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
  const loading =
    !binary &&
    baseContent === null &&
    sourceContent === null

  const single_side: Side =
    sourceContent?.content != null ? 'source' : 'base'
  const single_content =
    single_side === 'source' ? sourceContent?.content : baseContent?.content

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span className="font-mono text-zinc-200">{selectedPath}</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
          {selectedStatus}
        </span>
        <span className="grow" />
        {has_both && (
          <button
            className="text-zinc-400 hover:text-zinc-200"
            onClick={() => setSideBySide(!sideBySide)}
          >
            {sideBySide ? 'inline view' : 'side-by-side view'}
          </button>
        )}
      </div>
      <div className="min-h-0 grow">
        {binary && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Binary file — nothing to review
          </div>
        )}
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
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
              theme="vs-dark"
              options={{ ...editor_options, renderSideBySide: sideBySide }}
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
              theme="vs-dark"
              options={editor_options}
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
