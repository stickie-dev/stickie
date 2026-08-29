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

## What a review is

A review is `(repo, source, base_ref)` — this working tree or this branch,
against this ref — and that is the table's unique key. The commit the base is
pinned to is *state*: `getOrCreateSession` finds a review by its ref and leaves
the pin alone, and re-pinning updates it in place. Keying on the pinned commit
instead is what used to mint a fresh review every time the reviewed branch got a
commit, splitting one person's notes across a row per commit.

`db/sessionKey.ts` moves an older database onto that key, once, from
`applySchema`. It merges whatever forked under the old keying — notes and viewed
files onto one survivor, the one holding the most notes — before swapping the
constraint. SQLite cannot drop a constraint, so the table is rebuilt with
foreign keys switched off around it (this connection has them on, and dropping
the old table with them on would cascade every note away) and
`pragma foreign_key_check` verifies the result. The merge re-points `activity`
rows at the survivor, which is the one thing that ever rewrites the record: it
is a one-off re-key rather than a runtime path, and it writes a
`review.merged` row saying so.

Looking at one commit against its parent is a *view*, not a review: the commits
list opens it in its own tab and creates nothing.

## The record

`activity` is append-only by convention: nothing in `Store` updates or deletes
a row and there is deliberately no method to, and its foreign keys are plain
integers with no cascade so deleting a note does not delete the record that it
existed. Its `detail` blob holds what the route already knew — path, lines,
base sha, counts — so a row still says something once what it points at is
gone.

Every mutation goes through `record` in `app.ts`, which appends and *then*
emits the live frame. One call rather than two, so the record cannot be
forgotten: forgetting it would break live refresh, which someone notices
immediately. It is awaited, and a failed append fails the request — a change
stickie did not record is not a change it should report as done.

`subject` and `action` are separate columns; the pairs that make sense are
declared in `activity.ts` and the types make an invalid one unwritable.

## Conventions

- comments state constraints the code cannot, nothing else
- no external network calls at runtime except the opt-in GitLab import
- the server never writes to a reviewed working tree
