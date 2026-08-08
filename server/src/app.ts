import { Hono } from 'hono'
import { z } from 'zod'
import type { RepoInfo, Session, TargetOptions, Thread } from '@stickie/shared'
import { extractSnippet, reanchor } from './anchors.js'
import { buildPrompt } from './export.js'
import {
  changedFiles,
  defaultBranch,
  fileAtSide,
  gitStatus,
  isGitRepo,
  listAllFiles,
  listRecentBranches,
  listWorktrees,
  mergeBase,
  repoRoot,
  resolveRef,
} from './git.js'
import type { Store } from './store.js'
import type { WatchHub } from './watcher.js'

const source_schema = z.object({
  kind: z.enum(['worktree', 'ref']),
  value: z.string().min(1),
})

const session_body = z.object({
  repoId: z.number().int(),
  source: source_schema,
  baseRef: z.string().min(1).optional(),
})

const thread_body = z.object({
  path: z.string().min(1),
  side: z.enum(['base', 'source']),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  body: z.string().min(1),
  author: z.enum(['user', 'agent']).default('user'),
})

const message_body = z.object({
  author: z.enum(['user', 'agent']),
  body: z.string().min(1),
})

const repo_body = z.object({ path: z.string().min(1) })

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createApp(store: Store, hub: WatchHub): Hono {
  const app = new Hono()

  app.onError((error, c) => c.json({ error: errorMessage(error) }, 500))

  app.get('/api/repos', async (c) => {
    const repos = store.listRepos()
    const infos: RepoInfo[] = await Promise.all(
      repos.map(async (repo) => {
        const status = await gitStatus(repo.path)
        return {
          id: repo.id,
          path: repo.path,
          name: repo.path.split('/').at(-1) ?? repo.path,
          branch: status.branch,
          clean: status.clean,
        }
      }),
    )
    return c.json(infos)
  })

  app.post('/api/repos', async (c) => {
    const body = repo_body.parse(await c.req.json())
    if (!(await isGitRepo(body.path))) {
      return c.json({ error: `not a git repository: ${body.path}` }, 400)
    }
    const root = await repoRoot(body.path)
    return c.json(store.addRepo(root))
  })

  app.delete('/api/repos/:id', (c) => {
    store.removeRepo(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.get('/api/repos/:id/targets', async (c) => {
    const repo = store.getRepo(Number(c.req.param('id')))
    if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)
    const [worktrees, branches, default_branch] = await Promise.all([
      listWorktrees(repo.path),
      listRecentBranches(repo.path),
      defaultBranch(repo.path),
    ])
    const targets: TargetOptions = {
      worktrees,
      branches,
      defaultBranch: default_branch,
    }
    return c.json(targets)
  })

  app.post('/api/sessions', async (c) => {
    const body = session_body.parse(await c.req.json())
    const repo = store.getRepo(body.repoId)
    if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)

    if (body.source.kind === 'worktree') {
      const worktrees = await listWorktrees(repo.path)
      if (!worktrees.some((wt) => wt.path === body.source.value)) {
        return c.json({ error: `not a worktree of this repo: ${body.source.value}` }, 400)
      }
    } else {
      await resolveRef(repo.path, body.source.value)
    }

    let base_ref = body.baseRef
    if (base_ref === undefined) {
      if (body.source.kind === 'worktree') {
        base_ref = 'HEAD'
      } else {
        const default_branch = await defaultBranch(repo.path)
        base_ref =
          (await mergeBase(repo.path, default_branch, body.source.value)) ??
          default_branch
      }
    }
    const resolve_in =
      body.source.kind === 'worktree' ? body.source.value : repo.path
    const base_sha = await resolveRef(resolve_in, base_ref)

    const session = store.getOrCreateSession(
      repo.id,
      body.source,
      base_ref,
      base_sha,
    )
    hub.ensureWatch(
      body.source.kind === 'worktree' ? body.source.value : repo.path,
    )
    return c.json(session)
  })

  app.get('/api/sessions/:id', (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    return c.json(session)
  })

  app.get('/api/sessions/:id/diff', async (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    return c.json(
      await changedFiles(session.repoPath, session.source, session.baseSha),
    )
  })

  app.get('/api/sessions/:id/tree', async (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    return c.json(await listAllFiles(session.repoPath, session.source))
  })

  app.get('/api/sessions/:id/file', async (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    const file_path = c.req.query('path')
    const side = c.req.query('side')
    if (file_path === undefined || (side !== 'base' && side !== 'source')) {
      return c.json({ error: 'path and side=base|source are required' }, 400)
    }
    const blob = await fileAtSide(
      session.repoPath,
      session.source,
      session.baseSha,
      side,
      file_path,
    )
    return c.json({ path: file_path, side, ...blob })
  })

  app.get('/api/sessions/:id/threads', async (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    const status = c.req.query('status')
    const threads = await reanchorThreads(
      store,
      session,
      store.listThreads(session.id),
    )
    return c.json(
      status === undefined
        ? threads
        : threads.filter((t) => t.status === status),
    )
  })

  app.post('/api/sessions/:id/threads', async (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    const body = thread_body.parse(await c.req.json())
    if (body.endLine < body.startLine) {
      return c.json({ error: 'endLine before startLine' }, 400)
    }
    const blob = await fileAtSide(
      session.repoPath,
      session.source,
      session.baseSha,
      body.side,
      body.path,
    )
    if (blob.content === null) {
      return c.json({ error: `no readable file at ${body.side}:${body.path}` }, 400)
    }
    const snippet = extractSnippet(blob.content, body.startLine, body.endLine)
    const thread = store.createThread(
      session.id,
      body.path,
      body.side,
      body.startLine,
      body.endLine,
      blob.blobSha,
      snippet,
      body.author,
      body.body,
    )
    return c.json(thread, 201)
  })

  app.post('/api/threads/:id/reply', async (c) => {
    const thread = store.getThread(Number(c.req.param('id')))
    if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
    const body = message_body.parse(await c.req.json())
    store.addMessage(thread.id, body.author, body.body)
    return c.json(store.getThread(thread.id))
  })

  app.post('/api/threads/:id/resolve', (c) => {
    const thread = store.getThread(Number(c.req.param('id')))
    if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
    store.setThreadStatus(thread.id, 'resolved')
    return c.json(store.getThread(thread.id))
  })

  app.post('/api/threads/:id/reopen', (c) => {
    const thread = store.getThread(Number(c.req.param('id')))
    if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
    store.setThreadStatus(thread.id, 'open')
    return c.json(store.getThread(thread.id))
  })

  app.get('/api/sessions/:id/prompt', async (c) => {
    const session = store.getSession(Number(c.req.param('id')))
    if (session === undefined) return c.json({ error: 'unknown session' }, 404)
    const threads = (
      await reanchorThreads(store, session, store.listThreads(session.id))
    ).filter((t) => t.status !== 'resolved')
    const api_base = new URL(c.req.url).origin
    return c.text(buildPrompt(session, threads, api_base))
  })

  return app
}

/**
 * Source-side content drifts as the agent edits; recompute anchors for open
 * threads from their stored snippets before serving. Base-side threads are
 * pinned to base_sha and never move.
 */
async function reanchorThreads(
  store: Store,
  session: Session,
  threads: Thread[],
): Promise<Thread[]> {
  const contents = new Map<string, string | null>()
  const result: Thread[] = []
  for (const thread of threads) {
    if (thread.side !== 'source' || thread.status === 'resolved') {
      result.push(thread)
      continue
    }
    let content = contents.get(thread.path)
    if (content === undefined) {
      const blob = await fileAtSide(
        session.repoPath,
        session.source,
        session.baseSha,
        'source',
        thread.path,
      )
      content = blob.content
      contents.set(thread.path, content)
    }
    if (content === null) {
      store.setThreadStatus(thread.id, 'detached')
      result.push({ ...thread, status: 'detached' })
      continue
    }
    const anchor = reanchor(thread.snippet, content, thread.startLine)
    if (anchor === null) {
      store.setThreadStatus(thread.id, 'detached')
      result.push({ ...thread, status: 'detached' })
      continue
    }
    if (
      anchor.startLine !== thread.startLine ||
      anchor.endLine !== thread.endLine ||
      thread.status === 'detached'
    ) {
      store.setThreadAnchor(thread.id, anchor.startLine, anchor.endLine)
      if (thread.status === 'detached') store.setThreadStatus(thread.id, 'open')
      result.push({
        ...thread,
        ...anchor,
        status: thread.status === 'detached' ? 'open' : thread.status,
      })
      continue
    }
    result.push(thread)
  }
  return result
}
