import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DiffEditor, Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { ChangedFile, FileContent, Side } from '@stickie/shared'
import { cachedFile } from '../fileCache'
import {
  flowClickInFlight,
  flowJumpInFlight,
  flowScroller,
  registerFlowEditors,
  registerFlowSection,
  setFlowScroller,
} from '../flowNav'
import { languageFor } from '../languages'
import { useReview, wrapFor } from '../store'
import { CommentLayer } from './CommentLayer'
import { FileName } from './FileName'
import { Loading, SkeletonCode } from './Skeleton'
import { btn, card } from '../ui'

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
  const wrapExtensions = useReview((s) => s.wrapExtensions)
  const wrapOverrides = useReview((s) => s.wrapOverrides)
  const wrap = wrapFor(file.path, wrapExtensions, wrapOverrides)
  const toggleWrap = useReview((s) => s.toggleWrap)

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
        ? cachedFile(sessionId, epoch, file.oldPath ?? file.path, 'base')
        : Promise.resolve(null),
      want_source
        ? cachedFile(sessionId, epoch, file.path, 'source')
        : Promise.resolve(null),
    ]).then(([b, s]) => {
      setBase(b)
      setSource(s)
      setLoaded(true)
    })
  }, [visible, sessionId, file.path, file.oldPath, file.status, epoch])

  // a section that grows or shrinks above the reader would drag the page
  // under them — and, when the flow gets shorter, the browser clamps the
  // scroll upwards; keep the visible content where it was instead
  const measured = useRef(height)
  useLayoutEffect(() => {
    const el = containerRef.current
    const scroller = flowScroller()
    const previous = measured.current
    measured.current = height
    if (el === null || scroller === null || previous === height) return
    const rect = el.getBoundingClientRect()
    if (rect.bottom > scroller.getBoundingClientRect().top) return
    scroller.scrollTop += height - previous
  }, [height])

  // scroll the section into view when picked from the tree or keyboard
  useEffect(() => {
    const el = containerRef.current
    if (el === null || selectedPath !== file.path) return
    // a change-to-change jump already aimed at an exact line in here, and a
    // click or selection inside this section is the reader already being here
    if (flowJumpInFlight() || flowClickInFlight()) return
    const rect = el.getBoundingClientRect()
    const in_view = rect.top >= 0 && rect.top < window.innerHeight * 0.7
    if (!in_view) el.scrollIntoView({ block: 'start' })
  }, [selectedPath, file.path])

  const file_threads = (side: Side) =>
    threads.filter(
      (t) => t.path === file.path && t.side === side && t.startLine > 0,
    )
  const file_drafts = (side: Side) =>
    drafts.filter(
      (d) =>
        d.repoId === activeRepoId && d.path === file.path && d.side === side,
    )

  const collapseUnchanged = useReview((s) => s.collapseUnchanged)
  // only the file a match or a reference landed in opens; moving on folds it
  const expanded = useReview((s) => s.expandFor === file.path)
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
    // each file in the flow follows its own type's wrap decision
    wordWrap: wrap ? 'on' : 'off',
    rulers: wrap ? [] : [80, 100, 120],
    scrollBeyondLastLine: false,
    // the card clips its bottom corners, which would take the context menu and
    // the hover widgets with it; these render against the body instead
    fixedOverflowWidgets: true,
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'auto',
      handleMouseWheel: false,
      alwaysConsumeMouseWheel: false,
      useShadows: false,
    },
  }

  return (
    // a card per file rather than one unbroken column: at twenty files the
    // only thing saying where one ends and the next begins was a hairline,
    // and a sticky header sliding over it read as part of the file above
    <section ref={containerRef} className={`mb-3 ${card}`}>
      <div className="sticky top-0 z-20 flex items-center gap-3 rounded-t-lg border-b border-edge bg-panel px-3 py-1.5 text-xs">
        <FileName path={file.path} />
        <span className="shrink-0 rounded bg-overlay px-1.5 py-0.5 text-soft">
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
        <span className="grow" />
        <button
          className={`shrink-0 ${btn()}`}
          title="soft-wrap long lines in this file (also in the right-click menu)"
          onClick={() => toggleWrap(file.path)}
        >
          {wrap ? 'no wrap' : 'wrap'}
        </button>
      </div>
      {!loaded && (
        // only once it is near the viewport: a silhouette for each of twenty
        // files below the fold is twenty animations nobody is looking at
        <div className="h-24 overflow-hidden">
          {visible && (
            <Loading what={file.path}>
              <SkeletonCode lines={5} />
            </Loading>
          )}
        </div>
      )}
      {loaded && binary && (
        <div className="flex h-16 items-center justify-center text-xs text-faint">
          Binary file
        </div>
      )}
      {loaded && !binary && has_both && (
        <div className="overflow-hidden rounded-b-lg" style={{ height }}>
          <DiffEditor
            original={base?.content ?? ''}
            modified={source?.content ?? ''}
            language={language}
            theme={theme}
            options={{
              ...section_options,
              renderSideBySide: sideBySide,
              // the reader's choice, not a constant: this said "always
              // collapsed", so the menu's other answer did nothing here
              hideUnchangedRegions: {
                // a find match can sit in an unchanged region, and a region
                // that is folded away cannot show it
                enabled: collapseUnchanged && !expanded,
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
        <div className="overflow-hidden rounded-b-lg" style={{ height }}>
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

  /**
   * Dragging a selection past the edge scrolls the flow.
   *
   * Each file is its own content-sized editor, so Monaco has no scrollbar of
   * its own to run and nothing carries the drag past the viewport — a
   * selection could only ever be as long as what was already on screen. While
   * a drag is live, being near an edge scrolls towards it, faster the closer
   * it gets, and Monaco extends the selection as the content moves under the
   * pointer.
   */
  useEffect(() => {
    const el = scrollerRef.current
    if (el === null) return
    const edge = 60
    const top_speed = 18
    let dragging = false
    let pointer = 0
    let frame: number | null = null

    const step = () => {
      frame = null
      if (!dragging) return
      const box = el.getBoundingClientRect()
      const above = edge - (pointer - box.top)
      const below = edge - (box.bottom - pointer)
      const push =
        above > 0 ? -above : below > 0 ? below : 0
      if (push !== 0) {
        el.scrollTop += Math.sign(push) * Math.min(top_speed, Math.abs(push) / 2)
      }
      frame = requestAnimationFrame(step)
    }

    const start = (event: MouseEvent) => {
      // only a left-button drag that began inside the code
      if (event.button !== 0) return
      if ((event.target as HTMLElement | null)?.closest('.monaco-editor') == null) {
        return
      }
      dragging = true
      pointer = event.clientY
      frame ??= requestAnimationFrame(step)
    }
    const move = (event: MouseEvent) => {
      pointer = event.clientY
    }
    const stop = () => {
      dragging = false
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
    }

    el.addEventListener('mousedown', start)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    return () => {
      el.removeEventListener('mousedown', start)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      stop()
    }
  }, [])

  /**
   * A click never moves this scroller.
   *
   * The browser scrolls a newly focused element into view, and clicking into an
   * editor focuses a hidden element Monaco keeps for keyboard input — which is
   * not where the click landed. Deep inside a file taller than the viewport
   * that threw the reader back to the file's top: measured 3000 to 0 with no
   * scroll event and no height change, the offset already gone by the time
   * `focusin` fired.
   *
   * So the offset is put back in the same task the focus moved in, before any
   * paint, and only for a focus the click itself caused — a jump to a change
   * focuses an editor too, and that one is allowed to scroll.
   */
  useEffect(() => {
    const el = scrollerRef.current
    if (el === null) return
    let clicked = false
    let offset = 0
    const remember = () => {
      clicked = true
      offset = el.scrollTop
      // focus from a click arrives in this task; anything later is not a click
      setTimeout(() => {
        clicked = false
      }, 0)
    }
    const restore = () => {
      if (clicked && el.scrollTop !== offset) el.scrollTop = offset
    }
    el.addEventListener('mousedown', remember, true)
    el.addEventListener('focusin', restore, true)
    return () => {
      el.removeEventListener('mousedown', remember, true)
      el.removeEventListener('focusin', restore, true)
    }
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
      className="h-full overflow-y-auto px-2 pt-2"
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
