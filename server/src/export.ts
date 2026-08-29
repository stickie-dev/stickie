import type { Session, Thread } from '@stickie/shared'
import { shortSha } from './git.js'

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

// markdown info strings for the fences, so a pasted prompt highlights and an
// agent can tell yaml from python without guessing from the path
const fence_languages: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cfg: 'ini',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dockerfile: 'dockerfile',
  go: 'go',
  graphql: 'graphql',
  h: 'c',
  hcl: 'hcl',
  hpp: 'cpp',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  lua: 'lua',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  pl: 'perl',
  proto: 'protobuf',
  ps1: 'powershell',
  py: 'python',
  pyi: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scala: 'scala',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  tf: 'hcl',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

const named_files: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

export function fenceLanguage(path: string): string {
  const name = (path.split('/').at(-1) ?? '').toLowerCase()
  const named = named_files[name]
  if (named !== undefined) return named
  const dot = name.lastIndexOf('.')
  if (dot === -1) return ''
  return fence_languages[name.slice(dot + 1)] ?? ''
}

/** The trailing instructions; `{api}` becomes the server's own address. */
export const default_prompt_instructions = [
  'Address each note. The line numbers were correct at capture time;',
  'verify against the current file before editing. When done with a',
  'note, reply and resolve it:',
  '',
  '```bash',
  `curl -X POST {api}/api/threads/<id>/reply -H 'content-type: application/json' -d '{"author":"agent","body":"<what you did>"}'`,
  'curl -X POST {api}/api/threads/<id>/resolve',
  '```',
].join('\n')

function describeSource(session: Session): string {
  if (session.source.kind === 'worktree') {
    return `working tree at ${session.source.value}`
  }
  return `ref ${session.source.value}`
}

function fenced(code: string, language = ''): string[] {
  const longest_run = code
    .split('\n')
    .reduce(
      (max, line) => Math.max(max, /^`*/.exec(line.trim())?.[0].length ?? 0),
      0,
    )
  const fence = '`'.repeat(Math.max(3, longest_run + 1))
  return [`${fence}${language}`, code, fence]
}

export async function buildPrompt(
  session: Session,
  threads: Thread[],
  apiBase: string,
  readSource: (repo: string | null, path: string) => Promise<string | null>,
  instructions: string = default_prompt_instructions,
): Promise<string> {
  const lines: string[] = []
  lines.push('# Review notes (stickie)')
  lines.push('')
  lines.push(
    `Repo: ${session.repoPath} — reviewing ${describeSource(session)} ` +
      `against ${session.baseRef} (${shortSha(session.baseSha)})`,
  )
  if (threads.some((t) => t.startLine > 0 && t.blobSha !== null)) {
    lines.push('')
    lines.push(
      'A heading\'s `@ blob <sha>` is git\'s hash of the file the code under ' +
        'it was read from: `git hash-object <path>` still matching means that ' +
        'file has not changed since the note was written.',
    )
  }
  lines.push('')
  for (const thread of threads) {
    const anchored = thread.startLine > 0
    const range =
      thread.startLine === thread.endLine
        ? `L${thread.startLine}`
        : `L${thread.startLine}-L${thread.endLine}`
    const side = thread.side === 'base' ? ' (base side)' : ''
    const where = !anchored
      ? thread.path === ''
        ? 'whole review'
        : `${thread.path} (whole file)`
      : `${thread.path}:${range}${side}`
    const state = thread.pending ? ' [not yet submitted]' : ''
    // what the fence below actually came from, named in a way a reader can
    // check. It is git's own hash of that content, but `hash-object` without
    // `-w` never wrote the object, so it identifies the file rather than
    // retrieving it — the claim below says exactly that and no more.
    const blob =
      anchored && thread.blobSha !== null
        ? ` @ blob ${shortSha(thread.blobSha)}`
        : ''
    // one identifier, and the one every route and MCP tool takes. An ordinal
    // beside it was a second number for the same note, and the only number
    // that could not be used to act on it. As a link it also opens where the
    // note is now, since that address resolves rather than being stored.
    const link = `${apiBase}/r/${String(session.repoId)}/t/${String(thread.id)}`
    lines.push(`## [thread ${thread.id}](${link}) — ${where}${blob}${state}`)
    lines.push('')
    if (anchored) {
      const snippet_lines = thread.snippet.split('\n')
      if (snippet_lines.length <= 40) {
        lines.push(...fenced(thread.snippet, fenceLanguage(thread.path)))
      } else {
        lines.push(
          `Code block is ${snippet_lines.length} lines — read it from the file directly.`,
        )
      }
      lines.push('')
    }
    const seen_refs = new Set<string>()
    for (const message of thread.messages) {
      // the role stays in the line so an agent can tell its own words from
      // yours even when both carry a name
      const who =
        message.actorName === null
          ? message.author
          : `${message.actorName} (${message.author})`
      lines.push(`- ${who}: ${message.body}`)
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
        lines.push(
          ...fenced(slice, fenceLanguage(ref.path)).map((l) => `  ${l}`),
        )
      }
    }
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push(instructions.replaceAll('{api}', apiBase))
  return lines.join('\n')
}
