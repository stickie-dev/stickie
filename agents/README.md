# Agent integration

Stickie is agent-agnostic. Any coding agent that can issue HTTP requests (or
receive pasted text) can consume review notes. Nothing in the API or data
model is specific to one provider.

## The loop

1. The user reviews changes in the stickie UI and leaves line-anchored notes.
2. The agent fetches open notes:
   `GET http://localhost:4870/api/sessions/<id>/threads?status=open`
3. The agent addresses each note in the working tree.
4. The agent replies and resolves:
   `POST /api/threads/<id>/reply` with `{"author": "agent", "body": "..."}`
   `POST /api/threads/<id>/resolve`
5. The UI updates live; the user re-reviews or closes out.

Line numbers are re-anchored server-side on every fetch, so the positions in
a fresh `GET` are current. A note whose code block no longer exists comes
back with `"status": "detached"` — ask the user rather than guessing.

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
