import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { gitStatus } from './git.js'

const default_port = 4870

const here = path.dirname(fileURLToPath(import.meta.url))
const client_dist = path.relative(
  process.cwd(),
  path.resolve(here, '../../client/dist'),
)

const app = new Hono()

app.get('/api/status', async (c) => {
  const repo = c.req.query('repo') ?? process.cwd()
  try {
    return c.json(await gitStatus(repo))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

app.use('*', serveStatic({ root: client_dist }))
app.get('*', serveStatic({ path: path.join(client_dist, 'index.html') }))

const port = Number(process.env.PORT ?? default_port)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`stickie server on http://localhost:${info.port}`)
})
