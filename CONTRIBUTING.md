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

When a base goes stale the server only *reports* it — `baseStale`, from both
`GET /api/sessions/:id` and the get-or-create `POST`. Acting on it is the
client's, under the `repin_mode` setting, because a GET that quietly writes is
worse than a policy living where the reviewer is. Anything in the client that
decides whether to act on a setting must treat "not read yet" as its own state:
a default that acts is a default that acts before the stored answer arrives.

## The record

`activity` is append-only by convention: nothing in `Store` updates or deletes
a row and there is deliberately no method to, and its foreign keys are plain
integers with no cascade so deleting a note does not delete the record that it
existed. Its `detail` blob holds what the route already knew — path, lines,
base sha, counts — so a row still says something once what it points at is
gone.

A route that changes something takes `?author=` (and `actor=` for an agent) and
records **no actor** when it is not told. It must never fall back to the person
at this machine: that is how every note an agent resolved and every export an
agent pulled came to be credited to the reviewer. An honest blank reads as
"someone"; a wrong name is a false record.

Every mutation goes through `record` in `app.ts`, which appends and *then*
emits the live frame. One call rather than two, so the record cannot be
forgotten: forgetting it would break live refresh, which someone notices
immediately. It is awaited, and a failed append fails the request — a change
stickie did not record is not a change it should report as done.

`subject` and `action` are separate columns; the pairs that make sense are
declared in `activity.ts` and the types make an invalid one unwritable.

## Time

Every timestamp shown anywhere goes through `client/src/time.ts` — never a
hand-rolled diff, never `toLocaleString` at a call site. Recent times read as an
age and older ones as a date, and `TimeAgo` puts the exact stamp on hover.

The boundary carries ISO-8601 with the zone in it. SQLite stores UTC and says so
nowhere, so `toText` spells it out: a reader that takes "2026-08-24 09:11:44"
for local time is wrong by its own offset.

## Watching, and the cost of a descriptor

A reviewed repository is watched with one recursive `fs.watch` per repository,
filtered in the handler. It was a chokidar watch, which watches each file: on a
four-repository workspace that reached 8,300 open descriptors, because linked
worktrees and agent checkouts living inside a repository count every file in
them again.

The cost of holding descriptors is not memory, it is `fork`: a spawned `git`
inherits the descriptor table, so a spawn measured 10ms with a few open and
181ms with 8,000, and the overview page took ten seconds to answer instead of
half of one. Anything that opens a descriptor per file in a repository is
therefore a performance decision about every git call stickie makes, not a local
one.

## Look and feel

`client/src/ui.ts` is the language: `card`, `sunken`, `field`, `field_flush`,
`badge`, `th`, `row`, `eyebrow`, `page`, `motion`, `enter`, and `btn()`. No
component spells its own look. Fifteen of them used to, which is how one panel
came to have 4px corners and hairlines while the next had 6px and neither, and
why changing the language meant finding all fifteen.

**Buttons are one of four kinds and nothing else.** `btn('primary')` is the
accent, `secondary` is emerald and belongs to sending a review, `outline` needs
an edge to be found in a crowded row, `text` is the default. Disabled is the
same colour lighter — never a grey ghost of a different shape, and never a
`not-allowed` cursor: the colour says the button is not ready, a crossed-out
pointer says the reader is doing something wrong, and usually they have simply
not typed anything yet. A button is a radius step tighter than the surface
holding it; a badge keeps the pill, which cannot be mistaken for something to
press.

**An icon replaces a word only where the shape is the more recognisable of the
two.** `client/src/icons.tsx` holds them — drawn on a 24 grid, stroked in
`currentColor`, sized for an 11–12px line, because an installed set arrives
with its own stroke, its own grid and its own idea of how big an icon is.
Settings, the theme, reload, close and the arrows that move you about are
shapes. `Comments (3)`, `Activity`, `Import MR` stay words, because the word
carries what the shape cannot; sending gets both, since the label counts what
is about to go. A bar of pictograms is not denser than a bar of verbs, it is
just quieter about what it does — and an icon-only button still needs its
`aria-label`, because the picture is not the name.

