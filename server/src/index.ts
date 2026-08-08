import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import { createApp } from './app.js'
import { openDb } from './db.js'
import { isGitRepo, repoRoot } from './git.js'
import { Store } from './store.js'
import { WatchHub } from './watcher.js'

const default_port = 4870

const here = path.dirname(fileURLToPath(import.meta.url))
const client_dist = path.relative(
  process.cwd(),
  path.resolve(here, '../../client/dist'),
)

const store = new Store(openDb(process.env.STICKIE_DB))
const hub = new WatchHub()
const app = createApp(store, hub)

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

const sockets = new Set<WSContext>()
app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen: (_event, ws) => sockets.add(ws),
    onClose: (_event, ws) => sockets.delete(ws),
  })),
)
hub.onEvent((event) => {
  const payload = JSON.stringify(event)
  for (const ws of sockets) {
    ws.send(payload)
  }
})

// index.html must never be heuristically cached or the browser keeps
// serving a stale bundle after rebuilds; hashed assets can cache forever
app.use('*', async (c, next) => {
  await next()
  const pathname = new URL(c.req.url).pathname
  if (pathname.startsWith('/assets/')) {
    c.res.headers.set('cache-control', 'public, max-age=31536000, immutable')
  } else if (!pathname.startsWith('/api/')) {
    c.res.headers.set('cache-control', 'no-cache')
  }
})
app.use('*', serveStatic({ root: client_dist }))
app.get('*', serveStatic({ path: path.join(client_dist, 'index.html') }))

const add_repo = process.env.STICKIE_ADD_REPO
if (add_repo !== undefined && (await isGitRepo(add_repo))) {
  store.addRepo(await repoRoot(add_repo))
}

const port = Number(process.env.PORT ?? default_port)
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`stickie server on http://localhost:${info.port}`)
})
injectWebSocket(server)
