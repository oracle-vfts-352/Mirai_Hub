# Mirai Hub: Project State

> Last updated: 2026-10-12 (end of session 2).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~55%** (backend MVP loop complete, rate limited, covered by 38 automated tests; infra review, frontend, hardening, observability not started).

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

Everything else waits until this loop works end to end. **Backend: done, manually verified and covered by automated tests (session 2). Frontend: not started.**

---

## 3. Stack and decisions made

| Area | Choice |
|---|---|
| Frontend | React + TypeScript + Tailwind (Vite), **web-first** |
| Desktop | Electron as a **thin shell** around the web app (optional for devs). No Electron APIs inside React except behind `window.electronAPI` checks via `preload` + `contextBridge`. Keep `contextIsolation: true`, `nodeIntegration: false` |
| API | Node + Express 4 + TypeScript |
| DB | PostgreSQL 16 via Prisma 5.22 |
| Cache / queue | Redis (`ioredis` 6) + **BullMQ** 6. RabbitMQ was considered and rejected (overkill; BullMQ covers notifications, retries, delayed jobs). Don't suggest it again unless scale demands it |
| Auth | WebAuthn passkeys (`@simplewebauthn/server` v14) + JWT in HttpOnly cookie |
| Validation | zod (every route input, including `:id` params as UUID) |
| Rate limiting | `express-rate-limit` (in-memory for now) |
| Tests | vitest 5 + supertest, against a separate Postgres database `mirai_hub_test` |
| Infra | Docker Compose, nginx reverse proxy, GitHub Actions CI |
| IDs | UUIDv7 (`@default(uuid(7)) @db.Uuid`) on every id and every foreign key |
| Observability (later) | Prometheus + Grafana, `prom-client`; load tests with k6 (watch p99) |
| Images (later) | S3-compatible object storage + presigned uploads. See section 9 "Later". **Not now.** |

Decisions:
- Single domain: nginx serves the frontend on `/` and the API on `/api` (avoids cookie/CORS pain, including in Electron).
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

---

## 4. Repo layout (actual)

```
Mirai_Hub/
  apps/
    api/
      Dockerfile, Dockerfile.nginx, package.json, tsconfig.json, .env (git-ignored)
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
    web/                     React app (bare minimum, needs full rework)
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
| `POST /dev/login` | none | dev/test only, needs `ENABLE_DEV_LOGIN=true` |
| `POST /projects` | DEV | create |
| `GET /projects/mine`, `GET /projects/:slug`, `PATCH /projects/:slug` | auth / public / owner | `/mine` before `/:slug` |
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

Inside Docker, containers use service names: `postgres-db:5432`, `redis-cache:6379`.

**Before `npm run dev` or `npm test`, Postgres and Redis must be running** (a 500 on `/dev/login` with nothing obvious was this):

```powershell
cd C:\Users\PC_User\Desktop\Mirai_Hub
docker compose up -d postgres-db redis-cache
docker compose ps
```

**Daily development = 3 terminals:**
1. API: from `apps/api`, `npm run dev`
2. Worker: from `apps/api`, `npm run worker`
3. Tests / manual calls: PowerShell where `$s` (owner session) and `$c` (consumer session) live

**Automated tests:** from `apps/api`, `npm test` (API and worker don't need to be running). One-time setup of the test database:

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
- Test values live in `apps/api/tests/env.ts` (contains the local DB password, same as compose; read from the environment when secrets move out of compose).

**Docker-mode values** (set in compose for the API): `ORIGIN=http://localhost:8080`, `RP_ID=localhost`, `NODE_ENV=development`.

**Commands:**
- Prisma commands run from `packages/database` (or pass `--schema=packages/database/schema.prisma`).
- New migration (local only): `npx prisma migrate dev --name <name>`. Containers use `prisma migrate deploy`. After a migration restart the API and worker (new Prisma client).
- Run API: from `apps/api`, `npm run dev`. **Keep exactly one dev terminal for the API and one for the worker.** A duplicate gives `EADDRINUSE` and the old instance keeps serving old code. Find the culprit with `netstat -ano | findstr :5000`.
- Type-check: from `apps/api`, `npx tsc --noEmit` (not from the repo root). A clean run prints only the `npm notice` lines. `npm run dev` uses `--transpile-only`, so it never shows type errors. `tsc` only covers `src/`, not `tests/`.
- Validate compose: `docker compose config --quiet`.
- Prisma CLI prints `Assertion failed ... UV_HANDLE_CLOSING` on Node 24 at exit. Harmless; Node 22 LTS avoids it.
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- **Query the DB from PowerShell** (pipe through stdin, otherwise PowerShell strips the double quotes and Postgres looks for lowercase tables):
  `'select type, "userId", "dedupeKey", "readAt" from "Notification" order by "createdAt";' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`
  For a statement with quoted names plus a string use a double-quoted here-string with doubled quotes, e.g. `"delete from ""User"" where email = 'x@test.com';" | docker compose exec -T ...`
