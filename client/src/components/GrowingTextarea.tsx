import { useLayoutEffect, useRef } from 'react'
import type { ComponentPropsWithoutRef, RefObject } from 'react'

/**
 * A box for writing a note in, which is as tall as what has been written.
 *
 * A comment is usually one line and occasionally eight. A box fixed at two
 * rows makes the common case fine and the long one a keyhole — three lines
 * visible out of nine, scrolled, while you are still deciding what to say. So
 * it starts at `rows` and grows with the text to `maxLines`, and only then
 * scrolls: past eight lines the note has stopped being a comment, and the
 * card it sits in has a diff underneath it that should not disappear.
 *
 * The height is measured rather than counted — lines wrap, and a wrapped line
 * is two. `scrollHeight` after a reset to `auto` is what the content actually
 * needs, including the padding, which is why the bounds are computed from the
 * same box.
 *
 * There is no resize handle. It fought this: a dragged height is overwritten
 * by the next keystroke, and the drag it would restore is the one thing the
 * growth already does.
 */
export function GrowingTextarea({
  rows = 2,
  maxLines = 8,
  inputRef,
  className = '',
  value,
  ...rest
}: Omit<ComponentPropsWithoutRef<'textarea'>, 'ref'> & {
  maxLines?: number
  /** the caller's own handle on the element, since this one keeps its own */
  inputRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const own = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const node = own.current
    if (node === null) return
    const style = getComputedStyle(node)
    const line = Number.parseFloat(style.lineHeight)
    // `normal` computes to a keyword rather than a number on some faces
    const height = Number.isFinite(line)
      ? line
      : Number.parseFloat(style.fontSize) * 1.4
    const padding =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom)
    const min = height * rows + padding
    const max = height * maxLines + padding

    // measured from nothing, or the box can only ever get taller
    const scrolled = node.scrollTop
    node.style.height = 'auto'
    const wanted = Math.min(Math.max(node.scrollHeight, min), max)
    node.style.height = `${String(wanted)}px`
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden'

    /*
     * Measuring from `auto` puts the scroll back to the top, which past the
     * eighth line means the line being typed leaves the window on the next
     * keystroke. Typing means the caret is at the end, so follow it there;
     * anywhere else is an edit in the middle, where the position it had is the
     * one to keep.
     */
    const end = typeof value === 'string' ? value.length : node.value.length
    const typing =
      node.selectionStart === end && node.selectionEnd === end
    node.scrollTop = typing ? node.scrollHeight : scrolled
  }, [value, rows, maxLines])

  return (
    <textarea
      {...rest}
      ref={(node) => {
        own.current = node
        if (inputRef !== undefined) inputRef.current = node
      }}
      rows={rows}
      value={value}
      /*
       * The bottom padding is the point of `pb-2`: a field's `py-1` leaves the
       * last line sitting on the border, and in a box that grows the last line
       * is the one being written.
       */
      className={`pb-2 ${className}`}
    />
  )
}
