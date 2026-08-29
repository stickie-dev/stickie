import type { Side } from '@stickie/shared'

/**
 * Finding text in the review that is open — every file of the diff, not only
 * the one editor that happens to have focus.
 *
 * Monaco's own find is per editor, and a diff of twenty files is twenty
 * editors, so ⌘F inside one of them searched a twentieth of what was on
 * screen. This searches the contents the review is built from, which is also
 * what makes it able to count: a match on a line nobody has scrolled to yet is
 * still a match, where the browser's own find only sees rendered text and
 * Monaco renders the lines near the viewport.
 */

export interface Match {
  path: string
  side: Side
  /** 1-based, as everything the editor is told */
  line: number
  column: number
  length: number
  /** the whole line, for the result list */
  text: string
}

/** Where the search looks: one side of one file, as read for the diff. */
export interface Haystack {
  path: string
  side: Side
  content: string
}

const per_file_cap = 500
const total_cap = 4000

/**
 * Every occurrence, in the order a reader would meet them: file by file in the
 * order the diff lists them, then down the lines.
 *
 * Capped, because a one-letter query against a large diff is a plausible thing
 * to type by accident and no reader wants forty thousand results — the count
 * says when it has stopped looking.
 */
export function findMatches(
  haystacks: Haystack[],
  query: string,
  caseSensitive: boolean,
): { matches: Match[]; capped: boolean } {
  const matches: Match[] = []
  if (query === '') return { matches, capped: false }
  const needle = caseSensitive ? query : query.toLowerCase()
  let capped = false
  for (const hay of haystacks) {
    let in_file = 0
    const lines = hay.content.split('\n')
    for (const [index, line] of lines.entries()) {
      const haystack = caseSensitive ? line : line.toLowerCase()
      let from = 0
      for (;;) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) break
        matches.push({
          path: hay.path,
          side: hay.side,
          line: index + 1,
          column: at + 1,
          length: query.length,
          text: line,
        })
        in_file += 1
        from = at + Math.max(1, needle.length)
        if (in_file >= per_file_cap || matches.length >= total_cap) {
          capped = true
          break
        }
      }
      if (capped) break
    }
    if (matches.length >= total_cap) {
      capped = true
      break
    }
  }
  return { matches, capped }
}

/** How many files the matches are spread across, for the count line. */
export function fileCount(matches: Match[]): number {
  return new Set(matches.map((match) => match.path)).size
}
