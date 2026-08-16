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

## Conventions

- comments state constraints the code cannot, nothing else
- no external network calls at runtime except the opt-in GitLab import
- the server never writes to a reviewed working tree
