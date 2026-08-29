import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { swaggerUI } from '@hono/swagger-ui'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type {
  Author,
  ClientEvent,
  RepoInfo,
  Session,
  TargetOptions,
  Thread,
  ThreadEvent,
} from '@stickie/shared'
import { extractSnippet, reanchor } from './anchors.js'
import {
  configuredDatabaseUrl,
  databaseFromEnv,
  setDatabaseUrl,
} from './config.js'
import type {
  ActivityAction,
  ActivityInput,
  ActivitySubject,
} from './activity.js'
import { buildPrompt, default_prompt_instructions } from './export.js'
import { Identity } from './identity.js'
import {
  changedFiles,
  commitFiles,
  defaultBranch,
  describeRevs,
  expandUserPath,
  listCommitsBetween,
  fileAtRef,
  fileAtSide,
  fileInWorktree,
  gitOrigin,
  gitStatus,
  isGitRepo,
  listAllFiles,
  listRecentBranches,
  listRecentCommits,
  listWorktrees,
  mergeBase,
  repoRoot,
  resolveRef,
  shortenRev,
} from './git.js'
import {
  fetchMrDiscussions,
  gitlabConfig,
  parseMrRef,
  projectFromRemote,
} from './gitlab.js'
import { findDefinitions, findReferences, searchText } from './nav.js'
import type { SessionRollup, Store } from './store.js'
import type { WatchHub } from './watcher.js'

const error_schema = z.object({ error: z.string() }).openapi('Error')

const repo_schema = z
  .object({ id: z.number().int(), path: z.string() })
  .openapi('Repo')

const repo_info_schema = z
  .object({
    id: z.number().int(),
    path: z.string(),
    name: z.string(),
    branch: z.string(),
    clean: z.boolean(),
    changedFiles: z.number().int(),
  })
  .openapi('RepoInfo')

const note_counts_schema = z
  .object({
    total: z.number().int(),
    open: z.number().int(),
    pending: z.number().int(),
    resolved: z.number().int(),
    detached: z.number().int(),
  })
  .openapi('NoteCounts')

const source_schema = z
  .object({
    kind: z.enum(['worktree', 'ref']),
    value: z.string().min(1),
  })
  .openapi('ReviewSource')

const session_schema = z
  .object({
    id: z.number().int(),
    repoId: z.number().int(),
    repoPath: z.string(),
    source: source_schema,
    baseRef: z.string(),
    baseSha: z.string(),
    baseStale: z.boolean().optional(),
  })
  .openapi('Session')

function sourceRoot(session: Session): string {
  return session.source.kind === 'worktree'
    ? session.source.value
    : session.repoPath
}

/**
 * HEAD bases go stale when the worktree commits; default-branch bases go
 * stale when the merge-base drifts (branch rebased or default advanced).
 */
async function isBaseStale(session: Session): Promise<boolean> {
  try {
    if (session.baseRef === 'HEAD') {
      const current = await resolveRef(sourceRoot(session), 'HEAD')
      return current !== session.baseSha
    }
    const merge_base = await mergeBase(
      sourceRoot(session),
      session.baseRef,
      'HEAD',
    )
    return merge_base !== null && merge_base !== session.baseSha
  } catch {
    return false
  }
}

const targets_schema = z
  .object({
    worktrees: z.array(
      z.object({
        path: z.string(),
        branch: z.string().nullable(),
        head: z.string(),
        isMain: z.boolean(),
      }),
    ),
    branches: z.array(
      z.object({ name: z.string(), lastCommitAt: z.string() }),
    ),
    recentCommits: z.array(
      z.object({
        sha: z.string(),
        shortSha: z.string(),
        subject: z.string(),
      }),
    ),
    defaultBranch: z.string(),
  })
  .openapi('TargetOptions')

const changed_file_schema = z
  .object({
    path: z.string(),
    oldPath: z.string().optional(),
    status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
  })
  .openapi('ChangedFile')

const file_content_schema = z
  .object({
    path: z.string(),
    side: z.enum(['base', 'source']),
    content: z.string().nullable(),
    blobSha: z.string().nullable(),
    binary: z.boolean(),
  })
  .openapi('FileContent')

const message_schema = z
  .object({
    id: z.number().int(),
    author: z.enum(['user', 'agent']),
    body: z.string(),
    createdAt: z.string(),
    /** the name behind the role; null on imported and pre-actor rows */
    actorName: z.string().nullable(),
  })
  .openapi('ThreadMessage')

const thread_schema = z
  .object({
    id: z.number().int(),
    sessionId: z.number().int(),
    path: z.string(),
    side: z.enum(['base', 'source']),
    startLine: z.number().int(),
    endLine: z.number().int(),
    snippet: z.string(),
    status: z.enum(['open', 'resolved', 'detached']),
    pending: z.boolean(),
    origin: z.string().nullable(),
    createdAt: z.string(),
    actorName: z.string().nullable(),
    messages: z.array(message_schema),
  })
  .openapi('Thread')

const rev_label_schema = z
  .object({ name: z.string(), subject: z.string().nullable() })
  .openapi('RevLabel')

/**
 * A worktree source has no single commit to name, so it is named by what it is.
 * A ref source is a branch (named, with its tip's subject) or a raw sha (shown
 * short, since forty characters of hex tells a reader nothing).
 */
function sourceLabel(
  session: Session,
  repoPath: string | undefined,
  subjects: Map<string, string>,
): { name: string; subject: string | null } {
  const { source } = session
  if (source.kind === 'worktree') {
    const own = repoPath !== undefined && repoPath === source.value
    const name = source.value.split('/').at(-1) ?? source.value
    return {
      name: own ? 'working tree' : `worktree ${name}`,
      subject: null,
    }
  }
  return {
    name: shortenRev(source.value) ?? source.value,
    subject: subjects.get(source.value) ?? null,
  }
}