- Header check: `(Invoke-WebRequest $url -UseBasicParsing).Headers | Format-List` (without `-UseBasicParsing` PowerShell shows a security prompt).

---

## 5. Status

### Done and confirmed working
- [x] Docker Compose with nginx, api-server, queue-worker, redis, postgres (with healthcheck); Postgres/Redis published to localhost
- [x] Schema: User, DevicePasskey, Project, Post (with `updatedAt`), Feedback, Vote, Follow, Notification + enums (Role, PostType, FeedbackStatus, NotificationType), UUIDv7 with `@db.Uuid` everywhere. Migrations applied, including `add_notifications` and `add_post_updated_at`.
- [x] `lib/` shared clients and config (required env vars, no fallback secrets)
- [x] `app.ts`: helmet, CORS with credentials, `trust proxy`, rate limiters, 100kb body limit, cookie-parser, health route, single error handler (`AppError`, `ZodError`)
- [x] Auth backend: signup, passkey register/login (usernameless), `me`, `logout`; JWT cookie with `purpose`
- [x] Dev-only login shortcut `POST /api/dev/login` (needs `ENABLE_DEV_LOGIN=true`, never in production, never in compose)
- [x] `projects` routes + service: create (DEV only), `mine`, get by slug, update (owner only)
- [x] Follows, feedback, votes, owner-only status
- [x] Posts: create, list, **update, delete** (owner only)
- [x] Notifications end to end: queue (5 attempts, exponential backoff), fan-out, real worker, hooks in `setStatus`/`createPost`, read routes (list, unread count, mark read, read-all)
- [x] **Rate limiting** verified (10 feedback creations ok, 11th and 12th returned 429; headers present; other writes unaffected)
- [x] **Automated tests: 38 passing** (4 files): consumer can't create a project, only owner changes status / posts / edits / deletes, one vote per user, `hasVoted` per viewer, UUID validation (400), 401/403/404 cases, queue job requested exactly once and not for no-op status or edits, fan-out skips owner and non-followers and is idempotent, notifications scoped per user, post delete removes its notifications
- [x] `npx tsc --noEmit` clean
- [x] Old marketing code removed

### Test gaps (known, add when touching these areas)
- Follow/unfollow routes (tests create follows directly via Prisma), `GET /me/follows`
- `PATCH /projects/:slug` (owner-only update)
- Rate limiting (limiters are switched off under `NODE_ENV=test`)
- The BullMQ worker itself (the queue is mocked; fan-out logic is tested directly)
- Auth/passkey flow (only the dev login is used in tests)

### Written but NOT yet confirmed
- [ ] Passkey register/login flow itself: never tested in a real browser against `@simplewebauthn/server` v14 (field names like `credential.id` / `excludeCredentials`, and Redis `getdel`). First real test comes with the frontend login page.

### Not started
- [ ] Dockerfile / nginx / CI review; `docker compose up -d --build`
- [ ] Frontend rework, Electron checks
- [ ] Email verification, consumer login (email link / Google)
- [ ] Prometheus + Grafana, load tests (k6)
- [ ] Image uploads (deferred on purpose, see section 9 "Later")

### Housekeeping to do
- [ ] Commit everything (`git add -A; git commit -m "Post edit/delete, rate limiting, automated tests"`)
- [ ] `git ls-files | findstr .env` must print nothing
- [ ] Check the dev DB has no leftover test users from the failed early test runs: only `dev1@test.com` and `fan1@test.com` should exist; delete `owner@test.com`, `fan2@test.com`, `otherdev@test.com` if present
- [ ] Optional: `api.http` only if the REST Client gets working (PowerShell works, so skip)

---

## 6. How to test by hand (PowerShell, API + worker running)

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
- With the worker stopped, jobs just wait in Redis and are processed when it starts.
- **Vitest only loads `vitest.config.ts` from the project root (`apps/api`).** When it sat in `tests/`, vitest silently ignored it: no `env`, no `globalSetup`, no `setupFiles`, so tests ran against the DEV database (the wipe guard in `helpers.ts` blocked it and nothing was lost). If tests ever connect to `mirai_hub` again, check this first.
- Tests build their own Prisma client with the test URL (`vi.mock('../src/lib/prisma')` in `tests/setup.ts`), and `resetDb` checks `current_database()` before every TRUNCATE. Keep both guards.
- `ERESOLVE` when installing vitest: it needs `@types/node` ^22 or >=24; `apps/api` now uses `@types/node@^22`. Never use `--force` / `--legacy-peer-deps` for that.
- Vite prints a harmless warning about `configLoader: 'native'` (ESM syntax in a CommonJS package). Don't add `"type": "module"` to `apps/api/package.json` to silence it (would change how the API and worker load). `$env:VITE_CONFIG_NATIVE_IGNORE_WARNING = "true"` hides it for one terminal.
- The first request in each test file takes ~2 s (cold DB connection); a full run takes ~40 s.
- Rate-limit counters are in memory: a restart resets them.

