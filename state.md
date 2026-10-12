# Mirai Hub: Project State

> Last updated: 2026-10-12 (end of session 2).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~50%** (backend MVP loop complete and manually tested end to end; automated tests, rate limiting, infra review, frontend, hardening, observability not started).

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

Everything else waits until this loop works end to end. **Backend: done and manually verified (session 2). Frontend: not started.**

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
| Infra | Docker Compose, nginx reverse proxy, GitHub Actions CI |
| IDs | UUIDv7 (`@default(uuid(7)) @db.Uuid`) on every id and every foreign key |
| Observability (later) | Prometheus + Grafana, `prom-client`; load tests with k6 (watch p99) |
| Images (later) | S3-compatible object storage + presigned uploads. See section 9 "Later" for the design. **Not now.** |

Decisions:
- Single domain: nginx serves the frontend on `/` and the API on `/api` (avoids cookie/CORS pain, including in Electron).
- Logic goes in `services/` (plain functions, **no Express inside**); routes parse input with zod, call a service, return JSON. Services throw `AppError(status, msg)`; the single error handler in `server.ts` maps errors to status codes.
- Consumers should get low-friction login later (email link or Google); passkeys stay for devs and optional for consumers.
- Lists (feedback, posts, notifications) are capped at 50 for now (cursor pagination later).
- **Notifications:** one `Notification` row per follower per event. The project owner is never notified of their own actions. `@@unique([userId, dedupeKey])` + `createMany({ skipDuplicates: true })` makes the worker idempotent, so BullMQ retries never double-notify.
- **Dedupe keys** contain only `-` (BullMQ job ids can't contain `:`): `status-{feedbackId}-{status}-{updatedAtMs}` (timestamp so PLANNED -> IN_PROGRESS -> PLANNED stays three distinct events) and `post-{postId}`.
- Status notifications are only queued when the status actually changed.
- `enqueueNotification` never throws: the user's action already succeeded, a queue hiccup must not become a 500.
- BullMQ needs its own Redis connection with `maxRetriesPerRequest: null` (`createQueueConnection()` in `lib/queue.ts`). `lib/redis.ts` stays as is for normal use (passkey challenges etc.).
- Fan-out reads followers in batches of 500 (keyset on `userId`), so a project with many followers never loads them all at once.
- Notification list resolves titles via two batched queries (feedback ids, post ids). If the referenced item was deleted, `title` is `null`.

---

## 4. Repo layout (actual)

```
Mirai_Hub/
  apps/
    api/
      Dockerfile, Dockerfile.nginx, package.json, .env (git-ignored)
      src/
        server.ts            Express app (order matters, see section 7)
        run-worker.ts        REAL BullMQ worker (concurrency 5, graceful shutdown)
        lib/                 config.ts, prisma.ts, redis.ts, queue.ts, errors.ts, http.ts
        middleware/auth.ts   signToken, requireAuth, requireEnrollOrAuth, requireRole, optionalAuth
        controllers/auth_controller.ts
        routes/              auth.ts, projects.ts, dev.ts, feedback.ts (follows + feedback + votes + status), posts.ts, notifications.ts
        services/            projects.ts, follows.ts, feedback.ts, posts.ts, notifications.ts
    web/                     React app (bare minimum, needs full rework)
    desktop/                 Electron: src/main.ts, src/preload.ts
  packages/
    database/                schema.prisma, migrations/, .env (DATABASE_URL, git-ignored)
  docker-compose.yml
  .env                       root: JWT_SECRET for compose (git-ignored)
  state.md
```

Root `package.json` should have `"workspaces": ["apps/*", "packages/*"]` (verify).

`apps/api/package.json` scripts: `dev` (ts-node-dev API), `worker` (ts-node-dev worker), `build` (tsc), `start`.

### API endpoint reference (all under `/api`)

| Method + path | Auth | Notes |
|---|---|---|
| `POST /auth/signup`, passkey register/login, `GET /auth/me`, `POST /auth/logout` | mixed | JWT cookie, `purpose` session vs enroll |
| `POST /dev/login` | none | dev only, needs `ENABLE_DEV_LOGIN=true` |
| `POST /projects` | DEV | create |
| `GET /projects/mine`, `GET /projects/:slug`, `PATCH /projects/:slug` | auth / public / owner | `/mine` before `/:slug` |
| `PUT/DELETE /projects/:slug/follow`, `GET /me/follows` | auth | idempotent |
| `POST /projects/:slug/feedback` | auth | 201 |
| `GET /projects/:slug/feedback?status=&sort=votes\|new` | optional | `voteCount`, `hasVoted` |
| `PUT/DELETE /feedback/:id/vote` | auth | idempotent, returns `{ voteCount }` |
| `PATCH /feedback/:id/status` | owner | enqueues notification if changed |
| `POST /projects/:slug/posts` | owner | types VISION / ANNOUNCEMENT / CHANGELOG; enqueues notification |
| `GET /projects/:slug/posts?type=` | public | newest first, max 50 |
| `GET /me/notifications?unread=true`, `GET /me/notifications/unread-count` | auth | |
| `PATCH /notifications/:id/read`, `POST /me/notifications/read-all` | auth | scoped to own rows (404 otherwise) |

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

**Before `npm run dev`, Postgres and Redis must be running** (a 500 on `/dev/login` with nothing obvious was this):

```powershell
cd C:\Users\PC_User\Desktop\Mirai_Hub
docker compose up -d postgres-db redis-cache
docker compose ps
```

**Daily development = 3 terminals:**
1. API: from `apps/api`, `npm run dev`
2. Worker: from `apps/api`, `npm run worker`
3. Tests: PowerShell where `$s` (owner session) and `$c` (consumer session) live

**Env files (all git-ignored, never commit or paste secrets):**
- `/.env`: `JWT_SECRET=...` (compose refuses to start without it)
- `/apps/api/.env`: `PORT=5000`, `JWT_SECRET`, `REDIS_URL=redis://localhost:6380`, `RP_ID=localhost`, `ORIGIN=http://localhost:5173`, `ENABLE_DEV_LOGIN=true`, and `DATABASE_URL=postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public` (no quotes; the API reads this at runtime)
- `/packages/database/.env`: `DATABASE_URL="postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public"`
- `.env` files take only `#` comments on their own line; save as UTF-8 without BOM (if a variable "isn't found", rewrite with `Set-Content -Encoding ascii`).
- `.env` is read **only at startup**: after editing, stop `npm run dev` (Ctrl+C) and start it again. The worker reads `REDIS_URL` from the same `apps/api/.env`.
- A `$env:DATABASE_URL=...` set in PowerShell overrides the `.env`; clear with `Remove-Item Env:DATABASE_URL`.

**Docker-mode values** (set in compose for the API): `ORIGIN=http://localhost:8080`, `RP_ID=localhost`, `NODE_ENV=development`.

**Commands:**
- Prisma commands run from `packages/database` (or pass `--schema=packages/database/schema.prisma`).
- New migration (local only): `npx prisma migrate dev --name <name>`. Containers use `prisma migrate deploy`.
- Run API: from `apps/api`, `npm run dev`. **Keep exactly one dev terminal for the API and one for the worker.** A duplicate gives `EADDRINUSE` and the old instance keeps serving old code. Find the culprit with `netstat -ano | findstr :5000`.
- Type-check: from `apps/api`, `npx tsc --noEmit` (not from the repo root, where it just prints help). A clean run prints only the `npm notice` lines. `npm run dev` uses `--transpile-only`, so it never shows type errors.
- Validate compose: `docker compose config --quiet`.
- Prisma CLI prints `Assertion failed ... UV_HANDLE_CLOSING` on Node 24 at exit. Harmless; Node 22 LTS avoids it.
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- **Query the DB from PowerShell** (pipe through stdin, otherwise PowerShell strips the double quotes and Postgres looks for lowercase tables):
  `'select type, "userId", "dedupeKey", "readAt" from "Notification" order by "createdAt";' | docker compose exec -T postgres-db psql -U mirai_admin -d mirai_hub`

---

## 5. Status

### Done and confirmed working (manually tested in PowerShell)
- [x] Docker Compose with nginx, api-server, queue-worker, redis, postgres (with healthcheck); Postgres/Redis published to localhost
- [x] Schema: User, DevicePasskey, Project, Post, Feedback, Vote, Follow, **Notification** + enums (Role, PostType, FeedbackStatus, NotificationType), UUIDv7 with `@db.Uuid` everywhere. Migrations applied, including `add_notifications`.
- [x] `lib/` shared clients and config (required env vars, no fallback secrets)
- [x] `server.ts`: helmet, CORS with credentials, `trust proxy`, 100kb body limit, cookie-parser, health route, single error handler (`AppError`, `ZodError`)
- [x] Auth backend: signup, passkey register/login (usernameless), `me`, `logout`; JWT cookie with `purpose` (`session` vs short-lived `enroll`)
- [x] Signup tested (200, then 409 on duplicate)
- [x] Dev-only login shortcut `POST /api/dev/login` (needs `ENABLE_DEV_LOGIN=true`, never in production, never in compose)
- [x] `projects` routes + service: create (DEV only), `mine`, get by slug, update (owner only)
- [x] **Follows, feedback, votes, owner-only status**: all verified (second vote keeps count at 1; consumer status change gets 403, owner 200; bad UUID 400; `hasVoted` true for the voter and false for anonymous)
- [x] **Posts**: create (owner only: 403 for consumer, 401 anonymous, 400 bad type, 404 unknown project), public list with `?type=` filter. Newest-first ordering with 2+ posts: confirm once.
- [x] **Notifications end to end**: `lib/queue.ts` (queue, 5 attempts, exponential backoff, `removeOnComplete` 1000 / `removeOnFail` 5000), `services/notifications.ts` (fan-out + read side), real `run-worker.ts`, hooks in `setStatus` and `createPost`. Verified with DB rows: exactly one `FEEDBACK_STATUS` and one `NEW_POST` for the follower, none for the owner, repeated same status queues nothing.
- [x] Notification read routes: list (`?unread=true`), unread count, mark one read, read-all; other users get 404, anonymous 401, bad id 400
- [x] `npx tsc --noEmit` clean (session 2)
- [x] Old marketing code removed

### Written but NOT yet confirmed
- [ ] Passkey register/login flow itself: never tested in a real browser against `@simplewebauthn/server` v14 (field names like `credential.id` / `excludeCredentials`, and Redis `getdel`). First real test comes with the frontend login page.

### Not started
- [ ] Post update/delete by owner (decided: yes, add; see section 9)
- [ ] Rate limiting, email verification, consumer login (email link / Google)
- [ ] Automated tests (vitest + supertest)
- [ ] Frontend rework, Electron checks
- [ ] Dockerfile / nginx / CI review; `docker compose up -d --build`
- [ ] Prometheus + Grafana, load tests (k6)
- [ ] Image uploads (deferred on purpose, see section 9 "Later")

### Housekeeping to do
- [ ] Commit this updated `state.md` (`git add -A; git commit -m "Update state.md"`)
- [ ] Confirm `.env` files are not tracked: `git ls-files | findstr .env` must print nothing
- [ ] Add `api.http` tests only if the REST Client gets working (in VS Code it didn't send requests; PowerShell works, so this is optional)

---

## 6. How to test by hand (PowerShell, API + worker running)

Cookies are kept with `-SessionVariable` / `-WebSession`. The dev login only works for users that exist (sign them up first). `dev1@test.com` (DEV) owns the project `my-game`; `fan1@test.com` is a CONSUMER who follows it.

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

# List: consumer hasVoted=True, anonymous False
Invoke-RestMethod "$base/projects/my-game/feedback?sort=votes" -WebSession $c
Invoke-RestMethod "$base/projects/my-game/feedback"

# Consumer changing status -> 403; owner -> 200; bad id -> 400
try { Invoke-RestMethod "$base/feedback/$($fb.id)/status" -Method Patch -ContentType $json -WebSession $c -Body '{"status":"PLANNED"}' } catch { $_.ErrorDetails.Message }
Invoke-RestMethod "$base/feedback/$($fb.id)/status" -Method Patch -ContentType $json -WebSession $s -Body '{"status":"PLANNED"}'
try { Invoke-RestMethod "$base/feedback/not-a-uuid/vote" -Method Put -WebSession $c } catch { $_.ErrorDetails.Message }

# Posts: owner 201, consumer 403, anonymous 401, bad type 400, unknown project 404
Invoke-RestMethod "$base/projects/my-game/posts" -Method Post -ContentType $json -WebSession $s -Body '{"type":"ANNOUNCEMENT","title":"Hello world","body":"First update."}'
try { Invoke-RestMethod "$base/projects/my-game/posts" -Method Post -ContentType $json -WebSession $c -Body '{"type":"ANNOUNCEMENT","title":"Nope","body":"x"}' } catch { $_.ErrorDetails.Message }
Invoke-RestMethod "$base/projects/my-game/posts" | Select-Object title, createdAt

# Notifications (worker must be running): consumer count goes up, owner stays 0
Invoke-RestMethod "$base/me/notifications/unread-count" -WebSession $c
$n = Invoke-RestMethod "$base/me/notifications" -WebSession $c
$n | Format-Table type, title, status, read
Invoke-RestMethod "$base/notifications/$($n[0].id)/read" -Method Patch -WebSession $c
try { Invoke-RestMethod "$base/notifications/$($n[0].id)/read" -Method Patch -WebSession $s } catch { $_.ErrorDetails.Message }   # 404
Invoke-RestMethod "$base/me/notifications/read-all" -Method Post -WebSession $c
```

Pick a different status than the feedback currently has when testing notifications; an unchanged status queues nothing (by design).

Also: `GET $base/me/follows` (consumer) lists followed projects; `POST /projects` as a CONSUMER returns 403; duplicate slug returns 409; bad slug returns 400. The 403/400 tests print only the error body; add `$_.Exception.Response.StatusCode.value__` in the `catch` to see codes.

---

## 7. Gotchas learned (save yourself the time)

- **`server.ts` order matters:** middleware, then routes (`/api/auth`, `/api/projects`, feedback, posts, notifications, dev routes), then **one** error handler, then `app.listen`. Routes mounted after the error handler never run; two error handlers means the first swallows everything.
- Express 4 doesn't catch rejected promises: always wrap async handlers with `wrap()` from `lib/http.ts`.
- Route order inside a router: `/mine` must come before `/:slug`.
- "Cannot POST /x" is Express's 404: the route isn't mounted (wrong file, missing flag, stale process), not a logic bug.
- A **500 with no details** means look at the dev terminal for the stack trace. Usual causes: Postgres not running, wrong/missing `DATABASE_URL`, stale Prisma client (`npx prisma generate --schema=../../packages/database/schema.prisma`).
- `$env:...` overrides in PowerShell outlast `.env` edits; old terminals can keep stale servers alive.
- Windows reserves some ports (5432 failed with "access permissions"); use alternate host ports as above.
- Every foreign key must carry `@db.Uuid` or the migration fails with "incompatible types: text and uuid" (`prisma validate` doesn't catch it).
- Compose `${JWT_SECRET:?...}` fails the whole file if the root `.env` is missing.
- Never `cd` into a file; create files from PowerShell with `Set-Content -Encoding ascii` or in the VS Code sidebar.
- Check which folder you're in before using relative paths (`apps\api\package.json` from inside `apps\api` doubles the path).
- BullMQ job ids can't contain `:`; use `-` in dedupe keys.
- PowerShell strips double quotes when passing SQL to `docker compose exec`; pipe the query via stdin (section 4b).
- Without a `Notification` consumer or with the worker stopped, jobs just wait in Redis and are processed when the worker starts.

---

## 8. Known problems / tech debt

**Reliability:**
- If the API saves a status change/post and Redis is down at that moment, the notification is lost (`enqueueNotification` logs and swallows the error). Later fix: an **outbox table** written in the same DB transaction, drained by the worker.
- A no-op status change (same status again) still writes to the DB and bumps `updatedAt`; harmless, optional early return in `setStatus`.
- `ioredis ^6` + `bullmq ^6` typed cleanly so far; if a type mismatch on `connection` ever appears, it's two copies of `ioredis`.

**Security (before any public deploy):**
- Email is **not verified** at signup (anyone can sign up as any email).
- Signup returns 409 for existing emails (reveals which emails have accounts).
- **No rate limiting** (signup, login, feedback, votes, posts). Add `express-rate-limit`. **Next up.**
- Orphan users: signup without registering a passkey leaves an unusable row (add cleanup job).
- DB password hardcoded in `docker-compose.yml`; move to `.env` with `${VAR}` before sharing the repo.
- `/api/dev/login` must be deleted (or stay disabled) before launch.
- Keep Postgres/Redis bound to `127.0.0.1`.
- User-generated text (post/feedback bodies) is stored raw; the frontend must render it escaped (React does by default) and never with `dangerouslySetInnerHTML`. If markdown is added later, sanitize.

**Infra:**
- Dockerfile must: install `prisma` (now a dependency), run `prisma generate`, copy `packages/database` incl. `migrations/`, build TypeScript. **Not reviewed yet.**
- `queue-worker` container must run the compiled worker (`node dist/run-worker.js`) with the same env (`REDIS_URL`, `DATABASE_URL`, `JWT_SECRET` since `config.ts` requires it). **Not reviewed yet.** Leave the container stopped until the infra review.
- nginx must proxy `/api` to `api-server:5000`, pass `X-Forwarded-Proto`, serve the built frontend on `/`. **Not reviewed yet.**
- CI workflow **not reviewed yet** (needs `prisma generate`, typecheck, tests, dummy `JWT_SECRET`/`REDIS_URL`/`RP_ID`/`ORIGIN`).
- Docker images are **stale** (built before the rewrite); `docker compose up -d --build` after the infra review.
- `ORIGIN` must exactly match what the browser shows; `RP_ID` is the bare domain. Production needs HTTPS and `NODE_ENV=production`.
- `docker compose down -v` wipes the DB volume (then rerun `prisma migrate deploy`, and recreate `dev1`, `fan1`, and the `my-game` project).

**Electron:** WebAuthn (Touch ID / Windows Hello) in Electron is historically flaky. Test early; fallback is opening the system browser for login. `expectedOrigin` can be an array. Test cookie auth inside Electron too.

**Frontend:** bare minimum; rework starts now that the backend loop works (after the small backend items below).

---

## 9. Roadmap (in order; don't skip ahead)

**Next session starts here:**
1. Commit the updated `state.md` and everything pending; `git ls-files | findstr .env` prints nothing.
2. **Post update/delete (owner only)**, small and needed by the dev dashboard:
   - Schema: add `updatedAt DateTime @default(now()) @updatedAt` to `Post` (the `@default(now())` is required so existing rows migrate). Migration: `add_post_updated_at`.
   - `PATCH /projects/:slug/posts/:id` (or `/posts/:id`): owner only, partial update of `title`/`body` (type optional). **Editing does not re-notify.**
   - `DELETE /posts/:id`: owner only. Also delete that post's `NEW_POST` notifications (`refId = postId`) so followers don't see dead entries; the list already tolerates `title: null` as a fallback.
   - Owner check goes through `post.project.ownerId` (same pattern as `setStatus`). Reuse zod UUID param validation.
3. **Rate limiting** (`express-rate-limit`) on signup, login, feedback, vote, post endpoints. Needs `server.ts` and `routes/auth.ts`.
4. **Automated tests:** `vitest` + `supertest` for the rules that matter (CONSUMER can't create project, only owner changes status/posts/edits/deletes, one vote per user, UUID validation, notification only on real status change, owner never notified, notifications scoped to their user).

**Phase 0.5: Verify infra**
- Review Dockerfile, nginx config, CI; rebuild containers; start the `queue-worker` container for real; hit the API through `http://localhost:8080/api/health`.

**Phase 3: Frontend (web-first)**
1. Login/signup + passkey registration page (this is the first real test of the passkey flow)
2. Project page (vision, posts, feedback list, vote, submit feedback), **text only**
3. Dev dashboard (manage statuses, post/edit/delete updates)
4. Notification bell (unread count + list + mark read); then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, secrets out of compose, HTTPS + production nginx, remove dev login, outbox for notifications, CI running typecheck + tests.

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

**Rough time estimate (hobby pace):** ~10 hrs/week means ~4-5 months total, MVP in a browser at ~2-3 months from the start; frontend is the biggest chunk and biggest unknown. Backend MVP loop finished in session 2, ahead of plan.

---

## 10. Rules for working with AI on this repo

1. Re-read sections 1 and 2 before suggesting features; if a request doesn't serve the core loop, flag it.
2. One small piece at a time, and state which files may change.
3. New logic goes in `services/` (no Express inside); routes only parse input (zod), call a service, return output.
4. Never use `companyId` or `tenant`; those belonged to the dropped design. Use `userId` and `req.user`.
5. No fallback secrets (`|| 'something'`). Required env vars go through `lib/config.ts`.
6. Never trust an id from the request body for identity; identity comes from the signed cookie.
7. Schema changes: every id and foreign key keeps `@db.Uuid`; use migrations, never `db push` in containers.
8. Commit after every working piece; use branches.
9. Don't paste `.env` contents or secrets into chats.
10. Give complete files to paste (not diffs) and say exactly where each file goes; the user is on Windows/PowerShell. Say which folder each command runs from.

## 11. Resume prompt (paste into a new chat with this file)

> I'm building Mirai Hub (two-sided feedback/vision platform, see the attached state.md). I'm on Windows/PowerShell. Read state.md fully, then start at "Next session starts here" in section 9. Keep to the rules in section 10. Ask me for specific files only when you need them, and tell me where each file goes.