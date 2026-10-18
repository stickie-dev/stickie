// assembles the publishable single package under dist-pkg/ from the
// workspace build outputs; run pnpm build first
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist-pkg')

const root_pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
)
const server_pkg = JSON.parse(
  fs.readFileSync(path.join(root, 'server', 'package.json'), 'utf8'),
)

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
  ['agents', 'agents'],
  ['bin', 'bin'],
  ['README.md', 'README.md'],
  ['LICENSE', 'LICENSE'],
]
for (const [from, to] of copies) {
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true })
}

fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'stickie',
      version: root_pkg.version,
      description: root_pkg.description,
      homepage: root_pkg.homepage,
      repository: root_pkg.repository,
      bugs: root_pkg.bugs,
      license: 'Apache-2.0',
      type: 'module',
      bin: { stickie: 'bin/stickie.js', 'stickie-mcp': 'bin/stickie-mcp.js' },
      engines: { node: '>=22' },
      dependencies,
    },
    null,
    2,
  ) + '\n',
)

console.log(`assembled ${out}`)
