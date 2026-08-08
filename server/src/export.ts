import type { Session, Thread } from '@stickie/shared'

function describeSource(session: Session): string {
  if (session.source.kind === 'worktree') {
    return `working tree at ${session.source.value}`
  }
  return `ref ${session.source.value}`
}

export function buildPrompt(
  session: Session,
  threads: Thread[],
  apiBase: string,
): string {
  const lines: string[] = []
  lines.push('# Review notes (stickie)')
  lines.push('')
  lines.push(
    `Repo: ${session.repoPath} — reviewing ${describeSource(session)} ` +
      `against ${session.baseRef} (${session.baseSha.slice(0, 10)})`,
  )
  lines.push('')
  threads.forEach((thread, index) => {
    const range =
      thread.startLine === thread.endLine
        ? `L${thread.startLine}`
        : `L${thread.startLine}-L${thread.endLine}`
    const side = thread.side === 'base' ? ' (base side)' : ''
    lines.push(`## ${index + 1}. ${thread.path}:${range}${side} [thread ${thread.id}]`)
    const snippet_lines = thread.snippet.split('\n')
    if (snippet_lines.length <= 40) {
      // a fence longer than any backtick run inside the snippet
      const longest_run = thread.snippet
        .split('\n')
        .reduce(
          (max, line) => Math.max(max, /^`*/.exec(line.trim())?.[0].length ?? 0),
          0,
        )
      const fence = '`'.repeat(Math.max(3, longest_run + 1))
      lines.push('Code at capture time:')
      lines.push(fence)
      lines.push(thread.snippet)
      lines.push(fence)
    } else {
      lines.push(
        `Code block is ${snippet_lines.length} lines — read it from the file directly.`,
      )
    }
    for (const message of thread.messages) {
      lines.push(`- ${message.author}: ${message.body}`)
    }
    lines.push('')
  })
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