---

## 8. Known problems / tech debt

**Reliability:**
- If the API saves a status change/post and Redis is down at that moment, the notification is lost (`enqueueNotification` logs and swallows the error). Later fix: an **outbox table** written in the same DB transaction, drained by the worker.
- If a post is deleted before the worker handles its `NEW_POST` job, notifications pointing at a deleted post can still be created (shown with `title: null`, harmless). Fix: existence check in `fanOut`, together with the outbox work.
- A no-op status change (same status again) still writes to the DB and bumps `updatedAt`; harmless, optional early return in `setStatus`.
- Rate-limit counters live in the API process's memory: they reset on restart and aren't shared across multiple API containers. Fix for production: `rate-limit-redis` with the existing Redis. Limits are per IP (people behind one office/school network share an allowance); per-user limits are a later refinement.

**Security (before any public deploy):**
- Email is **not verified** at signup (anyone can sign up as any email).
- Signup returns 409 for existing emails (reveals which emails have accounts).
- Orphan users: signup without registering a passkey leaves an unusable row (add cleanup job).
- DB password hardcoded in `docker-compose.yml` (and mirrored in `tests/env.ts`); move to `.env` with `${VAR}` before sharing the repo.
- `/api/dev/login` must be deleted (or stay disabled) before launch.
- Keep Postgres/Redis bound to `127.0.0.1`.
- User-generated text (post/feedback bodies) is stored raw; the frontend must render it escaped (React does by default) and never with `dangerouslySetInnerHTML`. If markdown is added later, sanitize.

**Infra (next to review):**
- nginx must proxy `/api` to `api-server:5000`, pass `X-Forwarded-Proto` **and `X-Forwarded-For`** (the rate limiter needs the real client IP; `trust proxy` is 1), serve the built frontend on `/`, and the API port must never be exposed publicly. **Not reviewed yet.**
- Dockerfile must: install `prisma` (now a dependency), run `prisma generate`, copy `packages/database` incl. `migrations/`, build TypeScript. **Not reviewed yet.**
- `queue-worker` container must run the compiled worker (`node dist/run-worker.js`) with the same env (`REDIS_URL`, `DATABASE_URL`, `JWT_SECRET`, `RP_ID`, `ORIGIN`, since `config.ts` requires them). **Not reviewed yet.** Leave the container stopped until the review.
- CI workflow **not reviewed yet**. It should: install, `prisma generate`, `tsc --noEmit`, create `mirai_hub_test`, run `npm test`, with Postgres and Redis service containers (set `TEST_DATABASE_URL` and adjust `REDIS_URL` in `tests/env.ts` via env if ports differ from local).
- Docker images are **stale** (built before the rewrite); `docker compose up -d --build` after the infra review.
- `ORIGIN` must exactly match what the browser shows; `RP_ID` is the bare domain. Production needs HTTPS and `NODE_ENV=production`.
- `docker compose down -v` wipes the DB volume (then rerun `prisma migrate deploy`, recreate the `mirai_hub_test` database, and recreate `dev1`, `fan1`, and the `my-game` project).

**Electron:** WebAuthn (Touch ID / Windows Hello) in Electron is historically flaky. Test early; fallback is opening the system browser for login. `expectedOrigin` can be an array. Test cookie auth inside Electron too.

**Frontend:** bare minimum; rework starts after the infra review.

---

## 9. Roadmap (in order; don't skip ahead)

**Next session starts here:**
1. Commit everything; `git ls-files | findstr .env` prints nothing; clean leftover test users from the dev DB (section 5 housekeeping).
2. **Phase 0.5: Verify infra.** Review Dockerfile, nginx config (incl. `X-Forwarded-For`), compose (worker container command), and the CI workflow (runs `tsc` + `npm test` with Postgres and Redis services). Then `docker compose up -d --build` and hit `http://localhost:8080/api/health`; start the `queue-worker` container for real and repeat the notification check through nginx.
3. Optional small test additions from the "Test gaps" list (follow routes, project update).

**Phase 3: Frontend (web-first)**
1. Login/signup + passkey registration page (this is the first real test of the passkey flow)
2. Project page (vision, posts, feedback list, vote, submit feedback), **text only**
3. Dev dashboard (manage statuses, post/edit/delete updates)
4. Notification bell (unread count + list + mark read); then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, secrets out of compose, HTTPS + production nginx, remove dev login, outbox for notifications, Redis-backed rate limits, CI running typecheck + tests.

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

**Rough time estimate (hobby pace):** ~10 hrs/week means ~4-5 months total, MVP in a browser at ~2-3 months from the start; frontend is the biggest chunk and biggest unknown. Backend MVP loop, rate limiting and tests finished in session 2, ahead of plan.

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