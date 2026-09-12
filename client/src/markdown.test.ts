import { describe, expect, it } from 'vitest'
import { hasMarkup, parseInline, parseMarkdown } from './markdown'

const kinds = (text: string) => parseInline(text).map((i) => i.kind)

describe('parseInline', () => {
  it('leaves plain prose as one run', () => {
    expect(parseInline('just a sentence')).toEqual([
      { kind: 'text', text: 'just a sentence' },
    ])
  })

  it('reads a backticked identifier, which is most of what a review uses', () => {
    expect(parseInline('rename `foo_bar` here')).toEqual([
      { kind: 'text', text: 'rename ' },
      { kind: 'code', text: 'foo_bar' },
      { kind: 'text', text: ' here' },
    ])
  })

  it('reads bold, italic and strikethrough', () => {
    expect(kinds('**must** be *fixed*, ~~not~~ later')).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'strike',
      'text',
    ])
  })

  it('reads a link and keeps its label', () => {
    expect(parseInline('see [the build](https://ci.example.com/1)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'the build', href: 'https://ci.example.com/1' },
    ])
  })

  it('links a bare URL, which hub comments are full of', () => {
    const [, link] = parseInline('logs at https://ci.example.com/7 today')
    expect(link).toEqual({
      kind: 'link',
      text: 'https://ci.example.com/7',
      href: 'https://ci.example.com/7',
    })
  })

  it('leaves a full stop after a URL in the sentence it belongs to', () => {
    const parts = parseInline('see https://example.com/x.')
    expect(parts[1]).toMatchObject({ href: 'https://example.com/x' })
    expect(parts[2]).toEqual({ kind: 'text', text: '.' })
  })

  it('does not find a bare URL inside a link it already read', () => {
    expect(kinds('[build](https://ci.example.com/1)')).toEqual(['link'])
  })

  it('makes an image a link rather than fetching it', () => {
    // a comment from a hub can point anywhere, and loading it would tell that
    // host the reader opened this review
    expect(parseInline('![a screenshot](https://gl.example.com/s.png)')).toEqual([
      { kind: 'image', text: 'a screenshot', href: 'https://gl.example.com/s.png' },
    ])
  })

  it('refuses a javascript: url, keeping it as the text it is', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[click](javascript:alert(1))' },
    ])
  })

  it('leaves html as text, since nothing here becomes html', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ])
  })

  it('leaves a stickie code reference alone for the linker after it', () => {
    expect(kinds('as in @src/app.py:L12')).toEqual(['text'])
  })
})

describe('parseMarkdown', () => {
  it('reads a fenced block with its language', () => {
    expect(parseMarkdown('```python\nx = 1\n```')).toEqual([
      { kind: 'code', language: 'python', text: 'x = 1' },
    ])
  })

  it('runs an unclosed fence to the end rather than eating it as prose', () => {
    expect(parseMarkdown('```\nnot closed')).toEqual([
      { kind: 'code', language: '', text: 'not closed' },
    ])
  })

  it('reads a bulleted list', () => {
    const [block] = parseMarkdown('- one\n- two')
    expect(block).toMatchObject({ kind: 'list', ordered: false })
    expect(block?.kind === 'list' && block.items.length).toBe(2)
  })

  it('reads the checkboxes a merge request is full of', () => {
    const [block] = parseMarkdown('- [x] done\n- [ ] not yet')
    expect(block?.kind === 'list' && block.items.map((i) => i.checked)).toEqual([
      true,
      false,
    ])
  })

  it('tells a plain bullet from a task', () => {
    const [block] = parseMarkdown('- just a bullet')
    expect(block?.kind === 'list' && block.items[0]?.checked).toBe(null)
  })

  it('reads a quote, and what is inside it', () => {
    const [block] = parseMarkdown('> they said `this`\n> and this')
    expect(block?.kind).toBe('quote')
    expect(block?.kind === 'quote' && block.blocks[0]?.kind).toBe('paragraph')
  })

  it('reads the quote that starting a note from an MR produces', () => {
    const blocks = parseMarkdown('From !469:\n\n> **colleague**: needs a test\n\n')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'quote'])
  })

  it('separates paragraphs on a blank line', () => {
    expect(parseMarkdown('one\n\ntwo').map((b) => b.kind)).toEqual([
      'paragraph',
      'paragraph',
    ])
  })

  it('reads headings and rules', () => {
    expect(parseMarkdown('## Title\n\n---').map((b) => b.kind)).toEqual([
      'heading',
      'rule',
    ])
  })

  it('keeps a line break inside a paragraph', () => {
    const [block] = parseMarkdown('one\ntwo')
    expect(block?.kind === 'paragraph' && block.inlines[0]?.text).toBe('one\ntwo')
  })

  it('answers with nothing for nothing', () => {
    expect(parseMarkdown('')).toEqual([])
  })
})

describe('hasMarkup', () => {
  it('is false for prose, so a plain note is drawn plainly', () => {
    expect(hasMarkup('rename this, it reads badly')).toBe(false)
  })

  it('is true once anything is marked up', () => {
    expect(hasMarkup('rename `this`')).toBe(true)
    expect(hasMarkup('- one\n- two')).toBe(true)
  })
})
