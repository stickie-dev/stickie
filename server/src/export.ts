import type { Session, Thread } from '@stickie/shared'

export interface CodeRef {
  /** null = the session's own repo */
  repo: string | null
  path: string
  startLine: number
  endLine: number
}

const ref_pattern = /@([\w./-]+(?::[\w./-]+)?):L(\d+)(?:-L?(\d+))?/g

/**
 * Find @path:L10 / @repo:path:L10 references inside a note body. The @
 * sigil is what makes a mention live; a bare path:L10 stays free text. A
 * repo prefix (no slashes) targets another registered repository.
 */
export function parseRefs(body: string): CodeRef[] {
  const refs: CodeRef[] = []
  for (const match of body.matchAll(ref_pattern)) {
    const target = match[1] ?? ''
    const colon = target.indexOf(':')
    const prefix = colon === -1 ? null : target.slice(0, colon)
    const has_repo = prefix !== null && !prefix.includes('/')
    const repo = has_repo ? prefix : null
    const path = has_repo ? target.slice(colon + 1) : target
    const start = Number(match[2])
    const end = match[3] === undefined ? start : Number(match[3])
    if (end < start || path === '') continue
    refs.push({ repo, path, startLine: start, endLine: end })
  }
  return refs
}

const inline_ref_max_lines = 20

function describeSource(session: Session): string {
  if (session.source.kind === 'worktree') {
    return `working tree at ${session.source.value}`
  }
  return `ref ${session.source.value}`
}

function fenced(code: string): string[] {
  const longest_run = code
    .split('\n')
    .reduce(
      (max, line) => Math.max(max, /^`*/.exec(line.trim())?.[0].length ?? 0),
      0,
    )
  const fence = '`'.repeat(Math.max(3, longest_run + 1))
  return [fence, code, fence]
}

export async function buildPrompt(
  session: Session,
  threads: Thread[],
  apiBase: string,
  readSource: (repo: string | null, path: string) => Promise<string | null>,
): Promise<string> {
  const lines: string[] = []
  lines.push('# Review notes (stickie)')
  lines.push('')
  lines.push(
    `Repo: ${session.repoPath} — reviewing ${describeSource(session)} ` +
      `against ${session.baseRef} (${session.baseSha.slice(0, 10)})`,
  )
  lines.push('')
  for (const [index, thread] of threads.entries()) {
    const range =
      thread.startLine === thread.endLine
        ? `L${thread.startLine}`
        : `L${thread.startLine}-L${thread.endLine}`
    const side = thread.side === 'base' ? ' (base side)' : ''
    lines.push(`## ${index + 1}. ${thread.path}:${range}${side} [thread ${thread.id}]`)
    const snippet_lines = thread.snippet.split('\n')
    if (snippet_lines.length <= 40) {
      lines.push('Code at capture time:')
      lines.push(...fenced(thread.snippet))
    } else {
      lines.push(
        `Code block is ${snippet_lines.length} lines — read it from the file directly.`,
      )
    }
    const seen_refs = new Set<string>()
    for (const message of thread.messages) {
      lines.push(`- ${message.author}: ${message.body}`)
      for (const ref of parseRefs(message.body)) {
        const repo_prefix = ref.repo === null ? '' : `${ref.repo}:`
        const label =
          ref.startLine === ref.endLine
            ? `${repo_prefix}${ref.path}:L${ref.startLine}`
            : `${repo_prefix}${ref.path}:L${ref.startLine}-L${ref.endLine}`
        if (seen_refs.has(label)) continue
        seen_refs.add(label)
        const span = ref.endLine - ref.startLine + 1
        if (span > inline_ref_max_lines) {
          lines.push(
            `  Referenced ${label} spans ${span} lines — read it from the file.`,
          )
          continue
        }
        const content = await readSource(ref.repo, ref.path)
        if (content === null) continue
        const slice = content
          .split('\n')
          .slice(ref.startLine - 1, ref.endLine)
          .join('\n')
        if (slice === '') continue
        lines.push(`  Referenced ${label} (current content):`)
        lines.push(...fenced(slice).map((l) => `  ${l}`))
      }
    }
    lines.push('')
  }
  lines.push('---')
  lines.push('Address each note. The line numbers were correct at capture time;')
  lines.push('verify against the current file before editing. When done with a')
  lines.push('note, reply and resolve it:')
  lines.push('```')
  lines.push(
    `curl -X POST ${apiBase}/api/threads/<id>/reply -H 'content-type: application/json' -d '{"author":"agent","body":"<what you did>"}'`,
  )
  lines.push(`curl -X POST ${apiBase}/api/threads/<id>/resolve`)
  lines.push('```')
  return lines.join('\n')
}
