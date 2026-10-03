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
import type { BasePinState } from './basePin.js'
import { classifyBasePin } from './basePin.js'
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
import type { ReviewListing } from './export.js'
import {
  buildPrompt,
  default_prompt_instructions,
  filterReviews,
  renderReviewList,
} from './export.js'
import { Identity } from './identity.js'
import type { Fetcher } from './mcp.js'
import { handleMessage } from './mcp.js'
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
  isAncestor,
  isGitRepo,
  listAllFiles,
  listRecentBranches,
  listRecentCommits,
  listWorktrees,
  mergeBase,
  repoRoot,
  resolveRef,
  shortenRev,
  shortSha,
} from './git.js'
import type { GitLabConfig, MrThread } from './gitlab.js'
import {
  fetchMr,
  fetchMrDiscussions,
  fetchMrThreads,
  findOpenMr,
  gitlabConfig,
  parseMrRef,
  projectFromRemote,
  replyToMrThread,
  signReply,
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
    branch: z.string(),
    source: source_schema,
    baseRef: z.string(),
    baseSha: z.string(),
    prevBaseRef: z.string().nullable().optional(),
    baseStale: z.boolean().optional(),
    baseDiverged: z.boolean().optional(),
    sourceGone: z.boolean().optional(),
    merged: z.boolean().optional(),
  })
  .openapi('Session')

function sourceRoot(session: Session): string {
  return session.source.kind === 'worktree'
    ? session.source.value
    : session.repoPath
}

/**
 * The tip of what this review is *of*.
 *
 * A worktree review follows whatever that worktree has checked out, so its tip
 * is HEAD; a branch review is of that branch, whatever the repository happens
 * to have checked out at the time. Reading HEAD for both is how a review of
 * `orbit-api` came to be re-pinned because someone started an unrelated
 * branch in the same repository: git was asked about the wrong tip, and the
 * answer was applied to this review.
 */
function sourceHead(session: Session): string {
  return session.source.kind === 'worktree' ? 'HEAD' : session.source.value
}

/**
 * Where this review's base would move to, and whether moving there is moving
 * on. HEAD bases follow the tip commit; ref bases follow the merge-base, which
 * drifts when the source is rebased or the base branch advances.
 */
async function basePin(session: Session): Promise<BasePinState> {
  try {
    const root = sourceRoot(session)
    const resolved =
      session.baseRef === 'HEAD'
        ? await resolveRef(root, sourceHead(session))
        : await mergeBase(root, session.baseRef, sourceHead(session))
    if (resolved === null || resolved === session.baseSha) {
      return classifyBasePin(session.baseSha, resolved, false)
    }
    return classifyBasePin(
      session.baseSha,
      resolved,
      await isAncestor(root, session.baseSha, resolved),
    )
  } catch {
    return classifyBasePin(session.baseSha, null, false)
  }
}

/**
 * Whether what this review is *of* is still there, and whether it has landed.
 *
 * A review outlives the work it is of: a branch is merged and deleted, a
 * worktree is removed, and the row stays because the notes written on it do.
 * What it must not do is go on drawing a diff as though nothing had happened.
 * An emptied one reads as "no changes to review", which is an answer about the
 * code rather than about the branch being gone.
 *
 * `merged` is the source tip being contained in the base: everything this
 * review is of is already in the branch it is read against. It is reported
 * even where the diff is not yet empty, because uncommitted work in a worktree
 * is still work — and reported for a review of the checkout that *is* the base
 * branch, which has never had anything in it to review.
 *
 * Reported, never stored. A review is `(repo, source, base_ref)` and none of
 * this changes that: which of them is finished is the reviewer's to say, and
 * re-pointing the source is how they say otherwise.
 */
async function sourceState(
  session: Session,
): Promise<{ gone: boolean; merged: boolean }> {
  const root = sourceRoot(session)
  let tip: string
  try {
    tip = await resolveRef(root, sourceHead(session))
  } catch {
    // a removed worktree takes its directory with it, and a deleted branch
    // stops resolving; neither is an error to report as one
    return { gone: true, merged: false }
  }
  // a base of HEAD is the source's own tip, so there is nothing for the work
  // to have landed in
  if (session.baseRef === 'HEAD') return { gone: false, merged: false }
  try {
    const base = await resolveRef(root, session.baseRef)
    return { gone: false, merged: await isAncestor(root, tip, base) }
  } catch {
    return { gone: false, merged: false }
  }
}

/**
 * What the repository says about a review right now. Four answers rather than
 * one call per route, so a route cannot report half of them and a reader
 * cannot be told the base moved without being told the branch is gone.
 */
