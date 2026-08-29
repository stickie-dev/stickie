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

Columns added after a release go in `added_columns` in `schema.ts`, and they
are nullable or defaulted without exception: an existing row has to stay valid
and no read path may require one.

## Identity

`author` on a message is a *role* — `'user' | 'agent'` — and three behaviours
read it: whether a new note starts pending, whether a message may be edited,
and how the export labels it. It is not a name. Names live in `actors`, reached
through a nullable `actor_id`, so a row with no actor is normal rather than
broken. There is no authentication: a human's name comes from git config or
Settings and an agent's from what it claims, so nothing in the interface may
present an actor as verified.

A human is resolved *per repository* — `git config user.name` read inside the
repo, which is local-over-global and so the identity a commit made there would
carry. Someone whose global config is their employer's may well review a
personal repository under a different name, and the record should say which.

## Conventions

- comments state constraints the code cannot, nothing else
- no external network calls at runtime except the opt-in GitLab import
- the server never writes to a reviewed working tree
