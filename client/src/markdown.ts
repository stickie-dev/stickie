/**
 * The markdown a review comment actually uses, parsed to data.
 *
 * Not a markdown implementation — a reading of the handful of things people
 * reach for when they are talking about code: a backticked identifier, a
 * fenced block, a bulleted list of objections, a quote of what someone else
 * said, a link to a build. That is the whole of it, and stopping there is what
 * keeps this small enough to read.
 *
 * Parsed to *data* rather than to HTML. Nothing here produces a string that
 * gets handed to `dangerouslySetInnerHTML`, so a note containing a `<script>`
 * is a note containing the text `<script>`, and no sanitiser has to be
 * correct for that to hold. Notes come from agents as well as people.
 */

export interface Inline {
  kind: 'text' | 'code' | 'strong' | 'em' | 'strike' | 'link' | 'image'
  text: string
  /** links and images only */
  href?: string
}

/** A list item, which on a merge request is often a checkbox. */
export interface Item {
  /** null when it is a plain bullet rather than a task */
  checked: boolean | null
  inlines: Inline[]
}

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; items: Item[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'rule' }

/*
 * One pass, one alternation, no nesting. `**bold** inside a link` and friends
 * are where a real parser starts and where this one stops: a comment that
 * needs them is a comment that wants a document.
 *
 * Order matters twice over. An image is a link with a `!` in front, so it has
 * to be tried first or it parses as a link to a picture; and a bare URL is
 * tried last, so the one inside `[text](url)` is not found on its own.
 */
const inline_pattern = new RegExp(
  [
    '(`[^`\n]+`)',
    '(!\\[[^\\]\n]*\\]\\([^)\\s]+\\))',
    '(\\[[^\\]\n]*\\]\\([^)\\s]+\\))',
    '(\\*\\*[^*\n]+\\*\\*)',
    '(~~[^~\n]+~~)',
    '(\\*[^*\n]+\\*|_[^_\n]+_)',
    '(https?://[^\\s<>()\\[\\]]+)',
  ].join('|'),
)

/** Only what a browser will follow safely; `javascript:` is not a link. */
function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (/^(https?:\/\/|mailto:|#|\/)/i.test(trimmed)) return trimmed
  return null
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest !== '') {
    const match = inline_pattern.exec(rest)
    if (match === null || match.index === undefined) break
    if (match.index > 0) {
      out.push({ kind: 'text', text: rest.slice(0, match.index) })
    }
    const [whole, code, image, link, strong, strike, em, bare] = match
    if (code !== undefined) {
      out.push({ kind: 'code', text: code.slice(1, -1) })
    } else if (image !== undefined) {
      // a link, not an <img>: a comment from a hub can point anywhere, and
      // fetching it would tell that host the reader opened this review
      const split = image.indexOf('](')
      const alt = image.slice(2, split)
      const href = safeHref(image.slice(split + 2, -1))
      if (href === null) out.push({ kind: 'text', text: image })
      else out.push({ kind: 'image', text: alt === '' ? 'image' : alt, href })
    } else if (link !== undefined) {
      const split = link.indexOf('](')
      const label = link.slice(1, split)
      const href = safeHref(link.slice(split + 2, -1))
      if (href === null) out.push({ kind: 'text', text: link })
      else out.push({ kind: 'link', text: label === '' ? href : label, href })
    } else if (strong !== undefined) {
      out.push({ kind: 'strong', text: strong.slice(2, -2) })
    } else if (strike !== undefined) {
      out.push({ kind: 'strike', text: strike.slice(2, -2) })
    } else if (em !== undefined) {
      out.push({ kind: 'em', text: em.slice(1, -1) })
    } else if (bare !== undefined) {
      // trailing punctuation belongs to the sentence, not to the URL
      const trimmed = bare.replace(/[.,;:!?]+$/, '')
      out.push({ kind: 'link', text: trimmed, href: trimmed })
      if (trimmed !== bare) out.push({ kind: 'text', text: bare.slice(trimmed.length) })
    }
    rest = rest.slice(match.index + whole.length)
  }
  if (rest !== '') out.push({ kind: 'text', text: rest })
  if (out.length === 0) return [{ kind: 'text', text }]
  // a rejected link leaves the text either side of it in two runs; joined,
  // because what follows this renders each run and two of them can break a
  // line where the writer did not
  const joined: Inline[] = []
  for (const part of out) {
    const last = joined.at(-1)
    if (part.kind === 'text' && last?.kind === 'text') {
      last.text += part.text
      continue
    }
    joined.push({ ...part })
  }
  return joined
}

const heading_pattern = /^(#{1,4})\s+(.*)$/
const bullet_pattern = /^\s*[-*+]\s+(.*)$/
/** `- [ ]` and `- [x]`, which merge-request comments are full of. */
const task_pattern = /^\[([ xX])\]\s+(.*)$/
const ordered_pattern = /^\s*\d+[.)]\s+(.*)$/
const quote_pattern = /^\s*>\s?(.*)$/
const fence_pattern = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/
const rule_pattern = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const paragraph: string[] = []
  const flush = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join('\n')) })
    paragraph.length = 0
  }

  while (i < lines.length) {
    const line = lines[i] ?? ''

    const fence = fence_pattern.exec(line)
    if (fence !== null) {
      flush()
      const marker = fence[1] ?? '```'
      const body: string[] = []
      i += 1
      // an unclosed fence runs to the end rather than swallowing the rest as
      // prose: whoever wrote it meant the remainder to be code
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith(marker)) {
        body.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      blocks.push({ kind: 'code', language: fence[2] ?? '', text: body.join('\n') })
      continue
    }

    if (line.trim() === '') {
      flush()
      i += 1
      continue
    }

    if (rule_pattern.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      i += 1
      continue
    }

    const heading = heading_pattern.exec(line)
    if (heading !== null) {
      flush()
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        inlines: parseInline(heading[2] ?? ''),
      })
      i += 1
      continue
    }

    if (quote_pattern.test(line)) {
      flush()
      const quoted: string[] = []
      while (i < lines.length) {
        const inner = quote_pattern.exec(lines[i] ?? '')
        if (inner === null) break
        quoted.push(inner[1] ?? '')
        i += 1
      }
      blocks.push({ kind: 'quote', blocks: parseMarkdown(quoted.join('\n')) })
      continue
    }

    const ordered = ordered_pattern.test(line)
    if (ordered || bullet_pattern.test(line)) {
      flush()
      const items: Item[] = []
      while (i < lines.length) {
        const current = lines[i] ?? ''
        const item = ordered
          ? ordered_pattern.exec(current)
          : bullet_pattern.exec(current)
        if (item === null) break
        const body = item[1] ?? ''
        const task = task_pattern.exec(body)
        items.push(
          task === null
            ? { checked: null, inlines: parseInline(body) }
            : {
                checked: (task[1] ?? ' ').toLowerCase() === 'x',
                inlines: parseInline(task[2] ?? ''),
              },
        )
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    paragraph.push(line)
    i += 1
  }
  flush()
  return blocks
}

/** Whether a body has any markdown in it worth rendering differently. */
export function hasMarkup(source: string): boolean {
  const blocks = parseMarkdown(source)
  if (blocks.some((b) => b.kind !== 'paragraph')) return true
  return blocks.some((b) =>
    b.kind === 'paragraph' && b.inlines.some((i) => i.kind !== 'text'),
  )
}
