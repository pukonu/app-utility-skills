# Worked example: Antly One

Antly One is a multi-tenant SME ERP: a Next.js web app and server (`antlyone/`), an Expo
phone app (`antlyone-mobile/`), Postgres with Drizzle ORM and row-level security (RLS)
keyed on `business_id`. This is the implementation the skill was distilled from, file by
file. Paths are relative to the two repositories. Read the section you are adapting; the
"What to change" notes at the end of each one say where another stack diverges.

Contents

1. Data model (Drizzle schema + migrations)
2. Submit API (JQL controller)
3. Phone client (Expo): tab, screenshot, sheet, queue
4. Screenshot storage (core files)
5. Triage: SQL functions, admin REST, audit, Next.js page
6. CLI reader
7. Tests
8. Docs that describe it to testers and staff

---

## 1. Data model

`packages/db/src/schema/feedback.ts`:

```ts
export const feedbackEntries = pgTable(
  'feedback_entries',
  {
    id: id(),                       // uuidv7 from the server
    businessId: businessId(),       // the tenant
    staffMemberId: uuid(),          // the sender, nullable
    journey: text(),                // older scripted-journey runs
    step: integer(),
    stepTitle: text(),
    screen: text(),                 // path, e.g. /sell
    route: text(),                  // expo-router segments joined: (app)/sell
    kind: text(),                   // problem | change | idea (null reads as "note")
    screenshotFileId: uuid(),       // core_files.id
    asDescribed: text(),            // yes | partly | no (journey runs)
    rating: integer(),              // 1..5
    comment: text(),
    suggestion: text(),             // legacy, unused by the sheet
    source: text().notNull().default('app'),      // app | notes
    status: text().notNull().default('open'),     // open | planned | done | wont_do
    appVersion: text(),
    platform: text(),
    createdAt: tsz().notNull().defaultNow(),
  },
  (t) => [
    index('feedback_entries_business_idx').on(t.businessId, t.createdAt),
    index('feedback_entries_journey_idx').on(t.journey, t.step),
    index('feedback_entries_status_idx').on(t.status, t.createdAt),
  ],
);
```

Migrations, in the order they landed:

- `0035_feedback.sql`: the table (journey-run era: `journey NOT NULL`, no `route`, `kind`
  or screenshot).
- `0036_feedback_rls.sql`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy
  `business_isolation USING (business_id = app_business_id()) WITH CHECK (...)`, and
  `GRANT SELECT, INSERT, UPDATE ... TO antlyone_app`.
- `0063_feedback_screens.sql`: `journey DROP NOT NULL`; add `route`, `kind`,
  `screenshot_file_id`; index `(status, created_at)`. This is the move from "rate each
  step of a script" to "feedback from any screen".
- `0073_admin_feedback.sql`: the three `SECURITY DEFINER` functions for the portal (see §5).

The history matters: the first version tied every note to a journey step and asked "was it
as described?". Testers stopped following scripts, so the second version made the screen
and a screenshot the anchor instead. Start with the second shape.

**What to change.** Rename `business_id` to your tenant column, or drop it in a
single-tenant app together with the RLS policy. `app_business_id()` is a session-variable
reader; use your own. Keep the three indexes.

## 2. Submit API

`packages/server/src/modules/feedback/index.ts`. The server speaks "JQL", a controller /
intent RPC over one POST endpoint; `defineIntent` takes a Zod schema and a handler with a
`ctx` holding the principal and a tenant-scoped transaction `ctx.tx`.

