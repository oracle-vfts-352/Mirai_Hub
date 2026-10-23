# Mirai Hub: Project State

> Last updated: 2026-10-20 (end of session 3: the whole core loop works in the browser: passkey login, create project, project page, owner controls, notification bell).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~80%** (MVP loop works end to end in the browser; backend rate limited, 44 automated tests confirmed (+10 browse tests written); Docker stack runs behind nginx; CI rewritten; browse API (projects list + feed) works on real data. Left: Home page UI (Discover/Following), nginx serving the frontend, basic profiles, images/avatars via R2, hardening before any public deploy, observability, Electron).

---

## 1. Vision (don't drift from this)

A **two-sided, multi-tenant platform** connecting **consumers** and **devs/companies**:

- Devs/companies get a public **project page** to share vision, roadmap, and updates.
- Consumers **follow** projects, **submit feedback**, and **vote** on what matters.
- Devs **respond with a status** (planned / in progress / shipped / declined), and followers get notified.

**Core loop (the product):**

```
Dev posts update/vision -> Consumers see it -> Consumers give feedback + vote
-> Dev sees what matters -> Dev sets status -> Followers are notified -> repeat
```

If feedback disappears into a void, the product fails. The "dev responds, consumers see it" step is the point.

**Not the goal (for now):** marketing automation, email blasts, encrypted customer lists, analytics, and *advanced* discovery (search, ranking, recommendations). The old code was a single-company marketing tool; that idea is **dropped**. **But a basic browse list is part of the loop**: without it a consumer can only reach a project by typing its URL (decided in session 3, see "Next session starts here").

## 2. MVP definition (build only this first)

1. Dev signs up, registers a passkey, creates a project page.
2. Consumer signs up, follows a project, submits feedback.
3. Other consumers vote on feedback.
4. Project owner changes a feedback item's status.
5. Followers get notified of the change (BullMQ).

Everything else waits until this loop works end to end. **Backend: done, manually verified and covered by automated tests. Frontend (session 3): passkey signup/login/logout, create project, public project page (posts, feedback list, voting, submit feedback, follow) work in the browser. Owner controls (status dropdown on feedback, post create/edit/delete, edit project) and the notification bell work too. Missing: serving the built frontend from nginx, hardening, Electron.**

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
| Images (planned) | **Cloudflare R2** in production, **MinIO** locally (same S3 client). Uploads go THROUGH the API and are re-encoded with `sharp` (R2 has no presigned POST). Scheduled after the browse feed, nginx-served frontend and profiles. See section 9 "Later". |

