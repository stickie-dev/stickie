import { useEffect, useState } from 'react'
import { Editor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { api } from '../api'
import { editor_font } from '../monacoSetup'
import { languageFor } from '../languages'
import { fontShift, useReview } from '../store'
import { Loading, SkeletonCode } from './Skeleton'
import { btn } from '../ui'

interface RefOffer {
  x: number
  y: number
  start: number
  end: number
}

/**
 * Read-only reference pane beside the diff: consult any file of any
 * registered repo without leaving the review, and feed selections into the
 * active note as refs.
 */
export function SidePane() {
  const pane = useReview((s) => s.sidePane)
  const shift = useReview(fontShift)
  const closeSide = useReview((s) => s.closeSide)
  const openRefTarget = useReview((s) => s.openRefTarget)
  const insertDraftRef = useReview((s) => s.insertDraftRef)
  const hasTarget = useReview(
    (s) => s.drafts.length > 0 || s.activeReplyId !== null,
  )
  const session = useReview((s) => s.session)
  const activeRepoId = useReview((s) => s.activeRepoId)
  const theme = useReview((s) => s.theme)

  const [content, setContent] = useState<string | null>(null)
  const [binary, setBinary] = useState(false)
  const [instance, setInstance] = useState<editor.IStandaloneCodeEditor | null>(
    null,
  )
  const [offer, setOffer] = useState<RefOffer | null>(null)

  const repoId = pane?.repoId
  const path = pane?.path
  useEffect(() => {
    if (repoId === undefined || path === undefined) return
    setContent(null)
    setBinary(false)
    // the active repo reads through its session so worktree state matches
    // the diff; other repos read their main worktree directly
    const load =
      repoId === activeRepoId && session !== null
        ? api.file(session.id, path, 'source')
        : api.repoFile(repoId, path)
    void load.then((file) => {
      setContent(file.content)
      setBinary(file.binary)
    })
  }, [repoId, path, activeRepoId, session])

  useEffect(() => {
    if (instance === null || pane === null || content === null) return
    instance.revealLineInCenter(pane.line)
    instance.setPosition({ lineNumber: pane.line, column: 1 })
  }, [instance, pane, content])

  if (pane === null) return null

  return (
    <aside className="flex w-[36rem] max-w-[45%] shrink-0 flex-col border-l border-edge bg-surface">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-xs">
        <span className="rounded bg-overlay px-1.5 py-0.5 text-soft">ref</span>
        <span className="truncate font-mono text-ink">
          {pane.repoName}:{pane.path}
        </span>
        <span className="grow" />
        <button
          className={`shrink-0 ${btn()}`}
          title="open this file in the main view"
          onClick={() => {
            void openRefTarget(pane.repoName, pane.path, pane.line)
            closeSide()
          }}
        >
          open in main
        </button>
        <button
          className={`shrink-0 ${btn()}`}
          onClick={closeSide}
        >
          close
        </button>
      </div>
      <div className="min-h-0 grow">
        {binary && (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            Binary file
          </div>
        )}
        {!binary && content === null && (
          <Loading what={pane.path}>
            <SkeletonCode lines={12} />
          </Loading>
        )}
        {!binary && content !== null && (
          <Editor
            key={`${pane.repoId}:${pane.path}`}
            value={content}
            language={languageFor(pane.path)}
            theme={theme === 'dark' ? 'stickie-dark' : 'stickie-light'}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderLineHighlight: 'none',
              fontSize: Math.max(11, 11.5 + shift),
              fontFamily: editor_font,
              fontLigatures: true,
              lineHeight: shift < 0 ? 18 : 20,
              wordWrap: 'on',
              padding: { top: 8, bottom: 8 },
              lineNumbersMinChars: 3,
              overviewRulerBorder: false,
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
                useShadows: false,
              },
            }}
            onMount={(ed) => {
              setInstance(ed)
              ed.onMouseUp((event) => {
                const selection = ed.getSelection()
                if (selection === null || selection.isEmpty()) return
                let end = selection.endLineNumber
                if (
                  selection.endColumn === 1 &&
                  end > selection.startLineNumber
                ) {
                  end -= 1
                }
                const browser = event.event.browserEvent
                setOffer({
                  x: browser.clientX,
                  y: browser.clientY,
                  start: selection.startLineNumber,
                  end,
                })
              })
              ed.onDidChangeCursorSelection((event) => {
                if (event.selection.isEmpty()) setOffer(null)
              })
              ed.onDidScrollChange(() => setOffer(null))
            }}
          />
        )}
      </div>
      {offer !== null && hasTarget && (
        <button
          className="fixed z-50 -translate-x-1/2 rounded-md border border-edge bg-panel px-3 py-1.5 text-xs whitespace-nowrap text-ink shadow-xl hover:bg-overlay"
          style={{
            left: Math.min(Math.max(offer.x, 120), window.innerWidth - 120),
            top: offer.y + 12,
          }}
          onClick={() => {
            insertDraftRef(pane.path, offer.start, offer.end, pane.repoId)
            setOffer(null)
          }}
        >
          ↗ ref {offer.start === offer.end ? `L${offer.start}` : `L${offer.start}–L${offer.end}`}{' '}
          → active note
        </button>
      )}
    </aside>
  )
}