```ts
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const entry = z.object({
  journey: text(60), step: z.number().int().min(1).max(500).nullish(), stepTitle: text(160),
  screen: text(200), route: text(200),
  kind: z.enum(['problem', 'change', 'idea']).nullish(),
  screenshotFileId: z.uuid().nullish(),
  asDescribed: z.enum(['yes', 'partly', 'no']).nullish(),
  rating: z.number().int().min(1).max(5).nullish(),
  comment: text(4000), appVersion: text(40), platform: text(20),
});

export const Feedback = defineController('feedback.Feedback', {
  send: defineIntent({
    public: true,                       // any signed-in staff, no permission rule
    input: z.object({ entries: z.array(entry).min(1).max(50) }),
    handler: async (ctx, input) => {
      const me = signedIn(ctx);         // { businessId, staffMemberId } from the principal
      for (const e of input.entries) {
        if (e.screenshotFileId) await assertUploadedFile(ctx, e.screenshotFileId, ['feedback_screenshot'], 'screenshotFileId');
      }
      const rows = input.entries.map((e) => ({ id: uuidv7(), ...me, /* fields */ }));
      await ctx.tx.insert(feedbackEntries).values(rows);
      return { saved: rows.length };
    },
  }),
  mine: defineIntent({ /* this person's latest 30, newest first */ }),
});
```

