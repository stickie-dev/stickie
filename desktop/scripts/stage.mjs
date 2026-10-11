// Assembles what goes inside the desktop app under desktop/stage/, from the
// workspace build outputs; run `pnpm build` first. electron-builder packs that
// directory as the app (electron-builder.json).
//
// Staged rather than packed from the workspace: pnpm's linked node_modules are
// not something an installer can copy, so the server's dependencies are
// installed here with npm, flat and real, the way the published package gets
// them (scripts/package.mjs).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(desktop, '..')
const out = path.join(desktop, 'stage')

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const root_pkg = read(path.join(root, 'package.json'))
const server_pkg = read(path.join(root, 'server', 'package.json'))

// the shared package is types only, so nothing of it runs
const dependencies = Object.fromEntries(
  Object.entries(server_pkg.dependencies).filter(
    ([, version]) => !String(version).startsWith('workspace:'),
  ),
)

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

const copies = [
  ['server/dist', 'server/dist'],
  ['client/dist', 'client/dist'],
  ['desktop/dist', 'desktop/dist'],
  ['desktop/assets', 'desktop/assets'],
  ['bin', 'bin'],
  ['agents', 'agents'],
  ['README.md', 'README.md'],
  ['LICENSE', 'LICENSE'],
]
for (const [from, to] of copies) {
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true })
}

fs.writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'stickie',
      productName: 'stickie',
      version: root_pkg.version,
      description: root_pkg.description,
      license: root_pkg.license,
      author: 'Hossain Mahmud',
      type: 'module',
      main: 'desktop/dist/main.js',
      dependencies,
    },
    null,
    2,
  )}\n`,
)

// ripgrep fetches its binary for the machine it is installed on, which is why
// an installer is built on the platform it is for (see the desktop workflow)
execFileSync(
  'npm',
  ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund'],
  { cwd: out, stdio: 'inherit', shell: process.platform === 'win32' },
)

console.log(`staged ${out}`)
