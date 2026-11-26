# teacher-app (Cloudflare Worker, TypeScript)

Phase 1 of the teacher app: teacher login (Cloudflare Access), question bank, multi-question
exams, student attempts graded synchronously by the Python Worker (`worker/`) over a service
binding, and a React UI (`app-ui/`, plan `docs/superpowers/plans/2026-11-25-teacher-app-ui.md`) served as static assets. Design: `docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md`;
plan: `docs/superpowers/plans/2026-11-25-teacher-app-phase1.md`.

Free plan only, workers.dev hostname, $0.

## Local development

```bash
cd app-worker
npm install
npm test            # vitest inside the Workers runtime (miniflare); no Cloudflare login needed
npm run typecheck
```

For `wrangler dev`, put `DEV_AUTH_BYPASS=1` and `INTERNAL_TOKEN=local` in `app-worker/.dev.vars`
(gitignored); then send `X-Dev-Teacher: you@example.com` instead of an Access JWT.
**Never** put `DEV_AUTH_BYPASS` in `wrangler.jsonc`.

## API

Teacher (behind Access) `/api/teacher/*`: `GET me`, `GET bank`, `GET|POST problems`,
`POST problems/preview`, `GET|POST exams`, `GET|PATCH exams/:id`, `GET exams/:id/results`.
Student (no login) `/api/exam/:student_token`: `GET`, `POST attempts`,
`POST attempts/:attempt_id/questions/:problem_id/submit`, `GET attempts/by-receipt/:receipt_code`.
Scores are append-only rows in `score_revisions` (revision 0 = the AI score); the schema
rejects `UPDATE`/`DELETE` on scores and submissions.

## Deploy (first time)

Steps marked **(you)** need your Cloudflare login or the dashboard.

1. **(you)** `cd app-worker && npx wrangler d1 create teacher-app`, then put the printed
   `database_id` into `wrangler.jsonc`.
2. Schema and bank:
   ```bash
   npx wrangler d1 migrations apply teacher-app --remote
   python3 ../scripts/export_bank_seed.py          # regenerates seed/bank.sql from data/problems.py
   npx wrangler d1 execute teacher-app --remote --file seed/bank.sql
   npx wrangler d1 execute teacher-app --remote --command "SELECT count(*) FROM problems WHERE visibility='system'"   # expect 16
   ```
3. **(you)** Pick one random value and set it as `INTERNAL_TOKEN` on BOTH Workers:
   `(cd ../worker && uv run pywrangler secret put INTERNAL_TOKEN)` and `npx wrangler secret put INTERNAL_TOKEN`.
4. **(you)** Deploy the Python Worker first (it gains `/api/internal/*`), then this one:
   ```bash
   (cd .. && ./sandbox-worker/build.sh && ./worker/build.sh && cd worker && uv run pywrangler deploy)
   npx wrangler deploy
   ```
5. **(you)** Zero Trust dashboard: add a self-hosted application for this Worker's workers.dev
   hostname with path `/api/teacher/*`, policy "emails: your address", login method One-time PIN.
   Copy the team domain and the application's AUD tag into `wrangler.jsonc` vars
   (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) and redeploy. Check, and note below, whether the Free plan
   limits (users/applications) were confirmed in the Cloudflare docs.
6. **(you)** Smoke test (record the real output here when done):
   - `curl -i https://teacher-app.<subdomain>.workers.dev/api/teacher/me` -> 302 or 401
   - sign in in a browser, open `/api/teacher/me` -> your teacher JSON
   - create an exam from the bank, start an attempt, submit a known-good solution, read it back by receipt code
   - `curl -i -X POST https://grading.<subdomain>.workers.dev/api/internal/grade` -> 401

## Known deviation from the design

The design wanted the Python grading endpoints reachable only through the service binding. The
`grading` Worker has a public workers.dev URL and its assets config routes only `/api/*` to code,
so the endpoints live at `/api/internal/*` and are **public but token-gated** (`X-Internal-Token`,
compared in constant time, fails closed when the secret is unset). A separate Worker with
`workers_dev: false` would remove the public surface at the cost of a third Python bundle.

## Phase 2: background grading, attempt clock, audit log, abuse limits

- **Queues** (`grading-jobs`): submit stores the submission plus a `grading_jobs` row and answers 202; the Worker's
  `queue()` handler grades it through the Python Worker, writes score revision 0 to D1 and the LLM call log to **R2**
  (`teacher-app-audit`, key `audit/<submission_id>.json`). Delivery is at least once, so a finished job is a no-op.
  Three deliveries, then the job is `failed` in D1 with a fixed message (no dead-letter queue: it costs operations and adds
  nothing here); a student-code sandbox kill fails at once. The student gets a "Chấm lại" button (`POST .../retry`).
- **Durable Object** (`AttemptDO`, one per attempt): the authoritative clock (10 s grace) and a per-question submit claim (a claim left by a crashed request expires after 30 s). A queued or grading job older than
  120 s is reported `stuck` and can be retried; a sandbox kill is permanent (`retryable: false`).
  Questions are only returned after an attempt exists, and a reload resumes the attempt (`GET .../attempts/:id`) with the
  server's remaining time. Code drafts are not saved, so a resume shows the starter code again.
