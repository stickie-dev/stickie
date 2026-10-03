import type { ReactNode } from 'react'
import { GrowingTextarea } from './GrowingTextarea'
import { postsComment } from '../keys'
import { Markdown } from './Markdown'
import { useReview } from '../store'
import { badge, btn, field } from '../ui'
import { TimeAgo } from './TimeAgo'

const ref_pattern = /(@[\w./-]+(?::[\w./-]+)?:L\d+(?:-L?\d+)?)/g

/**
 * A note's text: markdown, with stickie's own `@path:L10` references linked
 * inside it.
 *
 * The references are handed to the markdown renderer as the way to draw plain
 * text, rather than being a markdown extension — they are stickie's, they point
 * inward at a file rather than outward at a URL, and markdown has no business
 * knowing about either.
 */
export function MessageBody({ body }: { body: string }) {
  return (
    <div className="text-ink [overflow-wrap:anywhere]">
      <Markdown body={body} text={(run, key) => <Refs key={key} run={run} />} />
    </div>
  )
}

/** Render @path:L10 and @repo:path:L10 references as jump links. */
function Refs({ run }: { run: string }) {
  const openRefTarget = useReview((s) => s.openRefTarget)
  const parts = run.split(ref_pattern)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^@(.+):L(\d+)/.exec(part)
        if (i % 2 === 1 && match !== null) {
          const target = match[1] ?? ''
          const line = Number(match[2])
          const colon = target.indexOf(':')
          const has_repo =
            colon !== -1 && !target.slice(0, colon).includes('/')
          const repo = has_repo ? target.slice(0, colon) : null
          const path = has_repo ? target.slice(colon + 1) : target
          return (
            <button
              key={i}
              className="rounded bg-accent/10 px-1 text-left font-mono text-accent [overflow-wrap:anywhere] hover:bg-accent/20"
              title={repo === null ? `open ${path}` : `open ${path} in ${repo}`}
              onClick={() => void openRefTarget(repo, path, line)}
            >
              {part}
            </button>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}


/**
 * The parts a note card is made of, so the two kinds of conversation stickie
 * shows are drawn by the same thing.
 *
 * There are two: the review's own notes, and the discussions on the merge
 * request beside them. They are not the same *data* — one is stickie's and can be
 * resolved and replied to here, the other is someone else's and can only be
 * read and answered where it lives — but they are the same shape on screen,
 * and a panel where two conversations are drawn by two components is a panel
 * where they drift apart a release at a time.
 */

export interface Said {
  /** who said it, as it should be shown */
  author: string
  /** an agent gets its own colour; a hub's commenters are all "someone else" */
  kind: 'user' | 'agent' | 'other'
  body: string
  at: string | null
  /** rendered after the body, on hover, for the message's own controls */
  actions?: ReactNode
}

/** The shell: one raised surface, ringed when something pointed at it. */
export function CardShell({
  linked = false,
  children,
}: {
  linked?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`min-w-0 rounded-lg bg-panel text-note shadow-lifted ${
        linked ? 'ring-1 ring-accent' : ''
      }`}
    >
      {children}
    </div>
  )
}

/** The band across the top: what this is, where it is, and what can be done. */
export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge/60 px-3 py-1.5">
      {children}
    </div>
  )
}

/**
 * Which messages sit on the shaded ground.
 *
 * It flips when the *speaker* changes — not every message, which stripes a
 * long back-and-forth for no reason, and not per author identity, which would
 * tint the same person differently in two threads. So a run of three from one
 * person is one block, and the reply after it is visibly a reply.
 */
export function shadeRun(authors: string[]): boolean[] {
  let shade = false
  let previous: string | null = null
  return authors.map((author) => {
    if (previous !== null && author !== previous) shade = !shade
    previous = author
    return shade
  })
}