Decisions:
- Single domain: nginx serves the frontend on `/` and the API on `/api` (avoids cookie/CORS pain, including in Electron). Today `/` is a placeholder text response until the frontend exists.
- nginx is the only public entry point and **overwrites** `X-Forwarded-For` with the real client address (`$remote_addr`); the API trusts one proxy hop (`trust proxy` 1) and the rate limiter relies on this.
- Logic goes in `services/` (plain functions, **no Express inside**); routes parse input with zod, call a service, return JSON. Services throw `AppError(status, msg)`; the single error handler in `app.ts` maps errors to status codes.
- `app.ts` exports the Express app (no `listen`); `server.ts` only calls `app.listen`. Needed so supertest can drive the app.
- Consumers should get low-friction login later (email link or Google); passkeys stay for devs and optional for consumers.
- Lists (feedback, posts, notifications) are capped at 50 for now (cursor pagination later).
- **Notifications:** one `Notification` row per follower per event. The project owner is never notified of their own actions. `@@unique([userId, dedupeKey])` + `createMany({ skipDuplicates: true })` makes the worker idempotent, so BullMQ retries never double-notify.
- **Dedupe keys** contain only `-` (BullMQ job ids can't contain `:`): `status-{feedbackId}-{status}-{updatedAtMs}` (timestamp so PLANNED -> IN_PROGRESS -> PLANNED stays three distinct events) and `post-{postId}`.
- Status notifications are only queued when the status actually changed. Editing a post does **not** re-notify. Deleting a post also deletes its `NEW_POST` notifications.
- `enqueueNotification` never throws: the user's action already succeeded, a queue hiccup must not become a 500.
- BullMQ needs its own Redis connection with `maxRetriesPerRequest: null` (`createQueueConnection()` in `lib/queue.ts`). `lib/redis.ts` stays as is for normal use (passkey challenges etc.).
- Fan-out reads followers in batches of 500 (keyset on `userId`).
- Notification list resolves titles via two batched queries; if the referenced item was deleted, `title` is `null`.
- **Rate limits** are mounted in `app.ts` before body parsing (table in section 4).
- The Docker image builds only the `api` workspace (`npm ci --workspace=api --include-workspace-root`), so Electron and the web app are never installed in it; the worker runs the compiled `dist/run-worker.js` from the same image.
- **Frontend dev setup:** Vite on `localhost:5173` with a **proxy of `/api` to `http://localhost:5000`**, so browser and API share one origin (HttpOnly cookies and WebAuthn work like in production; `ORIGIN=http://localhost:5173`, `RP_ID=localhost`). Always open `http://localhost:5173`, never `127.0.0.1` (WebAuthn needs the exact origin; cookies are per host).
- Frontend structure: `src/api.ts` (one `api()` fetch helper, `ApiError`, `errorMessage`), `src/auth.tsx` (`AuthProvider` + `useAuth`, loads `/api/auth/me` on start, 401 means signed out), pages in `src/pages/`. No tokens in JS: auth is the HttpOnly `auth_token` cookie.
- Signup flow: `POST /auth/signup` creates the user and an `enroll_token` cookie (10 min); the page then runs the passkey registration; if that step fails the page offers a retry for the 10 minutes the enroll cookie lives. Signup now also clears any old `auth_token` so the passkey is attached to the NEW account (`requireEnrollOrAuth` prefers `auth_token`).
- **Passkeys live on the device/password manager, the server stores only the public key.** Deleting a user row on the server does NOT remove the passkey from Windows/phone; remove old `localhost` test passkeys by hand (Windows: Settings > Accounts > Passkeys). The sign-in picker lists them by email.
- **Frontend routes:** `/` (landing / My projects), `/signup`, `/login`, `/projects/new` (DEV only, guarded by `RequireAuth role="DEV"`; signed-out visitors go to `/login`, consumers see a message), `/p/:slug` (public project page). Unknown paths show a not-found message.
- Project page: posts via `GET /projects/:slug/posts`, feedback via `GET /projects/:slug/feedback?sort=votes|new`; vote toggle uses the `voteCount` the API returns; header counts are adjusted client-side after follow / feedback. There is no "do I follow this?" endpoint, so `FollowButton` checks `GET /me/follows`. The Follow button is hidden for the project's owner; all user text is rendered as plain text (`whitespace-pre-wrap`), never as HTML.
- Another DEV may follow someone else's project; only the owner of that project is blocked (server rule in `services/follows.ts`, covered by `tests/follows.test.ts`: 400 `You cannot follow your own project`).
- **Owner controls** appear on `/p/:slug` when `user.id === project.ownerId`: feedback items get a status `<select>` (`PATCH /feedback/:id/status`, all 6 statuses), the Updates section gets a "New post" form plus Edit / Delete on each post (`PostForm` component inside `PostList.tsx`; delete asks `window.confirm`). This is only convenience: the server enforces owner-only on every one of these calls. Editing a post never re-notifies; a status change notifies followers only if the status really changed.
- **Edit project (owner):** "Edit project" button on the project header opens a form (name, tagline, vision) that calls `PATCH /projects/:id` with the project UUID; the slug is not editable. Clearing tagline/vision saves an empty string (the page treats it as "none").
- **Notification bell** (`components/NotificationBell.tsx`, rendered in the `App.tsx` header, signed-in users only): unread badge from `GET /me/notifications/unread-count`, polled every 30 s and on window focus (no websockets); the dropdown loads `GET /me/notifications` when opened. Text: `FEEDBACK_STATUS` -> "“title” is now {status}", `NEW_POST` -> "New post: title", deleted item (title null) -> "Update in {project}". Clicking an item marks it read (`PATCH /notifications/:id/read`, optimistic) and navigates to `/p/{slug}`; "Mark all read" calls `POST /me/notifications/read-all`. Escape / outside click closes it. Owners never get notifications for their own actions (server rule).
- **Images decision (session 3):** avatars for ALL signed-in users (plus one optional cover image per post for owners), stored in **Cloudflare R2** (production) / **MinIO** (local dev). Because R2 does not implement presigned POST (only presigned GET/PUT/DELETE/HEAD) and a presigned PUT cannot enforce a size range, uploads go through the API: multipart, hard size limit, magic-byte check, **re-encode with `sharp`** (strips EXIF and any non-image payload), then `PutObject` with a server-chosen key. Risk controls: one avatar per user (replaced, not accumulated), per-user upload rate limit, no SVG, delete replaced objects; report/removal tool + email verification before any public launch.
- **Browse API (session 3):** `services/projects.ts#listProjects` and `services/feed.ts#listFeed`, routes `GET /projects` (in `routes/projects.ts`) and `GET /feed` (`routes/feed.ts`, uses `optionalAuth`). Public responses expose only the owner's `id` + `name`, never the email. Migration `add_browse_indexes` adds `Post(createdAt)` and `Follow(projectId)` (the follow primary key leads with `userId`, so per-project counts need their own index). `GET /projects/:slug` now validates the slug with zod. No pagination yet (50 cap).

---

## 4. Repo layout (actual)

```
Mirai_Hub/
  .dockerignore              excludes node_modules, dist, .env files, **/.git (also nested repos), .github, .vscode, logs (keeps secrets out of images)
  .github/workflows/ci.yml   typecheck, build, tests (Postgres + Redis services), docker build
  apps/
    api/
      Dockerfile, Dockerfile.nginx, package.json, tsconfig.json, .env (git-ignored)
      config/nginx.conf      the nginx config copied by Dockerfile.nginx (only copy; stale src/config/nginx.conf was deleted)
      vitest.config.ts       MUST be here (apps/api root), not in tests/
      src/
        app.ts               Express app, exported (order matters, see section 7)
        server.ts            only app.listen
        run-worker.ts        REAL BullMQ worker (concurrency 5, graceful shutdown)
        lib/                 config.ts, prisma.ts, redis.ts, queue.ts, errors.ts, http.ts
        middleware/          auth.ts (signToken, requireAuth, requireEnrollOrAuth, requireRole, optionalAuth), rateLimit.ts
        controllers/auth_controller.ts
        routes/              auth.ts, projects.ts, dev.ts, feedback.ts (follows + feedback + votes + status), posts.ts, notifications.ts, feed.ts
        services/            projects.ts, follows.ts, feedback.ts, posts.ts, notifications.ts, feed.ts
      tests/
        env.ts               test env values (DB must be mirai_hub_test)
        global-setup.ts      applies migrations to the test DB once per run
        setup.ts             mocks lib/prisma (client bound to test URL) and lib/queue
        helpers.ts           resetDb (TRUNCATE before each test, refuses any DB except mirai_hub_test), makeUser/loginAs/scenario
        projects.test.ts, feedback.test.ts, posts.test.ts, notifications.test.ts, follows.test.ts (44 tests in 5 files, confirmed), browse.test.ts (10 tests, written: run to confirm 54 in 6 files)
    web/                     React app (Vite). Files: index.html, vite.config.ts (proxy), tsconfig.json, postcss.config.js (MUST be .js, see gotchas), tailwind.config.ts, global.d.ts (old, outside tsconfig), src/main.tsx, src/App.tsx (routes + AuthProvider + bell in the header), src/api.ts (types + fetch helper), src/auth.tsx, src/labels.ts (status/post-type labels, colors and dropdown orders), src/index.css; src/pages/: Home.tsx (signed-out landing, "My projects" for DEV), Signup.tsx, Login.tsx, NewProject.tsx, ProjectPage.tsx (project header, owner "Edit project" form); src/components/: RequireAuth.tsx (route guard, optional role), FollowButton.tsx, PostList.tsx (posts + owner PostForm), FeedbackSection.tsx (feedback list, votes, submit form, owner status dropdown), NotificationBell.tsx
    desktop/                 Electron: src/main.ts, src/preload.ts
  packages/
    database/                schema.prisma, migrations/, .env (DATABASE_URL, git-ignored)
  docker-compose.yml
  .env                       root: JWT_SECRET for compose (git-ignored)
  state.md
```

Root `package.json` has `"workspaces": ["apps/*", "packages/*"]` (verified).

`apps/api/package.json` scripts: `dev` (ts-node-dev API), `worker` (ts-node-dev worker), `test` (`vitest run`), `test:watch`, `build` (tsc), `start`.

### API endpoint reference (all under `/api`)

| Method + path | Auth | Notes |
|---|---|---|
| `POST /auth/signup`, passkey register/login, `GET /auth/me`, `POST /auth/logout` | mixed | JWT cookie, `purpose` session vs enroll |
| `POST /dev/login` | none | dev/test only, needs `ENABLE_DEV_LOGIN=true` (not set in compose) |
| `POST /projects` | DEV | create |
| `GET /projects?sort=new\|followers` | public | browse list, max 50: id, slug, name, tagline, createdAt, `owner {id, name}` (never the email), `_count` followers/feedback; no vision text |
| `GET /projects/mine`, `GET /projects/:slug`, `PATCH /projects/:id` | auth / public / owner | `/mine` before `/:slug`. **Update is by UUID `:id`, not slug**; only name, tagline, vision are editable (slug is immutable) |
| `PUT/DELETE /projects/:slug/follow`, `GET /me/follows` | auth | idempotent; following your OWN project returns 400 (tested) |
| `POST /projects/:slug/feedback` | auth | 201 |
| `GET /projects/:slug/feedback?status=&sort=votes\|new` | optional | `voteCount`, `hasVoted` |
| `PUT/DELETE /feedback/:id/vote` | auth | idempotent, returns `{ voteCount }` |
| `PATCH /feedback/:id/status` | owner | enqueues notification if changed |
| `POST /projects/:slug/posts` | owner | types VISION / ANNOUNCEMENT / CHANGELOG; enqueues notification |
| `GET /projects/:slug/posts?type=` | public | newest first, max 50 |
| `PATCH /posts/:id` | owner | partial title/body/type, at least one field, no re-notify |
| `DELETE /posts/:id` | owner | also deletes its NEW_POST notifications |
| `GET /me/notifications?unread=true`, `GET /me/notifications/unread-count` | auth | |
| `PATCH /notifications/:id/read`, `POST /me/notifications/read-all` | auth | scoped to own rows (404 otherwise) |
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

Inside Docker, containers use service names: `postgres-db:5432`, `redis-cache:6379`. The `api-server` container is not published directly; reach it through nginx on 8080.

**Two ways to run (pick one at a time for the worker):**

1. **Local dev (default while coding):** start only the data services, then run the API and worker with npm.
   ```powershell
   cd C:\Users\PC_User\Desktop\Mirai_Hub
   docker compose up -d postgres-db redis-cache
   ```
   Terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`), web (`npm run dev:web` from the repo root, then open `http://localhost:5173`), tests/manual calls (PowerShell where `$s` owner and `$c` consumer sessions live). Type-check the frontend with `npx tsc --noEmit` from `apps/web`. nginx does not serve the frontend yet (placeholder on `/`).
2. **Full stack in Docker (to test the real setup):** `docker compose up -d --build`, then use `http://localhost:8080/api/...`. Only public reads work through it: `ENABLE_DEV_LOGIN` is deliberately not set in compose, so there is no login until the frontend and real passkey login exist. **Don't run the local `npm run worker` at the same time as the `queue-worker` container**: both consume the same Redis queue and you can't tell which handled a job. The local API on 5000 and the container API share the same dev database.

**Automated tests:** from `apps/api`, `npm test` (API and worker don't need to be running; Postgres and Redis do). One-time setup of the test database:

```powershell
'create database mirai_hub_test;' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub
```

Migrations are applied to it automatically on each run.

**Env files (all git-ignored, never commit or paste secrets):**
- `/.env`: `JWT_SECRET=...` (compose refuses to start without it)
- `/apps/api/.env`: `PORT=5000`, `JWT_SECRET`, `REDIS_URL=redis://localhost:6380`, `RP_ID=localhost`, `ORIGIN=http://localhost:5173`, `ENABLE_DEV_LOGIN=true`, and `DATABASE_URL=postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public` (no quotes; the API reads this at runtime)
- `/packages/database/.env`: `DATABASE_URL="postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public"`
- `.env` files take only `#` comments on their own line; save as UTF-8 without BOM (if a variable "isn't found", rewrite with `Set-Content -Encoding ascii`).
- `.env` is read **only at startup**: after editing, stop `npm run dev` (Ctrl+C) and start it again. The worker reads `REDIS_URL` from the same `apps/api/.env`.
- A `$env:DATABASE_URL=...` set in PowerShell overrides the `.env`; clear with `Remove-Item Env:DATABASE_URL`.
- Test values live in `apps/api/tests/env.ts` (contains the local DB password, same as compose; read from the environment when secrets move out of compose). CI uses the same values via service containers on ports 5433 / 6380.

**Docker-mode values** (set in compose for the API; the worker gets the same `NODE_ENV`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET`, `RP_ID`, `ORIGIN` because `lib/config.ts` requires them): `ORIGIN=http://localhost:8080`, `RP_ID=localhost`, `NODE_ENV=development`.

**Commands:**
- Prisma commands run from `packages/database` (or pass `--schema=packages/database/schema.prisma`).
- New migration (local only): `npx prisma migrate dev --name <name>`. Containers use `prisma migrate deploy` (the API container runs it on start). After a migration restart the API and worker (new Prisma client), and rebuild images (`docker compose up -d --build`).
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
- [x] Schema: User, DevicePasskey, Project, Post (with `updatedAt`), Feedback, Vote, Follow, Notification + enums (Role, PostType, FeedbackStatus, NotificationType), UUIDv7 with `@db.Uuid` everywhere. Migrations applied, including `add_notifications` and `add_post_updated_at`.
- [x] `lib/` shared clients and config (required env vars, no fallback secrets)
- [x] `app.ts`: helmet, CORS with credentials, `trust proxy`, rate limiters, 100kb body limit, cookie-parser, health route, single error handler (`AppError`, `ZodError`)
- [x] Auth backend: signup, passkey register/login (usernameless), `me`, `logout`; JWT cookie with `purpose`
- [x] Dev-only login shortcut `POST /api/dev/login` (needs `ENABLE_DEV_LOGIN=true`, never in production, never in compose)
- [x] `projects` routes + service: create (DEV only), `mine`, get by slug, update (owner only)
- [x] Follows, feedback, votes, owner-only status
- [x] Posts: create, list, update, delete (owner only)
- [x] Notifications end to end: queue (5 attempts, exponential backoff), fan-out, real worker, hooks in `setStatus`/`createPost`, read routes (list, unread count, mark read, read-all)
- [x] Rate limiting verified (10 feedback creations ok, 11th and 12th returned 429; headers present; other writes unaffected)
- [x] **Automated tests: 44 passing** (5 files): consumer can't create a project, only owner changes status / posts / edits / deletes, one vote per user, `hasVoted` per viewer, UUID validation (400), 401/403/404 cases, queue job requested exactly once and not for no-op status or edits, fan-out skips owner and non-followers and is idempotent, notifications scoped per user, post delete removes its notifications, follow routes (401, idempotent follow, `/me/follows`, owner cannot follow own project, another DEV can, unfollow repeatable, unknown project 404)
- [x] `npx tsc --noEmit` clean
- [x] **Docker (Phase 0.5):** `.dockerignore` added (loaded by the build, context only ~11 kB); Dockerfile rewritten (Node 22, api workspace only, local Prisma 5.22, builds API + worker); compose worker runs `node apps/api/dist/run-worker.js` with the env `config.ts` requires; image build succeeds (`prisma generate`, `tsc`); all 5 containers Up (api-server, queue-worker, nginx, redis, postgres healthy)
- [x] **nginx:** config replaced (API proxied on `/api/`, `X-Forwarded-For` set from `$remote_addr`, upstream keep-alive, 200k body limit, placeholder on `/`); stale `src/config/nginx.conf` deleted; `GET http://localhost:8080/api/health` returns `online`, `GET http://localhost:8080/` returns the placeholder text
- [x] **CI workflow** rewritten and renamed to `ci.yml` (file had been named `ci.yml;` with a stray semicolon, so GitHub never ran it; it also referenced Turborepo, which the repo doesn't have). Now: Node 22, Postgres + Redis services, install api workspace, prisma generate, typecheck, build, `npm test`, plus a Docker image build. Committed.
- [x] **Verified after the Docker review:** posts list works through nginx (raw JSON shows all 3 posts; the blank row earlier was a PowerShell display quirk); the image contains no `.env` (only a Linux-built `node_modules`); the containerized worker processed a real job (`[NEW_POST] post-...: 1 notifications created`)
- [x] **Frontend foundation (session 3):** old marketing UI deleted; Vite + React + Tailwind + router; `/api` proxy proven (page showed `API status: online`); `tsc --noEmit` clean
- [x] **Passkey signup and login work in a real browser** (Windows passkey prompt, first test ever of the `@simplewebauthn/server` v14 code in `auth_controller.ts`; no server-side field-name fixes were needed). Pages: `/signup` (email, name, role), `/login` (usernameless), Home shows the signed-in user + sign out.
- [x] **Browser checklist passed (user report "all fine"):** sign out / usernameless sign-in / reload, consumer signup (no project list, `/projects/new` shows a role message), signed-out redirect to `/login`, My projects list, create project with live slug validation (too short, leading dash, reserved `api`, duplicate `my-game` gives "That slug is already taken"), landing on `/p/:slug` with the "Your project" badge
- [x] **Public project page passed (8-point check):** posts newest first with type labels, feedback list with status badges and sorting, vote toggle, submit feedback, follow/unfollow with live follower count and persistence on reload, signed-out view (votes disabled, sign-in links), own project (no Follow button, empty states)
- [x] Dev DB check: no self-follow rows (`Follow` rows where the follower owns the project): 0 rows
- [x] **Follow-own-project rule confirmed:** `services/follows.ts` returns 400 for the owner; `follows.test.ts` passes (the file had been saved as `follows.tst.ts`, so vitest ignored it until git renamed it: 38 -> 44 tests). Committed (`Block following own project (server + tests)`).
- [x] **Owner controls passed the two-window test** (user report "we fine"; `devui` normal window, `fanui` private window): post create/edit/delete, status dropdown with followers notified only on a real change, consumer sees plain badges, no controls on someone else's project.
- [x] `.gitignore` check: no `.env` file is tracked and `.env`, `apps/api/.env`, `packages/database/.env` are ignored (rule `*.env` on line 12)
- [x] **Notification bell works (user report "it worked"):** badge, list, click-through to the project, mark read, mark all read, driven by the real worker. Together with owner controls this proves the whole loop in the browser: owner changes a status or publishes, the follower sees it in the bell.
- [x] **Edit project form works** (owner only; header updates immediately, counts unchanged, persists after reload).
- [x] **Browse API works on real data (user ran it in PowerShell):** `GET /api/projects` returned `fishing-game` then `my-game` (newest first, tagline shown), `GET /api/feed` returned all 4 posts newest first with excerpts (New Goals, Fishing is coming, v0.1, Hello world).
- [x] Old marketing code removed

### Still to confirm (small checks, do first next session)
- [ ] **First GitHub Actions run** (Actions tab after pushing): green means typecheck, build, tests and Docker build all pass in CI; if not, the failing step's log is what to paste.
- [ ] Dev DB has no leftover test users from the failed early test runs: only `dev1@test.com` and `fan1@test.com` should exist; delete `owner@test.com`, `fan2@test.com`, `otherdev@test.com` if present.
- [ ] **Nested git repo:** `apps/api/.git` exists (leftover from the old marketing project; 2 old commits). The root repo tracks the `apps/api` files normally (mode 100644 entries, including new files like `app.ts`), so commits are complete and nothing is lost. Decide next session whether to move it out of the project (e.g. `Move-Item apps\api\.git ..\old-api-git-backup`, keeps the history outside the repo), then confirm `git status` is clean. Don't delete it blindly.
- [ ] Apply the updated `.dockerignore` (`**/.git` instead of `.git`, so nested repos stay out of images) and commit it.

- [ ] Commit the remaining frontend work (create project, project page, owner controls, notification bell, edit-project form), the `clearCookie('auth_token')` line in `signup` and this `state.md` (`git add -A; git commit`); only `apps/api` is known to be committed. Then run the stricter secrets check (the old `findstr .env` also matches the harmless `tests/env.ts`): `git ls-files | Select-String -Pattern '(^|/)\.env'` must print nothing, and `git check-ignore -v .env apps/api/.env packages/database/.env` must print 3 lines.
- [ ] `.gitignore` rule `*.env` does not cover `.env.local` / `.env.production`: add a `.env.*` line (`Add-Content -Encoding ascii .gitignore "`n.env.*"`) and commit.
- [ ] Clean up test data when done testing: test accounts in the dev DB (`delete from "User" where email = '...'`) and the matching `localhost` passkeys on the device.

- [ ] **Browse API checks not yet seen:** `npx tsc --noEmit` clean in `apps/api`; `npm test` shows **6 files / 54 tests** (`tests/browse.test.ts` = 10 tests: 4 for the projects list, 6 for the feed; the filename must end `.test.ts`); migration folder `..._add_browse_indexes` exists under `packages/database/migrations`; commit it (`Browse API: projects list and feed (+ indexes, tests)`), then the stricter secrets check.

### Test gaps (known, add when touching these areas)
- `PATCH /projects/:slug` (owner-only update)
- Rate limiting (limiters are switched off under `NODE_ENV=test`)
- The BullMQ worker itself (the queue is mocked; fan-out logic is tested directly)
- Auth/passkey flow and signup (409 on duplicate email, enroll cookie); only the dev login is used in tests

### Written but NOT yet confirmed
- (nothing pending)

### Not started
- [ ] **Browse/home feed, part B: the Home page UI** (Discover / Following tabs, project and post cards, better feed UI; the API part is done, but the page still shows only "My projects")
- [ ] **Basic profiles** (bio, public profile page, edit own profile; never expose email)
- [ ] **Images via object storage** (user avatars + optional cover image per post; see section 9 "Later" for the design)
- [ ] Serve the built frontend from nginx on `/` (production build check, SPA fallback), Electron checks
- [ ] Email verification, consumer login (email link / Google)
- [ ] Prometheus + Grafana, load tests (k6)

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

# Post, edit, delete
$p = Invoke-RestMethod "$base/projects/my-game/posts" -Method Post -ContentType $json -WebSession $s -Body '{"type":"ANNOUNCEMENT","title":"Hello world","body":"First update."}'
Invoke-RestMethod "$base/posts/$($p.id)" -Method Patch -ContentType $json -WebSession $s -Body '{"body":"Edited."}'
Invoke-RestMethod "$base/posts/$($p.id)" -Method Delete -WebSession $s

# Notifications (allow a few seconds for the worker)
Invoke-RestMethod "$base/me/notifications/unread-count" -WebSession $c
Invoke-RestMethod "$base/me/notifications" -WebSession $c | Format-Table type, title, status, read
Invoke-RestMethod "$base/me/notifications/read-all" -Method Post -WebSession $c
```

In `catch` blocks print the status code with `[int]$_.Exception.Response.StatusCode` (the error body alone is `$_.ErrorDetails.Message`). Creating 10+ feedback items within 10 minutes triggers the feedback rate limit; restarting the API resets all counters.

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
- Adding a required column to an existing table needs a default (`@default(now()) @updatedAt` for `Post.updatedAt`).
- Compose `${JWT_SECRET:?...}` fails the whole file if the root `.env` is missing.
- Never `cd` into a file; create files from PowerShell with `Set-Content -Encoding ascii` or in the VS Code sidebar.
- Check which folder you're in before using relative paths (`apps\api\package.json` from inside `apps\api` doubles the path). `npm test` only exists in `apps/api`.
- BullMQ job ids can't contain `:`; use `-` in dedupe keys.
- PowerShell strips double quotes when passing SQL to `docker compose exec`; pipe the query via stdin (section 4b).
- With the worker stopped, jobs just wait in Redis and are processed when it starts. Two workers (local + container) share one queue.
- **Vitest only loads `vitest.config.ts` from the project root (`apps/api`).** When it sat in `tests/`, vitest silently ignored it: no `env`, no `globalSetup`, no `setupFiles`, so tests ran against the DEV database (the wipe guard in `helpers.ts` blocked it and nothing was lost). If tests ever connect to `mirai_hub` again, check this first.
- Tests build their own Prisma client with the test URL (`vi.mock('../src/lib/prisma')` in `tests/setup.ts`), and `resetDb` checks `current_database()` before every TRUNCATE. Keep both guards.
- `ERESOLVE` when installing vitest: it needs `@types/node` ^22 or >=24; `apps/api` now uses `@types/node@^22`. Never use `--force` / `--legacy-peer-deps` for that.
- Vite prints a harmless warning about `configLoader: 'native'` (ESM syntax in a CommonJS package). Don't add `"type": "module"` to `apps/api/package.json` to silence it. `$env:VITE_CONFIG_NATIVE_IGNORE_WARNING = "true"` hides it for one terminal.
- The first request in each test file takes ~2 s (cold DB connection); a full run takes ~40 s.
- Rate-limit counters are in memory: a restart resets them.
- **Without a `.dockerignore`, `COPY apps/api` bakes `apps/api/.env` (secrets) and Windows `node_modules` into the image.** Keep the root `.dockerignore`.
- A GitHub workflow file must end in `.yml`/`.yaml`; a stray character (`ci.yml;`) means it never runs. Rename files with a weird name via `Rename-Item -LiteralPath`.
- Don't `npm install -g prisma` in images: it installs the newest major, not the repo's 5.22 (use the local one via `npx`).
- The worker container needs `JWT_SECRET`, `RP_ID` and `ORIGIN` in its env even though it doesn't use them (`lib/config.ts` requires them), and `command: node apps/api/dist/run-worker.js` (the root `package.json` has no `worker` script).
- Keep the Node major aligned: images and CI use 22, local is 24 (types are `@types/node` 22).
- In Windows PowerShell 5.1, `Invoke-RestMethod <url> | Select-Object title` can print a single blank row when the response is a JSON array (seen twice; the raw JSON was fine). Assign to a variable first (`$r = Invoke-RestMethod ...; $r | Select-Object title`) or check `(Invoke-WebRequest <url> -UseBasicParsing).Content`.
- `apps/api/.git` is a nested repo left from the old project; `ls -a apps/api` in the image showed it because `.dockerignore` only excluded the root `.git` (now `**/.git`).
- **`apps/web/postcss.config` must be `.js`** (package is `"type": "module"`, so ESM syntax). A `postcss.config.ts` makes Vite fail with `ERR_REQUIRE_ESM` (it gets loaded through the API's ts-node). Config changes (`vite.config.ts`, postcss, tailwind) need a Vite restart.
- Newer npm blocks install scripts and prints "install scripts blocked" (esbuild, prisma, electron, msgpackr-extract). Harmless for now. If Vite complains about esbuild: `npm install-scripts approve esbuild@0.21.5`; when reaching the desktop app: `npm install-scripts approve electron`. Never `npm audit fix --force`.
- "API not reachable" on the web page means the API terminal isn't running (Docker data services alone are not enough), or the Vite proxy isn't active (restart Vite).
- An abandoned signup (account created, passkey step never finished) locks that email with a 409. The signup page retries the passkey for 10 minutes; otherwise delete the row: `"delete from ""User"" where email = 'x@test.com';" | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`. Proper fix: orphan-user cleanup (Phase 4). `dev1@test.com` / `fan1@test.com` were created without passkeys, so they only work through the dev login, not in the browser.
- **The test count is the proof that a new test file was picked up** (now **44 tests in 5 files**). Test files must be `apps/api/tests/*.test.ts`; a file saved elsewhere or with a misspelled name is silently ignored (`follows.tst.ts` was ignored until renamed).
- Following a project needs no special role: a DEV can follow another DEV's project. If a Follow button seems to work "on your own project", check that the project is really yours (the page shows a "Your project" badge and hides the button there).
- `git ls-files | findstr .env` gives a false alarm on `apps/api/tests/env.ts` (`.` matches any character). Use `git ls-files | Select-String -Pattern '(^|/)\.env'` (must print nothing) and `git check-ignore -v .env apps/api/.env packages/database/.env` (3 lines).
- **Testing two accounts at once:** a browser keeps one login per site, so use a normal window for the DEV and a private (incognito) window for the consumer; passkeys work in private windows. Always `localhost:5173`.
- If the API/worker terminals spam `Redis error`, the data containers are not running: `docker compose ps` printing an empty table means nothing is up. Start Docker Desktop, then `docker compose up -d postgres-db redis-cache` (they reconnect by themselves; restart them if they don't).
- **Where the edit controls are** (a frequent confusion): "Edit project" is a button under the project header (owner only); Edit / Delete on a post only exist on an existing post, so publish a post with "New post" first; the status dropdown only replaces the badge on the owner's own project. Nothing shows if you are signed in as another account or on someone else's project (check for the "Your project" badge).
- After editing frontend files, Vite hot-reloads by itself: a hard refresh (Ctrl+F5) is enough. Restart `npm run dev:web` only after config changes or if a red error overlay sticks. The API terminal needs no restart for frontend changes.
- You don't need two logged-in accounts at once: notifications are stored in the DB, so one window can do owner step, sign out, consumer step. Two windows (normal + private) only show the live badge update.
- **End of a session:** Ctrl+C the API and any local worker, then `docker compose down` (containers go, data survives in the `postgres_data` volume; **never add `-v`**, it wipes the DB), then quit Docker Desktop. Terminal sessions (`$s`, `$c`) are lost; log in again next time with the two `dev/login` lines in section 6.

---

## 8. Known problems / tech debt

**Reliability:**
- If the API saves a status change/post and Redis is down at that moment, the notification is lost (`enqueueNotification` logs and swallows the error). Later fix: an **outbox table** written in the same DB transaction, drained by the worker.
- If a post is deleted before the worker handles its `NEW_POST` job, notifications pointing at a deleted post can still be created (shown with `title: null`, harmless). Fix: existence check in `fanOut`, together with the outbox work.
- A no-op status change (same status again) still writes to the DB and bumps `updatedAt`; harmless, optional early return in `setStatus`.
- `GET /me/notifications` returns the feedback's **current** status, not the status at the time of the event (it reads the item when listing). An old "now Planned" notification will show "Shipped" after a later change. Fix later: store the status on the `Notification` row (or in the job payload) if it matters.
- Rate-limit counters live in the API process's memory: they reset on restart and aren't shared across multiple API containers. Fix for production: `rate-limit-redis` with the existing Redis. Limits are per IP (people behind one office/school network share an allowance); per-user limits are a later refinement.

**API consistency (small):**
- `PATCH /projects/:id` uses the UUID while every other project route uses the slug; the frontend must use the `id` from the project object for updates.
- Clearing a project's tagline/vision stores an empty string, not `null` (UI treats both as empty); optionally normalize empty strings to `null` in `updateProject`.

**Security (before any public deploy):**
- Email is **not verified** at signup (anyone can sign up as any email).
- Signup returns 409 for existing emails (reveals which emails have accounts).
- Orphan users: signup without registering a passkey leaves an unusable row (add cleanup job).
- DB password hardcoded in `docker-compose.yml` (and mirrored in `tests/env.ts` and `ci.yml`, which are throwaway local/CI values); move compose to `.env` with `${VAR}` before sharing the repo.
- `/api/dev/login` must be deleted (or stay disabled) before launch.
- Keep Postgres/Redis bound to `127.0.0.1`; the API container port must never be published publicly (only nginx is).
- User-generated text (post/feedback bodies) is stored raw; the frontend must render it escaped (React does by default) and never with `dangerouslySetInnerHTML`. If markdown is added later, sanitize.
- `npm ci` in the API image reported **4 vulnerabilities (1 moderate, 3 high)**; the full workspace install reports **9 (3 moderate, 6 high)**. Run `npm audit` and review before any public deploy (some may be dev-only); never `npm audit fix --force`.

**Infra (remaining):**
- nginx: serve the built frontend on `/` (currently a text placeholder); add HTTPS and security headers for production; consider `limit_req` at the edge.
- Production needs HTTPS and `NODE_ENV=production`; `ORIGIN` must exactly match what the browser shows; `RP_ID` is the bare domain.
- Image hardening later: multi-stage build (drop dev dependencies), run as non-root user.
- `docker compose down -v` wipes the DB volume (then rerun migrations, recreate the `mirai_hub_test` database, and recreate `dev1`, `fan1`, and the `my-game` project).

**Electron:** WebAuthn (Touch ID / Windows Hello) in Electron is historically flaky. Test early; fallback is opening the system browser for login. `expectedOrigin` can be an array. Test cookie auth inside Electron too.

**Frontend:** bare minimum (`apps/web`); rework is the next big phase.

---

## 9. Roadmap (in order; don't skip ahead)

**Next session starts here:**
1. Start the stack: Docker Desktop, then `docker compose up -d postgres-db redis-cache` (check `docker compose ps`: postgres healthy, redis up); terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`, required for notifications), web (`npm run dev:web` from the repo root). Open `http://localhost:5173` (never 127.0.0.1).
2. Clear "Still to confirm" in section 5: commit all remaining frontend work + `state.md`, the stricter secrets check, `.env.*` ignore rule, first CI run result (GitHub Actions tab), leftover test users and passkeys, nested `apps/api/.git`, `.dockerignore`.
3. **Browse / home feed, part B: the Home page UI** (the API part is done). Home becomes tabs **Discover** / **Following** (Following only when signed in). Discover: project cards from `GET /api/projects?sort=new|followers` (name, tagline, owner name, followers/feedback counts, link to `/p/:slug`) with a Newest / Most followed switch, plus a recent-updates list from `GET /api/feed` (project name, type label from `labels.ts`, date, title, excerpt, link to the project). Following: `GET /api/feed?scope=following`, empty state "Follow a project to see its updates here" linking to Discover. DEV users keep "My projects" + Create project (side block or its own tab). Widen the layout for feeds (the app container is `max-w-lg`; e.g. `max-w-3xl` on Home), with proper loading / error / empty states. Known limits: no pagination (50 cap), no search, no images yet.
4. **Serve the built frontend from nginx** (the Phase 0.5 leftover; makes the whole stack run in Docker with real passkey login at `http://localhost:8080`). Do it BEFORE object storage because upload and media URLs depend on the proxy layout. First check `npm run build` works in `apps/web` (`tsc && vite build`, output `apps/web/dist`). Then a multi-stage nginx image (stage 1 builds `apps/web` from the repo-root context, stage 2 is `nginx:alpine` with the `dist` files), `location /` with SPA fallback (`try_files $uri /index.html`), `/api/` stays proxied. `ORIGIN=http://localhost:8080` and `RP_ID=localhost` are already set in compose; test with a fresh signup at `:8080`. `ENABLE_DEV_LOGIN` stays off in compose.
5. **Basic profiles (no images yet).** Schema: `User.bio String?` (display name is the existing `name`). Public `GET /api/users/:id` returns id, name, bio, role, createdAt and, for DEVs, their projects; **never the email**. `PATCH /api/me` edits name and bio (zod, length limits). Frontend: `/u/:id` page, "Edit profile", author names in feedback/posts link to profiles. Use the user UUID in the URL for now (handles need uniqueness + reserved-word rules, later). Tests for the privacy rule (no email in any public response) and for editing only your own profile.
6. **Images via object storage** (design in section 9 "Later"): MinIO in compose for dev, R2 for production, uploads through the API with a `sharp` re-encode (no presigned URLs: R2 does not support presigned POST). Scope = avatars for ALL signed-in users + one optional cover image per post (owners). Prerequisites: step 4 done (nginx body limit for the upload routes), per-user upload rate limit, deleting replaced objects; images are served from `MEDIA_PUBLIC_URL`, not through the API.
7. **Phase 4 hardening** (in this order): consumer login without a passkey requirement (email link or Google) + email verification, orphan-user cleanup, secrets out of compose, notification outbox (and store the status on the notification), Redis-backed rate limits, `npm audit` review, multi-stage non-root API image, HTTPS + production nginx, remove dev login.
8. Optional small test additions (project update, signup).

**Phase 3: Frontend (web-first)**
1. ~~Login/signup + passkey registration page~~ DONE in session 3 (works in a real browser)
2. ~~Project page (vision, posts, feedback list, vote, submit feedback, follow), text only~~ DONE in session 3
3. ~~Dev dashboard (manage statuses, post/edit/delete updates)~~ DONE in session 3 (owner controls on the project page)
4. ~~Notification bell~~ DONE in session 3; then serve the built app from nginx on `/`; then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, secrets out of compose, HTTPS + production nginx, remove dev login, outbox for notifications, Redis-backed rate limits, `npm audit` review, multi-stage non-root image.

**Phase 5: Observability and load**
- Add `prom-client` metrics (request duration histogram, queue depth) while building routes, not afterwards
- Prometheus + Grafana containers, dashboards (latency p50/p95/p99, error rate, queue depth, DB connections)
- k6 load tests on real flows (list feedback, vote, status change + fan-out); expect first bottlenecks in the DB (indexes, vote-count queries, fan-out batching), not Node

**Later / ideas (don't build yet):**
- **Images (scheduled after the browse feed, nginx frontend and profiles; the text-only frontend now works).** The core loop doesn't need them, but avatars and post covers make the product feel real. Scope: user avatars (any signed-in user) + one optional cover image per post (owners); consumer feedback stays text. Uploads go through the API with a `sharp` re-encode (see the decision in section 3); no presigned URLs. Design:
  - Use **Cloudflare R2** in production (pricing checked Oct 2026: Standard storage $0.015/GB-month, permanent monthly free tier of 10 GB + 1M write-class + 10M read-class operations, zero egress fees; Backblaze B2 is cheaper per TB at rest, but R2's free tier and free egress make it effectively free at our scale) and a **MinIO** container in compose for local dev, with the same S3 client (`@aws-sdk/client-s3`, endpoint + credentials from env). Never store files in Postgres or on the API container's disk (containers are ephemeral).
  - Upload flow: browser sends the file to the API (`POST /api/me/avatar`, `POST /api/posts/:id/cover`; multipart, memory storage, hard size limit such as 2 MB avatar / 5 MB cover). The default 100 kb JSON body limit stays for everything else: only these routes get a bigger limit, and nginx `client_max_body_size` (now 200k) must be raised for just that path. The API checks magic bytes (png/jpeg/webp only, **no SVG**), **re-encodes with `sharp`** (avatar 256x256 WebP, cover max ~1600 px WebP), then `PutObject`s with a server-chosen key and stores the key on the user/post. `sharp` needs its prebuilt musl binary in the Alpine image: verify the Docker build when adding it.
  - DB: simplest is `User.avatarKey String?` and `Post.coverKey String?`; the public URL is `MEDIA_PUBLIC_URL` (env) + key, so the browser loads images straight from the bucket, not through the API. Production: R2 bucket on a custom domain (needs a domain on Cloudflare; the `r2.dev` address is meant for development, confirm in Cloudflare's current docs); local dev: MinIO.
  - Checks: hard size limits, a per-user upload rate limit (e.g. 5 per hour; avatars open the upload path to every signed-in user), one avatar per user, no SVG, EXIF stripped by the re-encode, delete the old object whenever an avatar/cover is replaced or a post is deleted. Before public launch: a way to report and remove abusive images, and email verification (signup is unverified today). Consumers' feedback stays text.
  - Start with **a single optional cover image per post**, not inline images in the body. Inline images imply markdown rendering and sanitizing, which is a bigger step.
- discovery and search, comments on feedback, multiple team members per project, dev analytics, desktop notifications/tray, auto-updater, public roadmap view, cursor pagination.

**Rough time estimate (hobby pace):** ~10 hrs/week means ~4-5 months total, MVP in a browser at ~2-3 months from the start; frontend is the biggest chunk and biggest unknown. Backend MVP loop, rate limiting, tests and the Docker/nginx/CI review finished in session 2, ahead of plan.

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
10. Give complete files to paste (not diffs) and say exactly where each file goes; the user is on Windows/PowerShell. Say which folder each command runs from.

## 11. Resume prompt (paste into a new chat with this file)

> I'm building Mirai Hub (two-sided feedback/vision platform, see the attached state.md). I'm on Windows/PowerShell. Read state.md fully, then start at "Next session starts here" in section 9. Keep to the rules in section 10. Ask me for specific files only when you need them, and tell me where each file goes.