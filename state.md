# Mirai Hub: Project State

> Last updated: 2026-10-05 (end of session 1, evening).
> Purpose: lets a new chat (or AI session) continue immediately without re-reading history.
> Rule: update this file at the end of every work session.
> Overall progress: **~28%** (backend core mostly written; frontend, notifications, hardening, observability not started).

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

Everything else waits until this loop works end to end.

---

## 3. Stack and decisions made

| Area | Choice |
|---|---|
| Frontend | React + TypeScript + Tailwind (Vite), **web-first** |
| Desktop | Electron as a **thin shell** around the web app (optional for devs). No Electron APIs inside React except behind `window.electronAPI` checks via `preload` + `contextBridge`. Keep `contextIsolation: true`, `nodeIntegration: false` |
| API | Node + Express 4 + TypeScript |
| DB | PostgreSQL 16 via Prisma 5.22 |
| Cache / queue | Redis (`ioredis`) + **BullMQ**. RabbitMQ was considered and rejected (overkill; BullMQ covers notifications, retries, delayed jobs). Don't suggest it again unless scale demands it |
| Auth | WebAuthn passkeys (`@simplewebauthn/server` v14) + JWT in HttpOnly cookie |
| Validation | zod (every route input, including `:id` params as UUID) |
| Infra | Docker Compose, nginx reverse proxy, GitHub Actions CI |
| IDs | UUIDv7 (`@default(uuid(7)) @db.Uuid`) on every id and every foreign key |
| Observability (later) | Prometheus + Grafana, `prom-client`; load tests with k6 (watch p99) |

Decisions:
- Single domain: nginx serves the frontend on `/` and the API on `/api` (avoids cookie/CORS pain, including in Electron).
- Logic goes in `services/` (plain functions, **no Express inside**); routes parse input with zod, call a service, return JSON. Services throw `AppError(status, msg)`; the single error handler in `server.ts` maps errors to status codes.
- Consumers should get low-friction login later (email link or Google); passkeys stay for devs and optional for consumers.
- Feedback lists are capped at 50 for now (cursor pagination later).

---

## 4. Repo layout (actual)

```
Mirai_Hub/
  apps/
    api/
      Dockerfile, Dockerfile.nginx, package.json, .env (git-ignored)
      src/
        server.ts            Express app (order matters, see section 7)
        run-worker.ts        STUB (prints "not implemented"); real BullMQ worker is Phase 2
        lib/                 config.ts, prisma.ts, redis.ts, errors.ts, http.ts
        middleware/auth.ts   signToken, requireAuth, requireEnrollOrAuth, requireRole, (optionalAuth: add if missing)
        controllers/auth_controller.ts
        routes/              auth.ts, projects.ts, dev.ts, (feedback.ts: see section 5)
        services/            projects.ts, (follows.ts, feedback.ts: see section 5)
    web/                     React app (bare minimum, needs full rework)
    desktop/                 Electron: src/main.ts, src/preload.ts
  packages/
    database/                schema.prisma, migrations/, .env (DATABASE_URL, git-ignored)
  docker-compose.yml
  .env                       root: JWT_SECRET for compose (git-ignored)
  state.md
```

Root `package.json` should have `"workspaces": ["apps/*", "packages/*"]` (verify).

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

