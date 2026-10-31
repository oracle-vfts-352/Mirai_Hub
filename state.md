# Mirai Hub: Project State

> Last updated: 2026-10-30 (end of session 7: new-feedback notification for the owner, notification OUTBOX, fan-out existence checks (step 3), plus post covers and project logos done earlier; sessions 5-6 before it: owner replies, reply notifications, owner rules, feedback linked to a post, SeaweedFS storage layer, avatars).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~96%** (MVP loop works end to end in the browser and through the production-like Docker stack; **174 automated tests in 22 files, all passing**; CI green on GitHub after the outbox commit and repo private (confirmed by the user in session 7). Done: browse feed, profiles, owner replies, reply notifications, owner rules, feedback-to-post link, avatars, post covers, project logos, NEW_FEEDBACK notification, outbox, fan-out existence checks, Redis-backed rate limits, orphan-user cleanup, mail module + Mailpit (email step 1), email verification backend (step 2a). Left (in this order): email step 2b (frontend), step 3 (gating), step 4 (email-link login) verification, the domain decision, then the R2 switch and the rest of hardening before any public deploy (the GitHub repo goes public LAST), deploy, observability, Electron).

---

## 1. Vision (don't drift from this)

A **two-sided, multi-tenant platform** connecting **consumers** and **devs/companies**:

- Devs/companies get a public **project page** to share vision, roadmap, and updates.
- Consumers **follow** projects, **submit feedback**, and **vote** on what matters.
- Devs **respond with a status** (planned / in progress / shipped / declined) and an official **reply**, and the people involved get notified.

**Core loop (the product):**

```
Dev posts update/vision -> Consumers see it -> Consumers give feedback + vote
-> Dev sees what matters (and is notified of new feedback) -> Dev sets status / replies -> Followers, the feedback author and voters are notified -> repeat
```

If feedback disappears into a void, the product fails. The "dev responds, consumers see it" step is the point. The response is a status plus one official owner reply per feedback item (done in session 5). A full comment thread (anyone replies) is deliberately later.

**Not the goal (for now):** marketing automation, email blasts, encrypted customer lists, analytics, and *advanced* discovery (search, ranking, recommendations). The old code was a single-company marketing tool; that idea is **dropped**. **But a basic browse list is part of the loop**: without it a consumer can only reach a project by typing its URL (decided in session 3).

## 2. MVP definition (build only this first)

1. Dev signs up, registers a passkey, creates a project page.
2. Consumer signs up, follows a project, submits feedback.
3. Other consumers vote on feedback.
4. Project owner changes a feedback item's status.
5. Followers get notified of the change (BullMQ).

Everything else waits until this loop works end to end. **Backend: done, manually verified and covered by automated tests. Frontend: passkey signup/login/logout, create project, public project page (posts, feedback list, voting, submit feedback, follow), owner controls (status dropdown, post create/edit/delete, edit project, owner replies), notification bell, Home browse tabs (Discover / Following / My projects), profiles, and nginx serving the built frontend all work. Session 5 added: owner reply, reply notifications, owner-can't-give-feedback rule, feedback linked to a post. Session 6 added user avatars. Session 7 added: post cover images, project logos (both landed as commits between the session 6 snapshot and now), the NEW_FEEDBACK notification for the owner, and the notification outbox. Missing: R2 switch, remaining hardening, deploy, Electron.**

---

## 3. Stack and decisions made

| Area | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind 3 (Vite 5), `react-router-dom`, `@simplewebauthn/browser` 14, **web-first** |
| Desktop | Electron as a **thin shell** around the web app (optional for devs). No Electron APIs inside React except behind `window.electronAPI` checks via `preload` + `contextBridge`. Keep `contextIsolation: true`, `nodeIntegration: false` |
| API | Node + Express 4 + TypeScript |
| DB | PostgreSQL 16 via Prisma 5.22 |
| Cache / queue | Redis (`ioredis` 6) + **BullMQ** 6. RabbitMQ was considered and rejected (overkill; BullMQ covers notifications, retries, delayed jobs). Don't suggest it again unless scale demands it |
| Auth | WebAuthn passkeys (`@simplewebauthn/server` v14) + JWT in HttpOnly cookie |
| Email | `nodemailer` over plain SMTP; Mailpit locally; Resend (SMTP) planned for production |
| Validation | zod (every route input, including `:id` params as UUID) |
| Rate limiting | `express-rate-limit` + `rate-limit-redis` (counters in Redis) |
| Tests | vitest 5 + supertest, against a separate Postgres database `mirai_hub_test` |
| Infra | Docker Compose (Node 22 images), nginx reverse proxy, GitHub Actions CI |
| IDs | UUIDv7 (`@default(uuid(7)) @db.Uuid`) on every id and every foreign key |
| Observability (later) | Prometheus + Grafana, `prom-client`; load tests with k6 (watch p99) |
| Images | **Cloudflare R2** in production, **SeaweedFS** locally (same S3 client `@aws-sdk/client-s3`; MinIO is NOT used: its community edition is archived, see gotchas). Uploads go THROUGH the API and are re-encoded with `sharp` (R2 has no presigned POST). Storage layer, avatars, post covers and project logos are DONE locally; the R2 switch (step 6c) is left. See section 9. |

