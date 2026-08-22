import { useEffect, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { api } from '../api'
import type { CommitBetween } from '../api'
import { languageFor } from '../languages'
import { useReview, wrapFor } from '../store'

interface Step {
  /** the commit this column arrives at */
  commit: CommitBetween | null
  before: string
  after: string
}

interface TouchedFile {
  path: string
  shas: string[]
}

/** Columns hold code, so they keep a code-sized width and scroll sideways. */
const column_chars = 90
const row_max_fraction = 0.7

function columnWidth(fontSize: number): number {
  // monospace advance is ~0.6em; the rest is the line-number gutter
  return Math.round(column_chars * fontSize * 0.6) + 64
}

/**
 * One file across the selected commits: the column at each commit shows what
 * that commit did to the file, so a row reads as that file's timeline, and
 * the rows stack into the whole selection. Nothing here moves the review
 * target.
 */
export function CommitTimeline({
  commits,
  options,
  theme,
}: {
  commits: CommitBetween[]
  options: editor.IStandaloneEditorConstructionOptions
  theme: string
}) {
  const view = useReview((s) => s.commitView)
  const selectCommits = useReview((s) => s.selectCommits)

  if (view === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        Pick commits in the sidebar — click one, ⌘/shift+click to add more.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-3 py-1.5 text-xs">
        <span className="text-soft">
          {view.shas.length} commit{view.shas.length === 1 ? '' : 's'}
          {' · '}
          {view.files.length} file{view.files.length === 1 ? '' : 's'}
        </span>
        <span className="truncate text-faint">
          oldest change on the left; each row is one file
        </span>
        <span className="grow" />
        <button
          className="shrink-0 text-soft hover:text-ink"
          title="clear the commit selection"
          onClick={() => void selectCommits([])}
        >
          clear
        </button>
      </div>
      {view.files.length === 0 ? (
        <div className="flex grow items-center justify-center text-sm text-faint">
          loading…
        </div>
      ) : (
        <div className="min-h-0 grow overflow-y-auto">
          {view.files.map((file) => (
            <FileTimeline
              key={file.path}
              file={file}
              repoId={view.repoId}
              shas={view.shas}
              commits={commits}
              options={options}
              theme={theme}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileTimeline({
  file,
  repoId,
  shas,
  commits,
  options,
  theme,
}: {
  file: TouchedFile
  repoId: number
  shas: string[]
  commits: CommitBetween[]
  options: editor.IStandaloneEditorConstructionOptions
  theme: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [height, setHeight] = useState(240)
  const wrapExtensions = useReview((s) => s.wrapExtensions)
  const wrapOverrides = useReview((s) => s.wrapOverrides)
  const toggleWrap = useReview((s) => s.toggleWrap)
  const wrap = wrapFor(file.path, wrapExtensions, wrapOverrides)

  // rows mount as they come into reach, like the review flow's sections
  useEffect(() => {
    const el = containerRef.current
    if (el === null || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  const key = shas.join(',')
  useEffect(() => {
    if (!visible) return
    let live = true
    const list = key.split(',')
    const oldest = list[0]
    if (oldest === undefined) return
    void (async () => {
      // the starting point is the oldest selected commit's parent
      const revisions = [`${oldest}^`, ...list]
      const contents = await Promise.all(
        revisions.map((rev) =>
          api
            .repoFile(repoId, file.path, rev)
            .then((blob) => blob.content ?? '')
            .catch(() => ''),
        ),
      )
      if (!live) return
      const built: Step[] = []
      // revisions[0] is the starting point, so revisions[i] is list[i - 1]
      for (let i = 1; i < revisions.length; i++) {
        built.push({
          commit: commits.find((c) => c.sha === list[i - 1]) ?? null,
          before: contents[i - 1] ?? '',
          after: contents[i] ?? '',
        })
      }
      setSteps(built)
    })()
    return () => {
      live = false
    }
  }, [visible, repoId, file.path, key, commits])

  const fontSize = typeof options.fontSize === 'number' ? options.fontSize : 12
  const min_width = columnWidth(fontSize)
  const column_options: editor.IStandaloneDiffEditorConstructionOptions = {
    ...options,
    wordWrap: wrap ? 'on' : 'off',
    rulers: [],
    renderSideBySide: false,
    scrollBeyondLastLine: false,
    // a row is capped in height, so a column scrolls its own content but
    // hands the wheel back to the page once it runs out
    scrollbar: {
      vertical: 'auto',
      horizontal: 'auto',
      alwaysConsumeMouseWheel: false,
      useShadows: false,
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
    hideUnchangedRegions: {
      enabled: true,
      contextLineCount: 2,
      minimumLineCount: 4,
      revealLineCount: 20,
    },
  }

  // the row is as tall as its tallest column, within reason
  const sizeToContent = (editors: editor.ICodeEditor[]) => {
    const update = () => {
      const content = Math.max(
        ...editors.map((ed) => ed.getContentHeight()),
        160,
      )
      setHeight((current) =>
        Math.max(
          current,
          Math.min(content + 12, window.innerHeight * row_max_fraction),
        ),
      )
    }
    for (const ed of editors) ed.onDidContentSizeChange(update)
    update()
  }

  const touched = new Set(file.shas)

  return (
    <section ref={containerRef} className="border-b border-edge">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-y border-edge bg-panel px-3 py-1.5 text-xs">
        <span className="truncate font-mono text-ink">{file.path}</span>
        <span className="shrink-0 rounded bg-overlay px-1.5 py-0.5 text-soft">
          {file.shas.length} of {shas.length} commit
          {shas.length === 1 ? '' : 's'}
        </span>
        <span className="grow" />
        <button
          className="shrink-0 text-soft hover:text-ink"
          title="soft-wrap long lines in this file"
          onClick={() => toggleWrap(file.path)}
        >
          {wrap ? 'no wrap' : 'wrap'}
        </button>
      </div>
      {steps === null ? (
        <div className="flex h-24 items-center justify-center text-xs text-faint">
          {visible ? 'loading…' : ''}
        </div>
      ) : (
        <div
          className="flex divide-x divide-edge overflow-x-auto"
          style={{ height }}
        >
          {steps.map((step, index) => (
            <div
              key={step.commit?.sha ?? index}
              className="flex min-h-0 flex-col"
              style={{ minWidth: min_width, flex: '1 0 auto' }}
            >
              <div className="flex items-baseline gap-2 border-b border-edge bg-surface px-2 py-1 text-xs">
                <span className="shrink-0 font-mono text-faint">
                  {step.commit?.shortSha ?? '—'}
                </span>
                <span className="truncate text-soft">
                  {step.commit?.subject ?? 'starting point'}
                </span>
              </div>
              <div className="min-h-0 grow">
                {step.before === step.after ? (
                  <div className="flex h-full items-center justify-center px-3 text-center text-xs text-faint">
                    {touched.has(step.commit?.sha ?? '')
                      ? 'no textual change here'
                      : 'this commit left the file alone'}
                  </div>
                ) : (
                  <DiffEditor
                    original={step.before}
                    modified={step.after}
                    language={languageFor(file.path)}
                    theme={theme}
                    options={column_options}
                    onMount={(diff) =>
                      sizeToContent([
                        diff.getOriginalEditor(),
                        diff.getModifiedEditor(),
                      ])
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
