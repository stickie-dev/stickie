import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createNodeWebSocket } from '@hono/node-ws'
import type { WSContext } from 'hono/ws'
import type { ClientEvent } from '@stickie/shared'
import { createApp } from './app.js'
import { default_port } from './config.js'
import { openDatabase } from './db.js'
import { sweep } from './expiry.js'
import { isGitRepo, repoRoot } from './git.js'
import { Store } from './store.js'
import { WatchHub } from './watcher.js'

export interface StartOptions {
  port?: number
  /** a local review server holding source code must not listen on the network */
  hostname?: string
  /** a repository to register on the way up, if it is one */
  addRepo?: string
}

export interface RunningServer {
  port: number
  url: string
  close: () => Promise<void>
}

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The whole server, started — what `stickie` runs, and what the desktop app runs
 * inside itself. A function rather than a module's side effects so the app can
 * wait for it to be listening, hear that the port is taken, and stop it when
 * it quits; the command line still gets exactly what it had, through index.ts.
 *
 * Resolves once it is listening. Rejects if the database cannot be opened or
 * the port cannot be had, with nothing left running.
 */
export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const port = options.port ?? default_port
  const hostname = options.hostname ?? '127.0.0.1'
  // served from beside this file, wherever it is installed: relative to it
  // rather than to the working directory, which for an app is wherever the
  // operating system started it
  const client_dist = path.resolve(here, '../../client/dist')

  const store = new Store(await openDatabase())
  const hub = new WatchHub()
  const sockets = new Set<WSContext>()
  const broadcast = (event: ClientEvent) => {
    const payload = JSON.stringify(event)
    for (const ws of sockets) ws.send(payload)
  }

  const app = createApp(store, hub, broadcast)
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })
  app.get(
    '/ws',
    upgradeWebSocket(() => ({
      onOpen: (_event, ws) => sockets.add(ws),
      onClose: (_event, ws) => sockets.delete(ws),
    })),
  )
  hub.onEvent(broadcast)

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
  // serveStatic wants a root relative to the working directory
  const root = path.relative(process.cwd(), client_dist)
  app.use('*', serveStatic({ root }))
  app.get('*', serveStatic({ path: path.join(root, 'index.html') }))

  if (options.addRepo !== undefined && (await isGitRepo(options.addRepo))) {
    await store.addRepo(await repoRoot(options.addRepo))
  }

  const server = await new Promise<ReturnType<typeof serve>>(
    (resolve, reject) => {
      const listening = serve({ fetch: app.fetch, port, hostname }, () =>
        resolve(listening),
      )
      listening.once('error', reject)
    },
  )
  injectWebSocket(server)

  // reviews left alone are archived and then deleted (Settings → Reviews).
  // The policy counts in days, so looking a few times a day is as often as it
  // can matter; a failed sweep is tried again at the next one
  const sweep_every_ms = 6 * 60 * 60 * 1000
  const sweepQuietly = () => {
    sweep(store).catch((error: unknown) => {
      console.error('stickie: expiry sweep failed:', error)
    })
  }
  sweepQuietly()
  const timer = setInterval(sweepQuietly, sweep_every_ms)
  timer.unref()

  const url = `http://localhost:${String(port)}`
  return {
    port,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer)
        for (const ws of sockets) ws.close()
        server.close(() => resolve())
        // a browser tab keeps its connection alive, and an upgraded socket is
        // not the server's to close any more; quitting must not wait for
        // either to give up, so after a second it stops waiting
        if ('closeAllConnections' in server) server.closeAllConnections()
        setTimeout(resolve, 1000).unref()
      }),
  }
}
