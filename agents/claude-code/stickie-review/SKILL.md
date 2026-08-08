---
name: stickie-review
description: Fetch open review notes from a running stickie server, address each one in the working tree, then reply to and resolve the threads. Use when the user says to address stickie notes, pick up review comments, or after they finish reviewing in stickie.
---

# Address stickie review notes

Stickie is a local review UI. The user has left line-anchored notes on the
working tree you are editing. Your job: fetch them, fix them, close them out.

## Steps

1. Find the session. List repos and sessions if needed; default server is
   `http://localhost:4870`. If exactly one session exists, use it. If the
   user named a session or repo, match it.

2. Fetch open notes:

   ```sh
   curl -s "http://localhost:4870/api/sessions/<id>/threads?status=open"
   ```

   Each thread has `path`, `startLine`/`endLine` (re-anchored to the current
   file state at fetch time), a `snippet` captured when the note was written,
   and `messages` (the discussion so far).

3. For each thread, in order:
   - Read the current file around `startLine`–`endLine`. If the code there
     no longer matches the intent of the snippet, re-read more context
     before acting.
   - Make the change the note asks for. If a note is unclear or you decide
     not to make a change, do not silently skip it — reply explaining why
     and leave it open.
   - After a successful change, reply and resolve:

     ```sh
     curl -s -X POST http://localhost:4870/api/threads/<tid>/reply \
       -H 'content-type: application/json' \
       -d '{"author": "agent", "body": "<one sentence: what changed>"}'
     curl -s -X POST http://localhost:4870/api/threads/<tid>/resolve
     ```

4. Threads with `"status": "detached"` reference code that no longer exists.
   Reply asking the user to re-anchor or clarify; never guess.

5. Finish with a short summary: notes addressed, notes left open and why.

## Rules

- Reply bodies are read by the user in the UI — keep them to one or two
  plain sentences.
- Never resolve a thread you did not act on.
- Fetch line numbers fresh; do not reuse positions from an earlier fetch
  after you have edited the file.
