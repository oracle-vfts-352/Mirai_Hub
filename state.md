# Mirai Hub: Project State

> Last updated: 2026-10-20 (session 3, after the first successful passkey signup/login in a real browser).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~68%** (backend MVP loop complete, rate limited, 38 automated tests; Docker stack runs behind nginx; CI rewritten; frontend foundation and passkey signup/login work in a real browser; product pages, hardening, observability not started).

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

**Not the goal (for now):** marketing automation, email blasts, encrypted customer lists, analytics, discovery/search. The old code was a single-company marketing tool; that idea is **dropped**.

## 2. MVP definition (build only this first)

1. Dev signs up, registers a passkey, creates a project page.
2. Consumer signs up, follows a project, submits feedback.
3. Other consumers vote on feedback.
4. Project owner changes a feedback item's status.
5. Followers get notified of the change (BullMQ).

Everything else waits until this loop works end to end. **Backend: done, manually verified and covered by automated tests. Frontend: foundation + passkey signup/login/logout work in a real browser (session 3); product pages (projects, feedback, notifications) not started.**

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
| Images (later) | S3-compatible object storage + presigned uploads. See section 9 "Later". **Not now.** |

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
        routes/              auth.ts, projects.ts, dev.ts, feedback.ts (follows + feedback + votes + status), posts.ts, notifications.ts
        services/            projects.ts, follows.ts, feedback.ts, posts.ts, notifications.ts
      tests/
        env.ts               test env values (DB must be mirai_hub_test)
        global-setup.ts      applies migrations to the test DB once per run
        setup.ts             mocks lib/prisma (client bound to test URL) and lib/queue
        helpers.ts           resetDb (TRUNCATE before each test, refuses any DB except mirai_hub_test), makeUser/loginAs/scenario
        projects.test.ts, feedback.test.ts, posts.test.ts, notifications.test.ts
    web/                     React app (Vite). Files: index.html, vite.config.ts (proxy), tsconfig.json, postcss.config.js (MUST be .js, see gotchas), tailwind.config.ts, global.d.ts (old, outside tsconfig), src/main.tsx, src/App.tsx (router + AuthProvider), src/api.ts, src/auth.tsx, src/pages/Home.tsx, Signup.tsx, Login.tsx, src/index.css
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
| `GET /projects/mine`, `GET /projects/:slug`, `PATCH /projects/:id` | auth / public / owner | `/mine` before `/:slug`. **Update is by UUID `:id`, not slug**; only name, tagline, vision are editable (slug is immutable) |
| `PUT/DELETE /projects/:slug/follow`, `GET /me/follows` | auth | idempotent |
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
- [x] **Automated tests: 38 passing** (4 files): consumer can't create a project, only owner changes status / posts / edits / deletes, one vote per user, `hasVoted` per viewer, UUID validation (400), 401/403/404 cases, queue job requested exactly once and not for no-op status or edits, fan-out skips owner and non-followers and is idempotent, notifications scoped per user, post delete removes its notifications
- [x] `npx tsc --noEmit` clean
- [x] **Docker (Phase 0.5):** `.dockerignore` added (loaded by the build, context only ~11 kB); Dockerfile rewritten (Node 22, api workspace only, local Prisma 5.22, builds API + worker); compose worker runs `node apps/api/dist/run-worker.js` with the env `config.ts` requires; image build succeeds (`prisma generate`, `tsc`); all 5 containers Up (api-server, queue-worker, nginx, redis, postgres healthy)
- [x] **nginx:** config replaced (API proxied on `/api/`, `X-Forwarded-For` set from `$remote_addr`, upstream keep-alive, 200k body limit, placeholder on `/`); stale `src/config/nginx.conf` deleted; `GET http://localhost:8080/api/health` returns `online`, `GET http://localhost:8080/` returns the placeholder text
- [x] **CI workflow** rewritten and renamed to `ci.yml` (file had been named `ci.yml;` with a stray semicolon, so GitHub never ran it; it also referenced Turborepo, which the repo doesn't have). Now: Node 22, Postgres + Redis services, install api workspace, prisma generate, typecheck, build, `npm test`, plus a Docker image build. Committed.
- [x] **Verified after the Docker review:** posts list works through nginx (raw JSON shows all 3 posts; the blank row earlier was a PowerShell display quirk); the image contains no `.env` (only a Linux-built `node_modules`); the containerized worker processed a real job (`[NEW_POST] post-...: 1 notifications created`)
- [x] **Frontend foundation (session 3):** old marketing UI deleted; Vite + React + Tailwind + router; `/api` proxy proven (page showed `API status: online`); `tsc --noEmit` clean
- [x] **Passkey signup and login work in a real browser** (Windows passkey prompt, first test ever of the `@simplewebauthn/server` v14 code in `auth_controller.ts`; no server-side field-name fixes were needed). Pages: `/signup` (email, name, role), `/login` (usernameless), Home shows the signed-in user + sign out.
- [x] Old marketing code removed

### Still to confirm (small checks, do first next session)
- [ ] **First GitHub Actions run** (Actions tab after pushing): green means typecheck, build, tests and Docker build all pass in CI; if not, the failing step's log is what to paste.
- [ ] Dev DB has no leftover test users from the failed early test runs: only `dev1@test.com` and `fan1@test.com` should exist; delete `owner@test.com`, `fan2@test.com`, `otherdev@test.com` if present.
- [ ] **Nested git repo:** `apps/api/.git` exists (leftover from the old marketing project; 2 old commits). The root repo tracks the `apps/api` files normally (mode 100644 entries, including new files like `app.ts`), so commits are complete and nothing is lost. Decide next session whether to move it out of the project (e.g. `Move-Item apps\api\.git ..\old-api-git-backup`, keeps the history outside the repo), then confirm `git status` is clean. Don't delete it blindly.
- [ ] Apply the updated `.dockerignore` (`**/.git` instead of `.git`, so nested repos stay out of images) and commit it.

- [ ] Commit the frontend foundation and the `clearCookie('auth_token')` line in `signup` (`git add -A; git commit`), then `git ls-files | findstr .env` must print nothing.
- [ ] Clean up test data when done testing: test accounts in the dev DB (`delete from "User" where email = '...'`) and the matching `localhost` passkeys on the device.

### Test gaps (known, add when touching these areas)
- Follow/unfollow routes (tests create follows directly via Prisma), `GET /me/follows`
- `PATCH /projects/:slug` (owner-only update)
- Rate limiting (limiters are switched off under `NODE_ENV=test`)
- The BullMQ worker itself (the queue is mocked; fan-out logic is tested directly)
- Auth/passkey flow and signup (409 on duplicate email, enroll cookie); only the dev login is used in tests

### Written but NOT yet confirmed
- [ ] The browser test script also covered sign out, usernameless sign-in and "reload keeps you signed in", and a CONSUMER signup. The user reported the passkey flow works; re-check each of those explicitly once.

### Not started
- [ ] Frontend product pages (create project, project page, dev dashboard, notification bell) and Electron checks
- [ ] Email verification, consumer login (email link / Google)
- [ ] Prometheus + Grafana, load tests (k6)
- [ ] Image uploads (deferred on purpose, see section 9 "Later")

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
- **End of a session:** Ctrl+C the API and any local worker, then `docker compose down` (containers go, data survives in the `postgres_data` volume; **never add `-v`**, it wipes the DB), then quit Docker Desktop. Terminal sessions (`$s`, `$c`) are lost; log in again next time with the two `dev/login` lines in section 6.

---

## 8. Known problems / tech debt

**Reliability:**
- If the API saves a status change/post and Redis is down at that moment, the notification is lost (`enqueueNotification` logs and swallows the error). Later fix: an **outbox table** written in the same DB transaction, drained by the worker.
- If a post is deleted before the worker handles its `NEW_POST` job, notifications pointing at a deleted post can still be created (shown with `title: null`, harmless). Fix: existence check in `fanOut`, together with the outbox work.
- A no-op status change (same status again) still writes to the DB and bumps `updatedAt`; harmless, optional early return in `setStatus`.
- Rate-limit counters live in the API process's memory: they reset on restart and aren't shared across multiple API containers. Fix for production: `rate-limit-redis` with the existing Redis. Limits are per IP (people behind one office/school network share an allowance); per-user limits are a later refinement.

**API consistency (small):**
- `GET /projects/:slug` passes `req.params.slug` to the service without zod (Prisma parameterizes, so it is safe, but rule 3 says validate): add the same `slugSchema` as the other routes.
- `PATCH /projects/:id` uses the UUID while every other project route uses the slug; the frontend must use the `id` from the project object for updates.

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
1. Start the stack: `docker compose up -d postgres-db redis-cache`; terminals: API (`npm run dev` in `apps/api`), worker (`npm run worker` in `apps/api`, optional), web (`npm run dev:web` from the repo root). Open `http://localhost:5173` (never 127.0.0.1).
2. Clear "Still to confirm" in section 5 (explicit passkey cycle re-check, commit, CI run result, leftover test users, nested `apps/api/.git`, `.dockerignore`).
3. **Phase 3 step 2: create a project (dev).** Backend rules are in section 4 ("Project rules"). Frontend: a route guard (redirect to `/login` when signed out), a "My projects" list for DEV users on Home (`GET /api/projects/mine`), and a "Create project" form (name, slug with live validation, tagline, vision) posting to `POST /api/projects`, then navigate to the project page. Needed before writing it: `apps/api/src/services/projects.ts` (exact response shapes of create, `mine`, `getBySlug`).
4. **Phase 3 step 3: public project page** (vision, posts, feedback list with votes, submit feedback); route suggestion `/p/:slug`.
5. Optional small test additions from the "Test gaps" list (follow routes, project update, signup).

**Phase 3: Frontend (web-first)**
1. ~~Login/signup + passkey registration page~~ DONE in session 3 (works in a real browser)
2. Project page (vision, posts, feedback list, vote, submit feedback), **text only**
3. Dev dashboard (manage statuses, post/edit/delete updates)
4. Notification bell (unread count + list + mark read); then serve the built app from nginx on `/`; then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, secrets out of compose, HTTPS + production nginx, remove dev login, outbox for notifications, Redis-backed rate limits, `npm audit` review, multi-stage non-root image.

**Phase 5: Observability and load**
- Add `prom-client` metrics (request duration histogram, queue depth) while building routes, not afterwards
- Prometheus + Grafana containers, dashboards (latency p50/p95/p99, error rate, queue depth, DB connections)
- k6 load tests on real flows (list feedback, vote, status change + fan-out); expect first bottlenecks in the DB (indexes, vote-count queries, fan-out batching), not Node

**Later / ideas (don't build yet):**
- **Images in posts (decided: defer until after the text-only frontend works).** The core loop doesn't need them. Design when it's time:
  - Use **S3-compatible object storage** (Cloudflare R2 or S3 in production; **MinIO** container in compose for local dev). Never store files in Postgres or on the API container's disk (containers are ephemeral).
  - Upload flow: client asks `POST /uploads` (auth, owner of a project) -> API validates content type (png/jpeg/webp only, **no SVG**) and size limit, returns a **presigned PUT URL** + object key -> browser uploads directly to storage -> post references the key. Files don't pass through the API.
  - DB: either an `Asset` table (id, ownerId, key, contentType, size) or an `imageKeys` array on `Post`; serve via public bucket/CDN URL.
  - Checks: size limits, per-user rate limit, strip EXIF, orphan cleanup job (uploaded but never attached), only project owners can upload at first (consumers' feedback stays text).
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