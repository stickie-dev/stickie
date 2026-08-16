import { rgPath } from '@vscode/ripgrep'
import { execa } from 'execa'

export interface NavHit {
  repoPath: string
  path: string
  line: number
  preview: string
}

const rg_type_by_language: Record<string, string> = {
  python: 'py',
  typescript: 'ts',
  javascript: 'js',
  go: 'go',
  rust: 'rust',
  java: 'java',
  kotlin: 'kotlin',
  ruby: 'ruby',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  php: 'php',
  swift: 'swift',
  shell: 'sh',
  css: 'css',
  html: 'html',
  yaml: 'yaml',
  sql: 'sql',
}

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Regex heuristics for "a definition of NAME lives on this line", per
 * language. Deliberately grep-grade: no type inference, occasional false
 * positives, no external indexer needed.
 */
export function definitionPattern(language: string, name: string): string {
  const n = escape(name)
  switch (language) {
    case 'python':
      return (
        `(?:async\\s+)?def\\s+${n}\\s*\\(` +
        `|class\\s+${n}\\b` +
        `|^${n}\\s*(?::[^=]+)?=`
      )
    case 'typescript':
    case 'javascript':
      return (
        `(?:function\\*?|class|interface|type|enum|namespace)\\s+${n}\\b` +
        `|(?:const|let|var)\\s+${n}\\s*[=:(]` +
        `|\\b${n}\\s*=\\s*(?:async\\s*)?\\(` +
        `|^\\s*(?:export\\s+)?(?:public\\s+|private\\s+|protected\\s+|static\\s+)*(?:async\\s+)?${n}\\s*\\([^)]*\\)\\s*[:{]`
      )
    case 'go':
      return `func\\s+(?:\\([^)]+\\)\\s*)?${n}\\s*\\(|type\\s+${n}\\b`
    case 'rust':
      return `(?:fn|struct|enum|trait|mod|macro_rules!)\\s+${n}\\b`
    case 'ruby':
      return `(?:def|class|module)\\s+(?:self\\.)?${n}\\b`
    default:
      return `(?:def|class|function|fn|type|interface|struct|enum)\\s+${n}\\b`
  }
}

interface RgMatch {
  type: string
  data?: {
    path?: { text?: string }
    line_number?: number
    lines?: { text?: string }
  }
}

export function parseRgJson(stdout: string, repoPath: string): NavHit[] {
  const hits: NavHit[] = []
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    let parsed: RgMatch
    try {
      parsed = JSON.parse(line) as RgMatch
    } catch {
      continue
    }
    if (parsed.type !== 'match' || parsed.data === undefined) continue
    const path = parsed.data.path?.text
    const line_number = parsed.data.line_number
    if (path === undefined || line_number === undefined) continue
    hits.push({
      repoPath,
      path: path.replace(/^\.\//, ''),
      line: line_number,
      preview: (parsed.data.lines?.text ?? '').trimEnd().slice(0, 200),
    })
  }
  return hits
}

async function rg(root: string, args: string[]): Promise<string> {
  // the explicit path argument matters: without one, spawned rg treats its
  // piped stdin as the search target and blocks forever
  const result = await execa(
    rgPath,
    ['--json', '--max-count', '50', '--max-filesize', '2M', ...args, '.'],
    { cwd: root, reject: false, stdin: 'ignore', maxBuffer: 16 * 1024 * 1024 },
  )
  // exit 1 = no matches; anything else non-zero signals a real failure
  if (result.failed && result.exitCode !== 1) {
    throw new Error(
      `ripgrep failed (exit ${result.exitCode ?? 'spawn error'}): ${result.stderr?.slice(0, 200) ?? ''}`,
    )
  }
  return result.stdout
}

export async function findDefinitions(
  root: string,
  name: string,
  language: string,
): Promise<NavHit[]> {
  const args = ['-e', definitionPattern(language, name)]
  const type = rg_type_by_language[language]
  if (type !== undefined) args.push('-t', type)
  return parseRgJson(await rg(root, args), root)
}

export async function findReferences(
  root: string,
  name: string,
): Promise<NavHit[]> {
  return parseRgJson(await rg(root, ['-e', `\\b${escape(name)}\\b`]), root)
}
