export interface Anchor {
  startLine: number
  endLine: number
}

function findMatches(haystack: string[], needle: string[]): number[] {
  const starts: number[] = []
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    starts.push(i)
  }
  return starts
}

function closest(starts: number[], oldStart: number): number {
  let best = starts[0] ?? 0
  for (const s of starts) {
    if (Math.abs(s - (oldStart - 1)) < Math.abs(best - (oldStart - 1))) {
      best = s
    }
  }
  return best
}

/**
 * Re-locate a snippet inside the current file content. Tries exact line
 * matches first, then whitespace-trimmed matches. Multiple occurrences
 * resolve to the one nearest the previous anchor. Returns null when the
 * snippet no longer exists (thread should be marked detached).
 */
export function reanchor(
  snippet: string,
  content: string,
  oldStart: number,
): Anchor | null {
  const needle = snippet.split('\n')
  if (needle.length === 0 || snippet === '') return null
  const lines = content.split('\n')

  let starts = findMatches(lines, needle)
  if (starts.length === 0) {
    const trimmed_lines = lines.map((l) => l.trim())
    const trimmed_needle = needle.map((l) => l.trim())
    starts = findMatches(trimmed_lines, trimmed_needle)
  }
  if (starts.length === 0) return null

  const start = closest(starts, oldStart)
  return { startLine: start + 1, endLine: start + needle.length }
}

/** Extract lines [startLine, endLine] (1-indexed, inclusive) as the stored snippet. */
export function extractSnippet(
  content: string,
  startLine: number,
  endLine: number,
): string {
  return content
    .split('\n')
    .slice(startLine - 1, endLine)
    .join('\n')
}