/** One thing somebody said. */
export function SaidLine({ said, shade }: { said: Said; shade: boolean }) {
  return (
    <div
      className={`group -mx-1 rounded-md px-1 py-0.5 ${shade ? 'bg-overlay/50' : ''}`}
    >
      {/*
        A row of its own, so the name can be cut short. Names are not all
        chosen by people — a hub's bots sign with things like
        `project_1234_bot_a1b2c3`, which has no space or hyphen in it to break
        on, so left inline it pushed the whole panel wider than its pane. The
        time keeps its width and the name takes what is left, with the whole of
        it on hover, since a trimmed name is still the thing you might need to
        read in full.
      */}
      <div className="flex items-baseline gap-1.5">
        <span
          className={`min-w-0 truncate ${
            said.kind === 'agent'
              ? 'font-semibold text-sky-600 dark:text-sky-400'
              : 'font-semibold text-ink'
          }`}
          title={
            said.kind === 'other'
              ? said.author
              : `${said.author} — role: ${said.kind}`
          }
        >
          {said.author}
        </span>
        {said.at !== null && (
          <TimeAgo at={said.at} className="shrink-0 text-faint" />
        )}
        {/*
          On this line, and holding its place whether or not they are shown.
          Under the message they appeared only on hover and grew the card by a
          line as they did — which in a view zone re-measures the zone, moves
          the card out from under the pointer, and hides them again. They could
          be seen and never reached.
        */}
        {said.actions !== undefined && (
          <span className="ml-auto shrink-0">{said.actions}</span>
        )}
      </div>
      <MessageBody body={said.body} />
    </div>
  )
}

/** What was said, in order, on alternating ground. */
export function Saids({ saids }: { saids: Said[] }) {
  const shades = shadeRun(saids.map((s) => s.author))
  return (
    <>
      {saids.map((said, i) => (
        <SaidLine key={i} said={said} shade={shades[i] ?? false} />
      ))}
    </>
  )
}

/**
 * A status, in the one palette stickie uses for them: amber is outstanding,
 * emerald is done with, rose is a note whose code has gone. A merge request's
 * discussions are open or resolved and mean the same thing by both, so they
 * wear the same colours — two schemes for one idea is two things to learn.
 */
export const status_styles: Record<string, string> = {
  open: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  detached: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${badge} ${status_styles[status] ?? 'bg-overlay text-soft'}`}>
      {status}
    </span>
  )
}

/**
 * The row a thread ends with while nothing is being written: the whole width,
 * not the word, because the row is the target a pointer is already over.
 * `extra` is for what a particular kind of thread can also do with itself.
 */
export function ReplyRow({
  onOpen,
  extra,
}: {
  onOpen: () => void
  extra?: ReactNode
}) {
  return (
    <div className="flex gap-2 border-t border-edge/60 pt-1.5">
      <button
        className={`grow text-left text-xs ${btn('text', 'px-1.5')}`}
        onClick={onOpen}
      >
        reply…
      </button>
      {extra}
    </div>
  )
}

/**
 * Writing an answer. One box for both conversations — they differ only in
 * where the answer goes and what else can be done with it, which is what
 * `submitLabel` and `extra` carry.
 */
export function ReplyBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  submitTitle,
  placeholder,
  extra,
  autoFocus = true,
  onFocus,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
  submitLabel: string
  submitTitle?: string
  placeholder?: string
  /** anything else this answer could be, shown before the send button */
  extra?: ReactNode
  autoFocus?: boolean
  onFocus?: () => void
}) {
  const submitKey = useReview((s) => s.submitKey)
  const hint =
    submitKey === 'enter' ? '↵ to send, ⇧↵ for a new line' : '⌘↵ to send'
  return (
    <div className="border-t border-edge/60 pt-2">
      <GrowingTextarea
        autoFocus={autoFocus}
        className={`w-full ${field}`}
        placeholder={placeholder ?? `reply… (${hint})`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={(e) => {
          if (postsComment(e, submitKey)) {
            e.preventDefault()
            onSubmit()
          }
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="mt-1 flex items-center gap-2">
        <button className={`text-xs ${btn()}`} onClick={onCancel}>
          cancel
        </button>
        <span className="grow" />
        {extra}
        <button
          className={`text-xs ${btn('primary')}`}
          disabled={value.trim() === ''}
          title={submitTitle}
          onClick={onSubmit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

/** The body of a card: what was said, then whatever answers it. */
export function CardBody({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5 px-3 py-2">{children}</div>
}
