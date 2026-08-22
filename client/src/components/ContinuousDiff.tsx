import { useEffect, useRef, useState } from 'react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { ChangedFile, FileContent, Side } from '@stickie/shared'
import { api } from '../api'
import {
  flowJumpInFlight,
  registerFlowEditors,
  registerFlowSection,
  setFlowScroller,
} from '../flowNav'
import { languageFor } from '../languages'
import { useReview } from '../store'
import { CommentLayer } from './CommentLayer'

type Attach = (
  instance: editor.IStandaloneCodeEditor,
  side: Side,
  filePath?: string,
) => void

interface SectionProps {
  file: ChangedFile
  sessionId: number
  options: editor.IStandaloneEditorConstructionOptions
  sideBySide: boolean
  theme: string
  attach: Attach
}

/** One file of the continuous review flow, sized to its own content. */
function DiffSection({
  file,
  sessionId,
  options,
  sideBySide,
  theme,
  attach,
}: SectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [base, setBase] = useState<FileContent | null>(null)
  const [source, setSource] = useState<FileContent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [height, setHeight] = useState(160)
  const [originalEditor, setOriginalEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [modifiedEditor, setModifiedEditor] =
    useState<editor.ICodeEditor | null>(null)
  const [singleEditor, setSingleEditor] =
    useState<editor.ICodeEditor | null>(null)

  const epoch = useReview((s) => s.contentEpoch)
  const threads = useReview((s) => s.threads)
  const drafts = useReview((s) => s.drafts)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const viewed = useReview((s) => s.viewed)
  const toggleViewed = useReview((s) => s.toggleViewed)
  const selectedPath = useReview((s) => s.selectedPath)

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    return registerFlowSection(file.path, el)
  }, [file.path])

  // mount editors lazily as sections approach the viewport
  useEffect(() => {
    const el = containerRef.current
    if (el === null || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '800px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const want_base = file.status !== 'added' && file.status !== 'untracked'
    const want_source = file.status !== 'deleted'
    void Promise.all([
      want_base
        ? api.file(sessionId, file.oldPath ?? file.path, 'base')
        : Promise.resolve(null),
      want_source
        ? api.file(sessionId, file.path, 'source')
        : Promise.resolve(null),
    ]).then(([b, s]) => {
      setBase(b)
      setSource(s)
      setLoaded(true)
    })
  }, [visible, sessionId, file.path, file.oldPath, file.status, epoch])

  // scroll the section into view when picked from the tree or keyboard
  useEffect(() => {
    const el = containerRef.current
    if (el === null || selectedPath !== file.path) return
    // a change-to-change jump already aimed at an exact line in here
    if (flowJumpInFlight()) return
    const rect = el.getBoundingClientRect()
    const in_view = rect.top >= 0 && rect.top < window.innerHeight * 0.7
    if (!in_view) el.scrollIntoView({ block: 'start' })
  }, [selectedPath, file.path])

  const file_threads = (side: Side) =>
    threads.filter((t) => t.path === file.path && t.side === side)
  const file_drafts = (side: Side) =>
    drafts.filter(
      (d) =>
        d.repoId === activeRepoId && d.path === file.path && d.side === side,
    )

  const binary = base?.binary === true || source?.binary === true
  const has_any = base?.content != null || source?.content != null
  // side-by-side renders one-sided files as a diff so added content sits
  // right and deleted content sits left; inline keeps the plain editor
  const has_both =
    (base?.content != null && source?.content != null) ||
    (sideBySide && has_any)
  const single_side: Side = source?.content != null ? 'source' : 'base'
  const single_content =
    single_side === 'source' ? source?.content : base?.content
  const language = languageFor(file.path)

  const sizeToContent = (
    editors: editor.ICodeEditor[],
  ): (() => void) => {
    const update = () => {
      const content = Math.max(
        ...editors.map((ed) => ed.getContentHeight()),
        120,
      )
      setHeight(Math.min(content + 14, 100000))
    }
    for (const ed of editors) ed.onDidContentSizeChange(update)
    update()
    return update
  }

  const section_options: editor.IStandaloneEditorConstructionOptions = {
    ...options,
    scrollBeyondLastLine: false,
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'auto',
      handleMouseWheel: false,
      alwaysConsumeMouseWheel: false,
      useShadows: false,
    },
  }

  return (
    <section ref={containerRef} className="border-b border-edge">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-y border-edge bg-panel px-3 py-1.5 text-xs">
        <span className="truncate font-mono text-ink">{file.path}</span>
        <span className="rounded bg-overlay px-1.5 py-0.5 text-soft">
          {file.status}
        </span>
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-soft hover:text-ink">
          <input
            type="checkbox"
            checked={viewed.has(file.path)}
            onChange={() => void toggleViewed(file.path)}
          />
          viewed
        </label>
      </div>
      {!loaded && (
        <div className="flex h-24 items-center justify-center text-xs text-faint">
          {visible ? 'loading…' : ''}
        </div>
      )}
      {loaded && binary && (
        <div className="flex h-16 items-center justify-center text-xs text-faint">
          Binary file
        </div>
      )}
      {loaded && !binary && has_both && (
        <div style={{ height }}>
          <DiffEditor
            original={base?.content ?? ''}
            modified={source?.content ?? ''}
            language={language}
            theme={theme}
            options={{
              ...section_options,
              renderSideBySide: sideBySide,
              hideUnchangedRegions: {
                enabled: true,
                contextLineCount: 3,
                minimumLineCount: 5,
                revealLineCount: 20,
              },
            }}
            onMount={(diff) => {
              const original = diff.getOriginalEditor()
              const modified = diff.getModifiedEditor()
              setOriginalEditor(original)
              setModifiedEditor(modified)
              attach(original, 'base', file.path)
              attach(modified, 'source', file.path)
              sizeToContent([original, modified])
              registerFlowEditors(file.path, diff, modified)
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
        </div>
      )}
      {loaded && !binary && !has_both && single_content != null && (
        <div style={{ height }}>
          <Editor
            value={single_content}
            language={language}
            theme={theme}
            options={section_options}
            onMount={(instance) => {
              setSingleEditor(instance)
              attach(instance, single_side, file.path)
              sizeToContent([instance])
              registerFlowEditors(file.path, null, instance)
            }}
          />
          <CommentLayer
            editorInstance={singleEditor}
            threads={file_threads(single_side)}
            drafts={file_drafts(single_side)}
          />
        </div>
      )}
    </section>
  )
}

interface Props {
  files: ChangedFile[]
  sessionId: number
  repoId: number
  options: editor.IStandaloneEditorConstructionOptions
  sideBySide: boolean
  theme: string
  attach: Attach
}

// diff tabs resume where they were left, keyed per repo
const flow_scroll = new Map<number, number>()

/** GitLab-style review: every changed file in one continuous scroll. */
export function ContinuousDiff({
  files,
  sessionId,
  repoId,
  options,
  sideBySide,
  theme,
  attach,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const restoringRef = useRef(false)
  useEffect(() => {
    setFlowScroller(scrollerRef.current)
    return () => setFlowScroller(null)
  }, [])
  useEffect(() => {
    const el = scrollerRef.current
    if (el === null) return
    const remembered = flow_scroll.get(repoId) ?? 0
    if (remembered === 0) return
    // lazy sections inflate over time; keep re-applying the remembered
    // offset (without letting those programmatic scrolls overwrite it)
    // until it sticks or the user scrolls themselves
    restoringRef.current = true
    el.scrollTop = remembered
    const timers = [150, 400, 800, 1400].map((delay) =>
      setTimeout(() => {
        if (!restoringRef.current) return
        if (Math.abs(el.scrollTop - remembered) > 4) {
          el.scrollTop = remembered
        }
      }, delay),
    )
    const done = setTimeout(() => {
      restoringRef.current = false
    }, 1600)
    const stopOnUserScroll = (event: WheelEvent | TouchEvent) => {
      void event
      restoringRef.current = false
    }
    el.addEventListener('wheel', stopOnUserScroll, { passive: true })
    el.addEventListener('touchmove', stopOnUserScroll, { passive: true })
    return () => {
      for (const t of timers) clearTimeout(t)
      clearTimeout(done)
      el.removeEventListener('wheel', stopOnUserScroll)
      el.removeEventListener('touchmove', stopOnUserScroll)
      restoringRef.current = false
    }
  }, [repoId])

  return (
    <div
      ref={scrollerRef}
      className="h-full overflow-y-auto"
      onScroll={(e) => {
        if (!restoringRef.current) {
          flow_scroll.set(repoId, e.currentTarget.scrollTop)
        }
      }}
    >
      {files.map((file) => (
        <DiffSection
          key={`${sessionId}:${file.path}`}
          file={file}
          sessionId={sessionId}
          options={options}
          sideBySide={sideBySide}
          theme={theme}
          attach={attach}
        />
      ))}
    </div>
  )
}