`assertUploadedFile` (`modules/core/files.ts`) loads the file inside the tenant
transaction (so another tenant's file is simply not found), and checks `status ===
'uploaded'` and the purpose. The error is a validation error on field `screenshotFileId`.

**What to change.** Replace JQL with a plain `POST /api/feedback` that takes
`{ entries: [...] }`. Keep the batch, the trim-to-null transform and the file check.

## 3. Phone client (Expo / React Native)

Folder `antlyone-mobile/src/features/feedback/`, two files.

**Mounting.** `src/app/_layout.tsx` lazily imports `FeedbackButton` once the session has
settled and renders it above the navigator, so it is on every screen:

```ts
void import('@/features/feedback/feedback-button').then((m) => setFeedback(() => m.FeedbackButton));
```

**`feedback-button.tsx`.**

- Gate: `export const FEEDBACK_ON = __DEV__ || process.env.EXPO_PUBLIC_FEEDBACK === '1';`
  Tester builds are made with that env var.
- Screen and route: `usePathname()` and `useSegments().join('/')` from expo-router.
- Screenshot: `captureScreen({ format: 'jpg', quality: 0.8, result: 'tmpfile' })` from
  `react-native-view-shot`, with width/height from `Dimensions.get('screen')` times
  `PixelRatio.get()`. Wrapped in try/catch returning `null`.
- Opening: set `capturing` so the tab unmounts, `await nextFrame()` twice
  (`requestAnimationFrame`), take the shot, then snapshot `{ screen, route }`, reset kind
  to `change`, rating to null, comment to '', bump a `round` counter (the comment field's
  `key`), open the sheet.
- Rating 1 or 2 while kind is still `change` switches kind to `problem`.
- Submit builds `FeedbackEntry` with `Application.nativeApplicationVersion`
  (`expo-application`) and `Platform.OS`; refuses when both comment and rating are empty;
  calls `send(entry)` when signed in, else `keep(entry)`; haptic success and close; on
  error shows "That did not send... (n waiting on this phone)".
- Layout: 40×48 dark tab, left-rounded, at `right: 0, top: '42%'`; a `Sheet` with the
  caption line, a row of (multiline uncontrolled `TextField` with `key={round}`) + (72 px
  wide `expo-image` thumbnail with a floating ✕), a `SegmentedControl` Problem / Improve /
  Idea, a `RatingPicker`, an `InlineAlert` for notes, and a block footer button whose label
  is "Send feedback" or "Save, sends after sign-in".

**`queue.ts`.**

- Types `FeedbackKind`, `Screenshot { uri, width, height }`, `FeedbackEntry`.
- Storage: `expo-secure-store` under one key, JSON array capped to the last 30. `read()`
  tolerates old entries without `kind` or `screenshot`.
- `keep(entry)` appends; `send(entry?)` reads the queue, appends the new entry, uploads
  each screenshot (`uploadPhoto(..., 'feedback_screenshot')`, failure → `null`), sends the
  whole batch in one call, then clears the queue. On failure it re-saves the batch
  (including the new entry) and rethrows.
- `waiting()` returns the queue length for the error message.

**What to change.** On web, replace `captureScreen` with `html2canvas` or the browser's
`getDisplayMedia` (needs a permission prompt; many teams skip the screenshot on web or
capture only the DOM). Replace SecureStore with `localStorage` or IndexedDB. Route
pattern on React Router is `useMatches()` last match's `pathname` pattern; on Next.js app
router there is no public pattern API, so derive it from the segment layout or store the
path only.

## 4. Screenshot storage

`modules/core/files.ts` keeps a purpose table:

```ts
feedback_screenshot: { types: IMAGES, maxBytes: 5 * MB, permission: null, sensitive: false },
```

Upload is three calls from the phone (`src/lib/upload.ts`, `uploadPhoto`): `core.Files
presign` (returns `fileId`, `uploadUrl`, headers) → `PUT` the bytes to S3-compatible
storage → `core.Files complete`. The `core_files` row holds `key`, `contentType`,
`sizeBytes`, `purpose`, `status` (`pending` → `uploaded`), `sensitive`, `uploadedAt`.
Photos are shrunk on the phone first (1600 px, WebP 0.72, with a 20 s timeout fallback to
the original); the feedback screenshot is already a JPEG at 0.8 so it goes as is.

Downloads: `platform/storage.ts` `presignDownload(key, ttlSeconds)` signs a GET; the
portal uses 900 s.

**What to change.** Any object store with presigned URLs works. With local disk storage,
serve screenshots through an authenticated route instead of signed URLs.

## 5. Triage

**SQL** (`0073_admin_feedback.sql`), all `LANGUAGE sql STABLE SECURITY DEFINER SET
search_path = public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO antlyone_app`:

- `admin_feedback(p_status, p_kind, p_limit, p_offset)` returns the note columns plus
  `business_name`, `sender_name` (first + last, trimmed, null if empty), `sender_phone`,
  `screenshot_key` (joined to `core_files` only when `status = 'uploaded'` and same
  business) and `count(*) OVER () AS total`. `p_kind` matches `coalesce(kind, 'note')`.
  Limit is clamped to 1..200, offset to ≥ 0. Order `created_at DESC, id DESC`.
- `admin_feedback_counts()` returns `(status, coalesce(kind,'note'), count)`.
- `admin_feedback_lookup(p_id)` returns the note's `business_id`.

**Server** (`packages/server/src/admin/feedback.ts`):

- `FEEDBACK_STATUSES = ['open','planned','done','wont_do']`,
  `FEEDBACK_KINDS = ['problem','change','idea','note']`.
- `listFeedback(db, principal, { status='open', kind, offset, limit≤100 })`: validates the
  filters (400 "Unknown status."), runs the function, builds `counts.status` (all) and
  `counts.kind` (for the chosen status), maps rows to `{ id, business: {id,name},
  sender: {name, phone: phoneFor(principal, phone)}, ..., kind: kind ?? 'note',
  createdAt ISO, screenshotUrl: presignDownload(key, 900) or null }`. `phoneFor` masks
  the middle digits unless the principal is the owner.
- `setFeedbackStatus(db, principal, id, status)`: validate status (400), lookup (404),
  then `withBusinessTx(db, { businessId }, tx => select ... for update; update if
  changed)`, and `adminAudit(..., { action: 'feedback.status_changed', entityType:
  'feedback_entry', entityId: id, data: { from, status, businessName } })` only when the
  status changed.
- Routes: `GET /api/admin/feedback?status&kind&offset&limit`,
  `POST /api/admin/feedback/:id/status { status }`. Both behind the admin portal session
  (401 otherwise).

**Page** (`app/src/app/admin/(portal)/feedback/page.tsx`): client component using the
portal's `useAdmin` (GET with placeholder data) and `useAdminAction` (POST). A
`SegmentedControl` for status with counts, a `ChipRow` for kind with counts, then one
`<article>` per note: screenshot `<a target=_blank><img h-56 w-28 object-top></a>`, kind and
status `StatusPill`s, "Rated n/5", the time, the comment (`whitespace-pre-wrap`), a
definition list (Screen with journey/step prefix and route in brackets; From name, phone,
business link; App platform + version; As described), and secondary buttons for the other
three statuses ("Reopen" for open). "Show more (n left)" raises the limit by 20.

**What to change.** On a single-tenant app the functions collapse to plain queries with
joins. Keep the masking rule for non-owner staff and the audit write.

## 6. CLI reader

`packages/server/scripts/feedback.ts`, run as
`yarn workspace @antlyone/server feedback list|mark ...`. Connects with
`DATABASE_OWNER_URL` (refuses to start without it; the owner role bypasses RLS), joins
`staff_members`, `businesses` and `core_files` (uploaded only), prints each note in the
format below and writes the screenshot bytes (`getObjectBytes(key)`) to
`<out>/<id>.<ext>`; default out folder is `antlyone-feedback` under the system temp dir.

```
## 1b8cc2b3 · 2026-10-30 14:02 · open · problem · rated 2/5
   screen:     /sell  ((app)/sell)
   from:       Tolu at Tolu Styles · ios 0.4.0 (27)
   comment:    Pay button hides under the keyboard
   screenshot: /tmp/antlyone-feedback/0192...1b8cc2b3.jpg
```

`mark <status> <id...>` matches `right(id::text, 8)` so short ids work.

## 7. Tests

`packages/server/test/admin-feedback.test.ts` (Vitest, real Postgres via
`createTestAppDatabase` / `resetTestDatabase`). Setup: two businesses signed up through
the normal onboarding flow, one `core_files` row inserted directly as an uploaded
`feedback_screenshot`, three notes sent through the real `feedback.Feedback send` intent
(one with screenshot, kind and rating; one idea; one with no kind), then the owner admin
signs in and invites a support staff member. Cases:

1. lists open notes from every business newest first with business, sender, screen,
   route, kind, rating, version, platform, status; `screenshotUrl` matches
   `<businessId>/feedback/...jpg?`; the kind-less note reads `note` with null URL;
   `counts.status = { open: 3, planned: 0 }`, `counts.kind = { problem: 1, idea: 1, note: 1 }`.
2. filters by kind and status; `status=nonsense` → 400.
3. support staff see `***` in every phone.
4. marking planned: response `{ id, status }`, row updated inside the business, open
   total drops to 2, planned filter lists it, `shipped` → 400, random id → 404, the
   newest audit event is `feedback.status_changed` by the support email with
   `{ from: 'open', status: 'planned', businessName }`.
5. no portal session → 401.

Note: `packages/server/test/app-review.test.ts` is about the App Store review sign-in
(an allow-listed phone number with a fixed OTP), not feedback. It is listed near the
feedback tests because both support testers, but it has nothing to copy here.

## 8. Docs

- `docs/02-modules/admin-portal.prd.md` §Feedback: the portal's scope ("notes from every
  business, with the screenshot, the screen, who sent it and when; filters by status and
  kind; mark planned, done or won't do") and the success metric: every new note triaged
  within 2 working days, measured from status-change times.
- `docs/05-integration-notes/functional-runs.md`: the tester guide. The "How to give
  feedback" section is good copy for any app's tester instructions: tap the tab, the app
  takes a screenshot, remove it if it shows something private, say what should change,
  choose Problem / Improve / Idea, rate how easy the screen is, send. Before sign-in the
  button says "Save, sends after sign-in".
- The journey write-ups live in `docs/00-overview/journeys/`; there is no `journeys.ts` in
  the phone app any more (the scripted-journey sheet was replaced by the any-screen tab).
