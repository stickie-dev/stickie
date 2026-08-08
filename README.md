# stickie

**N**ot another **E**ditor — **N**otes for **A**gents.

A local, read-only review surface for changes made by coding agents. Open a
GitHub-style diff of any repo in your workspace — working tree, branch, or
worktree — and leave line-anchored comments anywhere, including on unchanged
code. Agents fetch the unresolved notes over a plain JSON API, address them,
reply, and resolve. Stickie never writes to your working tree; the notes are the
only output.

## Status

Early scaffold. Current walking skeleton: server serves the built client and a
`/api/status` endpoint reporting git state of the target repo.

## Development

```sh
pnpm install
pnpm dev        # client on :5173 (proxies /api), server on :4870
```

## Production-style run

```sh
pnpm build
pnpm start      # serves built client + API on :4870
```

## Layout

- `client/` — Vite + React UI
- `server/` — Hono API + static hosting, talks to git via the CLI
- `shared/` — types crossing the API boundary, consumed as source