**All three headers wear the same bar.** `title_bar`: the overview, settings
and the review sit on `surface` under a half-pixel rule, with the same
controls in the same order at the right end. The review's used to be a
panel-filled strip of its own with a full hairline under it, a few pixels
above the tab strip's own — two lines, and moving between the three pages read
as moving between three applications. Half a pixel is one device pixel on a 2×
screen and lighter than a hairline on a 1× one, which is the whole intent: it
should say "the chrome ends here", not "this is the edge of a box".

**Depth comes from surface and shadow, not outlines.** `edge` survives where a
real division belongs — a table header, a pane split — and not as a box round
every control. A fill on hover says "pressable" at the moment that matters.

**Density is the point where code is the content.** 11px for code and dense
detail, 12–14px for what is read, weight 400–500 rather than bold. The
references this look came from are 16px marketing pages; a surface showing
twenty files is not one, and lines of code per screen is the job.

The scale has names — `text-meta` (10), `text-dense` (11), `text-xs` (12),
`text-note` (13), `text-sm` (14), `text-lede` (15) — and each is
`max(10px, that number + var(--font-shift))`, which Settings → Appearance sets
to −1px for *Compact*. So no component writes `text-[11px]` any more, and one
radio makes the whole interface a pixel smaller. Two things about that
expression: the floor lives in it rather than in the mode, so what is already
at 10px simply stays there and nothing has to ask which mode it is in; and
only the type moves — spacing, radii and icons stay, because a reader asking
for more rows on a laptop is not asking for smaller buttons.

Monaco is the exception that proves it, since an editor is laid out in numbers
it is handed rather than variables it can read. `fontShift` in the store is
the same −1, and `editorOptions` applies it to the width ladder (11.5 / 12.5 /
13) with its own floor at 11 — code is the content, and the last thing that
should be squinted at to fit another line — and tightens the line from 1.7× to
1.6×. That is the only place a component is allowed to know which mode it is
in.

**One frame per page.** `page` is fluid with a ceiling: no gutters on a laptop,
and a nine-column table does not stretch across a 34-inch screen. Prose keeps
its own measure inside it (`Section` is 2xl). Both full pages use it for their
header *and* their content, so the left edge does not move when a reader goes
from one to the other.

**A page has one scroller.** Two nested ones both reserve a scrollbar gutter,
which puts a header back out of step with the content under it — and a page
that centres its content shifts by half a scrollbar the moment it overflows.
So: `scrollbar-gutter: stable` (`.stickie-scroll`) on the one scroller, the header
sticky inside it.

**Waiting looks like the thing that is coming.** `Skeleton.tsx` holds the
silhouettes and `Loading` announces "loading <what>" once for a screen reader.
A silhouette stands where its content will stand and is roughly its size.
Anything that decides from data it has not read yet needs a third state:
"no repositories" and "no changes to review" are answers, and both were being
given before anyone had looked.

**Where a control lives says what it acts on.** The top bar is the workspace
and the review — source, base, search, the panels, the theme, settings. The
menu at the end of the tabs is the diff: how it is drawn, and what can be done
with it. The status bar carries counts, so nothing else should.

### Monaco, and two things it will do to you

**A selection is painted under the diff's colours.** Monaco renders one line's
overlays as siblings in DOM order at `z-index: auto`: the selection first, then
the inserted/removed line background, which is opaque. No colour can fix that —
the selection is there, buried — so `.view-overlays .selected-text` is raised a
step in `index.css`. Anything else that must show through a diff line has the
same problem and the same answer.

**A form inside a view zone keeps no state of its own.** `useState` for an open
menu read back false on the very next click. Zone-local state goes in the store
— which is where the draft body and the reply text already live, for this
reason. A zone also clips whatever leaves its box, so a menu grows the card
instead of floating over it, and the `ResizeObserver` re-measures.

## Conventions

- comments state constraints the code cannot, nothing else
- no external network calls at runtime except the opt-in GitLab import, which
  also rules out a webfont from a CDN: a face has to be vendored or it is the
  system stack
- the server never writes to a reviewed working tree
- prettier is not this project's formatter and `npx prettier --write` will
  reformat a whole file; match the surrounding style by hand
