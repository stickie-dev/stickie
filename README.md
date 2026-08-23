# stickie

**N**ot another **E**ditor — **N**otes for **A**gents.

A local, read-only review surface for changes made by coding agents. Open a
GitHub-style diff of any repo in your workspace — working tree, branch, or
worktree — and leave line-anchored notes anywhere, including on unchanged
code. Agents fetch the open notes over a plain JSON API, address them,
reply, and resolve. Stickie never writes to your working tree; the notes are
the only output.

## Features

- **Continuous review flow** — every changed file stacked in one scroll
  (GitLab-style), sections mounting as they approach the viewport; or open
  any file on its own
- **Monaco diff review** — side-by-side or inline, full syntax highlighting,
  built from full file contents so every line is commentable, not just hunks
- **Tabs** — a persistent diff tab per repo that resumes its scroll position,
  a commit tab, and closable file tabs; file names carry only as much path as
  it takes to tell two of them apart, whatever does not fit moves into a
  dropdown rather than off the side, and the whole set comes back after a
  reload
- **Status bar** — the current path as clickable segments: each one opens
  what sits beside it (folders and files at that level) or copies the path,
  beside the review's tally — files changed, viewed, unresolved, pending
- **Nothing lost on reload** — open tabs, viewed files, scroll position and
  half-written notes all come back
- **Comment anywhere** — changed lines, unchanged lines, untouched files
  (the *All files* tab), base or source side, single lines or ranges, or no
  code at all: notes on a whole file or on the review itself
- **Review targets** — source is any worktree's working tree or any branch;
  base defaults to HEAD (worktrees) or the merge-base with the default
  branch (branches), pinned at session creation
- **Live refresh** — file watching pushes updates over a websocket while the
  agent edits; the diff, note positions, and counters follow along, and notes
  the agent posts, answers, or resolves appear without a reload
- **Re-anchoring** — notes store the code snippet they were written against
  and re-locate themselves after edits; a note whose code vanished turns
  `detached` instead of pointing at the wrong line
- **Agent loop** — open notes via REST or MCP (`stickie-mcp`, five tools over
  the same routes), agent replies and resolves; or the zero-integration
  *Copy prompt* export — markdown, language-tagged code fences, in an order
  you can arrange — for pasting into anything
- **Comments panel** — every note in the session in one list, in posting
  order, scrolling to new arrivals; notes still being written stay editable
  here while you browse elsewhere for references, and *prompt order* lets you
  arrange what *Copy prompt* emits
- **Multi-repo workspace** — every registered repository lives in one
  project tree (PyCharm attach-style); click into any repo's files, and
  cross-repo references (`@repo:path:L10`) capture naturally while a note
  is being written
- **Grep-grade navigation** — cmd/ctrl+click jumps to definitions
  (per-language regex heuristics over bundled ripgrep, no indexer daemon);
  right-click *Find usages* opens a hit panel, optionally sweeping every
  registered repo at once for cross-repo blast-radius checks
- **Review batches** — notes are *pending* until you hit Submit review, so
  agents receive a finished review, not a stream; per-note *post now* when
  you want immediacy
- **Commit timeline** — the commits list never moves the review target
  (the pickers do that): a click opens that commit against its parent in its
  own tab, and ⌘/shift+click adds commits as further columns, so one file
  reads left to right through the commits that touched it
- **Session continuity** — when HEAD moves past the pinned base (the agent
  committed), one click re-pins and carries open notes forward
- **Keyboard flow** — j/k files, n/p changes (across the whole flow, not just
  the open file), v viewed, ? for help; viewed files persist per session, and
  open tabs come back after a reload
- **GitLab MR import** — pull unresolved MR diff discussions into a local
  session (`GITLAB_TOKEN` + `GITLAB_URL` env), so agent fixes happen
  locally against real review threads
- **Reference pane + workspace search** — ⌘F searches every registered
  repo; results (and definition/usage hits) open in a read-only pane beside
  the diff, where selections feed refs into the note being written
- **Reading comfort** — light and dark themes built for diffs, soft wrap by
  file type (settings) or per file (header button, right-click menu), and
  width rulers at 80/100/120 on anything unwrapped
- **Settings** — GitLab instance and token resolution, the instruction block
  *Copy prompt* appends, which file types wrap, and the theme

## Run

```sh
pnpm install
pnpm build
pnpm start          # serves UI + API on http://localhost:4870
```

`node bin/stickie.js [path] [--port n] [--db file] [--no-open]` additionally
registers a repo (default: cwd) and opens the browser. During development:
`pnpm dev` (client on :5173 proxying to the server on :4870).

`pnpm package` assembles the publishable npm package under `dist-pkg/`, which
carries two binaries: `stickie` (the server) and `stickie-mcp` (the MCP bridge).

The server binds 127.0.0.1 only (`STICKIE_HOST` overrides). The GitLab import
is the only outbound network call and only runs when you trigger it.

## API (agent-facing)

Interactive docs: **http://localhost:4870/api/docs** (Swagger UI); machine
spec at `/api/openapi.json`. The routes are defined with zod schemas, so the
spec is generated from the code and cannot drift.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/repos` | registered repos |
| POST | `/api/repos` | register `{path}` |
| GET | `/api/repos/:id/targets` | worktrees, recent branches, default branch |
| POST | `/api/sessions` | get-or-create `{repoId, source, baseRef?}` |
| GET | `/api/sessions/:id/diff` | changed files |
| GET | `/api/sessions/:id/file?path=&side=` | full file content per side |
| GET | `/api/sessions/:id/threads?status=open` | notes, re-anchored |
| POST | `/api/sessions/:id/threads` | create a note |
| POST | `/api/threads/:id/reply` | `{author, body}` |
| POST | `/api/threads/:id/resolve` · `/reopen` | close / reopen |
| GET | `/api/sessions/:id/prompt` | self-contained markdown export |
| GET | `/api/sessions` | every review, newest first |
| POST | `/api/sessions/:id/submit-review` | post the pending batch |
| GET | `/api/repos/:id/file?path=&rev=` | any file, at any revision |

The table is the agent-facing subset; Swagger lists the whole surface,
including the UI's own routes (navigation, settings, commit files, viewed
state, GitLab import).

## MCP

`stickie-mcp` bridges stdio JSON-RPC to a running stickie server, exposing the
agent routes as five tools:

| Tool | Route | |
| --- | --- | --- |
| `list_reviews` | `GET /api/sessions` | read-only |
| `get_review_notes` | `GET /api/sessions/:id/prompt` | read-only |
| `list_notes` | `GET /api/sessions/:id/threads` | read-only |
| `reply_to_note` | `POST /api/threads/:id/reply` | writes |
| `resolve_note` | `POST /api/threads/:id/resolve` | writes |

```sh
claude mcp add stickie -- node /path/to/stickie/bin/stickie-mcp.js
claude mcp add stickie -- npx -y stickie stickie-mcp          # once published
```

Point it elsewhere with `--url http://host:port` or `STICKIE_URL`; it defaults
to `http://localhost:4870`. The bridge starts nothing — run stickie first.

See [agents/README.md](agents/README.md) for the integration guide and
[agents/claude-code/](agents/claude-code/) for a ready-made Claude Code
skill.

## Layout

- `client/` — Vite + React + Monaco UI
- `server/` — Hono API + static hosting; git via the CLI, SQLite storage
  (`~/.stickie/stickie.sqlite`, override with `STICKIE_DB`)
- `shared/` — types crossing the API boundary, consumed as source
- `agents/` — integration docs and per-agent adapters