async function reviewState(session: Session): Promise<Partial<Session>> {
  const [pin, source] = await Promise.all([
    basePin(session),
    sourceState(session),
  ])
  return {
    baseStale: pin.stale,
    baseDiverged: pin.diverged,
    sourceGone: source.gone,
    merged: source.merged,
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
    number: z.number().int().openapi({
      description:
        'Which note this is inside its review, counting from 0. The handle ' +
        'the export and the MCP tools use: /api/reviews/{id}/notes/{number}.',
    }),
    path: z.string(),
    side: z.enum(['base', 'source']),
    startLine: z.number().int(),
    endLine: z.number().int(),
    snippet: z.string(),
    blobSha: z.string().nullable(),
    status: z.enum(['open', 'resolved', 'detached']),
    pending: z.boolean(),
    origin: z.string().nullable(),
    mrDiscussion: z.string().nullable().optional(),
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
/**
 * What a review's source is called where someone reads it.
 *
 * A working tree is named by the *branch it is on*, because that is what a
 * person knows it by and a branch name is unique within a repository. Calling
 * every one of them "working tree" said only that it was a checkout with
 * uncommitted changes in it — true of all of them, and unable to say that this
 * row is the one you were on last week. It is read live rather than stored, so
 * checking out another branch changes what the row says, which is the point:
 * the review is of that checkout, and the checkout has moved.
 *
 * `branches` maps a worktree path to its branch, from one `git worktree list`
 * per repository. A detached checkout has no branch to give, so it says where
 * its HEAD is instead.
 */
function sourceLabel(
  session: Session,
  repoPath: string | undefined,
  subjects: Map<string, string>,
  branches?: Map<string, { branch: string | null; head: string }>,
): { name: string; subject: string | null } {
  const { source } = session
  if (source.kind === 'worktree') {
    const own = repoPath !== undefined && repoPath === source.value
    const folder = source.value.split('/').at(-1) ?? source.value
    const checkout = branches?.get(source.value)
    // which checkout, when it is not the repository's own
    const where = own ? 'working tree' : `working tree · ${folder}`
    if (checkout?.branch != null && checkout.branch !== '') {
      return { name: checkout.branch, subject: where }
    }
    if (checkout !== undefined) {
      return { name: `detached at ${shortSha(checkout.head)}`, subject: where }
    }
    return { name: own ? 'working tree' : `worktree ${folder}`, subject: null }
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
    subject: z.enum(['note', 'review', 'file', 'repo']),
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
        defaultBranch: z.string(),
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
  /** the merge-request discussion this note was started from, if it was */
  mrDiscussion: z.string().optional(),
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

/**
 * Who a caller says it is, on the routes that change something and cannot tell
 * from the request itself. Optional, so nothing that worked before breaks —
 * and when it is missing the change is recorded with no actor at all, because a
 * name stickie guessed at is worse than an honest blank.
 */
const actor_query = z.object({
  author: z.enum(['user', 'agent']).optional(),
  actor: z.string().max(64).optional(),
})

const id_param = z.object({ id: z.coerce.number().int() })

/**
 * A note addressed the way a review talks about it: which review, and which
 * note inside it. Both ways in stay open — the row id because permalinks and
 * older adapters carry it, the number because it is the one a person reads and
 * the one the export and the MCP tools hand an agent.
 */
const note_param = z.object({
  id: z.coerce.number().int(),
  number: z.coerce.number().int().min(0),
})

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

/**
 * When a review's base moves on, who moves the pin. Automatic by default: an
 * agent committing mid-review is the normal case, and stopping to press a
 * button for it is friction. `when-clear` is the cautious reading — moving the
 * base can leave a note without its code, so hold off while notes are open.
 */
/** Reported to MCP clients as the server's own version. */
const mcp_version = '0.1.0'

const repin_modes = ['always', 'when-clear', 'never'] as const
const default_repin_mode = 'always'

/**
 * What removing a repository does to the reviews in it. Deleting is the
 * default: a repository is removed because it is finished with, and a workspace
 * quietly keeping every review of every repository ever added is its own kind
 * of mess. `unregister` is for when the notes matter more than the tidiness —
 * it keeps them, and re-adding the path brings them back.
 */
const remove_modes = ['delete', 'unregister'] as const
const default_remove_mode = 'delete'

/**
 * Which keystroke posts a comment. Enter by default — a note is usually one
 * sentence, and reaching for a modifier to send it is friction on the thing
 * this tool exists to do.
 */
const submit_keys = ['enter', 'mod-enter'] as const
const default_submit_key = 'enter'

/**
 * Whether a new note joins the review batch or goes to the agent at once.
 * Draft by default, which is what stickie has always done and the reason the
 * batch exists — an agent should get a finished review, not a stream.
 */
const note_defaults = ['draft', 'comment'] as const
const default_note_default = 'draft'

/**
 * Where a resolved note goes. `folded` keeps it in the diff as one line that
 * can be opened; `gutter` takes it out of the flow of the code entirely and
 * marks its line, so a file that has been worked through reads as code again.
 */
const resolved_notes_modes = ['folded', 'gutter'] as const
const default_resolved_notes = 'folded'

// extensions whose files open soft-wrapped; prose and data, not code
const default_wrap_extensions = 'md,markdown,txt,rst,csv,log,json'

/**
 * Files that open folded in the diff: machine-written, enormous, and read only
 * to check that they changed at all. One name or suffix per entry, matched
 * against the file name — a lockfile is not a file anyone reads line by line,
 * and twenty thousand lines of it between two source files is the whole review
 * scrolled past.
 */
const default_collapsed_files =
  'uv.lock,poetry.lock,package-lock.json,pnpm-lock.yaml,yarn.lock,Cargo.lock,' +
  'go.sum,Gemfile.lock,composer.lock,.min.js,.min.css,.snap'

/** An unknown or unset stored value falls back to the default. */
function repinMode(stored: string | null): (typeof repin_modes)[number] {
  return repin_modes.find((mode) => mode === stored) ?? default_repin_mode
}

function submitKey(stored: string | null): (typeof submit_keys)[number] {
  return submit_keys.find((key) => key === stored) ?? default_submit_key
}

function removeMode(stored: string | null): (typeof remove_modes)[number] {
  return remove_modes.find((mode) => mode === stored) ?? default_remove_mode
}

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
   * What a caller claimed, or nothing. These routes used to record the person
   * at this machine whoever asked, which quietly credited them with every note
   * an agent resolved and every export an agent pulled for itself.
   */
  const claimedActor = async (
    query: { author?: Author; actor?: string },
    repoPath: string | null,
  ): Promise<number | null> =>
    query.author === undefined
      ? null
      : actorFor(query.author, query.actor, repoPath)

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
      request: { body: json_body(repo_body), query: actor_query },
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
      const before = await store.repoByPath(root)
      const repo = await store.addRepo(root)
      // when it actually joined the workspace, which is a new path or one
      // coming back from being unregistered. This route is idempotent and the
      // client calls it whenever a path is typed in, so most calls record
      // nothing
      const entered = before === undefined || before.removed_at !== null
      if (entered) {
        await record({
          subject: 'repo',
          action: 'added',
          actorId: await claimedActor(c.req.valid('query'), root),
          repoId: repo.id,
          detail: { path: root },
        })
      }
      return c.json(repo, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/repos/{id}',
      tags: ['repos'],
      summary: 'Take a repository out of the workspace',
      description:
        '`mode=delete` deletes its reviews, notes and replies with it; ' +
        '`unregister` keeps them, and adding the same path back brings them ' +
        'again. Without a mode the setting decides. A repository with no ' +
        'notes is deleted either way — there is nothing to keep. What it did ' +
        'is recorded, including how many notes went with it.',
      request: {
        params: id_param,
        query: actor_query.extend({
          mode: z.enum(remove_modes).optional(),
        }),
      },
      responses: {
        200: json_response(
          z.object({
            ok: z.boolean(),
            deleted: z.boolean(),
            notes: z.number().int(),
          }),
          'Removed',
        ),
        404: not_found,
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param')
      const query = c.req.valid('query')
      const repo = await store.getRepo(id)
      if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)
      const mode =
        query.mode ?? removeMode(await store.getSetting('repo_remove_mode'))
      const { deleted, notes } = await store.removeRepo(id, mode)
      // it is out of the workspace either way, so stop following its files
      hub.forget(repo.path)
      // the record outlives what it points at: after a delete this row is the
      // only thing left saying those reviews and notes were ever here
      await record({
        subject: 'repo',
        action: deleted ? 'removed' : 'unregistered',
        actorId: await claimedActor(query, repo.path),
        repoId: id,
        detail: { path: repo.path, notes },
      })
      return c.json({ ok: true, deleted, notes }, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/repos/{id}/ancestor',
      tags: ['repos'],
      summary: 'Whether one ref is in another ref\'s history',
      description:
        'Asked before a review is left for another one: if the notes were ' +
        'written against something the new ref already contains, their code ' +
        'is still there and nothing needs saying. A ref that cannot be ' +
        'resolved answers false — "cannot tell" and "no" lead to the same ' +
        'question being asked.',
      request: {
        params: id_param,
        query: z.object({ older: z.string().min(1), newer: z.string().min(1) }),
      },
      responses: {
        200: json_response(
          z.object({ ancestor: z.boolean() }),
          'Whether older is in newer',
        ),
        404: not_found,
      },
    }),
    async (c) => {
      const repo = await store.getRepo(c.req.valid('param').id)
      if (repo === undefined) return c.json({ error: 'unknown repo' }, 404)
      const { older, newer } = c.req.valid('query')
      return c.json(
        { ancestor: await isAncestor(repo.path, older, newer) },
        200,
      )
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
        'source is a worktree working tree or a ref. Without baseRef the base ' +
        'is the merge-base with the default branch — what a merge request ' +
        'compares — for a worktree as well as for a ref, falling back to HEAD ' +
        'when the default branch shares no history. Pass `HEAD` for the ' +
        'uncommitted work on its own. Whatever it resolves to is pinned as ' +
        'baseSha at creation.',
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

      const source = body.source
      const source_there =
        source.kind === 'worktree'
          ? (await listWorktrees(repo.path)).some(
              (wt) => wt.path === source.value,
            )
          : await resolveRef(repo.path, source.value).then(
              () => true,
              () => false,
            )
      if (!source_there) {
        /*
         * A review outlives the source it is of. A branch is merged and
         * deleted, a worktree is removed, and the notes written on it are
         * still about work that was really done — so the review opens, empty,
         * and says what happened to it (`sourceGone`). Refusing it is what
         * made a finished branch's review unreachable, and left the workspace
         * showing a review of whatever is checked out now instead, which is a
         * review of something nobody asked to review.
         *
         * A source that never had a review is still refused. There is nothing
         * there to read, and making a review of it would only record the
         * mistake.
         */
        const existing = await store.getSessionBySource(
          repo.id,
          source,
          body.baseRef,
        )
        if (existing !== undefined) {
          return c.json({ ...existing, ...(await reviewState(existing)) }, 200)
        }
        return c.json(
          {
            error:
              source.kind === 'worktree'
                ? `not a worktree of this repo: ${source.value}`
                : `not a ref in this repo: ${source.value}`,
          },
          400,
        )
      }

      // what the review *is*. A worktree is asked what it has checked out; a
      // ref names its own branch. A detached checkout has no branch, and there
      // is nothing to key a review on — reviewing a bare commit is what the
      // commits tab is for, so it is refused rather than given an identity it
      // cannot keep.
      const branch =
        body.source.kind === 'worktree'
          ? (await gitStatus(body.source.value)).branch
          : body.source.value
      if (
        body.source.kind === 'worktree' &&
        (branch === '' || branch === '(detached)')
      ) {
        return c.json(
          {
            error:
              'this working tree has no branch checked out; a review is of a branch. Check one out, or open the commit from the commits list.',
          },
          400,
        )
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

      let session = await store.getOrCreateSession(
        repo.id,
        branch,
        body.source,
        base_ref,
        base_sha,
      )
      // an explicit base on a review that already exists moves it: the base is
      // a lens on this branch's work, not a second review of it. Without one,
      // the review keeps the base it is on rather than being dragged back to
      // the default every time the client opens it.
      if (body.baseRef !== undefined && session.baseRef !== base_ref) {
        await store.slideBase(session.id, base_ref, base_sha)
        await record({
          subject: 'review',
          action: 'repinned',
          actorId: (await identity.human(repo.path)).actor.id,
          repoId: repo.id,
          sessionId: session.id,
          detail: { from: session.baseRef, baseRef: base_ref, baseSha: base_sha },
        })
        session = (await store.getSession(session.id)) ?? session
      }
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
      // an existing review comes back with the base it is pinned to, which may
      // have been left behind since; saying so here is what lets a fresh load
      // offer the re-pin rather than waiting for the next file change
      return c.json({ ...session, ...(await reviewState(session)) }, 200)
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
      return c.json({ ...session, ...(await reviewState(session)) }, 200)
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
      request: {
        params: id_param,
        query: z.object({ automatic: flag_query }),
      },
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
      // both asked at once: a re-pin answers with the review as it now stands,
      // and the branch being gone is as much a part of that as the base is
      const [pin, source] = await Promise.all([
        basePin(session),
        sourceState(session),
      ])
      const state = { sourceGone: source.gone, merged: source.merged }
      const current = pin.next
      if (current === null) {
        return c.json(
          { ...session, ...state, baseStale: false, baseDiverged: false },
          200,
        )
      }
      /*
       * A base that would move backwards is not this review moving on, and the
       * setting is not permission to be pointed at another line of history:
       * the automatic path stops here and the banner says why. A reviewer who
       * asks for it by hand still gets it — with their notes' code gone from
       * under them, which the client warns about before asking for this.
       */
      if (pin.diverged && c.req.valid('query').automatic === true) {
        return c.json(
          { ...session, ...state, baseStale: false, baseDiverged: true },
          200,
        )
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
        detail: {
          fromBaseSha: session.baseSha,
          toBaseSha: current,
          // a pin the reviewer moved and one the setting moved for them are
          // different facts about who was watching
          automatic: c.req.valid('query').automatic === true,
          // and a pin that moved off the line it was on is a third
          ...(pin.diverged ? { diverged: true } : {}),
        },
      })
      return c.json(
        {
          ...session,
          ...state,
          baseSha: current,
          baseStale: false,
          baseDiverged: false,
        },
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/base/undo',
      tags: ['sessions'],
      summary: 'Put the base back where it was before the last move',
      description:
        'One step, not a history: the base is a lens on this branch and this ' +
        'undoes the last time it was moved. Undoing twice returns to where ' +
        'you started.',
      request: { params: id_param },
      responses: {
        200: json_response(session_schema, 'The session, on its previous base'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const before = await store.getSession(c.req.valid('param').id)
      if (before === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      if (before.prevBaseRef == null) {
        return c.json({ error: 'this base has not been moved' }, 400)
      }
      const session = await store.undoBase(before.id)
      if (session === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      await record({
        subject: 'review',
        action: 'repinned',
        actorId: (await identity.human(session.repoPath)).actor.id,
        repoId: session.repoId,
        sessionId: session.id,
        detail: {
          from: before.baseRef,
          baseRef: session.baseRef,
          baseSha: session.baseSha,
          undo: true,
        },
      })
      return c.json({ ...session, ...(await reviewState(session)) }, 200)
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
      // A review whose worktree has been removed has no diff to read, and git
      // says so by failing on a directory that is not there. That is not an
      // error the reviewer can act on: the review still opens, empty, and
      // `sourceGone` on the session is what explains it.
      const changed = await changedFiles(
        session.repoPath,
        session.source,
        session.baseSha,
      ).catch(async (error: unknown) => {
        if ((await sourceState(session)).gone) return []
        throw error
      })
      return c.json(changed, 200)
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
        'many notes are waiting on it. `repo` and `branch` match loosely — a ' +
        'substring of the path, the name or the branch — because the caller ' +
        'knows where it is without knowing which of those the server would ' +
        'compare. `format=markdown` answers in text instead of JSON.',
      request: {
        query: z.object({
          repo: z.string().optional(),
          branch: z.string().optional(),
          with_notes: flag_query,
          format: z.enum(['json', 'markdown']).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: z.array(session_schema.extend({ openNotes: z.number().int() })),
            },
            'text/plain': { schema: z.string() },
          },
          description: 'Sessions',
        },
      },
    }),
    async (c) => {
      const { repo, branch, with_notes, format } = c.req.valid('query')
      const sessions = await store.listSessions()
      const listed: ReviewListing[] = []
      for (const session of sessions) {
        listed.push({
          session,
          openNotes: await store.countOpenThreads(session.id),
        })
      }
      const wanted = filterReviews(listed, {
        ...(repo === undefined ? {} : { repo }),
        ...(branch === undefined ? {} : { branch }),
        ...(with_notes === true ? { withNotes: true } : {}),
      })
      if (format === 'markdown') return c.text(renderReviewList(wanted))
      return c.json(
        wanted.map(({ session, openNotes }) => ({ ...session, openNotes })),
        200,
      )
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

      // one `git worktree list` per repository, not per review: a working tree
      // review is named by the branch it is on, and every checkout of a
      // repository comes back in the one call
      const checkouts = new Map<
        number,
        Map<string, { branch: string | null; head: string }>
      >()
      await Promise.all(
        repos.map(async (repo) => {
          const trees = await listWorktrees(repo.path).catch(() => [])
          checkouts.set(
            repo.id,
            new Map(
              trees.map((tree) => [
                tree.path,
                { branch: tree.branch, head: tree.head },
              ]),
            ),
          )
        }),
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
              const [status, default_branch] = await Promise.all([
                gitStatus(repo.path),
                defaultBranch(repo.path),
              ])
              return {
                id: repo.id,
                name: names.get(repo.id) ?? repo.path,
                path: repo.path,
                branch: status.branch,
                clean: status.clean,
                changedFiles: status.changedFiles,
                latestSessionId: latest.get(repo.id) ?? null,
                defaultBranch: default_branch,
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
                source: sourceLabel(
                  session,
                  repo?.path,
                  known,
                  checkouts.get(session.repoId),
                ),
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
          {
            pending: body.pending ?? body.author === 'user',
            actorId,
            ...(body.mrDiscussion === undefined
              ? {}
              : { mrDiscussion: body.mrDiscussion }),
          },
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
        {
          pending: body.pending ?? body.author === 'user',
          actorId,
          ...(body.mrDiscussion === undefined
            ? {}
            : { mrDiscussion: body.mrDiscussion }),
        },
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
      method: 'get',
      path: '/api/threads/{id}',
      tags: ['threads'],
      summary: 'One note by id, re-anchored to where its code is now',
      description:
        'A note id is global, so this needs no review: it answers which one ' +
        'the note belongs to. Lines are re-anchored first, so the answer is ' +
        'where the code is now rather than where it was written.',
      request: { params: id_param },
      responses: {
        200: json_response(thread_schema, 'The note'),
        404: not_found,
      },
    }),
    async (c) => {
      const thread = await store.getThread(c.req.valid('param').id)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      const session = await store.getSession(thread.sessionId)
      if (session === undefined) return c.json({ error: 'unknown thread' }, 404)
      const [current] = await reanchorThreads(store, session, [thread])
      return c.json(current ?? thread, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/reviews/{id}/notes/{number}',
      tags: ['threads'],
      summary: 'One note by its number in the review, re-anchored',
      description:
        'What a note link resolves through: the answer says where the code is ' +
        'now, not the lines the note was written against.',
      request: { params: note_param },
      responses: {
        200: json_response(thread_schema, 'The note'),
        404: not_found,
      },
    }),
    async (c) => {
      const { id, number } = c.req.valid('param')
      const session = await store.getSession(id)
      if (session === undefined) {
        return c.json({ error: 'unknown review' }, 404)
      }
      const thread = await store.getThreadByNumber(id, number)
      if (thread === undefined) {
        return c.json(
          { error: `no note ${String(number)} in review ${String(id)}` },
          404,
        )
      }
      const [current] = await reanchorThreads(store, session, [thread])
      return c.json(current ?? thread, 200)
    },
  )

  /**
   * Both note routes end here, so the two ways of naming a note cannot come to
   * behave differently. Returns undefined only if the note went away under it.
   */
  const addReply = async (
    thread: Thread,
    body: z.infer<typeof message_body>,
  ): Promise<Thread | undefined> => {
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
    if (updated === undefined) return undefined
    await noteRecord('replied', owner ?? thread.sessionId, thread.id, actorId, {
      author: body.author,
    })
    return updated
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/threads/{id}/reply',
      tags: ['threads'],
      summary: 'Add a reply to a note, by row id',
      request: { params: id_param, body: json_body(message_body) },
      responses: {
        200: json_response(thread_schema, 'Updated thread'),
        404: not_found,
      },
    }),
    async (c) => {
      const thread = await store.getThread(c.req.valid('param').id)
      if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
      const updated = await addReply(thread, c.req.valid('json'))
      if (updated === undefined) return c.json({ error: 'unknown thread' }, 404)
      return c.json(updated, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/reviews/{id}/notes/{number}/reply',
      tags: ['threads'],
      summary: 'Add a reply to a note, by its number in the review',
      description:
        'Notes are numbered from 0 within a review and numbers are never ' +
        'reused, so a number no note holds is a 404 rather than the next note ' +
        'along. `id` is the review — a session id, as `list_reviews` returns.',
      request: { params: note_param, body: json_body(message_body) },
      responses: {
        200: json_response(thread_schema, 'Updated note'),
        404: not_found,
      },
    }),
    async (c) => {
      const { id, number } = c.req.valid('param')
      const thread = await store.getThreadByNumber(id, number)
      if (thread === undefined) {
        return c.json(
          { error: `no note ${String(number)} in review ${String(id)}` },
          404,
        )
      }
      const updated = await addReply(thread, c.req.valid('json'))
      if (updated === undefined) return c.json({ error: 'unknown note' }, 404)
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
      request: { params: id_param, query: actor_query },
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
      const owner = await store.getSession(thread.sessionId)
      await noteRecord(
        'deleted',
        owner ?? thread.sessionId,
        thread.id,
        await claimedActor(c.req.valid('query'), owner?.repoPath ?? null),
        {
          path: thread.path,
          startLine: thread.startLine,
          endLine: thread.endLine,
          messages: thread.messages.length,
        },
      )
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

  const status_description =
    'Say who with `author` (and `actor` for an agent): an agent resolving ' +
    'its own work and a human accepting it are different facts, and ' +
    'without them the record says neither.'

  /**
   * Resolving takes a note whatever state it is in, `detached` included: a note
   * whose code has gone still counts as unresolved everywhere it is counted,
   * and every export carries it until somebody closes it.
   */
  const changeStatus = async (
    thread: Thread,
    action: 'resolve' | 'reopen',
    who: z.infer<typeof actor_query>,
  ): Promise<Thread | undefined> => {
    await store.setThreadStatus(
      thread.id,
      action === 'resolve' ? 'resolved' : 'open',
    )
    const updated = await store.getThread(thread.id)
    if (updated === undefined) return undefined
    const owner = await store.getSession(thread.sessionId)
    await noteRecord(
      action === 'resolve' ? 'resolved' : 'reopened',
      owner ?? thread.sessionId,
      thread.id,
      await claimedActor(who, owner?.repoPath ?? null),
      { path: thread.path },
    )
    return updated
  }

  for (const action of ['resolve', 'reopen'] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/api/threads/{id}/${action}`,
        tags: ['threads'],
        summary:
          action === 'resolve'
            ? 'Resolve a note, by row id'
            : 'Reopen a note, by row id',
        description: status_description,
        request: { params: id_param, query: actor_query },
        responses: {
          200: json_response(thread_schema, 'Updated thread'),
          404: not_found,
        },
      }),
      async (c) => {
        const thread = await store.getThread(c.req.valid('param').id)
        if (thread === undefined) return c.json({ error: 'unknown thread' }, 404)
        const updated = await changeStatus(thread, action, c.req.valid('query'))
        if (updated === undefined) return c.json({ error: 'unknown thread' }, 404)
        return c.json(updated, 200)
      },
    )

    app.openapi(
      createRoute({
        method: 'post',
        path: `/api/reviews/{id}/notes/{number}/${action}`,
        tags: ['threads'],
        summary:
          action === 'resolve'
            ? 'Resolve a note, by its number in the review'
            : 'Reopen a note, by its number in the review',
        description: status_description,
        request: { params: note_param, query: actor_query },
        responses: {
          200: json_response(thread_schema, 'Updated note'),
          404: not_found,
        },
      }),
      async (c) => {
        const { id, number } = c.req.valid('param')
        const thread = await store.getThreadByNumber(id, number)
        if (thread === undefined) {
          return c.json(
            { error: `no note ${String(number)} in review ${String(id)}` },
            404,
          )
        }
        const updated = await changeStatus(thread, action, c.req.valid('query'))
        if (updated === undefined) return c.json({ error: 'unknown note' }, 404)
        return c.json(updated, 200)
      },
    )
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
        'thread ids first, in that order; the rest follow by age. ' +
        '`include_resolved` adds the notes already answered, for revisiting ' +
        'one rather than working through what is outstanding.',
      request: {
        params: id_param,
        query: actor_query.extend({
          order: z.string().optional(),
          include_pending: flag_query,
          include_resolved: flag_query,
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
      const { order, include_pending, include_resolved } = c.req.valid('query')
      const with_pending = include_pending !== false
      const with_resolved = include_resolved === true
      const unresolved = (
        await reanchorThreads(store, session, await store.listThreads(session.id))
      ).filter(
        (t) =>
          (with_resolved || t.status !== 'resolved') &&
          (with_pending || !t.pending),
      )
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
      // reading the notes out is part of the oversight story either way, but
      // a human handing them over and an agent fetching them for itself are
      // not the same event, so this records whoever said they were asking
      await record({
        subject: 'review',
        action: 'exported',
        actorId: await claimedActor(c.req.valid('query'), session.repoPath),
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
      request: { params: id_param, query: actor_query },
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
          actorId: await claimedActor(c.req.valid('query'), session.repoPath),
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
      request: { params: id_param, query: actor_query },
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
      const owner = await store.getSession(thread.sessionId)
      await noteRecord(
        'posted',
        owner ?? thread.sessionId,
        thread.id,
        await claimedActor(c.req.valid('query'), owner?.repoPath ?? null),
        { path: thread.path },
      )
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
        query: actor_query,
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
        actorId: await claimedActor(c.req.valid('query'), session.repoPath),
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

  /**
   * MCP over HTTP, at /mcp — the same tools the stdio bridge exposes, without
   * a bridge process. Clients that speak streamable HTTP point straight at a
   * running stickie; `stickie-mcp` stays for the ones that only speak stdio.
   *
   * The calls the tools make are dispatched against this app rather than sent
   * back over the loopback, so serving MCP costs no second request and works
   * whatever host or port the server was given.
   */
  const localFetcher: Fetcher = async (call) => {
    const response = await app.request(call.path, {
      method: call.method,
      ...(call.body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(call.body),
          }),
    })
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    }
  }

  app.post('/mcp', async (c) => {
    const answer = await handleMessage(
      await c.req.text(),
      localFetcher,
      mcp_version,
    )
    // a notification carries no id and expects no answer
    if (answer === null) return c.body(null, 202)
    return c.body(answer, 200, { 'content-type': 'application/json' })
  })

  // the spec's other half is a server-initiated SSE stream; stickie has no
  // unsolicited messages to send, and saying so is better than a dead socket
  app.get('/mcp', (c) =>
    c.json(
      { error: 'stickie serves MCP over POST only; it sends nothing unprompted' },
      405,
    ),
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
            collapsedFiles: z.string(),
            defaultCollapsedFiles: z.string(),
            /** the command that points an MCP client at this server */
            mcpCommand: z.string(),
            /** who moves a review's base pin when it goes stale */
            repinMode: z.enum(repin_modes),
            /** what removing a repository does to the reviews in it */
            removeMode: z.enum(remove_modes),
            /** which keystroke posts a comment */
            submitKey: z.enum(submit_keys),
            /** whether a new note is a draft or goes straight to the agent */
            noteDefault: z.enum(note_defaults),
            resolvedNotes: z.enum(resolved_notes_modes),
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
      const stored_note_default = await store.getSetting('note_default')
      const stored_resolved_notes = await store.getSetting('resolved_notes')
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
          collapsedFiles:
            (await store.getSetting('collapsed_files')) ??
            default_collapsed_files,
          defaultCollapsedFiles: default_collapsed_files,
          mcpCommand: mcpCommand(),
          repinMode: repinMode(await store.getSetting('repin_mode')),
          removeMode: removeMode(await store.getSetting('repo_remove_mode')),
          submitKey: submitKey(await store.getSetting('submit_key')),
          noteDefault:
            note_defaults.find(
              (value) => value === stored_note_default,
            ) ?? default_note_default,
          resolvedNotes:
            resolved_notes_modes.find(
              (value) => value === stored_resolved_notes,
            ) ?? default_resolved_notes,
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
            collapsedFiles: z.string().optional(),
            /** a postgres url, or '' to go back to the local sqlite file */
            databaseUrl: z.string().optional(),
            /** '' falls back to git config */
            actorName: z.string().max(64).optional(),
            repinMode: z.enum(repin_modes).optional(),
            removeMode: z.enum(remove_modes).optional(),
            submitKey: z.enum(submit_keys).optional(),
            noteDefault: z.enum(note_defaults).optional(),
            resolvedNotes: z.enum(resolved_notes_modes).optional(),
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
      if (body.collapsedFiles !== undefined) {
        await store.setSetting('collapsed_files', body.collapsedFiles.trim())
      }
      if (body.repinMode !== undefined) {
        await store.setSetting('repin_mode', body.repinMode)
      }
      if (body.removeMode !== undefined) {
        await store.setSetting('repo_remove_mode', body.removeMode)
      }
      if (body.submitKey !== undefined) {
        await store.setSetting('submit_key', body.submitKey)
      }
      if (body.resolvedNotes !== undefined) {
        await store.setSetting('resolved_notes', body.resolvedNotes)
      }
      if (body.noteDefault !== undefined) {
        await store.setSetting('note_default', body.noteDefault)
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

  /**
   * Shared by every merge-request route: the review, a usable GitLab config,
   * and the project its origin remote names. Each of the three failures has a
   * different fix, so each says which one it is.
   */
  async function mrContext(sessionId: number): Promise<
    | { ok: true; session: Session; config: GitLabConfig; project: string }
    | { ok: false; status: 400 | 404; error: string }
  > {
    const session = await store.getSession(sessionId)
    if (session === undefined) {
      return { ok: false, status: 404, error: 'unknown session' }
    }
    const config = gitlabConfig(await gitlabSettings())
    if (config === null) {
      return {
        ok: false,
        status: 400,
        error:
          'no GitLab token configured — set one in Settings → GitLab, or export GITLAB_TOKEN',
      }
    }
    const project =
      session.mr?.projectPath ??
      (await (async () => {
        const remote = await gitOrigin(sourceRoot(session))
        return remote === null ? null : projectFromRemote(remote)
      })())
    if (project === null) {
      return {
        ok: false,
        status: 400,
        error: 'could not work out the GitLab project from the origin remote',
      }
    }
    return { ok: true, session, config, project }
  }

  const mr_thread_schema = z
    .object({
      id: z.string(),
      path: z.string().nullable(),
      side: z.enum(['base', 'source']),
      line: z.number().int().nullable(),
      resolved: z.boolean(),
      resolvable: z.boolean(),
      messages: z.array(
        z.object({
          author: z.string(),
          body: z.string(),
          createdAt: z.string().nullable(),
        }),
      ),
    })
    .openapi('MrThread')

  const mr_schema = z
    .object({
      iid: z.number().int(),
      projectPath: z.string(),
      title: z.string(),
      webUrl: z.string(),
      sourceBranch: z.string(),
      targetBranch: z.string(),
      state: z.string(),
    })
    .openapi('MergeRequest')

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/mr/candidate',
      tags: ['merge requests'],
      summary: 'The open merge request for this review\'s branch, if there is one',
      description:
        'Looked up by source branch and narrowed by the base ref, so a branch ' +
        'with more than one open MR answers with the one this review reads ' +
        'against. Nothing is attached by this — it only says what there is to ' +
        'attach.',
      request: { params: id_param },
      responses: {
        200: json_response(
          z.object({ candidate: mr_schema.nullable() }),
          'The merge request on offer',
        ),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const context = await mrContext(c.req.valid('param').id)
      if (!context.ok) {
        return c.json({ error: context.error }, context.status)
      }
      const { session, config, project } = context
      if (session.branch === '') return c.json({ candidate: null }, 200)
      try {
        const candidate = await findOpenMr(
          config,
          project,
          session.branch,
          session.baseRef === 'HEAD' ? null : session.baseRef,
        )
        return c.json({ candidate }, 200)
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/sessions/{id}/mr',
      tags: ['merge requests'],
      summary: 'Attach a merge request to this review, or take one off',
      description:
        'One per review: a review is of one branch, and a branch\'s work is ' +
        'one merge request. Attaching reads nothing in — the discussion stays ' +
        'on GitLab and is shown from there.',
      request: {
        params: id_param,
        body: json_body(z.object({ iid: z.number().int().nullable() })),
      },
      responses: {
        200: json_response(session_schema, 'The review, with its MR'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const context = await mrContext(c.req.valid('param').id)
      if (!context.ok) {
        return c.json({ error: context.error }, context.status)
      }
      const { session, config, project } = context
      const { iid } = c.req.valid('json')
      if (iid === null) {
        await store.setReviewMr(session.id, null)
        await record({
          subject: 'review',
          action: 'mr-detached',
          actorId: (await identity.human(session.repoPath)).actor.id,
          repoId: session.repoId,
          sessionId: session.id,
          detail: { project, mr: session.mr?.iid ?? null },
        })
      } else {
        let found
        try {
          found = await fetchMr(config, project, iid)
        } catch (error) {
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
        if (found === null) {
          return c.json({ error: `no merge request !${String(iid)} in ${project}` }, 400)
        }
        await store.setReviewMr(session.id, {
          iid: found.iid,
          projectPath: found.projectPath,
        })
        await record({
          subject: 'review',
          action: 'mr-attached',
          actorId: (await identity.human(session.repoPath)).actor.id,
          repoId: session.repoId,
          sessionId: session.id,
          detail: { project: found.projectPath, mr: found.iid, title: found.title },
        })
      }
      const fresh = await store.getSession(session.id)
      if (fresh === undefined) {
        return c.json({ error: 'unknown session' }, 404)
      }
      return c.json(
        { ...fresh, ...(await reviewState(fresh)) },
        200,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/sessions/{id}/mr/threads',
      tags: ['merge requests'],
      summary: 'The attached merge request\'s discussions, read from GitLab',
      description:
        'Read live rather than copied: the merge request is where that ' +
        'conversation lives, and a copy of it here would go stale the moment ' +
        'anyone replied on either side.',
      request: { params: id_param },
      responses: {
        200: json_response(
          z.object({ mr: mr_schema.nullable(), threads: z.array(mr_thread_schema) }),
          'The discussions',
        ),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const context = await mrContext(c.req.valid('param').id)
      if (!context.ok) {
        return c.json({ error: context.error }, context.status)
      }
      const { session, config, project } = context
      try {
        // attached, or merely the open one for this branch: the discussion is
        // read either way, since it exists and saying so costs nothing.
        // Attaching is what lets a *note* be tied to a discussion, and that is
        // asked for when a note is started rather than before anything is read
        const mr =
          session.mr == null
            ? await findOpenMr(
                config,
                project,
                session.branch,
                session.baseRef === 'HEAD' ? null : session.baseRef,
              )
            : await fetchMr(config, project, session.mr.iid)
        if (mr === null) return c.json({ mr: null, threads: [] }, 200)
        return c.json(
          { mr, threads: await fetchMrThreads(config, project, mr.iid) },
          200,
        )
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/sessions/{id}/mr/threads/{discussion}/reply',
      tags: ['merge requests'],
      summary: 'Reply to a merge-request discussion, on GitLab',
      description:
        'The reply is posted to the merge request, signed so that whoever ' +
        'reads it there knows it came through stickie and whether a person or an ' +
        'agent wrote it.',
      request: {
        params: z.object({
          id: z.coerce.number().int(),
          discussion: z.string(),
        }),
        query: actor_query,
        body: json_body(z.object({ body: z.string().min(1) })),
      },
      responses: {
        200: json_response(z.object({ ok: z.boolean() }), 'Posted'),
        400: bad_request,
        404: not_found,
      },
    }),
    async (c) => {
      const context = await mrContext(c.req.valid('param').id)
      if (!context.ok) {
        return c.json({ error: context.error }, context.status)
      }
      const { session, config, project } = context
      // the same fallback the threads route makes: what is being replied to is
      // whatever discussion was read, attached or merely found
      const target =
        session.mr?.iid ??
        (
          await findOpenMr(
            config,
            project,
            session.branch,
            session.baseRef === 'HEAD' ? null : session.baseRef,
          ).catch(() => null)
        )?.iid
      if (target === undefined) {
        return c.json({ error: 'no merge request for this review' }, 400)
      }
      // an unsigned reply reads as the repository owner's, and a reply that
      // reaches the MR is read by people who were not here
      const { actor } = c.req.valid('query')
      const author = c.req.valid('query').author ?? 'user'
      const signer =
        author === 'agent'
          ? await identity.agent(actor)
          : (await identity.human(session.repoPath)).actor
      try {
        await replyToMrThread(
          config,
          project,
          target,
          c.req.valid('param').discussion,
          signReply(c.req.valid('json').body, author, signer.name),
        )
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
      await record({
        subject: 'review',
        action: 'mr-replied',
        actorId: signer.id,
        repoId: session.repoId,
        sessionId: session.id,
        detail: { project, mr: target, discussion: c.req.valid('param').discussion },
      })
      return c.json({ ok: true }, 200)
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
