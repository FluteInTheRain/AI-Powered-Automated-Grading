# Phase 4 — metrics for teachers and for the developer (T6.5) — design

Status: draft for author approval, 2026-11-27. Extends Phase 4 of
`2026-11-25-teacher-app-cloudflare-design.md` (sections 3, 9); where this file is silent, that
spec stands.

## Intent

Two audiences need numbers about the grader, and they need different numbers:

- **A teacher** wants to read an exam: how the class did, which question was hard, how many
  appeals, which criterion the AI marks down most.
- **The developer** (the project owner) wants to judge the AI system: is it stable, is it
  healthy, what does it cost, how often is it overturned.

The hard requirement of the project (exact-match score consistency on the same input) is the
one number that cannot be read off production traffic, because identical submissions are rare.
So the developer side measures it directly with a daily canary.

## Goals

- **Teacher stats page per exam**, in the app, from D1 only: score distribution and mean, count
  needing review (total < 50, same rule as the results page), per-question pass rate and mean
  score, mean per criterion, appeals filed / decided / adjusted for this exam, submissions
  still grading or failed.
- **Developer page**, in the app, visible only to accounts in an admin allowlist, with:
  1. *Determinism canary*: one fixed submission graded once a day by the Cron; each run's
     score and sub-scores compared with the first run's; any difference is shown in red.
  2. *Grading health* (from Analytics Engine): grading duration (p50 / p95), runs by outcome
     (done, retried, failed, blank answer), retry count, per day for the last 14 days.
  3. *Overturn signal* (from D1, whole platform): appeals filed, decided, adjusted; mean score
     change on adjusted appeals.
  4. *Cost*: a link to the AI Gateway logs in the Cloudflare dashboard (tokens and per-call
     latency live there, not copied into the app).
- **AI Gateway in front of Workers AI**, response cache OFF.
- One Analytics Engine data point per finished grading attempt, written by the queue consumer.

## Non-goals / anti-goals

- Not "agreement with human graders". `CLAUDE.md` rule: appeal and teacher-adjustment data is
  one teacher's decision on only the submissions a student chose to dispute. The page labels
  it "overturn signal (selection-biased, single rater)" and never "accuracy".
- No AI Gateway response caching, ever: a cache hit would fake the consistency we measure.
- No metric write may break or slow grading. A failed or missing metric write is dropped.
- No user-typed SQL reaches Analytics Engine: the Worker runs a fixed set of queries.
- No per-student metrics or per-student export; teacher stats are aggregates of that
  teacher's own exams.
- No alerting / paging in this change (a red canary row is the alert).

## Approaches considered

| | Trade-off |
|---|---|
| A. Teacher page in app (D1); developer uses Cloudflare dashboard + SQL | Fewest parts, no token; no developer page in the app. |
| **B. Both pages in the app; developer page reads Analytics Engine through its SQL API (chosen by the author)** | Full result, matches "simple dashboards" in the parent spec; costs one read-only API token secret and an admin allowlist. |
| C. A first, developer page later | Real data before drawing charts; two rounds. Author chose B. |

Where the canary lives: **D1 table, not Analytics Engine** (my call). It is one row per day,
needs exact comparison, and D1 is queryable and testable without any token. Analytics Engine
holds the high-volume per-grade events.

## Design

### Teacher stats (D1)
`GET /api/teacher/exams/:id/stats`, owner-checked like the existing exam routes (a teacher
sees only their own exams; others get 404). One handler computing aggregates from `attempts`,
`submissions`, latest `score_revisions` per submission (the score a student currently sees),
`grading_jobs`, `appeals`. UI: new page `/teacher/exams/:id/stats` linked from the results
page next to "Khiếu nại". Scores are on the 0-100 scale; say so on the page.

### Events (Analytics Engine)
Binding `METRICS`, dataset `grading_events`. In `processJob` (`app-worker/src/jobs.ts`), one
`writeDataPoint` per call, at every return point: `blobs = [outcome, problem_id, model]`
with outcome in `done | blank | retry | failed`, `doubles = [duration_ms, final_score,
delivery_attempt, pass_count, total]`, `indexes = [problem_id]`. `duration_ms` is wall time of
the `gradeQuestion` call (0 for blank). Score fields are 0 for retry/failed-without-result.
Free-plan budget: 100k points/day, one per attempt, far below it.