- **Rate Limiting** bindings (`RL_START` 60/min and `RL_SYNTAX` 600/min per IP, sized so a classroom behind one public IP is not blocked;
  `RL_ACTION` 30/min per attempt). Counts are per Cloudflare location and approximate.
- **Turnstile** on attempt start. Secret `TURNSTILE_SECRET` is a Worker secret, `TURNSTILE_SITE_KEY` and `TURNSTILE_HOSTNAMES`
  are vars. For local runs use Cloudflare's always-pass test keys (site `1x00000000000000000000AA`, secret
  `1x0000000000000000000000000000000AA`) and add `localhost` to `TURNSTILE_HOSTNAMES`.
- Read an audit log: `npx wrangler r2 object get teacher-app-audit/audit/<submission_id>.json --remote`.

## Known limits (after Phase 2)

- **Names are not identities.** A name can be used once per exam, so a student who starts first under someone else's name
  locks that student out of a fresh start (they need their own attempt or receipt code); a different name always starts a
  fresh clock. Real per-student limits need a teacher-issued roster or invites.
- Attempts created before Phase 2 have no clock state and can no longer submit.
- Drafts are not autosaved. Hidden test cases are protected: students get pass counts only, the LLM feedback prompt sees
  counts, public-test errors are reduced to a generic text, and the exam view carries no test values.
- Resubmitting a question is rejected (409). Teacher results use one D1 query (the Free plan caps queries per invocation).
- The CI deploy token needs Workers Scripts, D1, Queues, R2 and Durable Objects edit; if the Deploy workflow fails on a
  permission, recreate the token and replace the repository secret.

## Status

Deployed 2026-11-25 to https://teacher-app.khangnguyen.workers.dev (D1 `teacher-app`, id in
`wrangler.jsonc`; `INTERNAL_TOKEN` set on both Workers; preview URLs turned off because they would
bypass Access). Verified on the live deployment:

- `/health` -> 200; `/api/teacher/me` without a login -> 401 `Not signed in` (fails closed while the
  Access placeholders are still in `wrangler.jsonc`); `POST /api/internal/grade` on `grading`
  without the token -> 401; the demo home page still -> 200.
- Bank: 16 system problems in D1.
- End to end through the service binding (smoke exam `smokeexam` / teacher `smoke-test@example.invalid`,
  inserted directly in D1, harmless): start attempt, submit the known-good `two_sum` -> score 94,
  tests 3/3, LLM feedback returned; by-receipt read-back matched. Those rows stay (scores are append-only).

**Access (2026-11-25):** Zero Trust org `aged-snowflake-18c8.cloudflareaccess.com`; application
"teacher-app (teacher API)" for `teacher-app.khangnguyen.workers.dev/api/teacher/*`, policy "Owner only"
(allow one email), session 24 h; AUD tag and team domain are in `wrangler.jsonc`. Created through the
Cloudflare API with a scoped API token (Access: Apps and Policies edit). Verified live: unauthenticated
`/api/teacher/me` -> 302 to the Access login; student routes and `/health` stay open.

**Real login verified (2026-11-25, by the author):** browser sign-in with a one-time PIN, then
`/api/teacher/me` returned the teacher JSON, so the Worker accepts a real Access JWT. The Free plan
user cap is still unconfirmed from the docs.

## UI (`app-ui/`)

React + Vite SPA that reuses the demo's components and `index.css`. Pages: `/teacher` (own exams, create
from the bank), `/teacher/exams/:id` (results, deadline), `/exam/:token` (student exam with Monaco editor,
timer, Run Tests, score and AI feedback, receipt-code lookup).

```bash
npm --prefix app-ui test                       # vitest + Testing Library
npm --prefix app-ui run build                  # writes app-ui/dist, served by the Worker's assets binding
(cd app-worker && npx wrangler deploy)         # build the UI first
```

Dev: `npx wrangler dev` in `app-worker/` (port 8787) and `npm --prefix app-ui run dev` (proxies `/api`).

**Access destinations** (all three are needed): `/api/teacher/*`, `/teacher/*` and the exact path `/teacher`
(the wildcard does not match it; without it the page loads unprotected and reloads in a loop when the
API redirects to the login). Student paths `/exam/*` and `/api/exam/*` stay public. Set through the
Cloudflare API (`PUT /accounts/<id>/access/apps/<app id>` with `destinations`).

Not in the UI yet: authoring your own question, Excel export, the AI audit trail (Phase 3).

## CI/CD (GitHub Actions)

- `.github/workflows/ci.yml` runs on every PR and push to `main`: Python tests, `app-worker` tests + typecheck,
  `app-ui` tests + build (three parallel jobs).
- `.github/workflows/deploy.yml` runs on every push to `main` (and by hand from the Actions tab), after the same
  checks: deploys `grading-sandbox`, `grading` (with the demo UI), applies D1 migrations, builds the UI and deploys
  `teacher-app`, then smoke-tests `/health`, the Access redirect and the demo home page. Deploys never overlap.
- Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Repository variable: `DEMO_EXAM_PATH`
  (`/exam/Gj4_eCLot4LOiksK_JMf-w`, the "try it" box). `INTERNAL_TOKEN` stays a Worker secret on Cloudflare, not in CI.
- To rotate the token: create a new one (Edit Cloudflare Workers + D1 Edit), replace the secret in
  Settings > Secrets and variables > Actions.
