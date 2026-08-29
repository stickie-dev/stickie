# Agent integration

Interactive API docs live at `http://localhost:4870/api/docs`; the OpenAPI
spec at `/api/openapi.json` can seed generated clients if pasting curl
commands ever stops being enough.

Stickie is agent-agnostic. Any coding agent that can issue HTTP requests (or
receive pasted text) can consume review notes. Nothing in the API or data
model is specific to one provider.

## The loop

1. The user reviews changes in the stickie UI and leaves line-anchored notes.
2. The agent fetches the work order — markdown first, built for LLM
   consumption: `GET http://localhost:4870/api/sessions/<id>/prompt`
   (JSON when structured fields are needed:
   `GET /api/sessions/<id>/threads?status=open`)
3. The agent addresses each note in the working tree.
4. The agent replies and resolves:
   `POST /api/threads/<id>/reply` with `{"author": "agent", "body": "..."}`
   `POST /api/threads/<id>/resolve`
5. The UI updates live; the user re-reviews or closes out.

## Naming yourself

`author` is a role — `"user"` or `"agent"` — and it decides how a message is
treated, so keep sending it. Resolving, reopening, deleting and reading the
notes out take the same pair as a query — `?author=agent&actor=claude-code` —
because those routes cannot tell an agent from a reviewer, and record nobody at
all rather than guessing. Alongside it, an optional `actor` says *which*
agent: `{"author": "agent", "actor": "claude-code", "body": "..."}` on a reply
or a note. Omitting it is fine and always will be — unnamed agent messages are
recorded under one shared `agent` actor. Nothing is verified; it is a label on
the record, which is exactly as much as a local tool can honestly claim.

Line numbers are re-anchored server-side on every fetch, so the positions in
a fresh `GET` are current. A note whose code block no longer exists comes
back with `"status": "detached"` — ask the user rather than guessing.

## MCP

For agents that speak MCP instead of curl, `stickie-mcp` bridges stdio JSON-RPC
to a running server — five tools over the same routes:

| Tool | Route | |
| --- | --- | --- |
| `list_reviews` | `GET /api/sessions` | read-only |
| `get_review_notes` | `GET /api/sessions/:id/prompt` | read-only |
| `list_notes` | `GET /api/sessions/:id/threads` | read-only |
| `reply_to_note` | `POST /api/threads/:id/reply` | writes |
| `resolve_note` | `POST /api/threads/:id/resolve` | writes |

```sh
claude mcp add stickie -- npx -y stickie stickie-mcp        # published install
claude mcp add stickie -- node /path/to/stickie/bin/stickie-mcp.js
```

`--url http://host:port` (or `STICKIE_URL`) points it at a server that is not on
`http://localhost:4870`. The bridge starts nothing: run stickie first.

## Zero-integration fallback

The **Copy prompt** button in the UI (or `GET /api/sessions/<id>/prompt`)
produces a self-contained text block with every open note, its captured code
snippet, and the reply/resolve instructions. Paste it into any agent.

## Claude Code

A ready-made skill lives in `claude-code/stickie-review/`. Install by copying
(or symlinking) into your skills directory:

```sh
ln -s "$(pwd)/claude-code/stickie-review" ~/.claude/skills/stickie-review
```

Then `/stickie-review` in any session fetches and addresses the open notes.
