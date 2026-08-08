import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import type { Thread } from '@stickie/shared'
import type { Draft } from '../store'
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
  draft: Draft | null
}

/**
 * Renders comment threads (and the in-progress draft) as Monaco view zones,
 * with React content portaled into each zone's DOM node. Zone heights track
 * rendered content via ResizeObserver.
 */
export function CommentLayer({ editorInstance, threads, draft }: Props) {
  const [entries, setEntries] = useState<ZoneEntry[]>([])
  const entriesRef = useRef<ZoneEntry[]>([])

  const signature = [
    ...threads.map((t) => `${t.id}:${t.endLine}:${t.status}:${t.messages.length}`),
    draft === null ? '' : `draft:${draft.endLine}`,
  ].join('|')

  useEffect(() => {
    if (editorInstance === null) return
    const items: { key: string; line: number }[] = threads.map((t) => ({
      key: `t${t.id}`,
      line: t.endLine,
    }))
    if (draft !== null) {
      items.push({ key: 'draft', line: draft.endLine })
    }
    const created: ZoneEntry[] = []
    editorInstance.changeViewZones((accessor) => {
      for (const item of items) {
        const node = document.createElement('div')
        node.className = 'stickie-zone'
        const zone: editor.IViewZone = {
          afterLineNumber: item.line,
          heightInPx: 100,
          domNode: node,
        }
        const zoneId = accessor.addZone(zone)
        created.push({ key: item.key, node, zone, zoneId })
      }
    })
    entriesRef.current = created
    setEntries(created)
    return () => {
      entriesRef.current = []
      try {
        editorInstance.changeViewZones((accessor) => {
          for (const entry of created) accessor.removeZone(entry.zoneId)
        })
      } catch {
        // editor already disposed on unmount
      }
    }
  }, [editorInstance, signature])

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
            {entry.key === 'draft' ? (
              <DraftForm />
            ) : (
              <ThreadCard
                thread={threads.find((t) => `t${t.id}` === entry.key)}
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
    <div ref={ref} className="py-1 pr-6">
      {children}
    </div>
  )
}
