# Mirai Hub: Project State

> Last updated: 2026-10-28 (end of session 6: user avatars end to end on local object storage; session 5 before it: owner replies, reply notifications, owner rules, feedback linked to a post, SeaweedFS storage layer).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~95%** (MVP loop works end to end in the browser and through the production-like Docker stack; **108 automated tests in 14 files**; CI green on GitHub as of session 4 (later runs not reported yet); browse feed, profiles, owner replies, reply notifications, owner rules and feedback-to-post link done. Avatars work end to end on local storage (SeaweedFS); left: post cover images, the R2 switch, hardening before any public deploy (the GitHub repo goes public LAST), deploy, observability, Electron).

---

## 1. Vision (don't drift from this)

A **two-sided, multi-tenant platform** connecting **consumers** and **devs/companies**:

- Devs/companies get a public **project page** to share vision, roadmap, and updates.
- Consumers **follow** projects, **submit feedback**, and **vote** on what matters.
- Devs **respond with a status** (planned / in progress / shipped / declined) and an official **reply**, and the people involved get notified.

**Core loop (the product):**

```
Dev posts update/vision -> Consumers see it -> Consumers give feedback + vote
-> Dev sees what matters -> Dev sets status / replies -> Followers, the feedback author and voters are notified -> repeat
```

If feedback disappears into a void, the product fails. The "dev responds, consumers see it" step is the point. The response is a status plus one official owner reply per feedback item (done in session 5). A full comment thread (anyone replies) is deliberately later.

**Not the goal (for now):** marketing automation, email blasts, encrypted customer lists, analytics, and *advanced* discovery (search, ranking, recommendations). The old code was a single-company marketing tool; that idea is **dropped**. **But a basic browse list is part of the loop**: without it a consumer can only reach a project by typing its URL (decided in session 3).

## 2. MVP definition (build only this first)

1. Dev signs up, registers a passkey, creates a project page.
2. Consumer signs up, follows a project, submits feedback.
3. Other consumers vote on feedback.
4. Project owner changes a feedback item's status.
5. Followers get notified of the change (BullMQ).

Everything else waits until this loop works end to end. **Backend: done, manually verified and covered by automated tests. Frontend: passkey signup/login/logout, create project, public project page (posts, feedback list, voting, submit feedback, follow), owner controls (status dropdown, post create/edit/delete, edit project, owner replies), notification bell, Home browse tabs (Discover / Following / My projects), profiles, and nginx serving the built frontend all work. Session 5 added: owner reply, reply notifications, owner-can't-give-feedback rule, feedback linked to a post. Session 6 added user avatars (upload, remove, shown in the header, profile, feedback authors and project owner). Missing: post cover images, R2 switch, hardening, deploy, Electron.**

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
| Validation | zod (every route input, including `:id` params as UUID) |
| Rate limiting | `express-rate-limit` (in-memory for now) |
| Tests | vitest 5 + supertest, against a separate Postgres database `mirai_hub_test` |
| Infra | Docker Compose (Node 22 images), nginx reverse proxy, GitHub Actions CI |
| IDs | UUIDv7 (`@default(uuid(7)) @db.Uuid`) on every id and every foreign key |
| Observability (later) | Prometheus + Grafana, `prom-client`; load tests with k6 (watch p99) |
| Images (in progress) | **Cloudflare R2** in production, **SeaweedFS** locally (same S3 client `@aws-sdk/client-s3`; MinIO is NOT used: its community edition is archived, see gotchas). Uploads go THROUGH the API and are re-encoded with `sharp` (R2 has no presigned POST). Storage layer (session 5) and avatars (session 6) done; post covers are next (step 6b). See section 9 "Later". |