**Env files (all git-ignored, never commit or paste secrets):**
- `/.env`: `JWT_SECRET=...` (compose refuses to start without it)
- `/apps/api/.env`: `PORT=5000`, `JWT_SECRET`, `REDIS_URL=redis://localhost:6380`, `RP_ID=localhost`, `ORIGIN=http://localhost:5173`, `ENABLE_DEV_LOGIN=true`. (Add `DATABASE_URL=...localhost:5433...` if the API ever says it can't reach the database.)
- `/packages/database/.env`: `DATABASE_URL="postgresql://mirai_admin:secure_postgres_pass@localhost:5433/mirai_hub?schema=public"`
- `.env` files take only `#` comments on their own line; save as UTF-8 without BOM (if a variable "isn't found", rewrite with `Set-Content -Encoding ascii`).
- `.env` is read **only at startup**: after editing, stop `npm run dev` (Ctrl+C) and start it again.
- A `$env:DATABASE_URL=...` set in PowerShell overrides the `.env`; clear with `Remove-Item Env:DATABASE_URL`.

**Docker-mode values** (set in compose for the API): `ORIGIN=http://localhost:8080`, `RP_ID=localhost`, `NODE_ENV=development`.

**Commands:**
- Prisma commands run from `packages/database` (or pass `--schema=packages/database/schema.prisma`).
- New migration (local only): `npx prisma migrate dev --name <name>`. Containers use `prisma migrate deploy`.
- Run API: from `apps/api`, `npm run dev`. **Keep exactly one dev terminal.** A duplicate gives `EADDRINUSE` and the old instance keeps serving old code. Find the culprit with `netstat -ano | findstr :5000`.
- Type-check: from `apps/api`, `npx tsc --noEmit` (not from the repo root, where it just prints help). `npm run dev` uses `--transpile-only`, so it never shows type errors.
- Validate compose: `docker compose config --quiet`.
- Prisma CLI prints `Assertion failed ... UV_HANDLE_CLOSING` on Node 24 at exit. Harmless; Node 22 LTS avoids it.
- Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

---

## 5. Status

### Done and confirmed working
- [x] Docker Compose with nginx, api-server, queue-worker, redis, postgres (with healthcheck); Postgres/Redis published to localhost
- [x] **New schema applied** (User, DevicePasskey, Project, Post, Feedback, Vote, Follow + enums), UUIDv7 with `@db.Uuid` everywhere. (Signup writing to the DB confirms tables exist.)
- [x] `lib/` shared clients and config (required env vars, no fallback secrets)
- [x] `server.ts`: helmet, CORS with credentials, `trust proxy`, 100kb body limit, cookie-parser, health route, single error handler (`AppError`, `ZodError`)
- [x] Auth backend: signup, passkey register/login (usernameless), `me`, `logout`; JWT cookie with `purpose` (`session` vs short-lived `enroll`)
- [x] Signup tested (200, then 409 on duplicate)
- [x] Dev-only login shortcut `POST /api/dev/login` (needs `ENABLE_DEV_LOGIN=true`, never in production, never in compose)
- [x] `projects` routes + service: create (DEV only), `mine`, get by slug, update (owner only). Tested via PowerShell
- [x] Old marketing code removed (`customers`, `campaign` routes, queue, worker); `tsc --noEmit` should be clean after removing `routes/campaign.ts` and stubbing `run-worker.ts` (re-run to confirm)

### Written but NOT yet confirmed working
- [ ] **`follows`, `feedback`, `votes`, owner-only `status`**: code was provided (`services/follows.ts`, `services/feedback.ts`, `routes/feedback.ts`, `optionalAuth` in `middleware/auth.ts`, `projectIdFromSlug` in `services/projects.ts`, and `app.use('/api', feedbackRoutes)` in `server.ts`). Run the PowerShell test script (section 6) and tick this when it passes. Confirm all those files actually exist.
- [ ] Passkey register/login flow itself: never tested in a real browser against `@simplewebauthn/server` v14 (field names like `credential.id` / `excludeCredentials`, and Redis `getdel`)

### Not started
- [✓] `posts` routes (VISION / ANNOUNCEMENT / CHANGELOG)
- [ ] BullMQ notification worker + `Notification` model + fan-out on status change/post
- [ ] Automated tests (vitest + supertest)
- [ ] Rate limiting, email verification, consumer login (email link / Google)
- [ ] Frontend rework, Electron checks
- [ ] Dockerfile / nginx / CI review; `docker compose up -d --build`
- [ ] Prometheus + Grafana, load tests (k6)

### Housekeeping to do
- [ ] Commit `packages/database/migrations/` and everything else (`git add -A && git commit`)
- [ ] Confirm `.env` files are in `.gitignore` and `.dockerignore`: `git ls-files | findstr .env` must show nothing
- [ ] Add `api.http` tests only if the REST Client gets working (in VS Code it didn't send requests; PowerShell worked fine, so this is optional)

---

## 6. How to test by hand (PowerShell, API running)

Cookies are kept with `-SessionVariable` / `-WebSession`. The dev login only works for users that exist (sign them up first).

```powershell
$base = "http://localhost:5000/api"; $json = 'application/json'

# Owner session
Invoke-RestMethod "$base/dev/login" -Method Post -ContentType $json -Body '{"email":"dev1@test.com"}' -SessionVariable s

# Consumer
Invoke-RestMethod "$base/auth/signup" -Method Post -ContentType $json -Body '{"email":"fan1@test.com","name":"Fan One","role":"CONSUMER"}'
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
```

Also: `GET $base/me/follows` (consumer) lists followed projects; `POST /projects` as a CONSUMER returns 403; duplicate slug returns 409; bad slug returns 400.

---

## 7. Gotchas learned (save yourself the time)

- **`server.ts` order matters:** middleware, then routes (`/api/auth`, `/api/projects`, `/api`feedback, dev routes), then **one** error handler, then `app.listen`. Routes mounted after the error handler never run; two error handlers means the first swallows everything.
- Express 4 doesn't catch rejected promises: always wrap async handlers with `wrap()` from `lib/http.ts`.
- Route order inside a router: `/mine` must come before `/:slug`.
- "Cannot POST /x" is Express's 404: the route isn't mounted (wrong file, missing flag, stale process), not a logic bug.
- `$env:...` overrides in PowerShell outlast `.env` edits; old terminals can keep stale servers alive.
- Windows reserves some ports (5432 failed with "access permissions"); use alternate host ports as above.
- Every foreign key must carry `@db.Uuid` or the migration fails with "incompatible types: text and uuid" (`prisma validate` doesn't catch it).
- Compose `${JWT_SECRET:?...}` fails the whole file if the root `.env` is missing.
- Never `cd` into a file; create files from PowerShell with `Set-Content -Encoding ascii` or in the VS Code sidebar.

---

## 8. Known problems / tech debt

**Security (before any public deploy):**
- Email is **not verified** at signup (anyone can sign up as any email).
- Signup returns 409 for existing emails (reveals which emails have accounts).
- **No rate limiting** (signup, login, feedback, votes). Add `express-rate-limit`.
- Orphan users: signup without registering a passkey leaves an unusable row (add cleanup job).
- DB password hardcoded in `docker-compose.yml`; move to `.env` with `${VAR}` before sharing the repo.
- `/api/dev/login` must be deleted (or stay disabled) before launch.
- Keep Postgres/Redis bound to `127.0.0.1`.

**Infra:**
- Dockerfile must: install `prisma` (now a dependency), run `prisma generate`, copy `packages/database` incl. `migrations/`, build TypeScript. **Not reviewed yet.**
- nginx must proxy `/api` to `api-server:5000`, pass `X-Forwarded-Proto`, serve the built frontend on `/`. **Not reviewed yet.**
- CI workflow **not reviewed yet** (needs `prisma generate`, typecheck, tests, dummy `JWT_SECRET`).
- Docker images are **stale** (built before the rewrite); `docker compose up -d --build` after Phase 0 review.
- `queue-worker` container just exits until the real worker exists; leave it stopped.
- `ORIGIN` must exactly match what the browser shows; `RP_ID` is the bare domain. Production needs HTTPS and `NODE_ENV=production`.
- `docker compose down -v` wipes the DB volume.

**Electron:** WebAuthn (Touch ID / Windows Hello) in Electron is historically flaky. Test early; fallback is opening the system browser for login. `expectedOrigin` can be an array. Test cookie auth inside Electron too.

**Frontend:** bare minimum; do the rework only after the backend loop and notifications work.

---

## 9. Roadmap (in order; don't skip ahead)

**Next session starts here:**
1. `npx tsc --noEmit` from `apps/api` (must be clean). Commit.
2. Run the section 6 script; fix anything that fails in follows/feedback/votes/status. Tick section 5.
3. Add `posts`: `services/posts.ts` + routes (create: owner only; list per project, newest first).
4. **Notifications (Phase 2):**
   - `Notification` model (userId, projectId, type, refId, readAt, createdAt) + migration
   - BullMQ queue `notifications`; one job per event (e.g. `notify-followers:{feedbackId}:{status}`), worker batches followers (~500) and inserts rows; idempotent (unique key per user+event); retries with backoff
   - Hook into `setStatus` (the TODO) and post creation; implement real `run-worker.ts`
   - Routes: `GET /me/notifications`, mark as read
5. Rate limiting (`express-rate-limit`) on auth, feedback, vote endpoints.
6. Automated tests: `vitest` + `supertest` for the rules that matter (CONSUMER can't create project, only owner changes status, one vote per user, UUID validation).

**Phase 0.5: Verify infra**
- Review Dockerfile, nginx config, CI; rebuild containers; hit the API through `http://localhost:8080/api/health`.

**Phase 3: Frontend (web-first)**
1. Login/signup + passkey registration page (this is the first real test of the passkey flow)
2. Project page (vision, posts, feedback list, vote, submit feedback)
3. Dev dashboard (manage statuses, post updates)
4. Notification bell; then Electron checks

**Phase 4: Hardening before public**
- Email verification, consumer login (email link / Google), orphan-user cleanup, secrets out of compose, HTTPS + production nginx, remove dev login, CI running typecheck + tests.

**Phase 5: Observability and load**
- Add `prom-client` metrics (request duration histogram, queue depth) while building routes, not afterwards
- Prometheus + Grafana containers, dashboards (latency p50/p95/p99, error rate, queue depth, DB connections)
- k6 load tests on real flows (list feedback, vote, status change + fan-out); expect first bottlenecks in the DB (indexes, vote-count queries, fan-out batching), not Node

**Later / ideas (don't build yet):** discovery and search, comments on feedback, multiple team members per project, dev analytics, desktop notifications/tray, auto-updater, public roadmap view, cursor pagination.

**Rough time estimate (hobby pace):** ~10 hrs/week means ~4-5 months total, MVP in a browser at ~2-3 months from the start; frontend is the biggest chunk and biggest unknown.

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
10. Give complete files to paste (not diffs) and say exactly where each file goes; the user is on Windows/PowerShell.

## 11. Resume prompt (paste into a new chat with this file)

> I'm building Mirai Hub (two-sided feedback/vision platform, see the attached state.md). I'm on Windows/PowerShell. Read state.md fully, then start at "Next session starts here" in section 9. Keep to the rules in section 10. Ask me for specific files only when you need them, and tell me where each file goes.