const activity_schema = z
  .object({
    id: z.number().int(),
    at: z.string(),
    subject: z.enum(['note', 'review', 'file']),
    action: z.string(),
    actorName: z.string().nullable(),
    repoId: z.number().int().nullable(),
    sessionId: z.number().int().nullable(),
    threadId: z.number().int().nullable(),
    messageId: z.number().int().nullable(),
    detail: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi('ActivityEntry')

const review_overview_schema = z
  .object({
    sessionId: z.number().int(),
    repoId: z.number().int(),
    repoName: z.string(),
    source: source_schema,
    baseRef: z.string(),
    baseSha: z.string(),
    comparing: z.object({ source: rev_label_schema, base: rev_label_schema }),
    notes: note_counts_schema,
    filesRead: z.number().int(),
    agentReplies: z.number().int(),
    lastActivityAt: z.string().nullable(),
    lastAction: z.string().nullable(),
    lastActorName: z.string().nullable(),
    awaiting: z.enum(['you', 'agent']).nullable(),
  })
  .openapi('ReviewOverview')

const overview_schema = z
  .object({
    repos: z.array(
      repo_info_schema.extend({
        latestSessionId: z.number().int().nullable(),
      }),
    ),
    reviews: z.array(review_overview_schema),
    recent: z.array(activity_schema),
  })
  .openapi('Overview')

const session_body = z.object({
  repoId: z.number().int(),
  source: source_schema,
  baseRef: z.string().min(1).optional(),
})

const thread_body = z.object({
  // line 0 marks a note with no code anchor: on a whole file when path is
  // set, on the review itself when path is empty
  path: z.string(),
  side: z.enum(['base', 'source']).default('source'),
  startLine: z.number().int().min(0),
  endLine: z.number().int().min(0),
  body: z.string().min(1),
  author: z.enum(['user', 'agent']).default('user'),
  // user notes default into the pending review batch; agent notes post
  pending: z.boolean().optional(),
  /**
   * What an agent calls itself. Optional on purpose: every adapter written
   * before this field existed keeps working, and its notes land under one
   * shared "agent" actor rather than failing.
   */
  actor: z.string().max(64).optional(),
})

const message_body = z.object({
  author: z.enum(['user', 'agent']),
  body: z.string().min(1),
  /** what an agent calls itself; see `thread_body.actor` */
  actor: z.string().max(64).optional(),
})

const repo_body = z.object({ path: z.string().min(1) })

const id_param = z.object({ id: z.coerce.number().int() })

// z.coerce.boolean() reads "0" as true, which is the opposite of what any
// caller writing include_pending=0 means
const flag_query = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined ? undefined : value === '1' || value === 'true',
  )

function json_body<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true }
}

function json_response<T extends z.ZodType>(schema: T, description: string) {
  return { content: { 'application/json': { schema } }, description }
}

const not_found = json_response(error_schema, 'Unknown resource')
const bad_request = json_response(error_schema, 'Invalid request')

