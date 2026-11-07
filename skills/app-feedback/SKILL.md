---
name: app-feedback
description: Add an in-app feedback mechanism to any app (mobile or web, any stack) so testers and users can report from the screen they are on. Covers a feedback tab or button on every screen, a sheet that captures the screen path and route pattern, a screenshot taken as the sheet opens, a kind (problem / change / idea), an optional 1-5 rating, a comment, app version and platform; a submit API; screenshot storage; a triage surface with statuses (open / planned / done / won't do), counts and an audit trail; a CLI reader that lists notes and downloads screenshots; and the tests to write. Use this skill whenever someone wants a feedback tab, feedback button, bug reports from testers, in-app bug reporting, in-app review or rating of screens, beta or TestFlight feedback, user notes with screenshots, a feedback inbox or triage portal, a "report a problem" sheet, functional-run or UAT feedback, or asks how to collect and triage feedback from inside an app, even if they do not say "feedback mechanism". Also use it when extending or reviewing an existing feedback feature of this shape.
---

# In-app feedback

A tester or user opens a feedback sheet on whatever screen they are on. The app records
which screen it was, takes a screenshot before the sheet covers it, and lets the person
say what kind of note it is, rate the screen and write a comment. The note is stored with
the app version and platform, and the team triages it from a portal or a command line,
screenshot beside the comment. This skill tells you how to build that end to end in any
stack and what makes each part worth its cost.

## Workflow

1. **Find out what exists.** Look for a file or upload service, an auth principal with a
   tenant or user id, a routing layer that exposes the current path, an admin or internal
   area, and a test harness. Reuse each one; this feature should add one table, one or two
   endpoints, one client component and one triage page, not new infrastructure.
2. **Decide the tenancy model** (single app, or many tenants whose rows must stay apart).
   It shapes the table, the read path and the triage page.
3. **Build in this order**, each step testable on its own: data model → submit API →
   client sheet → screenshot storage → triage surface → CLI reader → tests.
4. **Read `references/antlyone-implementation.md`** when you want a worked example (a
   Postgres schema with row-level security, an Expo/React Native sheet, a Next.js triage
   page, a Node CLI). Copy and adapt the snippets in `assets/` rather than typing from
   scratch; see "Bundled files" at the end.
5. **Gate it.** The tab shows in development builds and in builds made with a flag for
   testers. Production users should not see it unless the product wants them to.

## Data model

One table of feedback entries. Every field below exists for a reason, and leaving one
out usually shows up later as a note nobody can act on.

| Field | Why it exists |
|---|---|
| `id` | Time-ordered id (UUIDv7 or similar) so "newest first" needs no extra sort key and the CLI can shorten it to its last 8 characters. |
| `tenant_id` | Which business, workspace or account the note belongs to. Keeps rows apart under row-level security and lets the portal say which customer sent it. Drop it in a single-tenant app. |
| `sender_id` | The signed-in user or staff member, nullable. Lets the team follow up and shows "from whom". |
| `screen` | The concrete path the person was on (`/jobs/42`). Tells you where it happened. |
| `route` | The screen's pattern (`(app)/jobs/[id]`). Groups notes about one screen regardless of which record was open. Without it, ten notes on ten records look like ten screens. |
| `kind` | `problem`, `change` or `idea`. Drives triage: problems first, ideas later. Rows without a kind read as `note`. |
| `screenshot_file_id` | A reference into the file store, nullable. The screenshot is what makes a two-word comment actionable. |
| `rating` | Optional 1-5 ("how easy is this screen?"). Trend data per route, and a low rating is a strong hint of a problem. |
| `comment` | The note itself, capped (around 4000 chars). |
| `app_version` | Build identifier (`0.4.0 (27)`). Tells you whether the note is about a build you already fixed. |
| `platform` | `ios`, `android`, `web`. Many problems are platform-specific. |
| `source` | `app` for the sheet; another value for rows imported from written notes or other channels. |
| `status` | `open` (default), `planned`, `done`, `wont_do`. The triage state. |
| `created_at` | When it was sent (server time, not the phone's clock). |

Optional, when the team runs scripted test journeys: `journey`, `step`, `step_title`,
`as_described` (`yes` / `partly` / `no`) link a note to a step in a written script.

Indexes: `(tenant_id, created_at)` for a tenant's own notes, `(status, created_at)` for the
triage list. Add `(route)` if the portal groups by screen.

Multi-tenant apps: put the table behind the same row isolation as everything else. The
submit path then writes inside the sender's tenant, and the portal needs a separate,
narrow cross-tenant read (see "Triage surface").

## Client capture flow

The sheet lives once, in the root layout, above every screen, so no screen has to opt in.
Load it lazily so it costs nothing where it is turned off.

**The tab.** A small persistent control on an edge of the screen (right edge, around 40%
down, works on phones; a corner button works on web). Give it an accessibility label.

**On tap, in this order:**

1. Hide the tab for a frame or two, then take the screenshot. The picture should show the
   screen as the person sees it, not the feedback control or the sheet. Any screenshot
   failure (permissions, unsupported view) yields `null`, never an error: the note is
   worth more than the picture.
2. Record `screen` (current path) and `route` (route pattern) at this moment, not at
   submit time. The person may navigate while the sheet is open.
3. Reset the form: kind defaults to `change`, rating empty, comment empty. Give the comment
   field a fresh key each opening so stale text never carries over.
4. Open the sheet.

**The sheet.** Keep it short enough to fill in ten seconds:

- A one-line caption: the screen path and whether a screenshot is attached.
- The comment field first and at the top, so it stays above the keyboard. Prompt with
  "What should change?" and a hint ("wording, layout, something missing or broken").
- A thumbnail of the screenshot beside the comment with a small remove control, so the
  person can drop a picture that shows something private.
- A three-way kind control: Problem / Improve / Idea.
- An optional 1-5 rating ("How easy is this screen?"). When the rating is 2 or lower and
  the kind is still the default, switch the kind to `problem`; the person can switch back.
- One submit button. Require a comment or a rating; everything else is optional.

**Offline and signed-out.** Feedback given before sign-in (sign-in and sign-up screens) is
the feedback you most want. Keep those entries in local storage, screenshot path and all,
show "Save, sends after sign-in" on the button, and flush the queue as soon as a session
exists. On send failure, keep the entry queued and tell the person how many are waiting.
Cap the queue (around 30) so it cannot grow without bound.

**Metadata.** Read the native application version and the platform from the runtime, not
from a hand-maintained constant.

## Submit API

One authenticated endpoint that accepts a batch (1 to 50 entries), so the queue flushes in
one call. Validate every field server side:

- `kind` in the enum, `rating` an integer 1-5, text fields trimmed and capped, empty
  strings stored as null.
- `screenshot_file_id`, when present, must reference a file that belongs to the caller's
  tenant, has status `uploaded`, and was uploaded for the feedback purpose. Never trust a
  file id from the client without this check; it is how one tenant would attach another
  tenant's file.
- `tenant_id` and `sender_id` come from the session principal, never from the body.
- `created_at` is the server's clock.

Return `{ saved: n }`. A second, optional endpoint returns the caller's own recent notes
(newest first) so the app can show "what I sent".

## Screenshot storage

Reuse the app's file upload flow. The usual shape is presign → direct PUT to object
storage → complete, which marks the file `uploaded`. Register a file purpose
(`feedback_screenshot`) with image-only content types and a size cap around 5 MB, no
special permission, and not marked sensitive.

On the client, shrink the screenshot before upload (JPEG at 0.8, or WebP at about 0.7 and
1600 px on the long side). Upload at submit time, not at capture time: most openings of
the sheet are cancelled. If the upload fails, send the note without the picture rather
than holding the note back.

Never return a permanent public URL for a screenshot. The triage surface mints a
short-lived signed download link (about 15 minutes) per request.

## Triage surface

A page in the internal or admin area, desktop first, listing notes newest first across
every tenant. What the team needs on each card:

- the screenshot thumbnail (opens full size in a new tab) when there is one;
- kind and status pills, the rating, and when it was sent;
- the comment, whitespace preserved;
- screen, route, sender (name, contact detail masked for non-owner staff), tenant (linked
  to the tenant's own admin page), platform and app version;
- buttons for each status other than the current one ("Reopen" for `open`).

Filters: a status control (`open` by default, plus `planned`, `done`, `wont_do`, `all`)
and a kind row (`all`, `problem`, `change`, `idea`, `note`). Show the count beside each
option, because "7 open problems" is the number the team actually wants. Paginate with a
"show more" that reports how many are left.

**Read path.** In a multi-tenant database with row isolation, the listing needs a narrow,
read-only cross-tenant function (security-definer in Postgres terms) that joins the note
to the tenant's name, the sender's name and contact, and the screenshot's storage key.
Grant it only to the app role. Keep it to this one query; do not open the table.

**Status change.** Look the note's tenant up through an equally narrow function, then run
the update inside that tenant's isolation, locking the row, and write an audit event
(`feedback.status_changed` with `from`, `status`, tenant name) when the status actually
changed. Reject unknown statuses with 400 and unknown ids with 404.

**Counts.** One grouped query (`status`, `kind`, `n`) feeds both the status counts and the
kind counts for the chosen status.

## CLI reader

Before the portal exists, and later for scripting, a small command that reads with an
owner or bypass database role (the rows are behind isolation) and the same storage
settings as the server:

```
feedback list [--status open|planned|done|wont_do|all] [--out <dir>] [--limit n]
feedback mark <status> <id> [<id> ...]
```

`list` prints each note newest first (short id, time, status, kind, rating, screen and
route, sender and tenant, platform and version, comment) and saves its screenshot as
`<out>/<id>.<ext>`. Ids may be given shortened to their last 8 characters. Refuse to start
without the owner connection string, with a message that says why.

## Tests to write

Integration tests against a real database, with two tenants, cover the behaviour that
matters:

1. **Submit** stores the row with tenant and sender from the session, trims and caps
   text, and rejects a screenshot file id that is not uploaded, has the wrong purpose or
   belongs to another tenant.
2. **Listing** returns notes from every tenant newest first with tenant, sender, screen,
   route, kind, rating, version, platform, status and a signed screenshot URL; a row with
   no kind reads as `note` and `screenshotUrl` null; counts by status and kind are right.
3. **Filters** by kind and by status work; an unknown status is a 400.
4. **Masking**: non-owner staff see the sender's contact detail partly hidden.
5. **Status change** updates the row inside its tenant, moves it between filters, writes
   an audit event with `from` and `status`, rejects an unknown status (400) and an unknown
   id (404).
6. **Auth**: the triage endpoints need a portal session (401 without one).

Client side, a unit test for the queue (keep, flush on sign-in, keep on failure, cap) is
cheap and catches the most common regression.

## Pitfalls seen in practice

- A controlled text input inside a bottom sheet can lose the platform's keyboard
  shortcuts on iOS (double-space no longer inserts a full stop). Use an uncontrolled
  field with a fresh key per opening.
- Taking the screenshot after the sheet animates in captures the sheet. Capture first,
  wait two animation frames with the tab hidden, then open.
- Storing `screen` only (no `route`) makes per-screen grouping impossible once ids are in
  the path.
- Presigned download URLs with long lifetimes leak screenshots that may show customer
  data. Keep them to minutes and mint them per listing.
- Letting the portal read the table directly under a bypass role defeats tenant
  isolation everywhere else. Use the narrow function.

## Bundled files

- `references/antlyone-implementation.md`: the worked example (Postgres + Drizzle with
  row-level security, Expo/React Native sheet with screenshot capture and offline queue,
  Next.js triage page, Node CLI, Vitest tests), file by file, with what to change.
- `assets/schema.sql`: the table, indexes, isolation policy and the three triage SQL
  functions. Adapt names and the tenant column.
- `assets/types.ts`: shared TypeScript types and validation shape for entries, kinds and
  statuses.
- `assets/feedback-sheet.tsx`: a React Native sketch of the tab, capture and sheet, with
  the queue, to adapt to the app's components.
- `assets/feedback-cli.ts`: a skeleton of the `list` / `mark` command.
