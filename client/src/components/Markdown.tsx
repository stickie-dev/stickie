import type { ReactNode } from 'react'
import type { Block, Inline } from '../markdown'
import { parseMarkdown } from '../markdown'

/**
 * A comment body, drawn.
 *
 * Every leaf is a React node — nothing here builds an HTML string, so a note
 * containing markup is a note *showing* markup, and that holds without a
 * sanitiser being right. It matters more than usual: half these bodies are
 * written by agents, and the other half arrive from a merge request.
 *
 * Plain text runs are handed back to the caller to draw, because stickie's own
 * `@path:L10` references are links too and they are not markdown's business.
 */
export function Markdown({
  body,
  text,
}: {
  body: string
  /** how to draw a run of plain text — the ref linker, in a note */
  text: (run: string, key: string) => ReactNode
}) {
  return <Blocks blocks={parseMarkdown(body)} text={text} />
}

function Blocks({
  blocks,
  text,
}: {
  blocks: Block[]
  text: (run: string, key: string) => ReactNode
}) {
  return (
    <>
      {blocks.map((block, i) => {
        const key = String(i)
        switch (block.kind) {
          case 'code':
            return (
              // a diff is the content here; a block inside a note is quoted
              // code, so it sits in a well rather than competing with one
              <pre
                key={key}
                className="my-1.5 overflow-x-auto rounded-md bg-sunken p-2 font-mono text-dense text-ink"
              >
                <code>{block.text}</code>
              </pre>
            )
          case 'heading':
            return (
              <p key={key} className="mt-2 mb-1 font-semibold text-ink">
                <Inlines inlines={block.inlines} text={text} at={key} />
              </p>
            )
          case 'rule':
            return <hr key={key} className="my-2 border-edge" />
          case 'quote':
            return (
              <blockquote
                key={key}
                className="my-1.5 border-l-2 border-edge pl-2 text-soft"
              >
                <Blocks blocks={block.blocks} text={text} />
              </blockquote>
            )
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul'
            return (
              <List
                key={key}
                className={`my-1.5 space-y-0.5 pl-4 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
              >
                {block.items.map((item, j) => (
                  <li
                    key={j}
                    className={item.checked === null ? '' : 'list-none -ml-4'}
                  >
                    {item.checked !== null && (
                      <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly
                        // it reports what the merge request says; changing it
                        // here would change nothing there
                        className="mr-1.5 align-[-1px]"
                        tabIndex={-1}
                      />
                    )}
                    <Inlines
                      inlines={item.inlines}
                      text={text}
                      at={`${key}.${String(j)}`}
                    />
                  </li>
                ))}
              </List>
            )
          }
          default:
            return (
              <p key={key} className="my-1 whitespace-pre-wrap">
                <Inlines inlines={block.inlines} text={text} at={key} />
              </p>
            )
        }
      })}
    </>
  )
}

function Inlines({
  inlines,
  text,
  at,
}: {
  inlines: Inline[]
  text: (run: string, key: string) => ReactNode
  at: string
}) {
  return (
    <>
      {inlines.map((inline, i) => {
        const key = `${at}.${String(i)}`
        switch (inline.kind) {
          case 'code':
            return (
              <code
                key={key}
                className="rounded-xs bg-overlay px-1 font-mono text-dense"
              >
                {inline.text}
              </code>
            )
          case 'strong':
            return (
              <strong key={key} className="font-semibold text-ink">
                {inline.text}
              </strong>
            )
          case 'em':
            return <em key={key}>{inline.text}</em>
          case 'strike':
            return (
              <s key={key} className="text-faint">
                {inline.text}
              </s>
            )
          case 'image':
          case 'link':
            return (
              <a
                key={key}
                href={inline.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline [overflow-wrap:anywhere]"
              >
                {inline.kind === 'image' ? `🖼 ${inline.text}` : inline.text}
              </a>
            )
          default:
            return <span key={key}>{text(inline.text, key)}</span>
        }
      })}
    </>
  )
}