Decisions:
- Single domain: nginx serves the frontend on `/` and the API on `/api` (avoids cookie/CORS pain, including in Electron). Done in session 4: `/` serves the built web app (SPA fallback), `/api/` is proxied to the API.
- nginx is the only public entry point and **overwrites** `X-Forwarded-For` with the real client address (`$remote_addr`); the API trusts one proxy hop (`trust proxy` 1) and the rate limiter relies on this.
- Logic goes in `services/` (plain functions, **no Express inside**); routes parse input with zod, call a service, return JSON. Services throw `AppError(status, msg)`; the single error handler in `app.ts` maps errors to status codes.
- `app.ts` exports the Express app (no `listen`); `server.ts` only calls `app.listen`. Needed so supertest can drive the app.
- Passkeys stay the sign-up and sign-in method for everyone; an email link (existing verified accounts only) is added as fallback and recovery. Google login or email-only signup for consumers is a later option, not planned.
- Lists (feedback, posts, notifications) are capped at 50 for now (cursor pagination later).
- **Notifications:** one `Notification` row per recipient per event. The project owner is never notified of their own actions. `@@unique([userId, dedupeKey])` + `createMany({ skipDuplicates: true })` makes the worker idempotent, so BullMQ retries never double-notify.
- **Dedupe keys** contain only `-` (BullMQ job ids can't contain `:`): `status-{feedbackId}-{status}-{updatedAtMs}` (timestamp so PLANNED -> IN_PROGRESS -> PLANNED stays three distinct events), `post-{postId}`, `reply-{feedbackId}` and `feedback-{feedbackId}`.
- Status notifications are only queued when the status actually changed. Editing a post does **not** re-notify. Deleting a post also deletes its `NEW_POST` notifications.
- **Notification OUTBOX (session 7, replaces "enqueueNotification never throws"):** table `OutboxEvent` (`type`, `projectId`, `refId`, `dedupeKey` UNIQUE, `createdAt`, `publishedAt`; index `[publishedAt, createdAt]`; no foreign keys, so a row never blocks a delete). `enqueueNotification(job, db = prisma)` in `lib/queue.ts` no longer touches Redis: it does `outboxEvent.createMany({ skipDuplicates: true })`. The four call sites (`createFeedback`, `setStatus`, `setReply` in `services/feedback.ts`; `createPost` in `services/posts.ts`) run the action and the outbox row inside ONE `prisma.$transaction` and pass `tx`, so both commit or neither does. `publishNotification(job)` (also in `lib/queue.ts`) adds the job to BullMQ with `jobId = dedupeKey` and THROWS on failure. The relay lives in `lib/outbox.ts`: `relayOnce()` (100 rows, oldest first; rows already published are marked even if a later one fails), `purgePublished()` (published rows older than 7 days), `startOutboxRelay()` (polls every 1 s, ticks never overlap, purges hourly). `run-worker.ts` starts the relay and stops it on shutdown, so **the worker process must be running for notifications to go out** (otherwise they wait safely in the table). Two workers at once are harmless (BullMQ ignores a repeated jobId; the Notification unique key protects the rest). A reply deleted and rewritten produces the same `reply-{id}` key again: `skipDuplicates` makes it a no-op (anti-spam, no 500). If Redis is down, rows stay unpublished and go out when it is back.
- **Tests and the outbox:** `tests/setup.ts` mocks `lib/queue` with `enqueueNotification: vi.fn(actual.enqueueNotification)` (a spy around the REAL function, so outbox rows are really written and rollbacks are really tested) and `publishNotification: vi.fn(async () => undefined)`. `resetDb` truncates `"OutboxEvent"`. Assertions on `enqueueNotification` need `expect.anything()` as the SECOND argument (the `tx`).
- **Fan-out routes by type:** `services/notifications.ts#fanOut` is the single entry point used by the worker. `NEW_POST` and `FEEDBACK_STATUS` go to followers (`fanOutToFollowers`, batches of 500, keyset on `userId`, owner excluded). `FEEDBACK_REPLY` goes to the feedback AUTHOR plus everyone who VOTED for it (`fanOutReply`; owner always excluded; returns 0 if the feedback was deleted or belongs to another project). `NEW_FEEDBACK` goes to the project OWNER only (`fanOutNewFeedback`, session 7).
- **New feedback notifies the owner (session 7):** enum value `NEW_FEEDBACK`. Every new feedback item creates ONE notification for the project owner only (never followers, never the author), dedupe key `feedback-{id}`. `fanOutNewFeedback` returns 0 if the feedback was deleted, belongs to another project, or the author is the owner. The list resolves the title from the feedback row; `status` is null for this type. Bell text: "New feedback on {project}: “title”". For a very busy project this could become many notifications; a digest can come later. Tests: `newfeedback.test.ts` (7: queueing 3, fan-out 4). Browser check passed (user report).
- Notification list resolves titles via two batched queries (every type except `NEW_POST` reads feedback; `NEW_POST` reads posts); if the referenced item was deleted, `title` is `null`. `status` is only filled for `FEEDBACK_STATUS`.
- **Rate limits** are mounted in `app.ts` before body parsing (table in section 4).
- The Docker image builds only the `api` workspace (`npm ci --workspace=api --include-workspace-root`), so Electron and the web app are never installed in it; the worker runs the compiled `dist/run-worker.js` from the same image.
- **Frontend dev setup:** Vite on `localhost:5173` with a **proxy of `/api` to `http://localhost:5000`**, so browser and API share one origin (HttpOnly cookies and WebAuthn work like in production; `ORIGIN=http://localhost:5173`, `RP_ID=localhost`). Always open `http://localhost:5173`, never `127.0.0.1` (WebAuthn needs the exact origin; cookies are per host).
- Frontend structure: `src/api.ts` (one `api()` fetch helper, `ApiError`, `errorMessage`), `src/auth.tsx` (`AuthProvider` + `useAuth`, loads `/api/auth/me` on start, 401 means signed out), pages in `src/pages/`. No tokens in JS: auth is the HttpOnly `auth_token` cookie.
- Signup flow: `POST /auth/signup` creates the user and an `enroll_token` cookie (10 min); the page then runs the passkey registration; if that step fails the page offers a retry for the 10 minutes the enroll cookie lives. Signup now also clears any old `auth_token` so the passkey is attached to the NEW account (`requireEnrollOrAuth` prefers `auth_token`).
- **Passkeys live on the device/password manager, the server stores only the public key.** Deleting a user row on the server does NOT remove the passkey from Windows/phone; remove old `localhost` test passkeys by hand (Windows: Settings > Accounts > Passkeys). The sign-in picker lists them by email.
- **Frontend routes:** `/` (landing / My projects), `/signup`, `/login`, `/projects/new` (DEV only, guarded by `RequireAuth role="DEV"`; signed-out visitors go to `/login`, consumers see a message), `/p/:slug` (public project page), `/u/:id` (public profile). Unknown paths show a not-found message.
- Project page: posts via `GET /projects/:slug/posts`, feedback via `GET /projects/:slug/feedback?sort=votes|new`; vote toggle uses the `voteCount` the API returns; header counts are adjusted client-side after follow / feedback. There is no "do I follow this?" endpoint, so `FollowButton` checks `GET /me/follows`. The Follow button is hidden for the project's owner; all user text is rendered as plain text (`whitespace-pre-wrap`), never as HTML.
- Another DEV may follow someone else's project; only the owner of that project is blocked (server rule in `services/follows.ts`, covered by `tests/follows.test.ts`: 400 `You cannot follow your own project`).
- **Owner controls** appear on `/p/:slug` when `user.id === project.ownerId`: feedback items get a status `<select>` (`PATCH /feedback/:id/status`, all 6 statuses) and Reply / Edit reply / Delete reply, the Updates section gets a "New post" form plus Edit / Delete on each post (`PostForm` component inside `PostList.tsx`; delete asks `window.confirm`). This is only convenience: the server enforces owner-only on every one of these calls. Editing a post never re-notifies; a status change notifies followers only if the status really changed.
- **Edit project (owner):** "Edit project" button on the project header opens a form (name, tagline, vision, and the logo upload from session 7) that calls `PATCH /projects/:id` with the project UUID; the slug is not editable. Clearing tagline/vision saves an empty string (the page treats it as "none").
- **Notification bell** (`components/NotificationBell.tsx`, rendered in the `App.tsx` header, signed-in users only): unread badge from `GET /me/notifications/unread-count`, polled every 30 s and on window focus (no websockets); the dropdown loads `GET /me/notifications` when opened. Text: `FEEDBACK_STATUS` -> "“title” is now {status}", `NEW_POST` -> "New post: title", `FEEDBACK_REPLY` -> "{project} replied to “title”", `NEW_FEEDBACK` -> "New feedback on {project}: “title”", deleted item (title null) -> "Update in {project}". Clicking an item marks it read (`PATCH /notifications/:id/read`, optimistic) and navigates to `/p/{slug}`; "Mark all read" calls `POST /me/notifications/read-all`. Escape / outside click closes it. Owners never get notifications for their own actions (server rule).
- **Owner reply (session 5):** `Feedback.ownerReply String?` (1-2000 chars, trimmed) + `Feedback.ownerReplyAt DateTime?`. `PUT /feedback/:id/reply` (owner only; creates or overwrites; body `{ text }`) and `DELETE /feedback/:id/reply` (owner only; clears; repeatable). Both go through `getFeedbackAsOwner` in `services/feedback.ts` (404 unknown, 403 not the owner). The feedback list returns both fields (null when none). UI: "Response from {owner name}" block visible to everyone (plain text, with date); the owner gets Reply / Edit reply / Delete reply with a textarea and a 2000-character counter (`ReplyEditor` inside `FeedbackSection.tsx`). One reply per item; threaded discussion is later.
- **Reply notifications (session 5):** only the FIRST reply (when `ownerReplyAt` was null) enqueues a `FEEDBACK_REPLY` event with dedupe key `reply-{feedbackId}`; edits do not notify. If the owner deletes the reply and writes a new one, nobody is notified again (the key already exists; intended anti-spam).
- **Owner cannot create feedback or vote on their own project (session 5):** `createFeedback` and `addVote` throw **403** `Project owners respond with replies, statuses and posts` (constant `OWNER_MSG` in `services/feedback.ts`). Removing a vote stays allowed on the API (old data cleanup). UI: the owner sees a note instead of the feedback form and the vote buttons are disabled with a tooltip (so in the UI an owner cannot remove an old vote of their own; delete by hand in the dev DB if it matters). `createFeedback` returns 404 for an unknown project.
- **Feedback optionally linked to a post (session 5, option A):** `Feedback.postId String? @db.Uuid`, relation to `Post` with `onDelete: SetNull`, `Post.feedback Feedback[]`, `@@index([postId])`. `POST /projects/:slug/feedback` accepts optional `postId` (UUID); the post must belong to the SAME project, otherwise 400 `That update does not belong to this project` (unknown id also 400). `GET /projects/:slug/feedback?postId=` filters (non-UUID = 400); every item includes `postId` and `post {id, title}` (null when unlinked or the post was deleted). Deleting a post keeps the feedback and clears the link. UI: `ProjectPage.tsx` holds the state `aboutPost` and passes `onGiveFeedback` / `onDeleted` to `PostList` and `aboutPost` / `onClearAbout` to `FeedbackSection`; signed-in non-owners see "Give feedback on this update" under each post, which scrolls to `#feedback` and pre-fills "Feedback about: {title}" with a Clear link; feedback items show an "About: {title}" tag (click = filter) and the board has an "All feedback / About: {post}" dropdown. The git log mentions a "feedback update picker" in the logo commit (confirm what that changed in the UI). **Known limits (left for later):** a post created in the current session is not in the filter dropdown until a reload; the tag after a post delete needs a reload.
- **Images decision (session 3):** avatars for ALL signed-in users, one optional cover image per post and one logo per project (owners), stored in **Cloudflare R2** (production) / **SeaweedFS** (local dev). Because R2 does not implement presigned POST and a presigned PUT cannot enforce a size range, uploads go through the API: multipart, hard size limit, magic-byte check, **re-encode with `sharp`** (strips EXIF and any non-image payload), then `PutObject` with a server-chosen key. Risk controls: one image per owner object (replaced, not accumulated), per-user upload rate limit, no SVG, delete replaced objects; report/removal tool + email verification before any public launch.
- **Local object storage (session 5, done and tested):** MinIO was dropped (community edition and `mc` archived). Local stand-in = SeaweedFS: compose service `seaweedfs` (`chrislusf/seaweedfs:4.06`, pinned, never `latest`; command `server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json -dir=/data`), published only on `127.0.0.1:8333`, data in the volume `seaweed_data`. Credentials and public access come from `docker/seaweedfs-s3.json` (throwaway dev values; **commit 5b7fd05 "untrack SeaweedFS credentials" means this file is no longer tracked in git** (it is git-ignored; create it by copying `docker/seaweedfs-s3.example.json`)): identity `mirai` = Admin/Read/Write/List/Tagging with the keys from `apps/api/.env`; identity `anonymous` = `Read:mirai-media`, so images are readable by URL and nothing else is public. Bucket `mirai-media` is created by `ensureBucket()` (dev helper; in production the bucket is made in Cloudflare). `lib/storage.ts` exports `putObject(key, buffer, contentType)` (CacheControl public, 1 year, immutable: keys MUST be unique per upload), `deleteObject(key)` (best effort: logs, never throws), `publicUrl(key)`, `mediaUrl(key|null)` and `ensureBucket()`. The S3 client uses `forcePathStyle: true` and `requestChecksumCalculation` / `responseChecksumValidation` = `'WHEN_REQUIRED'`. `config.ts` exposes `storageConfig()`, read LAZILY on first use (so the worker, the tests and CI don't need the S3 variables; no fallback secrets). Variables in `apps/api/.env`: `S3_ENDPOINT=http://localhost:8333`, `S3_REGION=us-east-1` (R2: `auto`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=mirai-media`, `MEDIA_PUBLIC_URL=http://localhost:8333/mirai-media`. Connection test: from `apps/api`, `npx ts-node --transpile-only scripts/storage-check.ts` prints bucket ready / uploaded / public GET 200 / after delete 404. The `api-server` container gets the S3 variables in compose with `S3_ENDPOINT=http://seaweedfs:8333` while `MEDIA_PUBLIC_URL` stays `http://localhost:8333/mirai-media` (the browser's view); the worker does not need them. R2 later: region `auto`, endpoint `https://<account>.r2.cloudflarestorage.com`, `MEDIA_PUBLIC_URL` = the bucket's custom domain.
- **Avatars (session 6, done and tested):** `User.avatarKey String?` (migration `add_user_avatar`). The raw key never leaves the server: API responses carry `avatarUrl` (`mediaUrl(key)`, `null` when none). Done in `getPublicProfile`, `updateMe`, `GET /auth/me`, the project owner in `getBySlug` (`owner {id, name, avatarUrl}`) and the feedback `author {id, name, avatarUrl}`. `POST /api/me/avatar`: `requireAuth` -> `avatarUploadLimiter` (5 per hour per USER via `keyGenerator: req.user.userId`; skipped under `NODE_ENV=test`) -> multer (memory storage, field `avatar`, 2 MB, 1 file; multer errors mapped in `acceptAvatar` in `routes/users.ts`) -> `services/avatars.ts#setAvatar`: magic-byte check (PNG/JPEG/WebP only, no SVG/GIF; file name and Content-Type ignored), `sharp` (`limitInputPixels` 24M, `.rotate()`, 256x256 cover, WebP q80), a NEW key `avatars/{userId}/{uuid}.webp`, `putObject` (storage failure -> 503), DB update (if it fails the new object is deleted), then the old object is deleted (best effort). Errors: 400 missing/invalid/unreadable file, 401, 413 over 2 MB, 429, 503. `DELETE /api/me/avatar` clears the key and deletes the object; repeatable. Both return `{ avatarUrl }`. nginx: `location = /api/me/avatar` has `client_max_body_size 3m` and repeats the `proxy_*` settings (nginx does not inherit them); everything else stays at 200k, and nginx answers 413 with an HTML page (the frontend `uploadFile` maps 413 to "That file is too large"). Tests: `avatar.test.ts` (11) and `avatarpayloads.test.ts` (3). Frontend: `components/Avatar.tsx` (`url`, `name`, `size`; initials fallback), `uploadFile(path, field, file)` in `api.ts`, profile page `AvatarControls`, header `ProfileLink`, small avatars on feedback authors and "by {owner}". Browser check passed (user report, session 7). Known gaps: the per-user limit has no automated test; two simultaneous uploads by one user could orphan one object; old objects are only deleted on replace/remove (no account deletion exists). **CSP note:** when nginx gets a Content-Security-Policy in Phase 4, `img-src` must allow the media host (the R2 domain in production, `localhost:8333` in dev) or avatars, covers and logos will break.
- **Post covers (session 7, step 6b, DONE; browser check passed per user):** `Post.coverKey String?`, `POST/DELETE /api/posts/:id/cover` (owner only, multipart field `cover`), shared helper `lib/images.ts#toWebp` (cover: `resize({ width: 1600, withoutEnlargement: true })`), key `covers/{postId}/{uuid}.webp`, the old object is deleted on replace, remove and post delete, `coverUrl` (never the key) in post payloads via `toPublic` in `services/posts.ts`; feed thumbnails exist (commit "Post cover images ... feed thumbnails"). Storage failure -> 503. Tests: `cover.test.ts`. (confirm: size limit, per-user rate limit, nginx regex location.)
- **Project logos (session 7, DONE; commits "Project logo API (fit-in-square WebP, owner only)" and "Project logos: upload in Edit project, shown on project page, cards, feed and profiles"):** `Project.logoKey String?`, `POST/DELETE /api/projects/:id/logo` (multipart field `logo`, owner only, UUID in the path like `PATCH /projects/:id`), `logoUrl` in project payloads, fit-in-square WebP. UI: upload in "Edit project", shown on the project page, project cards, feed and profiles. Tests: `logo.test.ts` (`cover.test.ts` + `logo.test.ts` = 29 tests together; confirm the split). (confirm: size limit, rate limit, nginx location.)
- **Browse API (session 3):** `services/projects.ts#listProjects` and `services/feed.ts#listFeed`, routes `GET /projects` and `GET /feed` (`optionalAuth`). Public responses expose only the owner's `id` + `name`, never the email. Migration `add_browse_indexes` adds `Post(createdAt)` and `Follow(projectId)`. `GET /projects/:slug` validates the slug with zod. No pagination yet (50 cap).
- **Home page (session 3):** tabs **Discover** (project cards with a Newest / Most followed switch + the recent-updates feed), **Following** (signed in; feed with `scope=following`), **My projects** (DEV only, with Create project). The selected tab lives in the URL (`/?tab=following`). Layout: app container `max-w-3xl`, forms and the project page wrapped in `Narrow` (`max-w-lg`). Data loading goes through `useApi(path)`.
- **nginx image (session 4):** `apps/api/Dockerfile.nginx` is multi-stage (stage 1: Node 22 builds the `web` workspace; stage 2: `nginx:alpine` with `apps/api/config/nginx.conf` and the `dist` files in `/usr/share/nginx/html`); the build context is the repo root. nginx config: `include /etc/nginx/mime.types` (without it JS is served as text and the page is blank), `/api/` proxied, `/assets/` cached 1 year, `/index.html` never cached, `location /` falls back to `/index.html`. Browser security headers (CSP etc.) are NOT set yet: Phase 4.
- **Profiles API (session 4):** `User.bio String?`. `services/users.ts#getPublicProfile` selects explicit fields only, so the email never leaks, plus the user's projects with counts; `updateMe` can only change name and bio. Routes: `GET /api/users/:id` (public) and `PATCH /api/me`. Handles/usernames come later.
- **Profiles UI (session 4):** `/u/:id` (`pages/Profile.tsx`) shows name, bio, role badge, join date, a "You" badge and, for DEVs, project cards; on your own profile "Edit profile". The header shows your name (links to your profile). The project page shows "by {owner}" linking to the owner's profile; feedback author names link to profiles. Project cards and feed cards do NOT link to profiles (nested links are invalid HTML). A bad id and an unknown id both show "User not found."
- **Secrets out of compose (session 7, commit 5b7fd05 "Move secrets out of compose, tests and CI; untrack SeaweedFS credentials") **(details confirmed in session 7, except CI):** compose reads `${POSTGRES_PASSWORD:?}`, `${JWT_SECRET:?}`, `${S3_ACCESS_KEY_ID:?}` and `${S3_SECRET_ACCESS_KEY:?}` from the root `.env` (listed as placeholders in the tracked root `.env.example`; compose refuses to start when one is missing). `tests/env.ts` has no fallback password: it reads `TEST_DATABASE_URL` from the environment (CI) or from `apps/api/.env` (local) and throws unless the path is `/mirai_hub_test`; its remaining literals (`JWT_SECRET: 'test-only-...'`, `REDIS_URL`) are test-only values. (confirm: how `ci.yml` provides `TEST_DATABASE_URL`.) Commit 79d304b ("npm audit fix") patched body-parser, qs and postcss-selector-parser; the audit list in section 8 is not re-checked yet.
- **Fan-out existence checks (session 7, step 3, DONE):** `refExists(job)` in `services/notifications.ts`, used by `fanOutToFollowers`: `NEW_POST` looks the post up, `FEEDBACK_STATUS` looks the feedback up, and the item must belong to `job.projectId`; otherwise the fan-out returns 0 (no ghost notifications for a post deleted before its job ran). `fanOutReply` and `fanOutNewFeedback` already had the same guard. Tests: `fanoutexists.test.ts` (5); `notifications.test.ts` now creates a real post / feedback item for its fan-out tests (a random uuid as `refId` now correctly creates nothing). A millisecond window remains (delete between the check and the insert); accepted, because `deletePost` also removes the `NEW_POST` notifications.
- **Orphan-user cleanup (session 7, DONE):** `services/orphans.ts`: `cleanupOrphans(maxAgeMs = 1 hour)` does one `user.deleteMany` for users older than the threshold with NO passkey, NO projects, NO feedback, NO follows and NO votes (projects and feedback have no cascade and would block the delete; passkeys, votes, follows and notifications cascade, but an account with any of them is kept anyway). `startOrphanCleanup()` runs once at start and every 10 minutes inside the worker process (`run-worker.ts`), never overlapping; `ORPHAN_CLEANUP=off` disables it. Two workers at once are harmless. In local dev, empty passkey-less test accounts older than an hour disappear (`dev1` owns a project and `fan1` follows it, so they stay). Tests: `orphans.test.ts` (6). Manual check passed (signup without passkey, back-dated by SQL, removed when the worker started). Its `EmailToken` rows cascade with the user.
- **JWT secret:** one server-side `JWT_SECRET` signs every token (not per user); `lib/config.ts` requires it with no fallback; `tests/env.ts` holds a test-only value. Production gets a fresh random secret generated on the server (never the dev one); rotating it signs everyone out. `git grep -n -i "jwt_secret"` from the REPO ROOT checks that no literal secret is in code, compose or CI (the apps/api-only check was clean).
- **Email plan (direction agreed in session 7, details still to build):** plain SMTP in the code (library to choose, e.g. nodemailer); the provider (Resend or anything else) is picked at deploy time and is only a settings change. Local development uses a catcher container in compose (Mailpit, like SeaweedFS stands in for R2), so nothing real is sent while building. Real sending needs a domain (SPF + DKIM records). Order: build and test locally first. **Decided by the user (session 7):** passkeys are KEPT as the way to sign up and sign in for everyone (they already work and are tested); email verification is ADDED, not a replacement (a passkey proves a device, not that the email is real). A VERIFIED email is required to follow, vote, write feedback and upload images (fake accounts must not be able to inflate follower and vote counts); reading and browsing stay open. **Also decided (the user accepted both AI proposals):** creating a project also requires a verified email; email-link login only signs in EXISTING verified accounts (also the recovery path when a passkey device is lost) and there is NO email-only signup, so passkey signup stays the only way to create an account. Verified email does not stop disposable addresses: keep the signup limit (10/hour per IP) and the per-user limits.
- **Mail module (session 7, email step 1, DONE):** `lib/mail.ts` exports `sendMail({ to, subject, text, html? })` using `nodemailer` over plain SMTP (lazy transporter; `from` = `SMTP_FROM`; it THROWS if the mail server refuses or is unreachable, the caller decides what that means). `config.ts` has `smtpConfig()` read lazily like `storageConfig()`: `SMTP_HOST` (required), `SMTP_PORT` (default 1025), `SMTP_FROM` (required), optional `SMTP_USER` / `SMTP_PASS` (auth only when BOTH are set), `SMTP_SECURE` (`true` = TLS from the start, e.g. port 465). Links in mails must be built from `config.origin`. Local dev: compose service `mailpit` (`axllent/mailpit:v1.31.3`, pinned; SMTP on `127.0.0.1:1025`, inbox UI on `http://127.0.0.1:8025`; dev only, never in production); `api-server` gets `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM=Mirai Hub <noreply@mirai-hub.local>` (placeholder sender until the domain is chosen); the worker has no SMTP variables yet. Manual check: from `apps/api`, `npx ts-node --transpile-only scripts/mail-check.ts` prints `Mail sent` and the mail appears in Mailpit. Tests: `tests/setup.ts` mocks `lib/mail` (`sendMail: vi.fn`); `mail.test.ts` (3) tests the REAL module with `nodemailer` faked (it sets env values AFTER importing, see gotchas). **Production plan: Resend over SMTP**: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `SMTP_PASS=<Resend API key>`, `SMTP_FROM` on a domain verified in Resend (Resend needs a verified domain to send to real users; the API key is a secret, only in the server environment). Mail is sent inside the API request for now (a failed send must not break signup: step 2 adds a "resend" action); moving mail to the outbox/worker is a possible later improvement.
- **Email verification, backend (session 7, email step 2a, DONE):** migration `add_email_verification`: `User.emailVerifiedAt DateTime?`, `User.emailTokens`, enum `EmailTokenPurpose` (`VERIFY_EMAIL`, `LOGIN` for step 4) and table `EmailToken` (`tokenHash` UNIQUE = SHA-256 of the token, `purpose`, `expiresAt`, `usedAt`, `createdAt`; index `[userId, purpose]`; cascades with the user, so the orphan cleanup removes them too). The token is 32 random bytes (base64url); ONLY its hash is stored. `services/emailVerification.ts`: `sendVerificationEmail(userId)` (no-op `alreadyVerified: true` when already verified; otherwise deletes the user's unused VERIFY_EMAIL tokens, creates a new one valid for **24 hours**, mails `{config.origin}/verify-email?token=...`; THROWS if the mail fails) and `verifyEmail(token)` (single use via `updateMany where usedAt null` inside a transaction; unknown, used or expired all give the same 400). Routes in `routes/auth.ts` as in the endpoint table; the resend route maps any mail failure to 503. The FIRST mail is sent from `verifyRegistration` in `auth_controller.ts` when the first passkey is registered (not at signup, so abandoned signups send nothing), best effort: a failure is only logged and the user can use "resend". Limiters `emailSendLimiter` (per user) and `emailVerifyLimiter` (per IP) in `middleware/rateLimit.ts`; `userLimiter(name, limit, message)` now takes the full message. Verification needs NO login (the link may be opened on another device). Tests: `emailverify.test.ts` (9; the token is read from the mocked `sendMail` call). Known gap: the "mail after the first passkey" hook has no automated test (passkey registration cannot be automated); check it with a real browser signup after step 2b. Manual check passed (user report): `fan1@test.com` verified through the real mail + token flow. Local test accounts need `emailVerifiedAt` set by SQL for the gated actions in step 3 (`fan1` is verified now, `dev1` is not).
- **Repo visibility:** the GitHub repository is **PRIVATE** (confirmed again by the user in session 7; it had once been found public at the start of session 5 and was switched; the history check `git log --all --name-only --pretty=format: | Select-String -Pattern '(^|/)\.env'` printed nothing). Making it public is the LAST step. Before that: review `api.http` and `state.md` (Windows paths, notes), add a README and a LICENSE, re-run the history check, enable GitHub secret scanning, and check that no old secret value (including the old `secure_postgres_pass`, still in git history) is used anywhere real. Git history is permanent.

---

## 4. Repo layout (actual)

```
Mirai_Hub/
  .dockerignore              excludes node_modules, dist, .env files, **/.git (also nested repos), .github, .vscode, logs (keeps secrets out of images)
  .github/workflows/ci.yml   typecheck, build, tests (Postgres + Redis services), docker build (API image and nginx + web image)
  apps/
    api/
      Dockerfile, Dockerfile.nginx, package.json, tsconfig.json, .env (git-ignored)
      config/nginx.conf      the nginx config copied by Dockerfile.nginx (only copy)
      vitest.config.ts       MUST be here (apps/api root), not in tests/
      src/
        app.ts               Express app, exported (order matters, see section 7)
        server.ts            only app.listen
        run-worker.ts        REAL BullMQ worker (concurrency 5, graceful shutdown) + starts the outbox relay and the orphan cleanup; calls fanOut(job.data)
        lib/                 config.ts (incl. lazy storageConfig()), prisma.ts, redis.ts, queue.ts (enqueueNotification -> outbox row; publishNotification -> BullMQ), outbox.ts (relayOnce, purgePublished, startOutboxRelay), mail.ts (sendMail via nodemailer/SMTP), storage.ts (S3 client: putObject, deleteObject, publicUrl, mediaUrl, ensureBucket), images.ts (toWebp, shared sharp pipeline), errors.ts, http.ts
        middleware/          auth.ts (signToken, requireAuth, requireEnrollOrAuth, requireRole, optionalAuth), rateLimit.ts
        controllers/auth_controller.ts
        routes/              auth.ts, projects.ts, dev.ts, feedback.ts (follows + feedback + votes + status + reply), posts.ts, notifications.ts, feed.ts, users.ts
        services/            projects.ts, follows.ts, feedback.ts, posts.ts (incl. covers), notifications.ts, feed.ts, users.ts, avatars.ts, orphans.ts (cleanup of unfinished signups), emailVerification.ts (verification tokens and mails)
      scripts/storage-check.ts   manual object-storage check (not part of build or tests)
      scripts/mail-check.ts      manual mail check (sends one mail; look in Mailpit at http://localhost:8025)
      tests/
        env.ts               test env values (DB must be mirai_hub_test; see section 3 "Secrets out of compose" for what changed)
        global-setup.ts      applies migrations to the test DB once per run
        setup.ts             mocks lib/prisma (client bound to test URL), lib/queue (spy around the real enqueueNotification + fake publishNotification), lib/storage and lib/mail
        helpers.ts           resetDb (TRUNCATE before each test incl. "OutboxEvent", refuses any DB except mirai_hub_test), anon, makeUser/makeProject/makeFeedback, loginAs, scenario (owner + fan1 + fan2 who both follow the project)
        projects (3), feedback (14), posts (11), notifications (10), follows (6), browse (10), profiles (10), projectdetail (2), reply (10), replynotify (6), ownerrules (6), feedbackpost (6), avatar (11), avatarpayloads (3), newfeedback (7), cover + logo (29 together, confirm split), outbox (7), fanoutexists (5), orphans (6), mail (3), emailverify (9) = 174 tests in 22 files, confirmed (all *.test.ts)
    web/                     React app (Vite). Files: index.html, vite.config.ts (proxy), tsconfig.json, postcss.config.js (MUST be .js, see gotchas), tailwind.config.ts, global.d.ts (old, outside tsconfig), src/main.tsx, src/App.tsx (routes + AuthProvider + bell in the header and your name (links to your profile); `Narrow` wrapper keeps non-Home pages at max-w-lg, Home is max-w-3xl), src/api.ts (types incl. BrowseProject, FeedPost, FeedbackItem, NotificationType with FEEDBACK_REPLY and NEW_FEEDBACK; avatarUrl / coverUrl / logoUrl; `api()` fetch helper and `uploadFile()` for multipart), src/auth.tsx, src/useApi.ts, src/labels.ts, src/index.css; src/pages/: Home.tsx, Signup.tsx, Login.tsx, NewProject.tsx, ProjectPage.tsx, Profile.tsx; src/components/: RequireAuth.tsx, FollowButton.tsx, PostList.tsx, FeedbackSection.tsx, NotificationBell.tsx, ProjectCard.tsx, FeedList.tsx, Avatar.tsx
    desktop/                 Electron: src/main.ts, src/preload.ts
  packages/
    database/                schema.prisma, migrations/, .env (DATABASE_URL, git-ignored)
  docker/                    SeaweedFS S3 config (throwaway dev values; no longer tracked in git, see section 3)
  docker-compose.yml
  .env                       root: JWT_SECRET (and, since the secrets commit, probably more) for compose (git-ignored)
  state.md
```

Root `package.json` has `"workspaces": ["apps/*", "packages/*"]` (verified).

`apps/api/package.json` scripts: `dev` (ts-node-dev API), `worker` (ts-node-dev worker), `test` (`vitest run`), `test:watch`, `build` (tsc), `start`. Root: `dev:web`.

### Database migrations (in order, latest last)
`20261005005808_init`, `20261012030544_add_notifications`, `20261012033837_add_post_updated_at`, `20261026045222_add_browse_indexes`, `20261026103721_add_user_bio`, `20261027071341_add_feedback_reply`, `20261027074319_add_feedback_reply_notification`, `20261027082913_add_feedback_post`, `20261028004139_add_user_avatar`, `20261028014625_add_post_cover`, `20261029013930_add_project_logo`, `20261029142812_add_new_feedback_notification`, `20261029231924_add_outbox` (checked in session 7), then `20261030120412_add_email_verification` (session 7, email step 2a; list confirmed by the user).
List them from the REPO ROOT with `Get-ChildItem packages\database\migrations | Select-Object Name` (it does not work from `apps/api`).

### API endpoint reference (all under `/api`)

| Method + path | Auth | Notes |
|---|---|---|
| `POST /auth/signup`, passkey register/login, `GET /auth/me`, `POST /auth/logout` | mixed | JWT cookie, `purpose` session vs enroll; `/auth/me` returns id, email, name, role, `avatarUrl`, `emailVerified` (boolean) |
| `POST /auth/verify-email/send` | auth | "resend": creates a fresh token (older unused ones stop working) and mails the link; 5 per hour per user (429); `{ success, alreadyVerified }`; 503 if the mail cannot be sent |
| `POST /auth/verify-email` | none | body `{ token }` (20-200 chars); single use, 24 h; invalid, used or expired = the same 400 `This link is invalid or has expired`; 30 per 15 min per IP; POST on purpose (mail scanners prefetch GET links) |
| `POST /dev/login` | none | dev/test only, needs `ENABLE_DEV_LOGIN=true` (not set in compose) |
| `POST /projects` | DEV | create |
| `GET /projects?sort=new\|followers` | public | browse list, max 50: id, slug, name, tagline, createdAt, `logoUrl`, `owner {id, name}` (never the email), `_count` followers/feedback; no vision text |
| `GET /projects/mine`, `GET /projects/:slug`, `PATCH /projects/:id` | auth / public / owner | `/mine` before `/:slug`. **Update is by UUID `:id`, not slug**; only name, tagline, vision are editable (slug is immutable). `GET /projects/:slug` includes `owner {id, name, avatarUrl}` (no email) and `logoUrl` |
| `POST/DELETE /projects/:id/logo` | owner | multipart field `logo`; returns the new `logoUrl` (null on delete); repeatable delete (session 7; confirm exact limits) |
| `PUT/DELETE /projects/:slug/follow`, `GET /me/follows` | auth | idempotent; following your OWN project returns 400 |
| `POST /projects/:slug/feedback` | auth, not the owner | 201; body `title` 3-120, `body` 1-5000, optional `postId` (UUID of a post of the SAME project, else 400); the project owner gets **403**; queues a `NEW_FEEDBACK` outbox event for the owner |
| `GET /projects/:slug/feedback?status=&postId=&sort=votes\|new` | optional | each item: `voteCount`, `hasVoted`, `author {id, name, avatarUrl}`, `ownerReply`, `ownerReplyAt`, `postId`, `post {id, title}` (nulls when none); max 50 |
| `PUT/DELETE /feedback/:id/vote` | auth | idempotent, returns `{ voteCount }`; **PUT by the project owner = 403**, DELETE stays allowed |
| `PATCH /feedback/:id/status` | owner | outbox event if changed |
| `PUT /feedback/:id/reply` | owner | body `{ text }` (1-2000, trimmed); creates or overwrites; the first reply queues `FEEDBACK_REPLY`; returns the feedback |
| `DELETE /feedback/:id/reply` | owner | clears `ownerReply` + `ownerReplyAt`; repeatable (200 again) |
| `POST /projects/:slug/posts` | owner | types VISION / ANNOUNCEMENT / CHANGELOG; queues `NEW_POST`; response carries `coverUrl` (null) |
| `GET /projects/:slug/posts?type=` | public | newest first, max 50, each with `coverUrl` |
| `PATCH /posts/:id` | owner | partial title/body/type, at least one field, no re-notify |
| `DELETE /posts/:id` | owner | also deletes its NEW_POST notifications and its cover object; feedback linked to it stays (link cleared by SetNull) |
| `POST/DELETE /posts/:id/cover` | owner | multipart field `cover`; WebP max 1600 px wide; returns `{ coverUrl }`; delete is repeatable (session 7; confirm exact limits) |
| `GET /me/notifications?unread=true`, `GET /me/notifications/unread-count` | auth | types FEEDBACK_STATUS, NEW_POST, FEEDBACK_REPLY, NEW_FEEDBACK |
| `PATCH /notifications/:id/read`, `POST /me/notifications/read-all` | auth | scoped to own rows (404 otherwise) |
| `GET /users/:id` | public | profile: id, name, bio, `avatarUrl`, role, createdAt and `projects`; **never the email**; UUID in the URL |
| `PATCH /me` | auth | edit own `name` (1-80) and `bio` (max 500; empty string clears it to null); unknown keys such as role/email are dropped by zod; a body with nothing editable returns 400 |
| `POST /me/avatar` | auth | multipart field `avatar`, one file up to 2 MB (PNG/JPEG/WebP by magic bytes; SVG/GIF/other = 400; too large = 413); re-encoded to 256x256 WebP; 5 uploads per hour per user (429); returns `{ avatarUrl }`; the old object is deleted |
| `DELETE /me/avatar` | auth | clears the avatar and deletes the object; repeatable; returns `{ avatarUrl: null }` |
| `GET /feed?scope=all\|following` | public; `following` needs login (401) | recent posts across projects, newest first, max 50: id, type, title, createdAt, `project {slug, name}`, `excerpt` (240 chars + "…"), cover thumbnail URL (confirm field name) |

### Project rules (zod in `routes/projects.ts`)

- `name`: 1-80 chars (required). `tagline`: max 160 (optional). `vision`: max 5000 (optional).
- `slug` (create only, required): trimmed + lowercased, 3-40 characters, letters/numbers/dashes, must not start or end with a dash, regex `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`; reserved: `mine`, `new`, `admin`, `api`. Duplicate slug returns 409.
- Create needs a signed-in DEV (CONSUMER gets 403, anonymous 401). Update: partial, owner only (enforced in the service).

### Rate limits (per IP unless noted; counters live in Redis since session 7)

| Limiter | Limit |
|---|---|
| Global (`/api`, except `/health`) | 300 / minute |
| Writes (POST/PUT/PATCH/DELETE, except `/auth`) | 60 / minute |
| Signup | 10 / hour |
| Passkey register/login steps | 30 / 15 minutes |
| Feedback creation | 10 / 10 minutes |
| Avatar upload (per USER, not per IP) | 5 / hour |
| Cover uploads (per USER) | 20 / hour |
| Logo uploads (per USER) | 10 / hour |
| Verification mail ("resend", per USER) | 5 / hour |
| Opening a verification link (per IP) | 30 / 15 minutes |

Responses: 429 with `{ "error": "Too many requests, please try again later" }`; `RateLimit` and `RateLimit-Policy` headers on all responses. Limits are skipped when `NODE_ENV=test`.

---

## 4b. Local environment (Windows, Node 24)

**Published ports on the host** (Windows blocked 5432):

| Service | Host port | Container port |
|---|---|---|
| nginx | 8080 | 80 |
| Postgres | 127.0.0.1:5433 | 5432 |
| Redis | 127.0.0.1:6380 | 6379 |
| API (npm run dev) | 5000 | n/a |
| SeaweedFS (S3 API for images) | 127.0.0.1:8333 | 8333 |
| Mailpit SMTP (dev mail catcher) | 127.0.0.1:1025 | 1025 |
| Mailpit inbox (web UI) | 127.0.0.1:8025 | 8025 |

Inside Docker, containers use service names: `postgres-db:5432`, `redis-cache:6379`. The `api-server` container is not published directly; reach it through nginx on 8080.

**Two ways to run (pick one at a time for the worker):**

1. **Local dev (default while coding):** start only the data services, then run the API and worker with npm.
   ```powershell
   cd C:\Users\PC_User\Desktop\Mirai_Hub
   docker compose up -d postgres-db redis-cache seaweedfs mailpit
   docker compose ps   # postgres "healthy", the others "Up"
   ```
   Terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`; **required for notifications since the outbox: the worker runs the relay**), web (`npm run dev:web` from the repo root, then open `http://localhost:5173`), tests/manual calls (PowerShell where `$s` owner and `$c` consumer sessions live). Type-check the frontend with `npx tsc --noEmit` from `apps/web`. (In Docker mode nginx serves the built frontend at `http://localhost:8080`.)
2. **Full stack in Docker (the production-like setup):** `docker compose up -d --build`, then open `http://localhost:8080` (sign in with a passkey: `ENABLE_DEV_LOGIN` is deliberately not set in compose, so there is no dev login there). **Don't run the local `npm run worker` at the same time as the `queue-worker` container**: both consume the same Redis queue and both run an outbox relay (harmless but you can't tell which handled a job). The local API on 5000 and the container API share the same dev database and Redis. Back to local development: `docker compose stop api-server queue-worker nginx`, then start the local worker again.

**Automated tests:** from `apps/api`, `npm test` (API and worker don't need to be running; Postgres and Redis do). A full run takes ~110 s now (21 files). One-time setup of the test database:

```powershell
'create database mirai_hub_test;' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub
```

Migrations are applied to it automatically on each run.

**Env files (all git-ignored, never commit or paste secrets):**
- `/.env` (git-ignored; placeholders listed in the tracked `/.env.example`): `JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (compose refuses to start when one is missing).
- `/apps/api/.env`: `PORT=5000`, `JWT_SECRET`, `REDIS_URL=redis://localhost:6380`, `RP_ID=localhost`, `ORIGIN=http://localhost:5173`, `ENABLE_DEV_LOGIN=true`, and `DATABASE_URL=postgresql://<user>:<password>@localhost:5433/mirai_hub?schema=public` (no quotes; the API reads this at runtime)
- `/packages/database/.env`: `DATABASE_URL="postgresql://<user>:<password>@localhost:5433/mirai_hub?schema=public"`
- `/apps/api/.env` also holds the six storage variables (section 3, "Local object storage"); they are only read when the storage code runs.
- `/apps/api/.env` also holds `TEST_DATABASE_URL` (database `mirai_hub_test`, read by `tests/env.ts`) and the mail variables for local runs: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_FROM=Mirai Hub <noreply@mirai-hub.local>`.
- `.env` files take only `#` comments on their own line; save as UTF-8 without BOM (if a variable "isn't found", rewrite with `Set-Content -Encoding ascii`).
- `.env` is read **only at startup**: after editing, stop `npm run dev` (Ctrl+C) and start it again. The worker reads `REDIS_URL` from the same `apps/api/.env`.
- A `$env:DATABASE_URL=...` set in PowerShell overrides the `.env`; clear with `Remove-Item Env:DATABASE_URL`.
- Test values live in `apps/api/tests/env.ts` (the test DB URL comes from `TEST_DATABASE_URL`, see section 3). CI uses service containers on ports 5433 / 6380.

**Docker-mode values** (set in compose for the API; the worker gets the same `NODE_ENV`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET`, `RP_ID`, `ORIGIN` because `lib/config.ts` requires them): `ORIGIN=http://localhost:8080`, `RP_ID=localhost`, `NODE_ENV=development`.

**Commands:**
- Prisma commands run from `packages/database` (or pass `--schema=packages/database/schema.prisma`). `Get-ChildItem packages\database\migrations` only works from the REPO ROOT.
- New migration (local only): stop the API and worker first, then `npx prisma migrate dev --name <name>`. Containers use `prisma migrate deploy` (the API container runs it on start). After a migration restart the API and worker (new Prisma client), rebuild images (`docker compose up -d --build`), and in VS Code run **TypeScript: Restart TS Server**.
- Run API: from `apps/api`, `npm run dev`. **Keep exactly one dev terminal for the API and one for the worker.** A duplicate gives `EADDRINUSE`. Find the culprit with `netstat -ano | findstr :5000`.
- Type-check: from `apps/api`, `npx tsc --noEmit` (not from the repo root; typo `--noEmi` gives TS5025). A clean run prints only the `npm notice` lines. `npm run dev` uses `--transpile-only`, so it never shows type errors. `tsc` only covers `src/`, not `tests/`.
- Validate compose: `docker compose config --quiet`. Container logs: `docker compose logs --tail 30 api-server queue-worker`.
- Prisma CLI prints `Assertion failed ... UV_HANDLE_CLOSING` on Node 24 at exit. Harmless.
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- **Query the DB from PowerShell** (pipe through stdin, otherwise PowerShell strips the double quotes):
  `'select type, "userId", "dedupeKey", "readAt" from "Notification" order by "createdAt";' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`
  Outbox: `'select type, "dedupeKey", "publishedAt" from "OutboxEvent" order by "createdAt";' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`
  For a statement with quoted names plus a string use a double-quoted string with doubled quotes, e.g. `"delete from ""User"" where email = 'x@test.com';" | docker compose exec -T ...`
- Header check: `(Invoke-WebRequest $url -UseBasicParsing).Headers | Format-List`. Raw JSON check: `(Invoke-WebRequest $url -UseBasicParsing).Content`.

---

## 5. Status

### Done and confirmed working
- [x] Schema: User, DevicePasskey, Project (with `logoKey`), Post (with `updatedAt`, `coverKey`), Feedback (with `ownerReply`, `ownerReplyAt`, `postId`), Vote, Follow, Notification, OutboxEvent + enums (Role, PostType, FeedbackStatus, NotificationType with `FEEDBACK_REPLY` and `NEW_FEEDBACK`), UUIDv7 with `@db.Uuid` everywhere. All migrations applied.
- [x] `lib/` shared clients and config (required env vars, no fallback secrets)
- [x] `app.ts`: helmet, CORS with credentials, `trust proxy`, rate limiters, 100kb body limit, cookie-parser, health route, single error handler (`AppError`, `ZodError`)
- [x] Auth backend: signup, passkey register/login (usernameless), `me`, `logout`; JWT cookie with `purpose`
- [x] Dev-only login shortcut `POST /api/dev/login` (needs `ENABLE_DEV_LOGIN=true`, never in production, never in compose)
- [x] `projects` routes + service: create (DEV only), `mine`, get by slug, update (owner only)
- [x] Follows, feedback, votes, owner-only status
- [x] Posts: create, list, update, delete (owner only)
- [x] Notifications end to end: queue (5 attempts, exponential backoff), fan-out, real worker, read routes (list, unread count, mark read, read-all)
- [x] Rate limiting verified (10 feedback creations ok, 11th and 12th returned 429)
- [x] **Docker (Phase 0.5):** `.dockerignore`; Dockerfile (Node 22, api workspace only); compose worker runs `node apps/api/dist/run-worker.js`; all containers Up
- [x] **nginx:** API proxied on `/api/`, `X-Forwarded-For` from `$remote_addr`, serves the frontend with SPA fallback (session 4)
- [x] **CI workflow** `ci.yml`: Node 22, Postgres + Redis services, typecheck, build, `npm test`, Docker image builds. Green on GitHub (confirmed by the user in session 7).
- [x] **Frontend (sessions 3-4):** passkey signup/login, create project, public project page, owner controls, notification bell, edit project, Home tabs, profiles; browse API; nginx serves the frontend
- [x] **Session 5:** owner reply, reply notifications, owner rules, feedback linked to a post, local object storage (SeaweedFS + `lib/storage.ts`)
- [x] **Session 6:** avatars end to end (browser check passed, session 7)
- [x] **Session 7, before this chat:** post covers (API, UI, feed thumbnails, tests; browser check passed), project logos (API, UI in Edit project, shown on project page, cards, feed, profiles), secrets moved out of compose/tests/CI (commit 5b7fd05), `npm audit fix` patch updates (79d304b), the `:8080` passkey test with the production-like stack passed (user report).
- [x] **Session 7, NEW_FEEDBACK (commit 3a460c4):** migration + enum, `fanOutNewFeedback`, `feedback.ts` hook, bell text, `newfeedback.test.ts`; `tsc` clean in both apps, browser check passed.
- [x] **Session 7, OUTBOX (committed, pushed, CI green):** `OutboxEvent` table + migration `add_outbox`, `enqueueNotification(job, tx)` writes the outbox row inside the action's transaction, relay in `lib/outbox.ts`, started by `run-worker.ts`, `outbox.test.ts` (7), `tests/setup.ts` / `helpers.ts` updated, three old assertions got `expect.anything()`. `npm test` = **18 files / 151 tests passing**. Manual checks of the relay and of Redis down for a new post were reported as done before the user moved on to step 2 (confirm).
- [x] Old marketing code removed
- [x] **Session 7, email verification backend (step 2a):** schema + migration, `services/emailVerification.ts`, verify and resend routes, mail after the first passkey, new limiters, `/auth/me` returns `emailVerified`, `emailverify.test.ts`; `tsc` clean, **`npm test` = 22 files / 174 tests passing**, CI green, manual check passed (user report).
- [x] **Session 7, mail module (email step 1):** `lib/mail.ts`, `smtpConfig()`, Mailpit service in compose, `mail-check.ts`, `mail.test.ts`; `npm test` = **21 files / 165 tests passing**; `mail-check` printed `Mail sent` (user report); commit `be3f718` pushed.
- [x] **Session 7, orphan-user cleanup:** `services/orphans.ts` + worker hook + `orphans.test.ts`; `npm test` = **20 files / 162 tests passing**; manual check passed (user report). Committed and pushed.
- [x] **Session 7, Redis-backed rate limits:** `middleware/rateLimit.ts` uses `rate-limit-redis` (one `RedisStore` per limiter, prefix `rl:<name>:`, `passOnStoreError: true`, same limits as before, still skipped under `NODE_ENV=test`); manual check passed (429 persists across an API restart), CI green (user report).
- [x] **Session 7, outbox and fan-out checks committed:** the outbox commit was pushed and the GitHub Actions run is green (user report). Step 3 (existence checks in `fanOutToFollowers`) is done: `npx tsc --noEmit` clean, **`npm test` = 19 files / 156 tests passing** (user report). Step 3 is committed and pushed.

### Still to confirm (small checks, do first next session)
- [ ] **Manual Redis-down check for a status change and a reply** (stop `redis-cache`, act as the owner, start it again, the notifications arrive; the worker may print `Redis error` lines meanwhile). The outbox and its tests are done; only this manual check is open.
- [ ] Fill the remaining `(confirm)` items in sections 3 and 4: the `cover.test.ts` / `logo.test.ts` split (`npx vitest run tests/cover.test.ts`), upload size and rate limits for covers and logos, nginx locations for the cover and logo paths, how `ci.yml` provides `TEST_DATABASE_URL` and the other values, what the "feedback update picker" changed in the UI.
- [ ] **First real browser signup with mail** (after step 2b): a fresh signup + passkey should put a verification mail in Mailpit (`http://localhost:8025`); this is the only check of the first-passkey hook.
- [ ] Clean up test data when done testing: test accounts in the dev DB (`delete from "User" where email = '...'`) and the matching `localhost` passkeys on the device.

### Test gaps (known, add when touching these areas)
- `PATCH /projects/:id` (owner-only update)
- Rate limiting, including the per-user upload limits (limiters are switched off under `NODE_ENV=test`)
- The BullMQ worker itself (queue publish is mocked; fan-out and the outbox relay are tested directly)
- Auth/passkey flow and signup (409 on duplicate email, enroll cookie); only the dev login is used in tests

### Not started
- [ ] **Email step 2b: frontend** (`/verify-email` page that reads the token from the URL and POSTs it; banner for signed-in users with an unverified email and a "resend" button; `emailVerified` on the `User` type in `api.ts`; a small hint on Signup) **<- next**
- [ ] **Email step 3: gating** (`requireVerified` on follow, vote, feedback, uploads and project creation; reading stays open; clear message + UI hint)
- [ ] **Email step 4: email-link login** (existing verified accounts only; sign-in and recovery; no email-only signup)
- [ ] **Domain decision** (also fixes `RP_ID` for passkeys), then the **R2 switch** (step 6c)
- [ ] Rest of hardening (store the status on the notification, finish the `npm audit` review, multi-stage non-root image, remove dev login, structured logging + error tracker, HTTPS + security headers)
- [ ] Deploy (domain, server, HTTPS, production env, email sender, backups)
- [ ] Prometheus + Grafana, load tests (k6)
- [ ] Electron checks (desktop shell, WebAuthn inside Electron)

---

## 6. How to test by hand (PowerShell, local API + worker running)

Cookies are kept with `-SessionVariable` / `-WebSession`. The dev login only works for users that exist (sign them up first). `dev1@test.com` (DEV) owns the project `my-game`; `fan1@test.com` is a CONSUMER who follows it. Most of this is covered by `npm test`; use this for quick manual checks.

```powershell
$base = "http://localhost:5000/api"; $json = 'application/json'

# Sessions
Invoke-RestMethod "$base/dev/login" -Method Post -ContentType $json -Body '{"email":"dev1@test.com"}' -SessionVariable s
Invoke-RestMethod "$base/dev/login" -Method Post -ContentType $json -Body '{"email":"fan1@test.com"}' -SessionVariable c

# Follow, feedback (notifies the owner), vote (second vote must keep count at 1)
Invoke-RestMethod "$base/projects/my-game/follow" -Method Put -WebSession $c
$fb = Invoke-RestMethod "$base/projects/my-game/feedback" -Method Post -ContentType $json -WebSession $c -Body '{"title":"Add fishing","body":"Please add a fishing minigame"}'
Invoke-RestMethod "$base/feedback/$($fb.id)/vote" -Method Put -WebSession $c
Invoke-RestMethod "$base/feedback/$($fb.id)/vote" -Method Put -WebSession $c

# Owner changes status (worker log should print "1 notifications created"; pick a status the item doesn't have yet)
Invoke-RestMethod "$base/feedback/$($fb.id)/status" -Method Patch -ContentType $json -WebSession $s -Body '{"status":"PLANNED"}'

# Owner reply (first reply notifies the author and voters; edits do not)
Invoke-RestMethod "$base/feedback/$($fb.id)/reply" -Method Put -ContentType $json -WebSession $s -Body '{"text":"We will look into it"}'
Invoke-RestMethod "$base/feedback/$($fb.id)/reply" -Method Delete -WebSession $s

# Post, edit, delete
$p = Invoke-RestMethod "$base/projects/my-game/posts" -Method Post -ContentType $json -WebSession $s -Body '{"type":"ANNOUNCEMENT","title":"Hello world","body":"First update."}'
Invoke-RestMethod "$base/posts/$($p.id)" -Method Patch -ContentType $json -WebSession $s -Body '{"body":"Edited."}'
Invoke-RestMethod "$base/posts/$($p.id)" -Method Delete -WebSession $s

# Notifications (allow a few seconds: outbox relay polls every second, then the worker)
Invoke-RestMethod "$base/me/notifications/unread-count" -WebSession $c
Invoke-RestMethod "$base/me/notifications" -WebSession $c | Format-Table type, title, status, read
Invoke-RestMethod "$base/me/notifications/read-all" -Method Post -WebSession $c
```

In `catch` blocks print the status code with `[int]$_.Exception.Response.StatusCode` (the error body alone is `$_.ErrorDetails.Message`). Creating 10+ feedback items within 10 minutes triggers the feedback rate limit; restarting the API resets all counters. Note: the project owner (`dev1`) cannot create feedback or vote on `my-game` (403), and the OWNER receives the `NEW_FEEDBACK` notification when `fan1` posts feedback (check with the `$s` session).

---

## 7. Gotchas learned (save yourself the time)

- **`app.ts` order matters:** middleware, rate limiters, body parsing, routes, then **one** error handler. Routes mounted after the error handler never run; two error handlers means the first swallows everything.
- Express 4 doesn't catch rejected promises: always wrap async handlers with `wrap()` from `lib/http.ts`.
- Route order inside a router: `/mine` must come before `/:slug`.
- "Cannot POST /x" is Express's 404: the route isn't mounted (wrong file, missing flag, stale process), not a logic bug.
- A **500 with no details** means look at the dev terminal for the stack trace. Usual causes: Postgres not running, wrong/missing `DATABASE_URL`, stale Prisma client (`npx prisma generate --schema=../../packages/database/schema.prisma`).
- `$env:...` overrides in PowerShell outlast `.env` edits; old terminals can keep stale servers alive.
- Windows reserves some ports (5432 failed with "access permissions"); use alternate host ports.
- Every foreign key must carry `@db.Uuid` or the migration fails with "incompatible types: text and uuid" (`prisma validate` doesn't catch it).
- Adding a required column to an existing table needs a default. Optional columns (`String?`) need none.
- Compose `${JWT_SECRET:?...}` fails the whole file if the root `.env` is missing (and the same pattern applies to any other required variable).
- Never `cd` into a file; create files from PowerShell with `Set-Content -Encoding ascii` or in the VS Code sidebar.
- Check which folder you're in before using relative paths (`apps\api\package.json` from inside `apps\api` doubles the path; `packages\database\migrations` from inside `apps\api` does not exist). `npm test`, `npm run dev` and `npm run worker` only exist in `apps/api` (at the repo root only `dev:web` exists: "Missing script" means wrong folder).
- BullMQ job ids can't contain `:`; use `-` in dedupe keys.
- PowerShell strips double quotes when passing SQL to `docker compose exec`; pipe the query via stdin.
- With the worker stopped, events wait in the `OutboxEvent` table (and jobs wait in Redis) and are processed when it starts. Two workers (local + container) share one queue. **After adding a notification type or changing `fanOut` or the relay, restart the worker.**
- **Vitest only loads `vitest.config.ts` from the project root (`apps/api`).** When it sat in `tests/`, vitest silently ignored it and tests ran against the DEV database (the wipe guard blocked it). If tests ever connect to `mirai_hub` again, check this first.
- Tests build their own Prisma client with the test URL (`vi.mock('../src/lib/prisma')` in `tests/setup.ts`), and `resetDb` checks `current_database()` before every TRUNCATE. Keep both guards.
- `ERESOLVE` when installing vitest: it needs `@types/node` ^22 or >=24; `apps/api` uses `@types/node@^22`. Never use `--force` / `--legacy-peer-deps` for that.
- Vite prints a harmless warning about `configLoader: 'native'` (ESM syntax in a CommonJS package). Don't add `"type": "module"` to `apps/api/package.json`. `$env:VITE_CONFIG_NATIVE_IGNORE_WARNING = "true"` hides it. If `npm test` output stops right after that warning, it was only cut off: wait for the full run (~90 s) and read the bottom lines.
- The first request in each test file takes ~2 s (cold DB connection).
- Rate-limit counters are in Redis (prefix `rl:`): a restart does NOT reset them. To reset while testing: `docker compose exec redis-cache redis-cli --scan --pattern "rl:*"` lists them; delete with `redis-cli del <key>`.
- **Without a `.dockerignore`, `COPY apps/api` bakes `apps/api/.env` (secrets) and Windows `node_modules` into the image.** Keep the root `.dockerignore`.
- A GitHub workflow file must end in `.yml`/`.yaml`; a stray character (`ci.yml;`) means it never runs.
- Don't `npm install -g prisma` in images (use the local 5.22 via `npx`). Ignore the "Update available 8.0.0" box.
- The worker container needs `JWT_SECRET`, `RP_ID` and `ORIGIN` in its env even though it doesn't use them (`lib/config.ts` requires them), and `command: node apps/api/dist/run-worker.js`.
- Keep the Node major aligned: images and CI use 22, local is 24 (types are `@types/node` 22).
- In Windows PowerShell 5.1, `Invoke-RestMethod <url> | Select-Object title` can print a single blank row when the response is a JSON array. Assign to a variable first or check `(Invoke-WebRequest <url> -UseBasicParsing).Content`.
- `.dockerignore` excludes `**/.git` (an old nested repo was moved out in session 4).
- **`apps/web/postcss.config` must be `.js`** (package is `"type": "module"`). A `postcss.config.ts` makes Vite fail with `ERR_REQUIRE_ESM`. Config changes need a Vite restart.
- Newer npm blocks install scripts and prints "install scripts blocked" (esbuild, prisma, electron, msgpackr-extract). Harmless for now. If Vite complains about esbuild: `npm install-scripts approve esbuild@0.21.5`; for the desktop app: `npm install-scripts approve electron`. Never `npm audit fix --force`.
- "API not reachable" on the web page means the API terminal isn't running or the Vite proxy isn't active (restart Vite).
- An abandoned signup (account created, passkey step never finished) locks that email with a 409 until the orphan cleanup removes the row (account older than 1 hour, no passkey, no activity, worker running); to free it sooner delete the row: `"delete from ""User"" where email = 'x@test.com';" | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`. Proper fix: orphan-user cleanup (Phase 4). `dev1@test.com` / `fan1@test.com` have no passkeys, so they only work through the dev login.
- **The test count is the proof that a new test file was picked up** (now **165 tests in 21 files**). Test files must be `apps/api/tests/*.test.ts`; a misspelled name is silently ignored.
- **`enqueueNotification` takes `(job, tx)` since the outbox:** tests that assert the call need `expect.anything()` as the second argument, otherwise they fail with "expected vi.fn() to be called with arguments [ObjectContaining]" while the received call shows the job plus a transaction client.
- **If outbox tests fail with "expected 1 row, got 0",** check `vitest.config.ts` for `mockReset: true` / `restoreMocks: true`: they wipe the wrapped real implementation in `tests/setup.ts`.
- **The vitest summary does not name the failing test:** use `npx vitest run 2>&1 | Out-File -Encoding utf8 test-out.txt`, then `Select-String -Path test-out.txt -Pattern 'FAIL|AssertionError' -Context 2,15`, and delete `test-out.txt` afterwards (never commit it).
- Following a project needs no special role: a DEV can follow another DEV's project. If a Follow button seems to work "on your own project", check that the project is really yours.
- `git ls-files | findstr .env` gives a false alarm on `apps/api/tests/env.ts`. Use `git ls-files | Select-String -Pattern '(^|/)\.env'` (must print nothing) and `git check-ignore -v .env apps/api/.env packages/database/.env` (3 lines).
- **Testing two accounts at once:** use a normal window for the DEV and a private window for the consumer; passkeys work in private windows. Always `localhost:5173`.
- If the API/worker terminals spam `Redis error`, the data containers are not running: `docker compose ps` printing an empty table means nothing is up. Start Docker Desktop, then `docker compose up -d postgres-db redis-cache`.
- **Where the edit controls are:** "Edit project" is a button under the project header (owner only); Edit / Delete on a post only exist on an existing post; the status dropdown and Reply links only appear on the owner's own project. Nothing shows if you are signed in as another account.
- After editing frontend files, Vite hot-reloads by itself: a hard refresh (Ctrl+F5) is enough. Restart `npm run dev:web` only after config changes or if a red error overlay sticks.
- You don't need two logged-in accounts at once: notifications are stored in the DB, so one window can do owner step, sign out, consumer step.
- `git commit` printing "nothing to commit, working tree clean" is not an error. "Your branch is ahead of 'origin/main' by N commits" means those commits are not pushed yet; GitHub Actions only runs on pushed commits.
- Editing `schema.prisma` does not create a migration: check that a new folder exists in `packages/database/migrations` after `prisma migrate dev`. When Prisma asks to reset the database (drift), answer no.
- **Serving the built app from nginx:** `include /etc/nginx/mime.types;` is required; deep links and reloads need `try_files $uri /index.html;`.
- A "notifications created" line in the container worker's log does not prove a request came through `:8080`.
- **CI only builds what the workflow builds:** when a Dockerfile starts building something new, add a CI build step for it.
- **`EPERM: operation not permitted, rename ...query_engine-windows.dll.node` after `prisma migrate dev`:** stop the API and worker BEFORE migrating. If it still happens: stop them, run `npx prisma generate --schema=packages/database/schema.prisma` from the repo root, restart.
- **VS Code shows red underlines after a migration while `tsc` and the tests are fine:** `Ctrl+Shift+P` -> **TypeScript: Restart TS Server**. Needed after every migration.
- **Pasting a replacement function into a file can duplicate it** (TS2323, TS2393): select the old function and delete it first, or replace the whole file.
- A `tsc` error "missing the following properties ..." means a prop edit in the parent was missed: when a component gets new required props, update every place that renders it.
- **`git push` rejected with "fetch first":** never `git push --force`. Run `git fetch`, `git log --oneline HEAD..origin/main`, then `git pull --rebase` and `git push`; if the rebase conflicts, `git rebase --abort`.
- **Check the repo is private before work** (a "Private" label on its GitHub page).
- **MinIO is archived: don't use `minio/minio` or `minio/mc`.** Local S3 stand-in is SeaweedFS (section 3). Garage was judged to need more setup.
- **SeaweedFS notes:** wait ~10 s after `docker compose up -d seaweedfs` before the first request (`ECONNREFUSED` = not ready); "Fixing /data ownership" is normal. A public GET returning 403 means the `anonymous` identity was not applied: check the S3 JSON config, then `docker compose restart seaweedfs`. Keep the image tag pinned.
- After adding an npm dependency the lock file changes: commit `package-lock.json`, because the Docker build and CI run `npm ci`.
- **A strict `toEqual` test breaks when a response gains a field** (happened with `avatarUrl`, expect the same with `coverUrl` / `logoUrl`-like additions).
- **Pasting a replacement service block into `docker-compose.yml` can duplicate keys:** replace the whole file and validate with `docker compose config --quiet` before building.
- **Multipart uploads:** with `FormData` never set `Content-Type` yourself. nginx answers an oversized body with an HTML 413 page, not JSON.
- **A passing `docker compose build` does not prove `sharp` works at runtime:** run `docker compose run --rm --no-deps api-server node -e "require('sharp')({create:{width:10,height:10,channels:3,background:'#ffffff'}}).webp().toBuffer().then(b=>console.log('sharp ok', b.length))"`; it must print `sharp ok` and a number.
- `tests/setup.ts` mocks `lib/storage`; the tests count `putObject`/`deleteObject` calls per test.
- **`config.ts` runs `dotenv.config()` when imported:** a test that deletes env variables and then re-imports modules (`vi.resetModules()`) gets them back from `apps/api/.env`. Set test environment values AFTER the import (see `mail.test.ts`).
- **A test file that needs the REAL `lib/mail`, `lib/queue` or `lib/storage` must use `vi.importActual`:** `tests/setup.ts` mocks all three globally.
- Git prints "LF will be replaced by CRLF" for some files on Windows: harmless.
- **Never run `npm ci` locally (not needed): it deletes `node_modules` first.** If a Node process (API, worker, Vite, VS Code's TS server) holds `node_modules\.prisma\client\query_engine-windows.dll.node`, Windows refuses with `EPERM` and `node_modules` is left half deleted (session 7). `npm install <pkg>` already updates `node_modules` and the lock file; CI and Docker are the ones that run `npm ci`. Repair: stop every Node process and close VS Code, `Remove-Item -Recurse -Force node_modules\.prisma`, `npm ci` from the repo root, then `npx prisma generate --schema=packages/database/schema.prisma`, then `npx tsc --noEmit` and `npm test`.
- **Verification links are opened with a POST from a page, never a GET endpoint:** mail scanners prefetch links and would use the single-use token up.
- **Fan-out tests need real rows:** `fanOut` for `NEW_POST` / `FEEDBACK_STATUS` now checks that the post / feedback exists in the job's project, so tests must create one (`prisma.post.create` or `makeFeedback`) and use its id as `refId`; `randomUUID()` as `refId` makes the fan-out return 0 (symptom: "expected +0 to be 2").
- **End of a session:** Ctrl+C the API and any local worker, then `docker compose down` (**never add `-v`**, it wipes the DB), then quit Docker Desktop. Terminal sessions (`$s`, `$c`) are lost; log in again next time with the two `dev/login` lines in section 6.

---

## 8. Known problems / tech debt

**Reliability:**
- **Outbox (session 7):** events are published by the worker process. If the worker is not running, notifications wait in `OutboxEvent` (not lost). A crash between publishing and marking `publishedAt` re-publishes the same jobId, which is harmless. Published rows are purged after 7 days.
- Step 3 is DONE (session 7): `fanOut` skips deleted or mismatched posts / feedback (`refExists`). Only a millisecond window remains, accepted.
- A no-op status change (same status again) still writes to the DB and bumps `updatedAt`, but queues nothing; optional early return in `setStatus`.
- `GET /me/notifications` returns the feedback's **current** status, not the status at the time of the event. Fix later: store the status on the `Notification` row (or in the job payload) if it matters.
- Reply notifications fire once per feedback item ever (the dedupe key has no timestamp). Intended anti-spam; revisit if owners need a "re-notify" action.
- `NEW_FEEDBACK` creates one notification per feedback item for the owner: for a very busy project a digest may be needed later.
- Rate-limit counters live in Redis (`rate-limit-redis`, one store per limiter with key prefix `rl:<name>:`): shared by all API containers and kept across restarts. They fail open if Redis errors (`passOnStoreError`). Limits are per IP (uploads per user).

**API consistency (small):**
- `PATCH /projects/:id` and the logo routes use the UUID while every other project route uses the slug; the frontend must use the `id` from the project object.
- Clearing a project's tagline/vision stores an empty string, not `null`; optionally normalize in `updateProject`.
- Owners' old votes (from before the owner rule) stay in the DB and count; the UI gives the owner no way to remove them (the API allows `DELETE`).

**Frontend (small):**
- The post filter dropdown on the feedback board does not see posts created in the same session (reload needed); the "About:" tag does not disappear right after the post is deleted (reload needed).
- The notification bell shows no avatars or logos.
- The frontend is functional but plain; a design pass is a later phase.

**Security (before any public deploy):**
- Email verification exists (step 2a) but is NOT enforced yet (step 3 adds the gating): until then anyone can sign up as any email and use every feature.
- Signup returns 409 for existing emails (reveals which emails have accounts).
- Orphan users: handled by the orphan cleanup in the worker (session 7); signup still reveals existing emails with a 409.
- DB password / secrets: moved out of compose, tests and CI in commit 5b7fd05 (confirm). The OLD password `secure_postgres_pass` is still in git history: never use it anywhere real. **Keep the GitHub repository PRIVATE until the review in section 3 ("Repo visibility") is done.**
- Throwaway storage keys: the SeaweedFS config file was untracked in the same commit, but earlier versions are in history (throwaway values, still never reuse them). Production uses R2 API tokens from the environment only, never from a tracked file.
- Image uploads (avatars, covers, logos) are open to signed-in users (covers and logos to owners) and email is unverified: before launch add email verification and a way to report/remove images. The nginx CSP must allow the media host in `img-src`.
- `/api/dev/login` must be deleted (or stay disabled) before launch.
- Keep Postgres/Redis bound to `127.0.0.1`; the API container port must never be published publicly (only nginx is).
- User-generated text (post/feedback/reply bodies) is stored raw; the frontend must render it escaped (React does by default) and never with `dangerouslySetInnerHTML`. If markdown is added later, sanitize.
- `npm audit`: commit 79d304b applied patch-level fixes (body-parser, qs, postcss-selector-parser). Earlier counts were 4 vulnerabilities in the API image install (1 moderate, 3 high) and 9 in the full workspace install, plus 3 reported after adding `@aws-sdk/client-s3`. Re-run `npm audit` and review what remains before any public deploy; never `npm audit fix --force`.

**Infra (remaining):**
- nginx: add HTTPS and security headers (CSP etc.) for production; consider `limit_req` at the edge.
- Production needs HTTPS and `NODE_ENV=production`; `ORIGIN` must exactly match what the browser shows; `RP_ID` is the bare domain.
- Image hardening later: multi-stage build (drop dev dependencies), run as non-root user.
- `docker compose down -v` wipes the DB volume (then rerun migrations, recreate the `mirai_hub_test` database, and recreate `dev1`, `fan1`, and the `my-game` project).

**Electron:** WebAuthn (Touch ID / Windows Hello) in Electron is historically flaky. Test early; fallback is opening the system browser for login. `expectedOrigin` can be an array. Test cookie auth inside Electron too.

---

## 9. Roadmap (in order; don't skip ahead)

Order agreed with the user: (1) feedback pieces [DONE], (2) images locally [DONE: avatars, post covers, project logos], (3) notification outbox + fan-out checks [DONE, session 7], (4) Redis-backed rate limits, orphan-user cleanup, email verification + email-link login (SMTP, Mailpit locally), (5) domain decision, then the R2 switch, (6) rest of hardening + logging, (7) deploy, (8) monitoring and load tests, (9) make the GitHub repo public, last.

**Next session starts here:**
1. Start the stack: Docker Desktop, then `docker compose up -d postgres-db redis-cache seaweedfs` (check `docker compose ps`); terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`, required for notifications because it runs the outbox relay), web (`npm run dev:web` from the repo root). Open `http://localhost:5173` (never 127.0.0.1). Check the repo shows "Private" on GitHub.
2. Clear "Still to confirm" in section 5 (Redis-down check, `(confirm)` items, Mailpit inbox, CI).
3. ~~Redis-backed rate limits~~ DONE (session 7).
4. ~~Orphan-user cleanup~~ DONE (session 7).
5. **Email: steps 1 (mail module + Mailpit) and 2a (verification backend) are DONE.** Step 2b: frontend. Files the AI needs: `apps/web/src/api.ts` and `apps/web/src/App.tsx` (it also needs `Signup.tsx` and `auth.tsx` only if a new chat has not seen them). Work: `/verify-email` page (reads `?token=`, POSTs it to `/auth/verify-email`, shows success or the error), a banner for signed-in users whose `emailVerified` is false with a "resend" button (`POST /auth/verify-email/send`, handle 429 and 503), `emailVerified` on the `User` type, then the first real browser signup check with Mailpit. Step 3: gating (`requireVerified` on follow, vote, feedback, uploads and project creation; reading stays open; clear message + UI hint; tests). Step 4: email-link login for existing verified accounts (uses `EmailToken` purpose `LOGIN`; no email-only signup).
6. **Domain decision** (write it into section 3), then the **R2 switch** (step 6c): create the Cloudflare account/bucket only now (R2 may require a payment method even for the free tier; public images on a custom domain need a domain on Cloudflare; `r2.dev` is for development only, check Cloudflare's current docs), then set the six env variables for production (region `auto`).
7. Rest of Phase 4: store the status on the notification, finish the `npm audit` review, multi-stage non-root API image, HTTPS + production nginx, remove dev login, structured logging (`pino` + `pino-http`) and an error tracker.
8. Optional small test additions (project update, signup, upload limits).

**Phase 3: Frontend (web-first)**
1. ~~Login/signup + passkey registration page~~ DONE
2. ~~Project page~~ DONE
3. ~~Dev dashboard (statuses, posts, replies)~~ DONE (owner controls on the project page)
4. ~~Notification bell~~ DONE; ~~serve the built app from nginx~~ DONE; then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, HTTPS + production nginx, remove dev login, Redis-backed rate limits, finish the `npm audit` review, multi-stage non-root image. (Done: outbox, secrets out of compose.) **Also in this phase: structured logging (`pino` + `pino-http`: JSON logs, a request id on every line, never log secrets, cookies or emails) and an error tracker (e.g. Sentry), before deploying. Very last: make the GitHub repository public** (CI and tests stay public: they hold only throwaway values; before flipping: review `api.http` and `state.md` for personal paths/notes, add a README and a LICENSE, re-run the history secret check `git log --all --name-only --pretty=format: | Select-String -Pattern '(^|/)\.env'` (must print nothing), enable GitHub secret scanning).

**Phase 4b: Deploy (not planned in detail yet; decide each item first)**
- **Choose the final domain BEFORE real users register.** Passkeys are bound to the domain (`RP_ID`); changing the domain later invalidates every passkey. Production env: `RP_ID` = the bare domain, `ORIGIN` = `https://<domain>`, `NODE_ENV=production`.
- Host: the simplest match for the current stack is one small VPS running the existing Docker Compose (nginx, API, worker, Postgres, Redis); managed Postgres/Redis and platform hosting are alternatives for later. Only ports 80/443 are open to the internet; Postgres and Redis are never public.
- HTTPS (Let's Encrypt via certbot or a Caddy front), security headers (CSP etc.) in nginx.
- Secrets from environment / a secret store, never in compose or git; a production-only `.env` on the server.
- Cloudflare R2 bucket + custom domain for images, an email sender (Resend over SMTP, needs a verified domain, see section 3 "Mail module"), DNS.
- Postgres backups (scheduled `pg_dump` stored off the server) and a tested restore.
- Later: a deploy job in CI (build, push image, restart), uptime check.

**Phase 5: Observability and load**
- Add `prom-client` metrics (request duration histogram, queue depth, outbox backlog = unpublished rows) while building routes, not afterwards
- Prometheus + Grafana containers, dashboards (latency p50/p95/p99, error rate, queue depth, DB connections)
- k6 load tests on real flows (list feedback, vote, status change + fan-out); expect first bottlenecks in the DB (indexes, vote-count queries, fan-out batching), not Node.

**Later / ideas (don't build yet):**
- discovery and search, comments on feedback (threaded discussion beyond the single owner reply), comments per post, multiple team members per project, dev analytics, desktop notifications/tray, auto-updater, public roadmap view, cursor pagination, notification digest for busy projects, inline images in posts (needs markdown + sanitizing).
- Image reference (design, all of it implemented locally): Cloudflare R2 in production (pricing checked Oct 2026: Standard storage $0.015/GB-month, permanent monthly free tier of 10 GB + 1M write-class + 10M read-class operations, zero egress fees), SeaweedFS locally, same S3 client; browser uploads go through the API (multipart, memory storage, hard size limit), magic-byte check (png/jpeg/webp only, no SVG), `sharp` re-encode, server-chosen unique key, key stored on the row, public URL = `MEDIA_PUBLIC_URL` + key; delete the old object on replace; per-user upload rate limit; before public launch: a way to report/remove abusive images and email verification.

**Rough time estimate (hobby pace):** ~10 hrs/week means ~4-5 months total, MVP in a browser at ~2-3 months from the start. Backend MVP loop, rate limiting, tests, Docker/nginx/CI, browse, profiles, the four feedback pieces, all image features, the owner notification and the outbox are finished, ahead of plan.

---

## 10. Rules for working with AI on this repo

1. Re-read sections 1 and 2 before suggesting features; if a request doesn't serve the core loop, flag it.
2. One small piece at a time, and state which files may change.
3. New logic goes in `services/` (no Express inside); routes only parse input (zod), call a service, return output.
4. Never use `companyId` or `tenant`; those belonged to the dropped design. Use `userId` and `req.user`.
5. No fallback secrets (`|| 'something'`). Required env vars go through `lib/config.ts`.
6. Never trust an id from the request body for identity; identity comes from the signed cookie.
7. Schema changes: every id and foreign key keeps `@db.Uuid`; use migrations, never `db push` in containers.
8. Commit after every working piece; use branches. New behavior gets a test in `apps/api/tests/`.
9. Don't paste `.env` contents or secrets into chats.
10. Give complete files to paste (not diffs) and say exactly where each file goes; the user is on Windows/PowerShell. Say which folder each command runs from. (Partial edits caused duplicated functions in session 5: prefer whole files, or say exactly which old block to delete.)
11. Don't guess which test failed or what a file contains: ask for the output or the file (the vitest summary doesn't name failing tests, see section 7).

## 11. Resume prompt (paste into a new chat with this file)

> I'm building Mirai Hub (two-sided feedback/vision platform, see the attached state.md). I'm on Windows/PowerShell. Read state.md fully, then start at "Next session starts here" in section 9. Keep to the rules in section 10. Ask me for specific files only when you need them, and tell me where each file goes.