Decisions:
- Single domain: nginx serves the frontend on `/` and the API on `/api` (avoids cookie/CORS pain, including in Electron). Done in session 4: `/` serves the built web app (SPA fallback), `/api/` is proxied to the API.
- nginx is the only public entry point and **overwrites** `X-Forwarded-For` with the real client address (`$remote_addr`); the API trusts one proxy hop (`trust proxy` 1) and the rate limiter relies on this.
- Logic goes in `services/` (plain functions, **no Express inside**); routes parse input with zod, call a service, return JSON. Services throw `AppError(status, msg)`; the single error handler in `app.ts` maps errors to status codes.
- `app.ts` exports the Express app (no `listen`); `server.ts` only calls `app.listen`. Needed so supertest can drive the app.
- Consumers should get low-friction login later (email link or Google); passkeys stay for devs and optional for consumers.
- Lists (feedback, posts, notifications) are capped at 50 for now (cursor pagination later).
- **Notifications:** one `Notification` row per recipient per event. The project owner is never notified of their own actions. `@@unique([userId, dedupeKey])` + `createMany({ skipDuplicates: true })` makes the worker idempotent, so BullMQ retries never double-notify.
- **Dedupe keys** contain only `-` (BullMQ job ids can't contain `:`): `status-{feedbackId}-{status}-{updatedAtMs}` (timestamp so PLANNED -> IN_PROGRESS -> PLANNED stays three distinct events), `post-{postId}` and `reply-{feedbackId}`.
- Status notifications are only queued when the status actually changed. Editing a post does **not** re-notify. Deleting a post also deletes its `NEW_POST` notifications.
- `enqueueNotification` never throws: the user's action already succeeded, a queue hiccup must not become a 500.
- BullMQ needs its own Redis connection with `maxRetriesPerRequest: null` (`createQueueConnection()` in `lib/queue.ts`). `lib/redis.ts` stays as is for normal use (passkey challenges etc.).
- **Fan-out routes by type (session 5):** `services/notifications.ts#fanOut` is the single entry point used by the worker (`run-worker.ts` and `lib/queue.ts` did not change). `NEW_POST` and `FEEDBACK_STATUS` go to followers (`fanOutToFollowers`, batches of 500, keyset on `userId`, owner excluded). `FEEDBACK_REPLY` goes to the feedback AUTHOR plus everyone who VOTED for it (`fanOutReply`; author first, then voters in batches of 500; the owner is always excluded; if the feedback was deleted or belongs to another project it returns 0).
- Notification list resolves titles via two batched queries (`FEEDBACK_STATUS` and `FEEDBACK_REPLY` read feedback, `NEW_POST` reads posts); if the referenced item was deleted, `title` is `null`. `status` is only filled for `FEEDBACK_STATUS`.
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
- **Edit project (owner):** "Edit project" button on the project header opens a form (name, tagline, vision) that calls `PATCH /projects/:id` with the project UUID; the slug is not editable. Clearing tagline/vision saves an empty string (the page treats it as "none").
- **Notification bell** (`components/NotificationBell.tsx`, rendered in the `App.tsx` header, signed-in users only): unread badge from `GET /me/notifications/unread-count`, polled every 30 s and on window focus (no websockets); the dropdown loads `GET /me/notifications` when opened. Text: `FEEDBACK_STATUS` -> "“title” is now {status}", `NEW_POST` -> "New post: title", `FEEDBACK_REPLY` -> "{project} replied to “title”" (the payload has the project name, not the owner's name; the second line also shows the project name, accepted redundancy), deleted item (title null) -> "Update in {project}". Clicking an item marks it read (`PATCH /notifications/:id/read`, optimistic) and navigates to `/p/{slug}`; "Mark all read" calls `POST /me/notifications/read-all`. Escape / outside click closes it. Owners never get notifications for their own actions (server rule).
- **Owner reply (session 5):** `Feedback.ownerReply String?` (1-2000 chars, trimmed) + `Feedback.ownerReplyAt DateTime?`. `PUT /feedback/:id/reply` (owner only; creates or overwrites; body `{ text }`) and `DELETE /feedback/:id/reply` (owner only; clears; repeatable). Both go through `getFeedbackAsOwner` in `services/feedback.ts` (404 unknown, 403 not the owner). The feedback list returns both fields (null when none). UI: "Response from {owner name}" block visible to everyone (plain text, with date); the owner gets Reply / Edit reply / Delete reply with a textarea and a 2000-character counter (`ReplyEditor` inside `FeedbackSection.tsx`). One reply per item; threaded discussion is later.
- **Reply notifications (session 5):** only the FIRST reply (when `ownerReplyAt` was null) queues a `FEEDBACK_REPLY` job with dedupe key `reply-{feedbackId}`; edits do not notify. If the owner deletes the reply and writes a new one, nobody is notified again (the `(userId, dedupeKey)` row already exists; this is intended anti-spam).
- **Owner cannot create feedback or vote on their own project (session 5):** `createFeedback` and `addVote` throw **403** `Project owners respond with replies, statuses and posts` (constant `OWNER_MSG` in `services/feedback.ts`). Removing a vote stays allowed on the API (old data cleanup). UI: the owner sees a note instead of the feedback form and the vote buttons are disabled with a tooltip (so in the UI an owner cannot remove an old vote of their own; delete by hand in the dev DB if it matters). `createFeedback` returns 404 for an unknown project. The former `P2003` catch in `addVote` was replaced by an explicit lookup (404).
- **Feedback optionally linked to a post (session 5, option A):** `Feedback.postId String? @db.Uuid`, relation to `Post` with `onDelete: SetNull`, `Post.feedback Feedback[]`, `@@index([postId])`. `POST /projects/:slug/feedback` accepts optional `postId` (UUID); the post must belong to the SAME project, otherwise 400 `That update does not belong to this project` (unknown id also 400). `GET /projects/:slug/feedback?postId=` filters (non-UUID = 400); every item includes `postId` and `post {id, title}` (null when unlinked or the post was deleted). Deleting a post keeps the feedback and clears the link. UI: `ProjectPage.tsx` holds the state `aboutPost` and passes `onGiveFeedback` / `onDeleted` to `PostList` and `aboutPost` / `onClearAbout` to `FeedbackSection`; signed-in non-owners see "Give feedback on this update" under each post, which scrolls to `#feedback` (the section id) and pre-fills "Feedback about: {title}" with a Clear link; feedback items show an "About: {title}" tag (click = filter) and the board has an "All feedback / About: {post}" dropdown. Notifications are unchanged by this link. **Known limits (left for later):** a post created in the current session is not in the filter dropdown until a reload; the tag after a post delete needs a reload.
- **Images decision (session 3):** avatars for ALL signed-in users (plus one optional cover image per post for owners), stored in **Cloudflare R2** (production) / **SeaweedFS** (local dev; MinIO was the first plan but is archived). Because R2 does not implement presigned POST (only presigned GET/PUT/DELETE/HEAD) and a presigned PUT cannot enforce a size range, uploads go through the API: multipart, hard size limit, magic-byte check, **re-encode with `sharp`** (strips EXIF and any non-image payload), then `PutObject` with a server-chosen key. Risk controls: one avatar per user (replaced, not accumulated), per-user upload rate limit, no SVG, delete replaced objects; report/removal tool + email verification before any public launch.
- **Local object storage (session 5, done and tested):** MinIO was dropped (its community edition and `mc` are archived; the official Docker image stopped updating in 2025). Local stand-in = SeaweedFS: compose service `seaweedfs` (`chrislusf/seaweedfs:4.06`, pinned, never `latest`; command `server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json -dir=/data`), published only on `127.0.0.1:8333`, data in the volume `seaweed_data`. Credentials and public access come from `docker/seaweedfs-s3.json` (throwaway dev values): identity `mirai` = Admin/Read/Write/List/Tagging with the keys from `apps/api/.env`; identity `anonymous` = `Read:mirai-media`, so images are readable by URL and nothing else is public. Bucket `mirai-media` is created by `ensureBucket()` (dev helper; in production the bucket is made in Cloudflare). `lib/storage.ts` exports `putObject(key, buffer, contentType)` (CacheControl public, 1 year, immutable: keys MUST be unique per upload, e.g. `avatars/{userId}/{uuid}.webp`), `deleteObject(key)` (best effort: logs, never throws), `publicUrl(key)` (= `MEDIA_PUBLIC_URL` + `/` + key) and `ensureBucket()`. The S3 client uses `forcePathStyle: true` and `requestChecksumCalculation` / `responseChecksumValidation` = `'WHEN_REQUIRED'` (newer SDK checksums break some S3-compatible services). `config.ts` exposes `storageConfig()`, read LAZILY on first use (so the worker, the tests and CI don't need the S3 variables; no fallback secrets). Variables in `apps/api/.env`: `S3_ENDPOINT=http://localhost:8333`, `S3_REGION=us-east-1` (R2: `auto`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET=mirai-media`, `MEDIA_PUBLIC_URL=http://localhost:8333/mirai-media`. Connection test (confirmed): from `apps/api`, `npx ts-node --transpile-only scripts/storage-check.ts` prints bucket ready / uploaded / public GET 200 / after delete 404. The `api-server` container gets the S3 variables in compose (session 6) with `S3_ENDPOINT=http://seaweedfs:8333` (container to bucket by service name) while `MEDIA_PUBLIC_URL` stays `http://localhost:8333/mirai-media` (the browser's view); the worker does not need them. R2 later: region `auto`, endpoint `https://<account>.r2.cloudflarestorage.com`, `MEDIA_PUBLIC_URL` = the bucket's custom domain.
- **Avatars (session 6, done and tested):** `User.avatarKey String?` (migration `add_user_avatar`). The raw key never leaves the server: API responses carry `avatarUrl` (`mediaUrl(key)` from `lib/storage`, `null` when none). Done in `getPublicProfile`, `updateMe`, `GET /auth/me`, the project owner in `getBySlug` (`owner {id, name, avatarUrl}`) and the feedback `author {id, name, avatarUrl}`. The browse list, the feed and the bell do NOT carry avatars yet. `POST /api/me/avatar`: `requireAuth` -> `avatarUploadLimiter` (5 per hour per USER via `keyGenerator: req.user.userId`; skipped under `NODE_ENV=test`) -> multer (memory storage, field `avatar`, 2 MB, 1 file; multer errors are mapped in `acceptAvatar` in `routes/users.ts`) -> `services/avatars.ts#setAvatar`: magic-byte check (PNG/JPEG/WebP only, no SVG/GIF; the file name and Content-Type are ignored), `sharp` (`limitInputPixels` 24M, `.rotate()`, 256x256 cover, WebP q80, so EXIF and any hidden payload are dropped), a NEW key `avatars/{userId}/{uuid}.webp`, `putObject` (storage failure -> 503), DB update (if it fails the new object is deleted), then the old object is deleted (best effort). Errors: 400 missing/invalid/unreadable file, 401, 413 over 2 MB, 429, 503. `DELETE /api/me/avatar` clears the key and deletes the object; repeatable. Both return `{ avatarUrl }`. nginx: `location = /api/me/avatar` has `client_max_body_size 3m` and repeats the `proxy_*` settings (nginx does not inherit them); everything else stays at 200k, and nginx answers 413 with an HTML page (the frontend `uploadFile` maps 413 to "That file is too large"). Compose: `api-server` gets the six S3 variables and depends on `seaweedfs`; the worker does not need them. Tests: `tests/setup.ts` also mocks `lib/storage` (`putObject`, `deleteObject`, `ensureBucket` are `vi.fn`; `publicUrl`/`mediaUrl` return `http://media.test/{key}`); `avatar.test.ts` (11) and `avatarpayloads.test.ts` (3). Frontend: `components/Avatar.tsx` (`url`, `name`, `size` sm/md/lg; initials fallback, also when the image fails to load), `uploadFile(path, field, file)` in `api.ts` (FormData, no manual Content-Type), the profile page shows the avatar and, on your own profile, `AvatarControls` (Add/Change photo, Remove; checks type and 2 MB in the browser first; calls `refresh()` so the header updates), the header `ProfileLink` shows avatar + name (name hidden on very narrow screens), the feedback author line and "by {owner}" on the project page show small avatars. Known gaps: the per-user limit has no automated test; two simultaneous uploads by one user could orphan one object (unlikely at 5/hour); old objects are only deleted on replace/remove (no account deletion exists). **CSP note:** when nginx gets a Content-Security-Policy in Phase 4, `img-src` must allow the media host (the R2 domain in production, `localhost:8333` in dev) or avatars and covers will break.
- **Browse API (session 3):** `services/projects.ts#listProjects` and `services/feed.ts#listFeed`, routes `GET /projects` (in `routes/projects.ts`) and `GET /feed` (`routes/feed.ts`, uses `optionalAuth`). Public responses expose only the owner's `id` + `name`, never the email. Migration `add_browse_indexes` adds `Post(createdAt)` and `Follow(projectId)`. `GET /projects/:slug` validates the slug with zod. No pagination yet (50 cap).
- **Home page (session 3):** tabs **Discover** (project cards with a Newest / Most followed switch + the recent-updates feed), **Following** (signed in; feed with `scope=following`, empty state links back to Discover), **My projects** (DEV only, with Create project). The selected tab lives in the URL (`/?tab=following`) so the back button works; a tab that isn't available falls back to Discover. Layout: app container `max-w-3xl`, forms and the project page wrapped in `Narrow` (`max-w-lg`), page top-aligned. Data loading goes through `useApi(path)`.
- **nginx image (session 4):** `apps/api/Dockerfile.nginx` is multi-stage (stage 1: Node 22 builds the `web` workspace with `npm ci --workspace=web --include-workspace-root`; stage 2: `nginx:alpine` with `apps/api/config/nginx.conf` and the `dist` files in `/usr/share/nginx/html`); the build context is the repo root (compose `nginx.build.context: .`). nginx config: `include /etc/nginx/mime.types` (without it JS is served as text and the page is blank), `/api/` proxied, `/assets/` cached 1 year (hashed file names), `/index.html` never cached, `location /` falls back to `/index.html`. Browser security headers (CSP etc.) are NOT set yet: Phase 4.
- **Profiles API (session 4):** `User.bio String?` (migration `20261026103721_add_user_bio`). `services/users.ts#getPublicProfile` selects explicit fields only, so the email is never read and cannot leak, plus the user's projects with counts; `updateMe` can only change name and bio. Routes in `routes/users.ts`: `GET /api/users/:id` (public) and `PATCH /api/me`. Handles/usernames in the URL come later (they need uniqueness and reserved-word rules).
- **Profiles UI (session 4):** `/u/:id` (`pages/Profile.tsx`) shows name, bio, role badge, join date, a "You" badge and, for DEVs, project cards; on your own profile "Edit profile" (name, bio with a 500-character counter, `PATCH /me`, then `refresh()` so the header name updates). The header shows your name at the top left, linking to your profile. The project page shows "by {owner}" linking to the owner's profile; feedback author names link to profiles. Project cards and feed cards do NOT link to profiles (nested links are invalid HTML). A bad id and an unknown id both show "User not found."
- **Repo visibility:** the GitHub repository is **PRIVATE** (it was found public at the start of session 5 and switched to private; the history check `git log --all --name-only --pretty=format: | Select-String -Pattern '(^|/)\.env'` printed nothing, so no `.env` was ever committed). Making it public is the LAST step. Before that: move the DB password out of compose, review `api.http` and `state.md` (Windows paths, notes), add a README and a LICENSE, re-run the history check, enable GitHub secret scanning. Git history is permanent (never reuse `secure_postgres_pass` anywhere real).

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
        run-worker.ts        REAL BullMQ worker (concurrency 5, graceful shutdown); calls fanOut(job.data)
        lib/                 config.ts (incl. lazy storageConfig()), prisma.ts, redis.ts, queue.ts, storage.ts (S3 client: putObject, deleteObject, publicUrl, ensureBucket), errors.ts, http.ts
        middleware/          auth.ts (signToken, requireAuth, requireEnrollOrAuth, requireRole, optionalAuth), rateLimit.ts
        controllers/auth_controller.ts
        routes/              auth.ts, projects.ts, dev.ts, feedback.ts (follows + feedback + votes + status + reply), posts.ts, notifications.ts, feed.ts, users.ts
        services/            projects.ts, follows.ts, feedback.ts, posts.ts, notifications.ts, feed.ts, users.ts, avatars.ts
      scripts/storage-check.ts   manual object-storage check (not part of build or tests)
      tests/
        env.ts               test env values (DB must be mirai_hub_test)
        global-setup.ts      applies migrations to the test DB once per run
        setup.ts             mocks lib/prisma (client bound to test URL), lib/queue and lib/storage
        helpers.ts           resetDb (TRUNCATE before each test, refuses any DB except mirai_hub_test), anon, makeUser/makeProject/makeFeedback, loginAs, scenario (owner + fan1 + fan2 who both follow the project)
        projects.test.ts (3), feedback.test.ts (14), posts.test.ts (11), notifications.test.ts (10), follows.test.ts (6), browse.test.ts (10), profiles.test.ts (10), projectdetail.test.ts (2), reply.test.ts (10), replynotify.test.ts (6), ownerrules.test.ts (6), feedbackpost.test.ts (6), avatar.test.ts (11), avatarpayloads.test.ts (3) = 108 tests in 14 files, confirmed
    web/                     React app (Vite). Files: index.html, vite.config.ts (proxy), tsconfig.json, postcss.config.js (MUST be .js, see gotchas), tailwind.config.ts, global.d.ts (old, outside tsconfig), src/main.tsx, src/App.tsx (routes + AuthProvider + bell in the header and your name (links to your profile) at the top left; `Narrow` wrapper keeps non-Home pages at max-w-lg, Home is max-w-3xl), src/api.ts (types incl. BrowseProject, FeedPost, FeedbackItem with ownerReply/ownerReplyAt/postId/post, NotificationType with FEEDBACK_REPLY; avatarUrl on User, project owner, profile and feedback author; `api()` fetch helper and `uploadFile()` for multipart), src/auth.tsx, src/useApi.ts (small GET-loading hook), src/labels.ts (status/post-type labels, colors and dropdown orders), src/index.css; src/pages/: Home.tsx (tabs, selected tab in `?tab=`), Signup.tsx, Login.tsx, NewProject.tsx, ProjectPage.tsx (header with "by {owner}" link, owner "Edit project" form, holds `aboutPost` state), Profile.tsx; src/components/: RequireAuth.tsx, FollowButton.tsx, PostList.tsx (posts + owner PostForm + "Give feedback on this update"), FeedbackSection.tsx (feedback list, votes, submit form, owner status dropdown, owner reply editor, post filter), NotificationBell.tsx, ProjectCard.tsx, FeedList.tsx, Avatar.tsx (round avatar with initials fallback)
    desktop/                 Electron: src/main.ts, src/preload.ts
  packages/
    database/                schema.prisma, migrations/, .env (DATABASE_URL, git-ignored)
  docker/seaweedfs-s3.json   throwaway dev credentials + anonymous read of the bucket (SeaweedFS)
  docker-compose.yml
  .env                       root: JWT_SECRET for compose (git-ignored)
  state.md
```

Root `package.json` has `"workspaces": ["apps/*", "packages/*"]` (verified).

`apps/api/package.json` scripts: `dev` (ts-node-dev API), `worker` (ts-node-dev worker), `test` (`vitest run`), `test:watch`, `build` (tsc), `start`. Root: `dev:web`.

### Database migrations (in order, latest last)
`add_notifications`, `add_post_updated_at`, `20261026045222_add_browse_indexes`, `20261026103721_add_user_bio`, `add_feedback_reply` (session 5), `20261027074319_add_feedback_reply_notification` (session 5, enum value `FEEDBACK_REPLY`), `add_feedback_post` (session 5), `add_user_avatar` (session 6). Plus the initial schema migrations from sessions 1-2.

### API endpoint reference (all under `/api`)

| Method + path | Auth | Notes |
|---|---|---|
| `POST /auth/signup`, passkey register/login, `GET /auth/me`, `POST /auth/logout` | mixed | JWT cookie, `purpose` session vs enroll; `/auth/me` returns id, email, name, role, `avatarUrl` |
| `POST /dev/login` | none | dev/test only, needs `ENABLE_DEV_LOGIN=true` (not set in compose) |
| `POST /projects` | DEV | create |
| `GET /projects?sort=new\|followers` | public | browse list, max 50: id, slug, name, tagline, createdAt, `owner {id, name}` (never the email), `_count` followers/feedback; no vision text |
| `GET /projects/mine`, `GET /projects/:slug`, `PATCH /projects/:id` | auth / public / owner | `/mine` before `/:slug`. **Update is by UUID `:id`, not slug**; only name, tagline, vision are editable (slug is immutable). `GET /projects/:slug` includes `owner {id, name, avatarUrl}` (no email) |
| `PUT/DELETE /projects/:slug/follow`, `GET /me/follows` | auth | idempotent; following your OWN project returns 400 (tested) |
| `POST /projects/:slug/feedback` | auth, not the owner | 201; body `title` 3-120, `body` 1-5000, optional `postId` (UUID of a post of the SAME project, else 400); the project owner gets **403** |
| `GET /projects/:slug/feedback?status=&postId=&sort=votes\|new` | optional | each item: `voteCount`, `hasVoted`, `author {id, name, avatarUrl}`, `ownerReply`, `ownerReplyAt`, `postId`, `post {id, title}` (nulls when none); max 50 |
| `PUT/DELETE /feedback/:id/vote` | auth | idempotent, returns `{ voteCount }`; **PUT by the project owner = 403**, DELETE stays allowed |
| `PATCH /feedback/:id/status` | owner | enqueues notification if changed |
| `PUT /feedback/:id/reply` | owner | body `{ text }` (1-2000, trimmed); creates or overwrites; the first reply enqueues `FEEDBACK_REPLY`; returns the feedback |
| `DELETE /feedback/:id/reply` | owner | clears `ownerReply` + `ownerReplyAt`; repeatable (200 again) |
| `POST /projects/:slug/posts` | owner | types VISION / ANNOUNCEMENT / CHANGELOG; enqueues notification |
| `GET /projects/:slug/posts?type=` | public | newest first, max 50 |
| `PATCH /posts/:id` | owner | partial title/body/type, at least one field, no re-notify |
| `DELETE /posts/:id` | owner | also deletes its NEW_POST notifications; feedback linked to it stays (link cleared by SetNull) |
| `GET /me/notifications?unread=true`, `GET /me/notifications/unread-count` | auth | types FEEDBACK_STATUS, NEW_POST, FEEDBACK_REPLY |
| `PATCH /notifications/:id/read`, `POST /me/notifications/read-all` | auth | scoped to own rows (404 otherwise) |
| `GET /users/:id` | public | profile: id, name, bio, `avatarUrl`, role, createdAt and `projects` (id, slug, name, tagline, createdAt, `_count` followers/feedback); **never the email**; UUID in the URL |
| `PATCH /me` | auth | edit own `name` (1-80) and `bio` (max 500; empty string clears it to null); unknown keys such as role/email are dropped by zod; a body with nothing editable returns 400 |
| `POST /me/avatar` | auth | multipart field `avatar`, one file up to 2 MB (PNG/JPEG/WebP by magic bytes; SVG/GIF/other = 400; too large = 413); re-encoded to 256x256 WebP; 5 uploads per hour per user (429); returns `{ avatarUrl }`; the old object is deleted |
| `DELETE /me/avatar` | auth | clears the avatar and deletes the object; repeatable; returns `{ avatarUrl: null }` |
| `GET /feed?scope=all\|following` | public; `following` needs login (401) | recent posts across projects, newest first, max 50: id, type, title, createdAt, `project {slug, name}`, `excerpt` (body cut to 240 chars + "…" on the server; the full body is never sent) |

### Project rules (zod in `routes/projects.ts`)

- `name`: 1-80 chars (required). `tagline`: max 160 (optional). `vision`: max 5000 (optional).
- `slug` (create only, required): trimmed + lowercased, 3-40 characters, letters/numbers/dashes, must not start or end with a dash, regex `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`; reserved: `mine`, `new`, `admin`, `api`. Duplicate slug returns 409.
- Create needs a signed-in DEV (CONSUMER gets 403, anonymous 401). Update: partial, owner only (enforced in the service).

### Rate limits (per IP, in memory)

| Limiter | Limit |
|---|---|
| Global (`/api`, except `/health`) | 300 / minute |
| Writes (POST/PUT/PATCH/DELETE, except `/auth`) | 60 / minute |
| Signup | 10 / hour |
| Passkey register/login steps | 30 / 15 minutes |
| Feedback creation | 10 / 10 minutes |
| Avatar upload (per USER, not per IP) | 5 / hour |

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

Inside Docker, containers use service names: `postgres-db:5432`, `redis-cache:6379`. The `api-server` container is not published directly; reach it through nginx on 8080.

**Two ways to run (pick one at a time for the worker):**

1. **Local dev (default while coding):** start only the data services, then run the API and worker with npm.
   ```powershell
   cd C:\Users\PC_User\Desktop\Mirai_Hub
   docker compose up -d postgres-db redis-cache seaweedfs
   docker compose ps   # postgres "healthy", redis and seaweedfs "Up"
   ```
   Terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`), web (`npm run dev:web` from the repo root, then open `http://localhost:5173`), tests/manual calls (PowerShell where `$s` owner and `$c` consumer sessions live). Type-check the frontend with `npx tsc --noEmit` from `apps/web`. (In Docker mode nginx serves the built frontend at `http://localhost:8080`.)
2. **Full stack in Docker (the production-like setup):** `docker compose up -d --build`, then open `http://localhost:8080` (nginx serves the built web app and proxies `/api/`; sign in with a passkey: `ENABLE_DEV_LOGIN` is deliberately not set in compose, so there is no dev login there). **Don't run the local `npm run worker` at the same time as the `queue-worker` container**: both consume the same Redis queue and you can't tell which handled a job. The local API on 5000 and the container API share the same dev database and Redis, so the container worker also processes jobs created by the local API. Back to local development: `docker compose stop api-server queue-worker nginx`, then start the local worker again.

**Automated tests:** from `apps/api`, `npm test` (API and worker don't need to be running; Postgres and Redis do). A full run takes ~50 s. One-time setup of the test database:

```powershell
'create database mirai_hub_test;' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub
```

Migrations are applied to it automatically on each run.

**Env files (all git-ignored, never commit or paste secrets):**
- `/.env`: `JWT_SECRET=...` (compose refuses to start without it)
- `/apps/api/.env`: `PORT=5000`, `JWT_SECRET`, `REDIS_URL=redis://localhost:6380`, `RP_ID=localhost`, `ORIGIN=http://localhost:5173`, `ENABLE_DEV_LOGIN=true`, and `DATABASE_URL=postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public` (no quotes; the API reads this at runtime)
- `/packages/database/.env`: `DATABASE_URL="postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public"`
- `/apps/api/.env` also holds the six storage variables (section 3, "Local object storage"); they are only read when the storage code runs.
- `.env` files take only `#` comments on their own line; save as UTF-8 without BOM (if a variable "isn't found", rewrite with `Set-Content -Encoding ascii`).
- `.env` is read **only at startup**: after editing, stop `npm run dev` (Ctrl+C) and start it again. The worker reads `REDIS_URL` from the same `apps/api/.env`.
- A `$env:DATABASE_URL=...` set in PowerShell overrides the `.env`; clear with `Remove-Item Env:DATABASE_URL`.
- Test values live in `apps/api/tests/env.ts` (contains the local DB password, same as compose; read from the environment when secrets move out of compose). CI uses the same values via service containers on ports 5433 / 6380.

**Docker-mode values** (set in compose for the API; the worker gets the same `NODE_ENV`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET`, `RP_ID`, `ORIGIN` because `lib/config.ts` requires them): `ORIGIN=http://localhost:8080`, `RP_ID=localhost`, `NODE_ENV=development`.

**Commands:**
- Prisma commands run from `packages/database` (or pass `--schema=packages/database/schema.prisma`).
- New migration (local only): stop the API and worker first, then `npx prisma migrate dev --name <name>`. Containers use `prisma migrate deploy` (the API container runs it on start). After a migration restart the API and worker (new Prisma client), rebuild images (`docker compose up -d --build`), and in VS Code run **TypeScript: Restart TS Server** (see gotchas).
- Run API: from `apps/api`, `npm run dev`. **Keep exactly one dev terminal for the API and one for the worker.** A duplicate gives `EADDRINUSE` and the old instance keeps serving old code. Find the culprit with `netstat -ano | findstr :5000`.
- Type-check: from `apps/api`, `npx tsc --noEmit` (not from the repo root). A clean run prints only the `npm notice` lines. `npm run dev` uses `--transpile-only`, so it never shows type errors. `tsc` only covers `src/`, not `tests/`.
- Validate compose: `docker compose config --quiet`. Container logs: `docker compose logs --tail 30 api-server queue-worker`.
- Prisma CLI prints `Assertion failed ... UV_HANDLE_CLOSING` on Node 24 at exit. Harmless; Node 22 LTS avoids it (the images use Node 22).
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- **Query the DB from PowerShell** (pipe through stdin, otherwise PowerShell strips the double quotes and Postgres looks for lowercase tables):
  `'select type, "userId", "dedupeKey", "readAt" from "Notification" order by "createdAt";' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`
  For a statement with quoted names plus a string use a double-quoted string with doubled quotes, e.g. `"delete from ""User"" where email = 'x@test.com';" | docker compose exec -T ...`
- Header check: `(Invoke-WebRequest $url -UseBasicParsing).Headers | Format-List` (without `-UseBasicParsing` PowerShell shows a security prompt). Raw JSON check: `(Invoke-WebRequest $url -UseBasicParsing).Content`.

---

## 5. Status

### Done and confirmed working
- [x] Schema: User, DevicePasskey, Project, Post (with `updatedAt`), Feedback (with `ownerReply`, `ownerReplyAt`, `postId`), Vote, Follow, Notification + enums (Role, PostType, FeedbackStatus, NotificationType with `FEEDBACK_REPLY`), UUIDv7 with `@db.Uuid` everywhere. All migrations applied.
- [x] `lib/` shared clients and config (required env vars, no fallback secrets)
- [x] `app.ts`: helmet, CORS with credentials, `trust proxy`, rate limiters, 100kb body limit, cookie-parser, health route, single error handler (`AppError`, `ZodError`)
- [x] Auth backend: signup, passkey register/login (usernameless), `me`, `logout`; JWT cookie with `purpose`
- [x] Dev-only login shortcut `POST /api/dev/login` (needs `ENABLE_DEV_LOGIN=true`, never in production, never in compose)
- [x] `projects` routes + service: create (DEV only), `mine`, get by slug, update (owner only)
- [x] Follows, feedback, votes, owner-only status
- [x] Posts: create, list, update, delete (owner only)
- [x] Notifications end to end: queue (5 attempts, exponential backoff), fan-out, real worker, hooks in `setStatus`/`createPost`/`setReply`, read routes (list, unread count, mark read, read-all)
- [x] Rate limiting verified (10 feedback creations ok, 11th and 12th returned 429; headers present; other writes unaffected)
- [x] **Docker (Phase 0.5):** `.dockerignore`; Dockerfile (Node 22, api workspace only, local Prisma 5.22, builds API + worker); compose worker runs `node apps/api/dist/run-worker.js`; all 5 containers Up
- [x] **nginx:** API proxied on `/api/`, `X-Forwarded-For` from `$remote_addr`, upstream keep-alive, 200k body limit; serves the built frontend with SPA fallback (session 4)
- [x] **CI workflow** `ci.yml`: Node 22, Postgres + Redis services, install api workspace, prisma generate, typecheck, build, `npm test`, Docker image builds (API and nginx + web). Green on GitHub as of session 4.
- [x] **Frontend (session 3):** passkey signup/login in a real browser, create project with live slug validation, public project page (posts, feedback, vote, submit, follow), owner controls (two-window test passed), notification bell (driven by the real worker), edit project form, Home tabs
- [x] **Browse API + Home page UI** (session 3-4), **nginx serves the frontend**, **profiles API + UI** (session 4); see section 3
- [x] **Session 5, owner reply (5a):** schema + migration `add_feedback_reply`, `PUT/DELETE /feedback/:id/reply`, UI (Response block, Reply / Edit / Delete controls with counter). `reply.test.ts` (10 tests). Browser check passed (user report: "it worked perfect").
- [x] **Session 5, reply notifications (5a2):** enum `FEEDBACK_REPLY`, fan-out to author + voters (owner excluded), first reply only, idempotent, bell text. `replynotify.test.ts` (6 tests). Pushed.
- [x] **Session 5, owner rules (5b):** owner gets 403 on create feedback and on vote (server), UI note + disabled vote buttons. `ownerrules.test.ts` (6 tests).
- [x] **Session 5, feedback linked to a post (5c):** schema + migration `add_feedback_post`, `postId` on create and list filter, `post {id, title}` on items, SetNull on post delete, UI (give feedback on an update, "About:" tag and filter). `feedbackpost.test.ts` (6 tests).
- [x] **Type-checks and tests after 5c (user ran them):** `npx tsc --noEmit` clean in `apps/api` and `apps/web`; `npm test` = **12 files / 94 tests passing**.
- [x] **Repo privacy confirmed (session 5):** the repo was public at the start of the session, was made private, and the `.env` history check printed nothing.
- [x] **Session 5, local object storage (step 6, piece 1):** `@aws-sdk/client-s3` installed in the `api` workspace; SeaweedFS container in compose; `docker/seaweedfs-s3.json`; `lib/storage.ts`; `storageConfig()` in `config.ts`; `scripts/storage-check.ts` run against the real container (user report: bucket ready, upload ok, anonymous public GET 200 "hello mirai", 404 after delete). Covered indirectly by the avatar tests with `lib/storage` mocked; the real storage is only exercised by `scripts/storage-check.ts` and manual checks.
- [x] **Session 6, avatars (step 6a):** migration `add_user_avatar`, `services/avatars.ts`, `POST/DELETE /api/me/avatar`, per-user upload limit, nginx 3 MB for that path, S3 variables in compose for `api-server`, `avatarUrl` in profile / `/auth/me` / project owner / feedback author, web UI (`Avatar`, upload + remove on the profile, header, feedback, project page). `tsc` clean in both apps; `npm test` = **14 files / 108 tests passing** (after fixing two strict `toEqual` expectations that needed `avatarUrl: null`); `docker compose build api-server nginx` succeeded and `sharp` runs inside the Alpine image (user ran `docker compose run --rm --no-deps api-server node -e "require('sharp')..."`, output `sharp ok 44`; the 44 is the byte length of the test WebP).
- [x] Old marketing code removed

### Still to confirm (small checks, do first next session)
- [ ] **Browser check of 5(b) and 5(c)** (not reported yet): as the owner the feedback form is replaced by a note and the vote buttons are greyed out; as a consumer, "Give feedback on this update" scrolls to the form with "Feedback about: ...", the item shows the "About:" tag, the tag / dropdown filters, Clear removes the link, deleting the post keeps the feedback (tag gone after reload).
- [ ] **Confirm the newest GitHub Actions run is green** (not reported since session 4; it is the first run with the SeaweedFS files, the new lock file, `multer`/`sharp` and the avatar code). The 5(b)/5(c)/storage commit was pushed in session 6 (working tree clean).
- [ ] **Browser check of avatars (6a)** (not reported yet): Add photo as `devui` (round avatar, header avatar changes, persists after reload, image URL is `localhost:8333/mirai-media/avatars/...webp`), Change photo (old URL gives 404 afterwards), a renamed `.txt` is rejected by the server, a file over 2 MB is rejected by the page, avatars show next to feedback authors and "by {owner}", Remove brings the initials back.
- [ ] **Passkey signup/login at `http://localhost:8080`** (production-like stack, no dev login): sign in with an existing passkey (e.g. `devui`) or sign up a fresh account (e.g. `devdocker@test.com`). The `[NEW_POST]` log line from the container worker does not prove the post came through `:8080` (the local API shares Redis and DB), so check by posting at `:8080` and watching the log. Rebuild first (`docker compose up -d --build`) so the containers have the session-5 code and migrations.
- [ ] Clean up test data when done testing: test accounts in the dev DB (`delete from "User" where email = '...'`) and the matching `localhost` passkeys on the device.

### Test gaps (known, add when touching these areas)
- `PATCH /projects/:id` (owner-only update)
- Rate limiting, including the per-user avatar limit (limiters are switched off under `NODE_ENV=test`)
- The BullMQ worker itself (the queue is mocked; fan-out logic is tested directly)
- Auth/passkey flow and signup (409 on duplicate email, enroll cookie); only the dev login is used in tests

### Written but NOT yet confirmed
- (nothing pending besides the browser checks above)

### Not started
- [ ] **Post cover images** (step 6b), then the R2 switch (6c); the storage layer and avatars are done (see section 9 step 6) **<- next**
- [ ] Hardening (email verification, consumer login without a passkey, orphan-user cleanup, secrets out of compose, Redis-backed rate limits, `npm audit`, remove dev login, structured logging + error tracker)
- [ ] Deploy (domain, server, HTTPS, production env, email sender, backups)
- [ ] Prometheus + Grafana, load tests (k6)
- [ ] Electron checks (desktop shell, WebAuthn inside Electron)

---

## 6. How to test by hand (PowerShell, local API + worker running)

Cookies are kept with `-SessionVariable` / `-WebSession`. The dev login only works for users that exist (sign them up first). `dev1@test.com` (DEV) owns the project `my-game`; `fan1@test.com` is a CONSUMER who follows it. Most of this is now covered by `npm test`; use this for quick manual checks.

```powershell
$base = "http://localhost:5000/api"; $json = 'application/json'

# Sessions
Invoke-RestMethod "$base/dev/login" -Method Post -ContentType $json -Body '{"email":"dev1@test.com"}' -SessionVariable s
Invoke-RestMethod "$base/dev/login" -Method Post -ContentType $json -Body '{"email":"fan1@test.com"}' -SessionVariable c

# Follow, feedback, vote (second vote must keep count at 1)
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

# Notifications (allow a few seconds for the worker)
Invoke-RestMethod "$base/me/notifications/unread-count" -WebSession $c
Invoke-RestMethod "$base/me/notifications" -WebSession $c | Format-Table type, title, status, read
Invoke-RestMethod "$base/me/notifications/read-all" -Method Post -WebSession $c
```

In `catch` blocks print the status code with `[int]$_.Exception.Response.StatusCode` (the error body alone is `$_.ErrorDetails.Message`). Creating 10+ feedback items within 10 minutes triggers the feedback rate limit; restarting the API resets all counters. Note: the project owner (`dev1`) can no longer create feedback or vote on `my-game` (403).

---

## 7. Gotchas learned (save yourself the time)

- **`app.ts` order matters:** middleware, rate limiters, body parsing, routes (`/api` feedback, `/api/auth`, `/api/projects`, posts, notifications, dev routes), then **one** error handler. Routes mounted after the error handler never run; two error handlers means the first swallows everything.
- Express 4 doesn't catch rejected promises: always wrap async handlers with `wrap()` from `lib/http.ts`.
- Route order inside a router: `/mine` must come before `/:slug`.
- "Cannot POST /x" is Express's 404: the route isn't mounted (wrong file, missing flag, stale process), not a logic bug.
- A **500 with no details** means look at the dev terminal for the stack trace. Usual causes: Postgres not running, wrong/missing `DATABASE_URL`, stale Prisma client (`npx prisma generate --schema=../../packages/database/schema.prisma`).
- `$env:...` overrides in PowerShell outlast `.env` edits; old terminals can keep stale servers alive.
- Windows reserves some ports (5432 failed with "access permissions"); use alternate host ports as above.
- Every foreign key must carry `@db.Uuid` or the migration fails with "incompatible types: text and uuid" (`prisma validate` doesn't catch it).
- Adding a required column to an existing table needs a default (`@default(now()) @updatedAt` for `Post.updatedAt`). Optional columns (`String?`) need none.
- Compose `${JWT_SECRET:?...}` fails the whole file if the root `.env` is missing.
- Never `cd` into a file; create files from PowerShell with `Set-Content -Encoding ascii` or in the VS Code sidebar.
- Check which folder you're in before using relative paths (`apps\api\package.json` from inside `apps\api` doubles the path). `npm test` only exists in `apps/api`.
- BullMQ job ids can't contain `:`; use `-` in dedupe keys.
- PowerShell strips double quotes when passing SQL to `docker compose exec`; pipe the query via stdin (section 4b).
- With the worker stopped, jobs just wait in Redis and are processed when it starts. Two workers (local + container) share one queue. **After adding a notification type or changing `fanOut`, restart the worker** (it runs the compiled/transpiled code from startup).
- **Vitest only loads `vitest.config.ts` from the project root (`apps/api`).** When it sat in `tests/`, vitest silently ignored it: no `env`, no `globalSetup`, no `setupFiles`, so tests ran against the DEV database (the wipe guard in `helpers.ts` blocked it and nothing was lost). If tests ever connect to `mirai_hub` again, check this first.
- Tests build their own Prisma client with the test URL (`vi.mock('../src/lib/prisma')` in `tests/setup.ts`), and `resetDb` checks `current_database()` before every TRUNCATE. Keep both guards.
- `ERESOLVE` when installing vitest: it needs `@types/node` ^22 or >=24; `apps/api` now uses `@types/node@^22`. Never use `--force` / `--legacy-peer-deps` for that.
- Vite prints a harmless warning about `configLoader: 'native'` (ESM syntax in a CommonJS package). Don't add `"type": "module"` to `apps/api/package.json` to silence it. `$env:VITE_CONFIG_NATIVE_IGNORE_WARNING = "true"` hides it for one terminal. If `npm test` output stops right after that warning, it was only cut off: wait for the full run (~50 s) and read the bottom lines.
- The first request in each test file takes ~2 s (cold DB connection); a full run takes ~50 s.
- Rate-limit counters are in memory: a restart resets them.
- **Without a `.dockerignore`, `COPY apps/api` bakes `apps/api/.env` (secrets) and Windows `node_modules` into the image.** Keep the root `.dockerignore`.
- A GitHub workflow file must end in `.yml`/`.yaml`; a stray character (`ci.yml;`) means it never runs. Rename files with a weird name via `Rename-Item -LiteralPath`.
- Don't `npm install -g prisma` in images: it installs the newest major, not the repo's 5.22 (use the local one via `npx`). Ignore the "Update available 8.0.0" box.
- The worker container needs `JWT_SECRET`, `RP_ID` and `ORIGIN` in its env even though it doesn't use them (`lib/config.ts` requires them), and `command: node apps/api/dist/run-worker.js` (the root `package.json` has no `worker` script).
- Keep the Node major aligned: images and CI use 22, local is 24 (types are `@types/node` 22).
- In Windows PowerShell 5.1, `Invoke-RestMethod <url> | Select-Object title` can print a single blank row when the response is a JSON array. Assign to a variable first or check `(Invoke-WebRequest <url> -UseBasicParsing).Content`.
- `apps/api/.git` was a nested repo left from the old project (moved out in session 4); `.dockerignore` excludes `**/.git`.
- **`apps/web/postcss.config` must be `.js`** (package is `"type": "module"`, so ESM syntax). A `postcss.config.ts` makes Vite fail with `ERR_REQUIRE_ESM`. Config changes (`vite.config.ts`, postcss, tailwind) need a Vite restart.
- Newer npm blocks install scripts and prints "install scripts blocked" (esbuild, prisma, electron, msgpackr-extract). Harmless for now. If Vite complains about esbuild: `npm install-scripts approve esbuild@0.21.5`; when reaching the desktop app: `npm install-scripts approve electron`. Never `npm audit fix --force`.
- "API not reachable" on the web page means the API terminal isn't running (Docker data services alone are not enough), or the Vite proxy isn't active (restart Vite).
- An abandoned signup (account created, passkey step never finished) locks that email with a 409. The signup page retries the passkey for 10 minutes; otherwise delete the row: `"delete from ""User"" where email = 'x@test.com';" | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`. Proper fix: orphan-user cleanup (Phase 4). `dev1@test.com` / `fan1@test.com` were created without passkeys, so they only work through the dev login, not in the browser.
- **The test count is the proof that a new test file was picked up** (now **108 tests in 14 files**). Test files must be `apps/api/tests/*.test.ts`; a file saved elsewhere or with a misspelled name is silently ignored (`follows.tst.ts` was ignored until renamed).
- Following a project needs no special role: a DEV can follow another DEV's project. If a Follow button seems to work "on your own project", check that the project is really yours (the page shows a "Your project" badge and hides the button there).
- `git ls-files | findstr .env` gives a false alarm on `apps/api/tests/env.ts`. Use `git ls-files | Select-String -Pattern '(^|/)\.env'` (must print nothing) and `git check-ignore -v .env apps/api/.env packages/database/.env` (3 lines).
- **Testing two accounts at once:** a browser keeps one login per site, so use a normal window for the DEV and a private (incognito) window for the consumer; passkeys work in private windows. Always `localhost:5173`.
- If the API/worker terminals spam `Redis error`, the data containers are not running: `docker compose ps` printing an empty table means nothing is up. Start Docker Desktop, then `docker compose up -d postgres-db redis-cache`.
- **Where the edit controls are** (a frequent confusion): "Edit project" is a button under the project header (owner only); Edit / Delete on a post only exist on an existing post; the status dropdown and Reply links only appear on the owner's own project. Nothing shows if you are signed in as another account (check for the "Your project" badge).
- After editing frontend files, Vite hot-reloads by itself: a hard refresh (Ctrl+F5) is enough. Restart `npm run dev:web` only after config changes or if a red error overlay sticks. The API terminal needs no restart for frontend changes.
- You don't need two logged-in accounts at once: notifications are stored in the DB, so one window can do owner step, sign out, consumer step. Two windows only show the live badge update.
- `git commit` printing "nothing to commit, working tree clean" is not an error. "Your branch is ahead of 'origin/main' by N commits" means those commits are not pushed yet; GitHub Actions only runs on pushed commits.
- Editing `schema.prisma` does not create a migration: check that a new folder exists in `packages/database/migrations` after `prisma migrate dev`. When Prisma asks to reset the database (drift), answer no.
- **Serving the built app from nginx:** `include /etc/nginx/mime.types;` is required, otherwise JS is sent as plain text and the page is blank; deep links and reloads need `try_files $uri /index.html;`.
- A "notifications created" line in the container worker's log does not prove a request came through `:8080`.
- **CI only builds what the workflow builds:** when a Dockerfile starts building something new, add a CI build step for it.
- **`EPERM: operation not permitted, rename ...query_engine-windows.dll.node` after `prisma migrate dev`:** the Prisma query engine DLL is locked by running Node processes. Stop the API and worker BEFORE migrating (session 5 did, no EPERM). If it still happens: stop them, run `npx prisma generate --schema=packages/database/schema.prisma` from the repo root, restart.
- **VS Code shows red underlines after a migration while `tsc` and the tests are fine:** the editor's TypeScript server holds the old Prisma types (e.g. "Property 'ownerReplyAt' does not exist", "'FEEDBACK_REPLY' is not assignable to NotificationType"). Fix: `Ctrl+Shift+P` -> **TypeScript: Restart TS Server** (or Developer: Reload Window). Needed after every migration.
- **Pasting a replacement function into a file can duplicate it** (TS2323 "Cannot redeclare exported variable", TS2393 "Duplicate function implementation"): select the old function and delete it first, or replace the whole file. `tsc` error line numbers show where the two copies sit.
- A `tsc` error "missing the following properties ... aboutPost, onClearAbout" means a prop edit in the parent (`ProjectPage.tsx`) was missed: when a component gets new required props, update every place that renders it.
- **`git push` rejected with "fetch first":** GitHub has a commit your PC lacks. Never `git push --force`. Run `git fetch`, look with `git log --oneline HEAD..origin/main`, then `git pull --rebase` and `git push`; if the rebase conflicts, `git rebase --abort` puts everything back.
- **Check the repo is private before work** (a "Private" label on its GitHub page); it had been switched to public by mistake once.
- **MinIO is archived: don't use `minio/minio` or `minio/mc`** (official image stopped updating in 2025, repo archived April 2026, `mc` archived July 2026). A community fork `pgsty/minio` exists but is third-party. Local S3 stand-in is SeaweedFS (section 3). Garage was judged to need more setup (config file + helper container).
- **SeaweedFS notes:** wait ~10 s after `docker compose up -d seaweedfs` before the first request (`ECONNREFUSED` = not ready); "connection refused" lines in its first second of logs are startup noise; "Fixing /data ownership" is normal. A public GET returning 403 means the `anonymous` identity was not applied: check `docker/seaweedfs-s3.json`, then `docker compose restart seaweedfs` (config changes need a restart). Keep the image tag pinned.
- After adding an npm dependency the lock file changes: commit `package-lock.json`, because the Docker build and CI run `npm ci`. The "install scripts blocked" warning after `npm install` (prisma, esbuild, electron, msgpackr-extract) is the known harmless one.
- `npm install @aws-sdk/client-s3` reported **3 vulnerabilities (1 moderate, 2 high)** for the whole install; review with `npm audit` in Phase 4 (never `--force`).
- **A strict `toEqual` test breaks when a response gains a field:** after adding `avatarUrl`, `profiles.test.ts` and `projectdetail.test.ts` needed `avatarUrl: null` in the expected objects. Expect the same when more fields arrive (e.g. `coverUrl`).
- **Pasting a replacement service block into `docker-compose.yml` can duplicate keys** ("mapping key build already defined"): replace the whole file and validate with `docker compose config --quiet` before building.
- **Multipart uploads:** with `FormData` never set `Content-Type` yourself (the browser adds the boundary). nginx answers an oversized body with an HTML 413 page, not JSON.
- **A passing `docker compose build` does not prove `sharp` works at runtime:** run `docker compose run --rm --no-deps api-server node -e "require('sharp')({create:{width:10,height:10,channels:3,background:'#ffffff'}}).webp().toBuffer().then(b=>console.log('sharp ok', b.length))"`; it must print `sharp ok` and a number (44 when it worked in session 6).
- `tests/setup.ts` mocks `lib/storage`; the tests count `putObject`/`deleteObject` calls per test (mock calls are reset between tests, confirmed by the passing avatar tests).
- **End of a session:** Ctrl+C the API and any local worker, then `docker compose down` (containers go, data survives in the `postgres_data` volume; **never add `-v`**, it wipes the DB), then quit Docker Desktop. Terminal sessions (`$s`, `$c`) are lost; log in again next time with the two `dev/login` lines in section 6.

---

## 8. Known problems / tech debt

**Reliability:**
- If the API saves a status change/post/reply and Redis is down at that moment, the notification is lost (`enqueueNotification` logs and swallows the error). Later fix: an **outbox table** written in the same DB transaction, drained by the worker.
- If a post is deleted before the worker handles its `NEW_POST` job, notifications pointing at a deleted post can still be created (shown with `title: null`, harmless). Fix: existence check in `fanOut`, together with the outbox work.
- A no-op status change (same status again) still writes to the DB and bumps `updatedAt`; harmless, optional early return in `setStatus`.
- `GET /me/notifications` returns the feedback's **current** status, not the status at the time of the event. Fix later: store the status on the `Notification` row (or in the job payload) if it matters.
- Reply notifications fire once per feedback item ever (the dedupe key has no timestamp): delete + rewrite of a reply does not notify again. Intended anti-spam; revisit if owners need a "re-notify" action.
- Rate-limit counters live in the API process's memory: they reset on restart and aren't shared across multiple API containers. Fix for production: `rate-limit-redis` with the existing Redis. Limits are per IP; per-user limits are a later refinement.

**API consistency (small):**
- `PATCH /projects/:id` uses the UUID while every other project route uses the slug; the frontend must use the `id` from the project object for updates.
- Clearing a project's tagline/vision stores an empty string, not `null`; optionally normalize empty strings to `null` in `updateProject`.
- Owners' old votes (from before the owner rule) stay in the DB and count; the UI gives the owner no way to remove them (the API allows `DELETE`).

**Frontend (small):**
- The post filter dropdown on the feedback board does not see posts created in the same session (reload needed); the "About:" tag does not disappear right after the post is deleted (reload needed).
- Browse cards, feed cards and the notification bell show no avatars.
- The frontend is functional but plain; a design pass is a later phase.

**Security (before any public deploy):**
- Email is **not verified** at signup (anyone can sign up as any email).
- Signup returns 409 for existing emails (reveals which emails have accounts).
- Orphan users: signup without registering a passkey leaves an unusable row (add cleanup job).
- DB password hardcoded in `docker-compose.yml` (and mirrored in `tests/env.ts` and `ci.yml`, throwaway local/CI values); move compose to `.env` with `${VAR}` before sharing the repo. **Keep the GitHub repository PRIVATE until then.**
- Throwaway storage keys live in `docker/seaweedfs-s3.json` (tracked in git) and in the dev `.env` examples; include them in the review before the repo goes public. Production uses R2 API tokens from the environment only, never from a tracked file.
- Image uploads are open to every signed-in user and email is unverified: before launch add email verification and a way to report/remove images. The nginx CSP must allow the media host in `img-src` (see the Avatars bullet in section 3).
- `/api/dev/login` must be deleted (or stay disabled) before launch.
- Keep Postgres/Redis bound to `127.0.0.1`; the API container port must never be published publicly (only nginx is).
- User-generated text (post/feedback/reply bodies) is stored raw; the frontend must render it escaped (React does by default) and never with `dangerouslySetInnerHTML`. If markdown is added later, sanitize.
- `npm ci` in the API image reported **4 vulnerabilities (1 moderate, 3 high)**; the full workspace install reports **9 (3 moderate, 6 high)**. Run `npm audit` and review before any public deploy; never `npm audit fix --force`.

**Infra (remaining):**
- nginx: add HTTPS and security headers (CSP etc.) for production; consider `limit_req` at the edge.
- Production needs HTTPS and `NODE_ENV=production`; `ORIGIN` must exactly match what the browser shows; `RP_ID` is the bare domain.
- Image hardening later: multi-stage build (drop dev dependencies), run as non-root user.
- `docker compose down -v` wipes the DB volume (then rerun migrations, recreate the `mirai_hub_test` database, and recreate `dev1`, `fan1`, and the `my-game` project).

**Electron:** WebAuthn (Touch ID / Windows Hello) in Electron is historically flaky. Test early; fallback is opening the system browser for login. `expectedOrigin` can be an array. Test cookie auth inside Electron too.

---

## 9. Roadmap (in order; don't skip ahead)

Order agreed with the user: (1) feedback pieces [DONE], (2) images: SeaweedFS locally first (storage layer done), then Cloudflare R2, (3) hardening + logging, (4) deploy, (5) monitoring and load tests, (6) make the GitHub repo public, last.

**Next session starts here:**
1. Start the stack: Docker Desktop, then `docker compose up -d postgres-db redis-cache seaweedfs` (check `docker compose ps`: postgres healthy, redis and seaweedfs up); terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`, required for notifications), web (`npm run dev:web` from the repo root). Open `http://localhost:5173` (never 127.0.0.1). Check the repo shows "Private" on GitHub.
2. Clear "Still to confirm" in section 5 (browser check of 5b/5c, commit + push, `:8080` passkey test with a rebuild, test-data cleanup).
3. ~~Browse feed~~ DONE (sessions 3-4). Later ideas: cursor pagination, search.
4. ~~Serve the built frontend from nginx~~ DONE (session 4).
5. ~~Product pieces found in testing~~ DONE (session 5): (a) owner reply, (a2) reply notifications, (b) owner cannot create feedback or vote on own project, (c) feedback optionally linked to a post.
6. **Images via object storage** (IN PROGRESS). DONE: storage layer (session 5: SeaweedFS in compose, S3 client, `lib/storage.ts`, `scripts/storage-check.ts`) and **6a avatars** (session 6, section 3 "Avatars (session 6)"). NEXT: (b) **optional cover image per post** (owners only, ONE image per post, no inline images): migration `Post.coverKey String?`; `POST /api/posts/:id/cover` (owner only, multipart field `cover`, 5 MB, same magic-byte check and `sharp` pipeline as avatars but resized to max ~1600 px wide WebP, key `covers/{postId}/{uuid}.webp`, delete the old object on replace) and `DELETE /api/posts/:id/cover`; delete the object when the post is deleted; per-user upload limit; nginx: the path contains an id, so use a regex location such as `location ~ ^/api/posts/[0-9a-f-]{36}/cover$` with `client_max_body_size 6m` and the same `proxy_*` settings (regex locations win over the `/api/` prefix); expose `coverUrl` (via `mediaUrl`) in the post payloads (`GET /projects/:slug/posts`, create/update responses) and in the feed (`services/feed.ts`); tests with `lib/storage` mocked (the avatar tests are the template); UI: file picker in `PostForm` (owner), cover image on each post in `PostList`, optional thumbnail in `FeedList`. Files the AI needs: `apps/api/src/services/posts.ts`, `apps/api/src/routes/posts.ts`, `apps/api/src/services/feed.ts`, `apps/web/src/components/PostList.tsx` (current version), `apps/web/src/components/FeedList.tsx`, `apps/api/config/nginx.conf`. (c) **R2 switch**: create the Cloudflare account/bucket only now (R2 may require a payment method even for the free tier; public images on a custom domain need a domain on Cloudflare, so this can wait until the domain is chosen in Phase 4b; `r2.dev` is for development only, check Cloudflare's current docs), then set the six env variables for production (region `auto`).
7. **Phase 4 hardening** (in this order): consumer login without a passkey requirement (email link or Google) + email verification, orphan-user cleanup, secrets out of compose, notification outbox (and store the status on the notification), Redis-backed rate limits, `npm audit` review, multi-stage non-root API image, HTTPS + production nginx, remove dev login, structured logging (`pino` + `pino-http`) and an error tracker.
8. Optional small test additions (project update, signup).

**Phase 3: Frontend (web-first)**
1. ~~Login/signup + passkey registration page~~ DONE
2. ~~Project page~~ DONE
3. ~~Dev dashboard (statuses, posts, replies)~~ DONE (owner controls on the project page)
4. ~~Notification bell~~ DONE; ~~serve the built app from nginx~~ DONE; then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, secrets out of compose, HTTPS + production nginx, remove dev login, outbox for notifications, Redis-backed rate limits, `npm audit` review, multi-stage non-root image. **Also in this phase: structured logging (`pino` + `pino-http`: JSON logs, a request id on every line, never log secrets, cookies or emails) and an error tracker (e.g. Sentry), before deploying. Very last: make the GitHub repository public** (CI and tests stay public: they are a plus and hold only throwaway values; before flipping: DB password out of compose, review `api.http` and `state.md` for personal paths/notes, add a README and a LICENSE, re-run the history secret check `git log --all --name-only --pretty=format: | Select-String -Pattern '(^|/)\.env'` (must print nothing), enable GitHub secret scanning).

**Phase 4b: Deploy (not planned in detail yet; decide each item first)**
- **Choose the final domain BEFORE real users register.** Passkeys are bound to the domain (`RP_ID`); changing the domain later invalidates every passkey. Production env: `RP_ID` = the bare domain, `ORIGIN` = `https://<domain>`, `NODE_ENV=production`.
- Host: the simplest match for the current stack is one small VPS running the existing Docker Compose (nginx, API, worker, Postgres, Redis); managed Postgres/Redis and platform hosting are alternatives for later. Only ports 80/443 are open to the internet; Postgres and Redis are never public.
- HTTPS (Let's Encrypt via certbot or a Caddy front), security headers (CSP etc.) in nginx.
- Secrets from environment / a secret store, never in compose or git; a production-only `.env` on the server.
- Cloudflare R2 bucket + custom domain for images (create the account when the image code works against SeaweedFS), an email sender (verification mails), DNS.
- Postgres backups (scheduled `pg_dump` stored off the server) and a tested restore.
- Later: a deploy job in CI (build, push image, restart), uptime check.

**Phase 5: Observability and load**
- Add `prom-client` metrics (request duration histogram, queue depth) while building routes, not afterwards
- Prometheus + Grafana containers, dashboards (latency p50/p95/p99, error rate, queue depth, DB connections)
- k6 load tests on real flows (list feedback, vote, status change + fan-out); expect first bottlenecks in the DB (indexes, vote-count queries, fan-out batching), not Node. These matter most once the app runs somewhere real.

**Later / ideas (don't build yet):**
- **Images (in progress: storage layer and avatars done, post covers next).** The core loop doesn't need them, but avatars and post covers make the product feel real. Scope: user avatars (any signed-in user) + one optional cover image per post (owners); consumer feedback stays text. Uploads go through the API with a `sharp` re-encode (see the decision in section 3); no presigned URLs. Design:
  - Use **Cloudflare R2** in production (pricing checked Oct 2026: Standard storage $0.015/GB-month, permanent monthly free tier of 10 GB + 1M write-class + 10M read-class operations, zero egress fees; Backblaze B2 is cheaper per TB at rest, but R2's free tier and free egress make it effectively free at our scale) and a **SeaweedFS** container in compose for local dev (done), with the same S3 client (`@aws-sdk/client-s3`, endpoint + credentials from env). Never store files in Postgres or on the API container's disk (containers are ephemeral).
  - Upload flow: browser sends the file to the API (`POST /api/me/avatar`, `POST /api/posts/:id/cover`; multipart, memory storage, hard size limit such as 2 MB avatar / 5 MB cover). The default 100 kb JSON body limit stays for everything else: only these routes get a bigger limit, and nginx `client_max_body_size` (now 200k) must be raised for just that path. The API checks magic bytes (png/jpeg/webp only, **no SVG**), **re-encodes with `sharp`** (avatar 256x256 WebP, cover max ~1600 px WebP), then `PutObject`s with a server-chosen key and stores the key on the user/post. `sharp` needs its prebuilt musl binary in the Alpine image: verify the Docker build when adding it.
  - DB: simplest is `User.avatarKey String?` and `Post.coverKey String?`; the public URL is `MEDIA_PUBLIC_URL` (env) + key, so the browser loads images straight from the bucket, not through the API. Production: R2 bucket on a custom domain (needs a domain on Cloudflare; the `r2.dev` address is meant for development, confirm in Cloudflare's current docs); local dev: SeaweedFS (`MEDIA_PUBLIC_URL=http://localhost:8333/mirai-media`).
  - Checks: hard size limits, a per-user upload rate limit (e.g. 5 per hour; avatars open the upload path to every signed-in user), one avatar per user, no SVG, EXIF stripped by the re-encode, delete the old object whenever an avatar/cover is replaced or a post is deleted. Before public launch: a way to report and remove abusive images, and email verification (signup is unverified today). Consumers' feedback stays text.
  - Start with **a single optional cover image per post**, not inline images in the body. Inline images imply markdown rendering and sanitizing, which is a bigger step.
- discovery and search, comments on feedback (threaded discussion beyond the single owner reply), comments per post, multiple team members per project, dev analytics, desktop notifications/tray, auto-updater, public roadmap view, cursor pagination.

**Rough time estimate (hobby pace):** ~10 hrs/week means ~4-5 months total, MVP in a browser at ~2-3 months from the start; frontend was the biggest chunk. Backend MVP loop, rate limiting, tests, the Docker/nginx/CI review, browse, profiles and the four feedback pieces are finished, ahead of plan.

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

## 11. Resume prompt (paste into a new chat with this file)

> I'm building Mirai Hub (two-sided feedback/vision platform, see the attached state.md). I'm on Windows/PowerShell. Read state.md fully, then start at "Next session starts here" in section 9. Keep to the rules in section 10. Ask me for specific files only when you need them, and tell me where each file goes.