/** A database url without its password, for showing back to the user. */
function redactUrl(url: string | null): string | null {
  if (url === null) return null
  try {
    const parsed = new URL(url)
    if (parsed.password !== '') parsed.password = '***'
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * The MCP bridge as a command someone can paste. Both this module and the
 * bundled `bin/` sit two levels under the install root whether it is run from
 * source or from a build, and an install that has no bin/ (an odd layout, or
 * the published package under another name) gets the npx form instead.
 */
function mcpCommand(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const bridge = path.resolve(here, '../../bin/stickie-mcp.js')
  return existsSync(bridge)
    ? `claude mcp add stickie -- node ${bridge}`
    : 'claude mcp add stickie -- npx -y stickie stickie-mcp'
}

// extensions whose files open soft-wrapped; prose and data, not code
const default_wrap_extensions = 'md,markdown,txt,rst,csv,log,json'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Pushes an event to connected clients; a no-op outside the real server. */
export type Emit = (event: ClientEvent) => void

export function createApp(
  store: Store,
  hub: WatchHub,
  emit: Emit = () => undefined,
): OpenAPIHono {
  const app = new OpenAPIHono()

  const identity = new Identity(store)

  /**
   * The actor a write is attributed to: the agent asking, or the person as the
   * reviewed repository knows them.
   */
  const actorFor = async (
    author: Author,
    claimed: string | undefined,
    repoPath: string | null,
  ): Promise<number> =>
    author === 'agent'
      ? (await identity.agent(claimed)).id
      : (await identity.human(repoPath)).actor.id

  /**
   * Every mutation goes through here: it appends to the record and *then*
   * tells connected clients. One call rather than two so the record cannot be
   * forgotten — forgetting it would also break live refresh, which someone
   * would notice immediately.
   *
   * It is awaited rather than fired off, and a failed append fails the request:
   * a change stickie did not manage to record is not a change it should report as
   * done.
   */
  const record = async <S extends ActivitySubject>(
    entry: ActivityInput<S>,
  ): Promise<void> => {
    await store.recordActivity(entry)
    if (entry.subject === 'note' && entry.sessionId != null) {
      emit({
        type: 'thread',
        action: liveAction(entry.action),
        sessionId: entry.sessionId,
        ...(entry.threadId == null ? {} : { threadId: entry.threadId }),
      })
    }
  }

  /** The record has seven note actions; a client only needs to know three. */
  const liveAction = (action: string): ThreadEvent['action'] =>
    action === 'created' ? 'created' : action === 'deleted' ? 'deleted' : 'updated'

  /**
   * Who a change is attributed to. `'human'` means "the person, as the reviewed
   * repository knows them", resolved from the session the recorder has had to
   * look up anyway.
   */
  type Attribution = number | null | 'human'

  /**
   * A note event, with the repository denormalised onto the row so a
   * cross-repo read stays one query. Takes the session when the caller has it
   * and an id when it does not, rather than making every route fetch it twice.
   */
  const noteRecord = async (
    action: ActivityAction<'note'>,
    session: Session | number,
    threadId: number | undefined,
    actor: Attribution,
    detail?: Record<string, unknown>,
  ): Promise<void> => {
    const owner =
      typeof session === 'number' ? await store.getSession(session) : session
    const actorId =
      actor === 'human'
        ? (await identity.human(owner?.repoPath ?? null)).actor.id
        : actor
    await record({
      subject: 'note',
      action,
      actorId,
      repoId: owner?.repoId ?? null,
      sessionId: typeof session === 'number' ? session : session.id,
      ...(threadId === undefined ? {} : { threadId }),
      ...(detail === undefined ? {} : { detail }),
    })
  }

  app.onError((error, c) => c.json({ error: errorMessage(error) }, 500))

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/repos',
      tags: ['repos'],
      summary: 'List registered repositories',
      responses: {
        200: json_response(z.array(repo_info_schema), 'Registered repos'),
      },
    }),
    async (c) => {
      const repos = await store.listRepos()
      const infos: RepoInfo[] = await Promise.all(
        repos.map(async (repo) => {
          const status = await gitStatus(repo.path)
          return {
            id: repo.id,
            path: repo.path,
            name: repo.path.split('/').at(-1) ?? repo.path,
            branch: status.branch,
            clean: status.clean,
            changedFiles: status.changedFiles,
          }
        }),
      )
      return c.json(infos, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/repos',
      tags: ['repos'],
      summary: 'Register a repository by absolute path',
      request: { body: json_body(repo_body) },
      responses: {
        200: json_response(repo_schema, 'Registered repo'),
        400: bad_request,
      },
    }),
    async (c) => {
      const body = c.req.valid('json')
      const expanded = expandUserPath(body.path)
      if (!(await isGitRepo(expanded))) {
        return c.json({ error: `not a git repository: ${expanded}` }, 400)
      }
      const root = await repoRoot(expanded)
      return c.json(await store.addRepo(root), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/repos/{id}',
      tags: ['repos'],
      summary: 'Remove a repository registration',
      request: { params: id_param },
      responses: {
        200: json_response(z.object({ ok: z.boolean() }), 'Removed'),
      },
    }),
    async (c) => {
      await store.removeRepo(c.req.valid('param').id)
      return c.json({ ok: true }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/repos/{id}/targets',
      tags: ['repos'],
      summary: 'Worktrees, recent branches, and default branch',
      request: { params: id_param },
      responses: {
        200: json_response(targets_schema, 'Review target options'),
        404: not_found,
      },
    }),
    async (c) => {
      const repo = await store.getRepo(c.req.valid('param').id)
      if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)
      const [worktrees, branches, recentCommits, default_branch] =
        await Promise.all([
          listWorktrees(repo.path),
          listRecentBranches(repo.path),
          listRecentCommits(repo.path),
          defaultBranch(repo.path),
        ])
      const targets: TargetOptions = {
        worktrees,
        branches,
        recentCommits,
        defaultBranch: default_branch,
      }
      return c.json(targets, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions',
      tags: ['sessions'],
      summary: 'Get or create a review session',
      description:
        'source is a worktree working tree or a ref. baseRef defaults to ' +
        'HEAD for worktrees and to the merge-base with the default branch ' +
        'for refs; it is resolved and pinned as baseSha at creation.',
      request: { body: json_body(session_body) },
      responses: {
        200: json_response(session_schema, 'The session'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const body = c.req.valid('json')
      const repo = await store.getRepo(body.repoId)
      if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)

      if (body.source.kind === 'worktree') {
        const worktrees = await listWorktrees(repo.path)
        if (!worktrees.some((wt) => wt.path === body.source.value)) {
          return c.json(
            { error: `not a worktree of this repo: ${body.source.value}` },
            400,
          )
        }
      } else {
        await resolveRef(repo.path, body.source.value)
      }

      let base_ref = body.baseRef
      let base_sha: string
      const resolve_in =
        body.source.kind === 'worktree' ? body.source.value : repo.path
      if (base_ref === undefined) {
        // MR-style default: diff the whole branch against master/main,
        // falling back to HEAD when the default branch is unrelated
        const default_branch = await defaultBranch(repo.path)
        const against =
          body.source.kind === 'worktree' ? 'HEAD' : body.source.value
        const merge_base = await mergeBase(resolve_in, default_branch, against)
        if (merge_base !== null) {
          base_ref = default_branch
          base_sha = merge_base
        } else {
          base_ref = body.source.kind === 'worktree' ? 'HEAD' : default_branch
          base_sha = await resolveRef(resolve_in, base_ref)
        }
      } else {
        base_sha = await resolveRef(resolve_in, base_ref)
      }

      const session = await store.getOrCreateSession(
        repo.id,
        body.source,
        base_ref,
        base_sha,
      )
      // this route is get-or-create and the client calls it on every visit, so
      // only the first sighting of a review is worth recording
      if (!(await store.hasActivity(session.id, 'review', 'opened'))) {
        await record({
          subject: 'review',
          action: 'opened',
          actorId: (await identity.human(repo.path)).actor.id,
          repoId: repo.id,
          sessionId: session.id,
          detail: {
            source: body.source,
            baseRef: base_ref,
            baseSha: base_sha,
          },
        })
      }
      hub.ensureWatch(
        body.source.kind === 'worktree' ? body.source.value : repo.path,
      )
      return c.json(session, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}',
      tags: ['sessions'],
      summary: 'Session details, including base staleness',
      request: { params: id_param },
      responses: {
        200: json_response(session_schema, 'The session'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      return c.json({ ...session, baseStale: await isBaseStale(session) }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/repin',
      tags: ['sessions'],
      summary: 'Move a stale base pin to the freshly resolved commit',
      description:
        'Re-pins this review in place, so its notes and its history stay ' +
        'together; the base it moved from is kept in the activity record. ' +
        'Notes re-anchor against the new base on the next read.',
      request: { params: id_param },
      responses: {
        200: json_response(session_schema, 'The re-pinned session'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const current =
        session.baseRef === 'HEAD'
          ? await resolveRef(sourceRoot(session), 'HEAD')
          : ((await mergeBase(sourceRoot(session), session.baseRef, 'HEAD')) ??
            session.baseSha)
      if (current === session.baseSha) {
        return c.json({ ...session, baseStale: false }, 200)
      }
      // the pin moves on this review rather than starting another one; what
      // the base used to be is not lost, it is in the record below
      await store.repinSession(session.id, current)
      await record({
        subject: 'review',
        action: 'repinned',
        actorId: (await identity.human(session.repoPath)).actor.id,
        repoId: session.repoId,
        sessionId: session.id,
        detail: { fromBaseSha: session.baseSha, toBaseSha: current },
      })
      return c.json(
        { ...session, baseSha: current, baseStale: false },
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/commits',
      tags: ['sessions'],
      summary: 'Commits between the pinned base and the source head',
      request: { params: id_param },
      responses: {
        200: json_response(
          z.array(
            z.object({
              sha: z.string(),
              shortSha: z.string(),
              parentSha: z.string(),
              subject: z.string(),
            }),
          ),
          'Newest first',
        ),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const head =
        session.source.kind === 'worktree' ? 'HEAD' : session.source.value
      return c.json(
        await listCommitsBetween(sourceRoot(session), session.baseSha, head),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/diff',
      tags: ['sessions'],
      summary: 'Changed files between base and source',
      request: { params: id_param },
      responses: {
        200: json_response(z.array(changed_file_schema), 'Changed files'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      return c.json(
        await changedFiles(session.repoPath, session.source, session.baseSha),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/tree',
      tags: ['sessions'],
      summary: 'All files on the source side',
      request: { params: id_param },
      responses: {
        200: json_response(z.array(z.string()), 'File paths'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      return c.json(
        await listAllFiles(session.repoPath, session.source),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/file',
      tags: ['sessions'],
      summary: 'Full file content at one side of the diff',
      request: {
        params: id_param,
        query: z.object({
          path: z.string().min(1),
          side: z.enum(['base', 'source']),
        }),
      },
      responses: {
        200: json_response(file_content_schema, 'File content'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { path: file_path, side } = c.req.valid('query')
      const blob = await fileAtSide(
        session.repoPath,
        session.source,
        session.baseSha,
        side,
        file_path,
      )
      return c.json({ path: file_path, side, ...blob }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/repos/{id}/commit-files',
      tags: ['repos'],
      summary: 'Files touched by a set of commits',
      description:
        'Backs the commit timeline: the union of paths the given commits ' +
        'touch, each with the commits that touched it (newest first).',
      request: {
        params: id_param,
        query: z.object({
          shas: z.string().min(1).describe('comma separated'),
        }),
      },
      responses: {
        200: json_response(
          z.array(z.object({ path: z.string(), shas: z.array(z.string()) })),
          'Touched files',
        ),
        404: not_found,
      },
    }),
    async (c) => {
      const repo = await store.getRepo(c.req.valid('param').id)
      if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)
      const shas = c.req
        .valid('query')
        .shas.split(',')
        .map((sha) => sha.trim())
        .filter((sha) => /^[0-9a-f]{4,40}$/.test(sha))
      const touched = new Map<string, string[]>()
      for (const sha of shas) {
        for (const file of await commitFiles(repo.path, sha)) {
          touched.set(file.path, [...(touched.get(file.path) ?? []), sha])
        }
      }
      return c.json(
        [...touched.entries()]
          .map(([path, list]) => ({ path, shas: list }))
          .sort((a, b) => a.path.localeCompare(b.path)),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions',
      tags: ['sessions'],
      summary: 'Every review session, newest first',
      description:
        'For an agent handed no session id: one entry per review, with how ' +
        'many notes are waiting on it.',
      responses: {
        200: json_response(
          z.array(
            session_schema.extend({ openNotes: z.number().int() }),
          ),
          'Sessions',
        ),
      },
    }),
    async (c) => {
      const sessions = await store.listSessions()
      const listed = []
      for (const session of sessions) {
        listed.push({
          ...session,
          openNotes: await store.countOpenThreads(session.id),
        })
      }
      return c.json(listed, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/overview',
      tags: ['sessions'],
      summary: 'Every review in the workspace, with what is waiting on whom',
      description:
        'One request for the landing page. Everything about a review comes ' +
        'from the database — nothing shells out to git per review, or listing ' +
        'thirty of them would run thirty git commands; changed-file counts ' +
        'and base staleness stay on the review itself, which knows them.',
      responses: {
        200: json_response(overview_schema, 'The workspace at a glance'),
      },
    }),
    async (c) => {
      const [repos, sessions, rollups, recent] = await Promise.all([
        store.listRepos(),
        store.listSessions(),
        store.summarizeSessions(),
        store.listActivity({}, 40),
      ])

      // a sha means nothing to read; its subject does. Gathered per repository
      // over the distinct revisions its reviews name, so the number of git
      // lookups follows the repositories and not the reviews
      const wanted = new Map<number, string[]>()
      for (const session of sessions) {
        const revs = wanted.get(session.repoId) ?? []
        revs.push(session.baseSha)
        if (session.source.kind === 'ref') revs.push(session.source.value)
        wanted.set(session.repoId, revs)
      }
      const subjects = new Map<number, Map<string, string>>()
      await Promise.all(
        repos.map(async (repo) => {
          subjects.set(
            repo.id,
            await describeRevs(repo.path, wanted.get(repo.id) ?? []),
          )
        }),
      )

      const names = new Map(
        repos.map((repo) => [
          repo.id,
          repo.path.split('/').at(-1) ?? repo.path,
        ]),
      )
      // listSessions is newest first, so the first hit per repo is the newest
      const latest = new Map<number, number>()
      for (const session of sessions) {
        if (!latest.has(session.repoId)) latest.set(session.repoId, session.id)
      }

      const empty: SessionRollup = {
        notes: { total: 0, open: 0, pending: 0, resolved: 0, detached: 0 },
        filesRead: 0,
        agentReplies: 0,
        lastActivityAt: null,
        lastAction: null,
        lastActorName: null,
        awaiting: null,
      }

      return c.json(
        {
          repos: await Promise.all(
            repos.map(async (repo) => {
              const status = await gitStatus(repo.path)
              return {
                id: repo.id,
                name: names.get(repo.id) ?? repo.path,
                path: repo.path,
                branch: status.branch,
                clean: status.clean,
                changedFiles: status.changedFiles,
                latestSessionId: latest.get(repo.id) ?? null,
              }
            }),
          ),
          reviews: sessions.map((session) => {
            const rollup = rollups.get(session.id) ?? empty
            const known = subjects.get(session.repoId) ?? new Map()
            const repo = repos.find((entry) => entry.id === session.repoId)
            return {
              sessionId: session.id,
              repoId: session.repoId,
              repoName: names.get(session.repoId) ?? session.repoPath,
              source: session.source,
              baseRef: session.baseRef,
              baseSha: session.baseSha,
              comparing: {
                source: sourceLabel(session, repo?.path, known),
                // the base's subject comes from the pinned sha, which is
                // always resolvable, rather than from baseRef, which may be a
                // symbolic name that has since moved
                base: {
                  name: shortenRev(session.baseRef) ?? session.baseRef,
                  subject: known.get(session.baseSha) ?? null,
                },
              },
              ...rollup,
            }
          }),
          recent,
        },
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/threads',
      tags: ['threads'],
      summary: 'List note threads, re-anchored to current content',
      description:
        'Pending (unsubmitted) notes are excluded by default so agents only ' +
        'see submitted reviews; the UI passes include_pending=1.',
      request: {
        params: id_param,
        query: z.object({
          status: z.enum(['open', 'resolved', 'detached']).optional(),
          include_pending: flag_query,
        }),
      },
      responses: {
        200: json_response(z.array(thread_schema), 'Threads'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { status, include_pending } = c.req.valid('query')
      const threads = (
        await reanchorThreads(store, session, await store.listThreads(session.id))
      ).filter((t) => include_pending === true || !t.pending)
      return c.json(
        status === undefined
          ? threads
          : threads.filter((t) => t.status === status),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/threads',
      tags: ['threads'],
      summary: 'Create a note thread anchored to lines',
      request: { params: id_param, body: json_body(thread_body) },
      responses: {
        201: json_response(thread_schema, 'Created thread'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const body = c.req.valid('json')
      if (body.endLine < body.startLine) {
        return c.json({ error: 'endLine before startLine' }, 400)
      }
      const actorId = await actorFor(body.author, body.actor, session.repoPath)
      if (body.startLine === 0) {
        const note = await store.createThread(
          session.id,
          body.path,
          body.side,
          0,
          0,
          null,
          '',
          body.author,
          body.body,
          { pending: body.pending ?? body.author === 'user', actorId },
        )
        await noteRecord('created', session, note.id, actorId, {
          path: body.path,
          scope: body.path === '' ? 'review' : 'file',
          author: body.author,
          pending: note.pending,
          baseSha: session.baseSha,
        })
        return c.json(note, 201)
      }
      const blob = await fileAtSide(
        session.repoPath,
        session.source,
        session.baseSha,
        body.side,
        body.path,
      )
      if (blob.content === null) {
        return c.json(
          { error: `no readable file at ${body.side}:${body.path}` },
          400,
        )
      }
      const snippet = extractSnippet(blob.content, body.startLine, body.endLine)
      const thread = await store.createThread(
        session.id,
        body.path,
        body.side,
        body.startLine,
        body.endLine,
        blob.blobSha,
        snippet,
        body.author,
        body.body,
        { pending: body.pending ?? body.author === 'user', actorId },
      )
      await noteRecord('created', session, thread.id, actorId, {
        path: body.path,
        side: body.side,
        startLine: body.startLine,
        endLine: body.endLine,
        author: body.author,
        pending: thread.pending,
        baseSha: session.baseSha,
        blobSha: blob.blobSha,
      })
      return c.json(thread, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/threads/{id}/reply',
      tags: ['threads'],
      summary: 'Add a reply to a thread',
      request: { params: id_param, body: json_body(message_body) },
      responses: {
        200: json_response(thread_schema, 'Updated thread'),
        404: not_found,
      },
    }),
    async (c) => {
      const thread = await store.getThread(c.req.valid('param').id)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      const body = c.req.valid('json')
      // a reply is attributed as the reviewed repository would attribute it,
      // so the session has to be in hand
      const owner = await store.getSession(thread.sessionId)
      const actorId = await actorFor(
        body.author,
        body.actor,
        owner?.repoPath ?? null,
      )
      await store.addMessage(thread.id, body.author, body.body, actorId)
      const updated = await store.getThread(thread.id)
      if (updated === undefined) return c.json({ error: 'unknown thread' }, 404)
      await noteRecord(
        'replied',
        owner ?? thread.sessionId,
        thread.id,
        actorId,
        { author: body.author },
      )
      return c.json(updated, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/messages/{id}',
      tags: ['threads'],
      summary: 'Edit a message body (user-authored messages only)',
      request: { params: id_param, body: json_body(z.object({ body: z.string().min(1) })) },
      responses: {
        200: json_response(thread_schema, 'The thread containing the message'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const message = await store.getMessage(c.req.valid('param').id)
      if (message === undefined) {
        return c.json({ error: 'unknown message' }, 404)
      }
      if (message.author !== 'user') {
        return c.json({ error: 'agent messages cannot be edited' }, 400)
      }
      await store.updateMessage(message.id, c.req.valid('json').body)
      const thread = await store.getThread(message.threadId)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      await noteRecord('edited', thread.sessionId, thread.id, 'human', {
        messageId: message.id,
      })
      return c.json(thread, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/threads/{id}',
      tags: ['threads'],
      summary: 'Delete a thread and its messages',
      request: { params: id_param },
      responses: {
        200: json_response(z.object({ ok: z.boolean() }), 'Deleted'),
        404: not_found,
      },
    }),
    async (c) => {
      const thread = await store.getThread(c.req.valid('param').id)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      await store.deleteThread(thread.id)
      // the note is gone; what it said and where is kept, because a record
      // that vanishes with its subject records nothing
      await noteRecord('deleted', thread.sessionId, thread.id, 'human', {
        path: thread.path,
        startLine: thread.startLine,
        endLine: thread.endLine,
        messages: thread.messages.length,
      })
      return c.json({ ok: true }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/messages/{id}',
      tags: ['threads'],
      summary:
        'Delete a user-authored message; deletes the thread when it was the last one',
      request: { params: id_param },
      responses: {
        200: json_response(
          z.object({
            deletedThread: z.boolean(),
            thread: thread_schema.nullable(),
          }),
          'Result',
        ),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const message = await store.getMessage(c.req.valid('param').id)
      if (message === undefined) {
        return c.json({ error: 'unknown message' }, 404)
      }
      if (message.author !== 'user') {
        return c.json({ error: 'agent messages cannot be deleted' }, 400)
      }
      const owner = await store.getThread(message.threadId)
      await store.deleteMessage(message.id)
      if (await store.countMessages(message.threadId) === 0) {
        await store.deleteThread(message.threadId)
        if (owner !== undefined) {
          await noteRecord('deleted', owner.sessionId, owner.id, 'human', {
            path: owner.path,
            startLine: owner.startLine,
            endLine: owner.endLine,
            lastMessageRemoved: true,
          })
        }
        return c.json({ deletedThread: true, thread: null }, 200)
      }
      const thread = await store.getThread(message.threadId)
      if (thread !== undefined) {
        await noteRecord('edited', thread.sessionId, thread.id, 'human', {
          messageId: message.id,
          removed: true,
        })
      }
      return c.json({ deletedThread: false, thread: thread ?? null }, 200)
    },
  )

  const status_route = (action: 'resolve' | 'reopen') =>
    createRoute({
      method: 'post',
      path: `/api/threads/{id}/${action}`,
      tags: ['threads'],
      summary: action === 'resolve' ? 'Resolve a thread' : 'Reopen a thread',
      request: { params: id_param },
      responses: {
        200: json_response(thread_schema, 'Updated thread'),
        404: not_found,
      },
    })

  for (const action of ['resolve', 'reopen'] as const) {
    app.openapi(status_route(action), async (c) => {
      const thread = await store.getThread(c.req.valid('param').id)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      await store.setThreadStatus(thread.id, action === 'resolve' ? 'resolved' : 'open')
      const updated = await store.getThread(thread.id)
      if (updated === undefined) return c.json({ error: 'unknown thread' }, 404)
      await noteRecord(
        action === 'resolve' ? 'resolved' : 'reopened',
        thread.sessionId,
        thread.id,
        'human',
        { path: thread.path },
      )
      return c.json(updated, 200)
    })
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/prompt',
      tags: ['sessions'],
      summary: 'Self-contained text export of unresolved notes',
      description:
        'The manual paste path: every unresolved note, including the pending ' +
        'batch, with the instruction block from settings. `order` lists ' +
        'thread ids first, in that order; the rest follow by age.',
      request: {
        params: id_param,
        query: z.object({
          order: z.string().optional(),
          include_pending: flag_query,
        }),
      },
      responses: {
        200: {
          content: { 'text/plain': { schema: z.string() } },
          description: 'Prompt text for pasting into any agent',
        },
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { order, include_pending } = c.req.valid('query')
      const with_pending = include_pending !== false
      const unresolved = (
        await reanchorThreads(store, session, await store.listThreads(session.id))
      ).filter((t) => t.status !== 'resolved' && (with_pending || !t.pending))
      const wanted =
        order === undefined
          ? []
          : order
              .split(',')
              .map((id) => Number(id.trim()))
              .filter((id) => Number.isInteger(id))
      const rank = new Map(wanted.map((id, index) => [id, index]))
      const threads = [...unresolved].sort(
        (a, b) =>
          (rank.get(a.id) ?? rank.size + a.id) -
          (rank.get(b.id) ?? rank.size + b.id),
      )
      const api_base = new URL(c.req.url).origin
      const source_cache = new Map<string, string | null>()
      const repo_by_name = new Map(
        (await store.listRepos()).map((r) => [r.path.split('/').at(-1) ?? r.path, r]),
      )
      const readSource = async (
        repoName: string | null,
        path: string,
      ): Promise<string | null> => {
        const key = `${repoName ?? ''}:${path}`
        const cached = source_cache.get(key)
        if (cached !== undefined) return cached
        let content: string | null = null
        try {
          if (repoName === null) {
            const blob = await fileAtSide(
              session.repoPath,
              session.source,
              session.baseSha,
              'source',
              path,
            )
            content = blob.content
          } else {
            const other = repo_by_name.get(repoName)
            if (other !== undefined) {
              const blob = await fileInWorktree(other.path, path)
              content = blob.content
            }
          }
        } catch {
          // unreadable or unsafe ref target: leave it to the agent
        }
        source_cache.set(key, content)
        return content
      }
      // handing the notes to an agent is itself part of the oversight story:
      // this is the moment a human decided the review was ready to act on
      await record({
        subject: 'review',
        action: 'exported',
        actorId: (await identity.human(session.repoPath)).actor.id,
        repoId: session.repoId,
        sessionId: session.id,
        detail: {
          notes: threads.length,
          threadIds: threads.map((t) => t.id),
          baseSha: session.baseSha,
        },
      })
      return c.text(
        await buildPrompt(
          session,
          threads,
          api_base,
          readSource,
          await store.getSetting('prompt_instructions') ??
            default_prompt_instructions,
        ),
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/submit-review',
      tags: ['threads'],
      summary: 'Post every pending note of the session to the agent',
      request: { params: id_param },
      responses: {
        200: json_response(
          z.object({ posted: z.number().int() }),
          'How many notes were posted',
        ),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const posted = await store.postPending(session.id)
      if (posted > 0) {
        await record({
          subject: 'review',
          action: 'submitted',
          actorId: (await identity.human(session.repoPath)).actor.id,
          repoId: session.repoId,
          sessionId: session.id,
          detail: { posted },
        })
        // review.submitted is not a note event, so the live frame is its own
        emit({ type: 'thread', action: 'updated', sessionId: session.id })
      }
      return c.json({ posted }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/threads/{id}/post',
      tags: ['threads'],
      summary: 'Post a single pending note immediately',
      request: { params: id_param },
      responses: {
        200: json_response(thread_schema, 'Updated thread'),
        404: not_found,
      },
    }),
    async (c) => {
      const thread = await store.getThread(c.req.valid('param').id)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      await store.setThreadPending(thread.id, false)
      const updated = await store.getThread(thread.id)
      if (updated === undefined) return c.json({ error: 'unknown thread' }, 404)
      await noteRecord('posted', thread.sessionId, thread.id, 'human', {
        path: thread.path,
      })
      return c.json(updated, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/viewed',
      tags: ['sessions'],
      summary: 'Paths marked as viewed in this session',
      request: { params: id_param },
      responses: {
        200: json_response(z.array(z.string()), 'Viewed paths'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      return c.json(await store.listViewed(session.id), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/viewed',
      tags: ['sessions'],
      summary: 'Mark or unmark a file as viewed',
      request: {
        params: id_param,
        body: json_body(
          z.object({ path: z.string().min(1), viewed: z.boolean() }),
        ),
      },
      responses: {
        200: json_response(z.object({ ok: z.boolean() }), 'Stored'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const body = c.req.valid('json')
      await store.setViewed(session.id, body.path, body.viewed)
      // which files a reviewer actually opened is the part of the record that
      // nothing else anywhere can reconstruct afterwards
      await record({
        subject: 'file',
        action: body.viewed ? 'viewed' : 'unviewed',
        actorId: (await identity.human(session.repoPath)).actor.id,
        repoId: session.repoId,
        sessionId: session.id,
        detail: { path: body.path, baseSha: session.baseSha },
      })
      return c.json({ ok: true }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/activity',
      tags: ['sessions'],
      summary: 'What happened in this review, newest first',
      description:
        'The append-only record: notes raised, answered, resolved and deleted, ' +
        'files opened, submissions, re-pins and exports — with who and when. ' +
        'Nothing rewrites it, and on the local SQLite file nothing stops its ' +
        'owner editing it either: a record, not evidence.',
      request: {
        params: id_param,
        query: z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }),
      },
      responses: {
        200: json_response(z.array(activity_schema), 'Activity'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { limit } = c.req.valid('query')
      return c.json(
        await store.listActivity({ sessionId: session.id }, limit ?? 200),
        200,
      )
    },
  )

  const gitlabSettings = async () => ({
    url: await store.getSetting('gitlab_url'),
    token: await store.getSetting('gitlab_token'),
    tokenEnv: await store.getSetting('gitlab_token_env'),
  })

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/settings',
      tags: ['settings'],
      summary: 'Current settings; the raw token is never echoed back',
      responses: {
        200: json_response(
          z.object({
            gitlabUrl: z.string().nullable(),
            gitlabTokenEnv: z.string().nullable(),
            hasStoredToken: z.boolean(),
            effectiveUrl: z.string().nullable(),
            tokenSource: z.string().nullable(),
            promptInstructions: z.string(),
            defaultPromptInstructions: z.string(),
            wrapExtensions: z.string(),
            /** the command that points an MCP client at this server */
            mcpCommand: z.string(),
            identity: z.object({
              /** '' when nothing was set by hand and git config decides */
              chosenName: z.string(),
              /**
               * How a note would be attributed in each registered repository.
               * Per repository because that is how git resolves an identity.
               */
              perRepo: z.array(
                z.object({
                  repoId: z.number().int(),
                  repoName: z.string(),
                  name: z.string(),
                  email: z.string().nullable(),
                  /** settings | git (as the repo resolves it) | git-global | environment | fallback */
                  source: z.string(),
                }),
              ),
              /** used when no repository is in hand */
              fallback: z.object({
                name: z.string(),
                email: z.string().nullable(),
                source: z.string(),
              }),
            }),
            storage: z.object({
              /** what the running server is using */
              active: z.string(),
              /** the configured postgres url, with the password removed */
              databaseUrl: z.string().nullable(),
              /** the environment decides; the page cannot change it */
              fromEnv: z.boolean(),
            }),
          }),
          'Settings state',
        ),
      },
    }),
    async (c) => {
      const settings = await gitlabSettings()
      const config = gitlabConfig(settings)
      return c.json(
        {
          gitlabUrl: settings.url,
          gitlabTokenEnv: settings.tokenEnv,
          hasStoredToken: settings.token !== null && settings.token !== '',
          effectiveUrl: config?.url ?? null,
          tokenSource: config?.tokenSource ?? null,
          promptInstructions:
            await store.getSetting('prompt_instructions') ??
            default_prompt_instructions,
          defaultPromptInstructions: default_prompt_instructions,
          wrapExtensions:
            (await store.getSetting('wrap_extensions')) ??
            default_wrap_extensions,
          mcpCommand: mcpCommand(),
          identity: {
            chosenName: (await store.getSetting('actor_name')) ?? '',
            perRepo: await Promise.all(
              (await store.listRepos()).map(async (repo) => ({
                repoId: repo.id,
                repoName: repo.path.split('/').at(-1) ?? repo.path,
                ...(await identity.human(repo.path)).resolved,
              })),
            ),
            fallback: (await identity.human(null)).resolved,
          },
          storage: {
            active: store.describe,
            databaseUrl: redactUrl(configuredDatabaseUrl()),
            fromEnv: databaseFromEnv(),
          },
        },
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/settings',
      tags: ['settings'],
      summary: 'Update settings',
      description:
        'Omitted fields stay untouched; empty strings clear a value. The ' +
        'stored token lives in plaintext in the local sqlite file — prefer ' +
        'the env-var options on shared machines.',
      request: {
        body: json_body(
          z.object({
            gitlabUrl: z.string().optional(),
            gitlabToken: z.string().optional(),
            gitlabTokenEnv: z.string().optional(),
            promptInstructions: z.string().optional(),
            wrapExtensions: z.string().optional(),
            /** a postgres url, or '' to go back to the local sqlite file */
            databaseUrl: z.string().optional(),
            /** '' falls back to git config */
            actorName: z.string().max(64).optional(),
          }),
        ),
      },
      responses: {
        200: json_response(
          z.object({ ok: z.boolean(), restartRequired: z.boolean() }),
          'Stored',
        ),
        400: bad_request,
      },
    }),
    async (c) => {
      const body = c.req.valid('json')
      if (body.gitlabUrl !== undefined) {
        await store.setSetting('gitlab_url', body.gitlabUrl)
      }
      if (body.gitlabToken !== undefined) {
        await store.setSetting('gitlab_token', body.gitlabToken)
      }
      if (body.gitlabTokenEnv !== undefined) {
        await store.setSetting('gitlab_token_env', body.gitlabTokenEnv)
      }
      if (body.promptInstructions !== undefined) {
        await store.setSetting('prompt_instructions', body.promptInstructions.trim())
      }
      if (body.wrapExtensions !== undefined) {
        await store.setSetting('wrap_extensions', body.wrapExtensions.trim())
      }
      if (body.actorName !== undefined) {
        await store.setSetting('actor_name', body.actorName.trim())
        identity.forget()
      }
      let restart = false
      if (body.databaseUrl !== undefined && !databaseFromEnv()) {
        const url = body.databaseUrl.trim()
        if (url !== '' && !/^postgres(ql)?:\/\//.test(url)) {
          return c.json({ error: 'expected a postgres:// url' }, 400)
        }
        restart = url !== (configuredDatabaseUrl() ?? '')
        setDatabaseUrl(url === '' ? null : url)
      }
      return c.json({ ok: true, restartRequired: restart }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/import-mr',
      tags: ['threads'],
      summary: 'Import unresolved GitLab MR diff discussions as threads',
      description:
        'Requires GITLAB_TOKEN (and GITLAB_URL for self-hosted instances) in ' +
        'the server environment. Accepts an MR iid, !iid, or full URL; the ' +
        'project is inferred from the origin remote when not in the URL. ' +
        'Already-imported discussions are skipped by their discussion id.',
      request: {
        params: id_param,
        body: json_body(z.object({ mr: z.string().min(1) })),
      },
      responses: {
        200: json_response(
          z.object({ imported: z.number().int(), skipped: z.number().int() }),
          'Import result',
        ),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const config = gitlabConfig(await gitlabSettings())
      if (config === null) {
        return c.json(
          {
            error:
              'no GitLab token configured — set one in Settings or export GITLAB_TOKEN',
          },
          400,
        )
      }
      const ref = parseMrRef(c.req.valid('json').mr)
      if (ref === null) {
        return c.json({ error: 'expected an MR iid, !iid, or full URL' }, 400)
      }
      let project = ref.projectPath
      if (project === null) {
        const remote = await gitOrigin(sourceRoot(session))
        project = remote === null ? null : projectFromRemote(remote)
      }
      if (project === null) {
        return c.json(
          { error: 'could not infer the GitLab project from the origin remote' },
          400,
        )
      }
      const notes = await fetchMrDiscussions(config, project, ref.iid)
      let imported = 0
      let skipped = 0
      for (const note of notes) {
        if (
          await store.findThreadByExternalId(session.id, note.externalId) !==
          undefined
        ) {
          skipped += 1
          continue
        }
        const blob = await fileAtSide(
          session.repoPath,
          session.source,
          session.baseSha,
          note.side,
          note.path,
        ).catch(() => null)
        if (blob === null || blob.content === null) {
          skipped += 1
          continue
        }
        const line = Math.min(note.line, blob.content.split('\n').length)
        const [first, ...rest] = note.messages
        const thread = await store.createThread(
          session.id,
          note.path,
          note.side,
          line,
          line,
          blob.blobSha,
          extractSnippet(blob.content, line, line),
          'user',
          first ?? '',
          { origin: 'gitlab', externalId: note.externalId },
        )
        for (const body of rest) {
          await store.addMessage(thread.id, 'user', body)
        }
        imported += 1
      }
      if (imported > 0) {
        await record({
          subject: 'review',
          action: 'imported',
          actorId: (await identity.human(session.repoPath)).actor.id,
          repoId: session.repoId,
          sessionId: session.id,
          detail: { source: 'gitlab', project, mr: ref.iid, imported, skipped },
        })
        emit({ type: 'thread', action: 'created', sessionId: session.id })
      }
      return c.json({ imported, skipped }, 200)
    },
  )

  const nav_hit_schema = z
    .object({
      repoPath: z.string(),
      path: z.string(),
      line: z.number().int(),
      preview: z.string(),
    })
    .openapi('NavHit')

  const navRoot = (session: Session): string =>
    session.source.kind === 'worktree' ? session.source.value : session.repoPath

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/nav/definitions',
      tags: ['navigation'],
      summary: 'Grep-grade definition candidates for a symbol',
      request: {
        params: id_param,
        query: z.object({
          name: z.string().min(1),
          language: z.string(),
          scope: z.enum(['repo', 'workspace']).default('repo'),
        }),
      },
      responses: {
        200: json_response(z.array(nav_hit_schema), 'Definition candidates'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { name, language, scope } = c.req.valid('query')
      if (scope === 'repo') {
        return c.json(
          await findDefinitions(navRoot(session), name, language),
          200,
        )
      }
      const roots = [
        navRoot(session),
        ...(await store.listRepos())
          .map((r) => r.path)
          .filter((p) => p !== session.repoPath),
      ]
      const all = await Promise.all(
        roots.map((root) =>
          findDefinitions(root, name, language).catch(() => []),
        ),
      )
      return c.json(all.flat(), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/nav/references',
      tags: ['navigation'],
      summary: 'Word-boundary references for a symbol',
      description:
        'scope=workspace sweeps every registered repository — useful for ' +
        'blast-radius checks on shared code.',
      request: {
        params: id_param,
        query: z.object({
          name: z.string().min(1),
          scope: z.enum(['repo', 'workspace']).default('repo'),
        }),
      },
      responses: {
        200: json_response(z.array(nav_hit_schema), 'References'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { name, scope } = c.req.valid('query')
      if (scope === 'repo') {
        return c.json(await findReferences(navRoot(session), name), 200)
      }
      const roots = [
        navRoot(session),
        ...(await store.listRepos())
          .map((r) => r.path)
          .filter((p) => p !== session.repoPath),
      ]
      const all = await Promise.all(
        roots.map((root) => findReferences(root, name).catch(() => [])),
      )
      return c.json(all.flat(), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/nav/search',
      tags: ['navigation'],
      summary: 'Smart-case text search across repo or workspace',
      request: {
        params: id_param,
        query: z.object({
          q: z.string().min(2),
          scope: z.enum(['repo', 'workspace']).default('workspace'),
        }),
      },
      responses: {
        200: json_response(z.array(nav_hit_schema), 'Matches'),
        404: not_found,
      },
    }),
    async (c) => {
      const session = await store.getSession(c.req.valid('param').id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      const { q, scope } = c.req.valid('query')
      if (scope === 'repo') {
        return c.json(await searchText(navRoot(session), q), 200)
      }
      const roots = [
        navRoot(session),
        ...(await store.listRepos())
          .map((r) => r.path)
          .filter((p) => p !== session.repoPath),
      ]
      const all = await Promise.all(
        roots.map((root) => searchText(root, q).catch(() => [])),
      )
      return c.json(all.flat().slice(0, 300), 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/repos/{id}/file',
      tags: ['repos'],
      summary: "A file from the repo's main worktree, or at any revision",
      description:
        'Serves the reference side pane and the commit timeline: reading any ' +
        'file of any registered repo without needing a review session, at ' +
        'the working tree by default or at `rev` when given.',
      request: {
        params: id_param,
        query: z.object({
          path: z.string().min(1),
          rev: z.string().min(1).optional(),
        }),
      },
      responses: {
        200: json_response(
          z.object({
            path: z.string(),
            content: z.string().nullable(),
            binary: z.boolean(),
          }),
          'File content',
        ),
        404: not_found,
      },
    }),
    async (c) => {
      const repo = await store.getRepo(c.req.valid('param').id)
      if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)
      const { path: file_path, rev } = c.req.valid('query')
      const blob =
        rev === undefined
          ? await fileInWorktree(repo.path, file_path)
          : await fileAtRef(repo.path, rev, file_path)
      return c.json(
        { path: file_path, content: blob.content, binary: blob.binary },
        200,
      )
    },
  )

  app.doc('/api/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'stickie API',
      version: '0.1.0',
      description:
        'Not another Editor — Notes for Agents. Line-anchored review notes ' +
        'on local git changes, consumable by any coding agent.',
    },
  })
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }))

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
  // keyed by side as well as path: the same file reads differently on each
  const contents = new Map<string, string | null>()
  const result: Thread[] = []
  for (const thread of threads) {
    // a note with no code anchor has nothing to re-locate, and a resolved one
    // is history: it keeps the lines it was written against
    if (thread.startLine === 0 || thread.status === 'resolved') {
      result.push(thread)
      continue
    }
    // base-side notes re-anchor too. They did not have to while a session's
    // base was frozen for its lifetime, but re-pinning now moves the base under
    // them, and a note left on its old line number against new content points
    // at whatever happens to be there.
    const key = `${thread.side}:${thread.path}`
    let content = contents.get(key)
    if (content === undefined) {
      const blob = await fileAtSide(
        session.repoPath,
        session.source,
        session.baseSha,
        thread.side,
        thread.path,
      )
      content = blob.content
      contents.set(key, content)
    }
    if (content === null) {
      await store.setThreadStatus(thread.id, 'detached')
      result.push({ ...thread, status: 'detached' })
      continue
    }
    const anchor = reanchor(thread.snippet, content, thread.startLine)
    if (anchor === null) {
      await store.setThreadStatus(thread.id, 'detached')
      result.push({ ...thread, status: 'detached' })
      continue
    }
    if (
      anchor.startLine !== thread.startLine ||
      anchor.endLine !== thread.endLine ||
      thread.status === 'detached'
    ) {
      await store.setThreadAnchor(thread.id, anchor.startLine, anchor.endLine)
      if (thread.status === 'detached') await store.setThreadStatus(thread.id, 'open')
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
