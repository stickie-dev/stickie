# Contributing

stickie is a pnpm workspace: `client/` (Vite + React + Monaco), `server/`
(Hono + node:sqlite + git CLI), `shared/` (boundary types, consumed as
source), `agents/` (per-agent adapters).

## Setup

Node ≥ 22 and pnpm ≥ 9 required.

```sh
pnpm install
pnpm dev          # client :5173 (proxies /api and /ws), server :4870
```

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

All three must pass before a PR. New server logic that parses external
output (git, ripgrep, GitLab) should come with unit tests on the parser.

## Storage

`server/src/db/` is the only place that knows a database exists: `driver.ts`
declares the async surface, `sqlite.ts` and `postgres.ts` implement it, and
`schema.ts` holds the DDL for both dialects. SQL is written in SQLite's `?`
style and rewritten for Postgres. Two rules keep the two honest:

- everything above `Store` awaits — never add a synchronous data path
- write SQL both dialects accept, and when they differ, put the difference in
  `schema.ts` or the row helpers rather than in a caller

Tests run against `:memory:` SQLite; the Postgres path needs a live database,
which CI does not have — exercise it by hand with `STICKIE_DATABASE_URL`.

## Conventions

- comments state constraints the code cannot, nothing else
- no external network calls at runtime except the opt-in GitLab import
- the server never writes to a reviewed working tree
