---
name: stickie-review
description: Fetch open review notes from a running stickie server, address each one in the working tree, then reply to and resolve the threads. Use when the user says to address stickie notes, pick up review comments, or after they finish reviewing in stickie.
---

# Address stickie review notes

Stickie is a local review UI. The user has left line-anchored notes on the
working tree you are editing. Your job: fetch them, fix them, close them out.

## Two ways in

If stickie's MCP tools are connected (`list_reviews`, `get_review_notes`,
`list_notes`, `reply_to_note`, `resolve_note`), use them — they are the same
routes with the arguments checked for you. Otherwise use curl against the
REST API, as below. Either way the loop is identical, and mixing them is
fine: the tools and the routes read the same database.

## Steps

1. Find the session: `list_reviews`, or list repos and sessions over HTTP.
   The default server is `http://localhost:4870`. If exactly one session
   exists, use it. If the user named a session or repo, match it.

2. Fetch the work order as markdown — `get_review_notes`, or:

   ```sh
   curl -s "http://localhost:4870/api/sessions/<id>/prompt"
   ```

   It lists every unresolved note with its location, the code snippet as
   captured, and the discussion so far. Line numbers are re-anchored to the
   current file state at fetch time.

   When you need structured fields instead (filtering by status or side,
   exact line numbers as data), use the JSON form:

   ```sh
   curl -s "http://localhost:4870/api/sessions/<id>/threads?status=open"
   ```

3. For each thread, in order:
   - Read the current file around `startLine`–`endLine`. If the code there
     no longer matches the intent of the snippet, re-read more context
     before acting.
   - Make the change the note asks for. If a note is unclear or you decide
     not to make a change, do not silently skip it — reply explaining why
     and leave it open.
   - After a successful change, reply and resolve — `reply_to_note` then
     `resolve_note`, or:

     ```sh
     curl -s -X POST http://localhost:4870/api/threads/<tid>/reply \
       -H 'content-type: application/json' \
       -d '{"author": "agent", "body": "<one sentence: what changed>"}'
     curl -s -X POST http://localhost:4870/api/threads/<tid>/resolve
     ```

4. Notes may reference other locations as `@path:L10` or `@path:L10-L20`
   (the @ marks a live reference; a bare path is just prose). Short
   referenced blocks arrive inlined in the prompt (content as of fetch
   time); for longer ones, read the file at that range yourself.

5. Threads with `"status": "detached"` reference code that no longer exists.
   Reply asking the user to re-anchor or clarify; never guess.

6. Finish with a short summary: notes addressed, notes left open and why.

## Rules

- Reply bodies are read by the user in the UI — keep them to one or two
  plain sentences.
- Never resolve a thread you did not act on.
- Fetch line numbers fresh; do not reuse positions from an earlier fetch
  after you have edited the file.
