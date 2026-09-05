import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import type { Thread } from '@stickie/shared'
import { monaco } from '../monacoSetup'
import type { Draft } from '../store'
import { useReview } from '../store'
import { DraftForm } from './DraftForm'
import { ThreadCard } from './ThreadCard'

interface ZoneEntry {
  key: string
  node: HTMLDivElement
  zone: editor.IViewZone
  zoneId: string
}

interface Props {
  editorInstance: editor.ICodeEditor | null
  threads: Thread[]
  drafts: Draft[]
}

/**
 * Renders comment threads (and in-progress drafts) as Monaco view zones,
 * with React content portaled into each zone's DOM node. Zone heights track
 * rendered content via ResizeObserver.
 */
export function CommentLayer({ editorInstance, threads, drafts }: Props) {
  const [entries, setEntries] = useState<ZoneEntry[]>([])
  const entriesRef = useRef<ZoneEntry[]>([])
  const resolvedNotes = useReview((s) => s.resolvedNotes)
  const shownResolved = useReview((s) => s.shownResolved)
  const toggleResolvedShown = useReview((s) => s.toggleResolvedShown)

  /**
   * A resolved note that has left the code: it is marked in the gutter on the
   * line it was written against, and opens from there. Under the other setting
   * it stays where it is and folds itself to one line.
   */
  const marked = threads.filter(
    (thread) => resolvedNotes === 'gutter' && thread.status === 'resolved',
  )
  // the mark stays once its note is open, because it is also how to close it
  const hidden = (thread: Thread) =>
    marked.includes(thread) && shownResolved[thread.id] !== true

  const shown = threads.filter((thread) => !hidden(thread))

  const items: { key: string; line: number }[] = [
    ...shown.map((t) => ({ key: `t${t.id}`, line: t.endLine })),
    ...drafts.map((d) => ({ key: `d${d.id}`, line: d.endLine })),
  ]
  // only which zones exist and where they sit; message text reaches the cards
  // through props, and rebuilding a zone would unmount a note being typed in
  const signature = items.map((item) => `${item.key}:${item.line}`).join('|')

  useEffect(() => {
    const instance = editorInstance
    if (instance === null) return
    const wanted = new Map(items.map((item) => [item.key, item.line]))
    const previous = entriesRef.current
    const kept = previous.filter((entry) => wanted.has(entry.key))
    const gone = previous.filter((entry) => !wanted.has(entry.key))
    const added: ZoneEntry[] = []
    instance.changeViewZones((accessor) => {
      for (const entry of gone) accessor.removeZone(entry.zoneId)
      for (const entry of kept) {
        const line = wanted.get(entry.key)
        if (line !== undefined && entry.zone.afterLineNumber !== line) {
          entry.zone.afterLineNumber = line
          accessor.layoutZone(entry.zoneId)
        }
      }
      for (const [key, line] of wanted) {
        if (previous.some((entry) => entry.key === key)) continue
        const node = document.createElement('div')
        node.className = 'stickie-zone'
        const zone: editor.IViewZone = {
          afterLineNumber: line,
          heightInPx: 100,
          domNode: node,
        }
        const zoneId = accessor.addZone(zone)
        added.push({ key, node, zone, zoneId })
      }
    })
    if (gone.length > 0 || added.length > 0) {
      const next = [...kept, ...added]
      entriesRef.current = next
      setEntries(next)
    }
  }, [editorInstance, signature])

  // zones belong to one editor; a new editor (or none) starts over
  useEffect(() => {
    const instance = editorInstance
    return () => {
      const owned = entriesRef.current
      entriesRef.current = []
      setEntries([])
      if (instance === null) return
      try {
        instance.changeViewZones((accessor) => {
          for (const entry of owned) accessor.removeZone(entry.zoneId)
        })
      } catch {
        // editor already disposed on unmount
      }
    }
  }, [editorInstance])

  /**
   * The marks themselves, and the click that opens one. Monaco owns the gutter,
   * so this is a decoration rather than anything React can render — and the
   * click has to be read off the editor for the same reason.
   */
  const marks = marked
    .map(
      (t) =>
        `${String(t.id)}:${String(t.endLine)}:${shownResolved[t.id] === true ? 'open' : 'shut'}`,
    )
    .join('|')
  useEffect(() => {
    const instance = editorInstance
    if (instance === null || marked.length === 0) return
    const collection = instance.createDecorationsCollection(
      marked.map((thread) => {
        const open = shownResolved[thread.id] === true
        return {
          range: new monaco.Range(thread.endLine, 1, thread.endLine, 1),
          options: {
            isWholeLine: false,
            linesDecorationsClassName: `stickie-resolved-mark${open ? ' is-open' : ''}`,
            linesDecorationsTooltip: open
              ? 'hide this resolved note again'
              : 'a resolved note was written here — click to read it',
          },
        }
      }),
    )
    const listener = instance.onMouseDown((event) => {
      if (
        event.target.type !==
        monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
      ) {
        return
      }
      const line = event.target.position?.lineNumber
      if (line === undefined) return
      for (const thread of marked) {
        if (thread.endLine === line) toggleResolvedShown(thread.id)
      }
    })
    return () => {
      collection.clear()
      listener.dispose()
    }
  }, [editorInstance, marks, toggleResolvedShown])

  const relayout = (key: string, height: number) => {
    if (editorInstance === null) return
    const entry = entriesRef.current.find((e) => e.key === key)
    if (entry === undefined || entry.zone.heightInPx === height) return
    entry.zone.heightInPx = height
    editorInstance.changeViewZones((accessor) => accessor.layoutZone(entry.zoneId))
  }

  return (
    <>
      {entries.map((entry) =>
        createPortal(
          <Measured onHeight={(h) => relayout(entry.key, h)}>
            {entry.key.startsWith('d') ? (
              <DraftForm
                draft={drafts.find((d) => `d${d.id}` === entry.key)}
              />
            ) : (
              <ThreadCard
                thread={shown.find((t) => `t${t.id}` === entry.key)}
              />
            )}
          </Measured>,
          entry.node,
          entry.key,
        ),
      )}
    </>
  )
}

function Measured({
  children,
  onHeight,
}: {
  children: React.ReactNode
  onHeight: (height: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const observer = new ResizeObserver(() => {
      onHeight(el.offsetHeight)
    })
    observer.observe(el)
    onHeight(el.offsetHeight)
    return () => observer.disconnect()
  })

  return (
    // a left inset as well as a right one: a card's ring and its shadow are
    // drawn outside its box, and the zone clips at the content edge, so with
    // nothing on the left the border of the card came off
    <div ref={ref} className="py-1 pr-6 pl-1.5">
      {children}
    </div>
  )
}
