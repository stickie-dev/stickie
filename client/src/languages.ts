const by_extension: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  lua: 'lua',
  r: 'r',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  tf: 'hcl',
  hcl: 'hcl',
  graphql: 'graphql',
  proto: 'plaintext',
}

const by_basename: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
}

export function languageFor(path: string): string {
  const basename = path.split('/').at(-1)?.toLowerCase() ?? ''
  const from_basename = by_basename[basename]
  if (from_basename !== undefined) return from_basename
  const ext = basename.split('.').at(-1) ?? ''
  return by_extension[ext] ?? 'plaintext'
}