### Canary (D1 + Cron)
Migration `0006_canary.sql`: `canary_runs(id, ran_at, score, sub_scores, fingerprint,
model, input_version, status, error)`. The existing daily Cron (03:17 UTC, `scheduled` in `app-worker/src/index.ts`)
additionally grades one fixed constant input (statement, function name, rubric, hidden cases,
one fixed correct-but-imperfect solution; stored in a source file, not in D1) through
`gradeQuestion`, and inserts a row. `fingerprint` = SHA-256 of the concatenated raw LLM
responses in the call log. The baseline is the first row with the same `(model, input_version)`
(`model` from the call log, `input_version` a constant bumped whenever the canary input, prompts or rubric
change on purpose), so a deliberate change starts a new baseline by itself and never leaves the page
permanently red. A row is *stable* iff score, sub-scores and fingerprint equal that baseline's. A grader error stores a row with
`status='error'` and is shown as an error, not as a mismatch. Cron failures in the canary
must not stop `expireStaleAppeals`.

### AI Gateway
The Python grading Worker (`worker/src/app/bridges.py:66`, `self.ai.run(self.model,
payload)`; this is the project's own code, not vendored, so editing it is allowed) passes the gateway option `{ gateway: { id: <gateway>, skipCache: true } }`.
Gateway id comes from a var in `worker/wrangler.jsonc`. **Unverified risk:** the vendored
`llm_client.py` warns `json_schema` through Gateway is untested. The first build step is a
real graded call through the Gateway; if the structured output breaks, the option is removed
and Gateway is documented as not usable with schema-constrained output (the Analytics Engine
and canary work do not depend on it); the "Cost" item then becomes only a note in the README.

### Developer page
`GET /api/teacher/admin/metrics` (403 unless the signed-in email is in the `ADMIN_EMAILS`
var, comma-separated, lower-case compare). Returns canary history (last 30 rows with the
stable/mismatch verdict), overturn numbers (D1), and the grading-health series (Analytics
Engine SQL API: `POST https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql`
with secret `CF_API_TOKEN`, scope Account Analytics: Read, and var `CF_ACCOUNT_ID`). If the
SQL API call fails, the endpoint still returns the D1 parts and marks the health section
"unavailable". UI: `/teacher/admin`, shown in the header only for admins (the endpoint is the
real gate; the header link is cosmetic).

### Definitions the builder needs
- `gradeQuestion` already returns `call_log` (`app-worker/src/grader.ts`); the canary fingerprint hashes its
  `raw_response` fields. No change to the Python response contract.
- Canary runs directly in `scheduled`, in its own try/catch (any error or timeout stores `status='error'`).
- Events are one per `processJob` call (per delivery attempt, not per job). `delivery_attempt` is the Queues
  `msg.attempts` passed into `processJob`. `writeDataPoint` is synchronous, needs no `ctx.waitUntil`, and is
  still wrapped in try/catch so a metrics fault can never affect grading. "Retry count" on the page is the
  number of `retry` events.
- Admin check uses the `email` of the verified Access JWT, which `requireTeacher` already stores on
  `c.get("teacher")`. Local dev: `ADMIN_EMAILS` in `.dev.vars`, with `DEV_AUTH_BYPASS` + `X-Dev-Teacher`.
- Teacher stats: a question "passes" when its latest revision's `execution_result.pass_count ==
  total`; the mean and distribution cover only submissions whose job is `done`, with still-grading and
  failed counted separately; histogram bins are 10 points wide (0-9 ... 90-100).
- Health series sums `_sample_interval` when counting, so sampled data stays correct.

## Constraints

- Free plan: Analytics Engine 100k writes/day, 10k SQL reads/day, 3 months retention; AI
  Gateway 100k logs total. The dev page issues at most a handful of queries per load.
- `CLAUDE.md` design rules stand: scoring stays in Python, no agent framework, determinism is
  the invariant these metrics defend.
- Project working style: simple first; TDD; code comments and data in English; UI copy in
  Vietnamese like the rest of the app.

## Left to the builder

SQL for each aggregate, chart style (plain tables and a few bars; no chart library unless
already in `app-ui`), the canary's exact problem text and solution, the Gateway id name,
how `ADMIN_EMAILS` is set for local dev, test fixtures.

## Calls made by the assistant (author can reverse)

- Canary in D1, not Analytics Engine (above).
- Admin = email allowlist var, not a database role.
- Overturn signal computed from D1 on read, not duplicated into Analytics Engine.
- Token and latency per call are read in the Cloudflare dashboard, not copied into the app.
- Metric write failures are silent by design (grading must not depend on them); the dev page
  shows an empty series, which is the visible symptom.
