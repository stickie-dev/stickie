# stickie

**N**ot another **E**ditor — **N**otes for **A**gents.

A local, read-only review surface for changes made by coding agents. Open a
GitHub-style diff of any repo in your workspace — working tree, branch, or
worktree — and leave line-anchored notes anywhere, including on unchanged
code. Agents fetch the open notes over a plain JSON API, address them,
reply, and resolve. Stickie never writes to your working tree; the notes are
the only output.

## Features

- **Monaco diff review** — side-by-side or inline, full syntax highlighting,
  built from full file contents so every line is commentable, not just hunks
- **Comment anywhere** — changed lines, unchanged lines, untouched files
  (the *All files* tab), base or source side, single lines or ranges
- **Review targets** — source is any worktree's working tree or any branch;
  base defaults to HEAD (worktrees) or the merge-base with the default
  branch (branches), pinned at session creation
- **Live refresh** — file watching pushes updates over a websocket while the
  agent edits; the diff, note positions, and counters follow along
- **Re-anchoring** — notes store the code snippet they were written against
  and re-locate themselves after edits; a note whose code vanished turns
  `detached` instead of pointing at the wrong line
- **Agent loop** — open notes via REST, agent replies and resolves; or the
  zero-integration *Copy prompt* export for pasting into anything
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
- **Session continuity** — when HEAD moves past the pinned base (the agent
  committed), one click re-pins and carries open notes forward
- **Keyboard flow** — j/k files, n/p changes, v viewed, ? for help; viewed
  files persist per session
- **GitLab MR import** — pull unresolved MR diff discussions into a local
  session (`GITLAB_TOKEN` + `GITLAB_URL` env), so agent fixes happen
  locally against real review threads
- **Reference pane + workspace search** — ⌘F searches every registered
  repo; results (and definition/usage hits) open in a read-only pane beside
  the diff, where selections feed refs into the note being written

## Run

```sh
pnpm install
pnpm build
pnpm start          # serves UI + API on http://localhost:4870
```

`node bin/stickie.js [path] [--port n] [--db file] [--no-open]` additionally
registers a repo (default: cwd) and opens the browser. During development:
`pnpm dev` (client on :5173 proxying to the server on :4870).

`pnpm package` assembles the publishable npm package under `dist-pkg/`.

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
| GET | `/api/sessions/:id/prompt` | self-contained text export |

See [agents/README.md](agents/README.md) for the integration guide and
[agents/claude-code/](agents/claude-code/) for a ready-made Claude Code
skill.

## Layout

- `client/` — Vite + React + Monaco UI
- `server/` — Hono API + static hosting; git via the CLI, SQLite storage
  (`~/.stickie/stickie.sqlite`, override with `STICKIE_DB`)
- `shared/` — types crossing the API boundary, consumed as source
- `agents/` — integration docs and per-agent adapters
