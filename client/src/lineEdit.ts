/** A single Monaco edit, in the editor's own 1-based coordinates. */
export interface LineEdit {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  text: string
}

/**
 * The smallest whole-line edit that turns one text into another.
 *
 * Whole lines because what has to survive the edit is line-shaped: the diff
 * editor tracks each collapsed region with a decoration over its lines, and
 * works out after every change which of them the reader had opened by asking
 * those decorations where they now are. An edit that only touches the lines
 * that changed leaves every decoration outside them where it was, so a region
 * the reader had folded stays folded — and one they had opened stays open.
 *
 * Replacing the whole text instead (`setValue`, or one edit over the full
 * range) collapses every decoration to a point, the diff editor concludes
 * that nothing was hidden, and every region opens: an agent appending a line
 * at the bottom of a file unfolded all nine hundred above it.
 *
 * Lines are compared without their line breaks, and `eol` is the one the
 * model already uses, so a file with CRLF endings is never split between its
 * `\r` and its `\n`. Null when there is nothing to change.
 */
export function lineEdit(
  prev: string[],
  next: string[],
  eol: string,
): LineEdit | null {
  const p = prev.length
  const n = next.length
  let head = 0
  while (head < p && head < n && prev[head] === next[head]) head += 1
  if (head === p && head === n) return null
  let tail = 0
  while (
    tail < p - head &&
    tail < n - head &&
    prev[p - 1 - tail] === next[n - 1 - tail]
  ) {
    tail += 1
  }
  const lines = next.slice(head, n - tail)
  const from = head
  const to = p - tail
  // the column after a line's last character, which is where it ends
  const end = (index: number) => (prev[index] ?? '').length + 1

  if (from < to) {
    if (lines.length > 0) {
      return {
        startLineNumber: from + 1,
        startColumn: 1,
        endLineNumber: to,
        endColumn: end(to - 1),
        text: lines.join(eol),
      }
    }
    // lines went and nothing came in their place: take their line breaks with
    // them, from the front when there is a line after, from behind when they
    // ran to the end of the file
    if (to < p) {
      return {
        startLineNumber: from + 1,
        startColumn: 1,
        endLineNumber: to + 1,
        endColumn: 1,
        text: '',
      }
    }
    return {
      startLineNumber: from,
      startColumn: end(from - 1),
      endLineNumber: p,
      endColumn: end(p - 1),
      text: '',
    }
  }
  // nothing went, lines came: put them in at a line boundary
  if (from < p) {
    return {
      startLineNumber: from + 1,
      startColumn: 1,
      endLineNumber: from + 1,
      endColumn: 1,
      text: lines.join(eol) + eol,
    }
  }
  return {
    startLineNumber: p,
    startColumn: end(p - 1),
    endLineNumber: p,
    endColumn: end(p - 1),
    text: eol + lines.join(eol),
  }
}
