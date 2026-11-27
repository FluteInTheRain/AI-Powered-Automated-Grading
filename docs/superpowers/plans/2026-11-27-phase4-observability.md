# Phase 4 — metrics for teachers and the developer (T6.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-exam stats page for teachers, and an admin-only developer page (determinism canary, grading health, overturn signal), plus AI Gateway in front of Workers AI.

**Architecture:** Teacher stats are D1 aggregates. The queue consumer writes one Analytics Engine point per `processJob` call; the daily Cron also grades a fixed canary into D1. An admin endpoint merges D1 numbers with Analytics Engine SQL API results. Gateway is one option on the Python Worker's `ai.run` call.

**Tech Stack:** Hono + TypeScript on Workers (vitest with `@cloudflare/vitest-plugin`, tests in `app-worker/test/`), React + Vite + Vitest in `app-ui/` (tests in `app-ui/test/`), Python Worker in `worker/`.

**Spec:** `docs/superpowers/specs/2026-11-27-phase4-observability-design.md`. Decisions: `docs/adr/0001`-`0005`.

## Global Constraints

- Scores are 0-100; say "thang 100" on any page that shows them.
- UI copy is Vietnamese; code comments and data are English.
- Never call overturn data "accuracy" or "agreement with human graders" (ADR 0004).
- AI Gateway cache stays OFF: `skipCache: true` (ADR 0003).
- Metric writes must never throw into grading (ADR 0005).
- Free plan: at most 25 data points per invocation, 100k writes/day; D1 Free caps queries per invocation, so keep stats to a few queries.
- No user-typed SQL reaches Analytics Engine; the Worker sends fixed queries only.
- Repo rule: do not hand-edit generated data; run tests with `cd app-worker && npm test`, `cd app-ui && npx vitest run`.

## Review Focus

- A teacher requesting stats for someone else's exam gets 404 (never another teacher's aggregates).
- A non-admin, or a signed-in user with a differently-cased email, gets the correct 403 / is recognized as admin.
- An exam with zero attempts, or only unfinished jobs, returns zeros and empty lists, not NaN or a 500.
- The Analytics Engine SQL API failing (network error, non-200, malformed body) still returns the D1 sections with health marked unavailable.
- A canary grader error or timeout stores an `error` row, does not throw, and `expireStaleAppeals` still runs.
- Changing `input_version` or `model` starts a new baseline instead of showing a mismatch.

---

### Task 1: AI Gateway option in the Python Worker

**Files:**
- Modify: `worker/src/app/bridges.py` (`WorkersAIClient.__init__`, `structured_call`), `worker/src/app/routes.py:64` (`get_llm_client`), `worker/wrangler.jsonc`
- Test: the existing test file that covers `WorkersAIClient` (find it with `grep -rln WorkersAIClient worker tests`)

**Interfaces:**
- Produces: `WorkersAIClient(ai_binding, model, seed=1, run_sync=None, gateway_id: str | None = None)`. When `gateway_id` is set, `ai.run` receives a third argument `{"gateway": {"id": gateway_id, "skipCache": True}}`; when unset, the call is exactly as today (two arguments).

- [ ] **Step 1: Write failing tests** — two: with `gateway_id="g"` the fake `ai.run` receives options `{"gateway": {"id": "g", "skipCache": True}}`; without it, `run` is called with two arguments only.
- [ ] **Step 2: Run them** — Run the worker's test command (see `worker/` README). Expected: FAIL (unexpected keyword `gateway_id`).
- [ ] **Step 3: Implement** the parameter and pass the options via `_to_js`. In `get_llm_client`, read `GATEWAY_ID` from env (absent or empty means no gateway). Add `"GATEWAY_ID": "teacher-app-gateway"` to `vars` in `worker/wrangler.jsonc`.
- [ ] **Step 4: Run tests** — Expected: PASS, and the existing bridge tests still pass.
- [ ] **Step 5: Commit** — `feat(worker): route Workers AI calls through AI Gateway with cache off`.

(The live check that `json_schema` works through the Gateway is Task 8.)

### Task 2: Teacher stats endpoint

**Files:**
- Create: `app-worker/src/db/stats.ts`, `app-worker/test/stats.test.ts`
- Modify: `app-worker/src/routes/teacher_exams.ts` (add the route)

**Interfaces:**
- Produces: `getExamStats(db: D1Database, examId: string): Promise<ExamStats>` and `GET /api/teacher/exams/:id/stats`, owner-checked with `getOwnExam` (404 otherwise).
  `ExamStats = { attempts: number; submitted: number; grading: number; failed: number; mean_total: number | null; needs_review: number; histogram: number[] /* 10 bins, 0-9 .. 90-100 */; questions: { problem_id: string; position: number; pass_rate: number | null; mean_score: number | null; criteria: Record<string, number | null> }[]; appeals: { filed: number; decided: number; adjusted: number } }`.
- Rules: a score is the latest `score_revisions` row per submission (the pattern in `db/attempts.ts:86`); only submissions whose `grading_jobs.status = 'done'` count in means, histogram and pass rate; `grading` counts queued+grading jobs, `failed` counts failed jobs; a question passes when `execution_result.pass_count == execution_result.total` in the latest revision's `detail` (use `json_extract`; `total = 0` is not a pass); `needs_review` counts attempts whose weighted total is < 50 or that have a failed question (same rule as `ExamResultsPage`); the per-attempt total weights questions by `exam_questions.weight` as `listResults` does (reuse it rather than recomputing if it fits).

- [ ] **Step 1: Write failing tests** using `seedGradedAttempt` (`test/appeals_fixture.ts`): (a) the fixture's single graded question gives `submitted 1`, `mean_total 60`, histogram bin 6 = 1, question `pass_rate 0` (1 of 2 hidden tests), criterion `correctness 0.6`; (b) a teacher-adjusted revision (insert a `source='teacher'` revision) changes the mean to the adjusted score; (c) an exam with no attempts returns zeros, `mean_total null`, ten zero bins; (d) a second teacher requesting the exam gets 404; (e) an appeal filed and adjusted shows up in `appeals`.
- [ ] **Step 2: Run** `cd app-worker && npx vitest run test/stats.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `getExamStats` in at most four queries, and the route.
- [ ] **Step 4: Run** the new test file, then `npm test`. Expected: PASS, full suite green.
- [ ] **Step 5: Commit** — `feat(app-worker): per-exam stats endpoint`.

### Task 3: Teacher stats page

**Files:**
- Create: `app-ui/src/pages/ExamStatsPage.jsx`, `app-ui/test/ExamStats.test.jsx`
- Modify: `app-ui/src/api.js` (`getExamStats = (id) => request(...)`), `app-ui/src/main.jsx` (route `/teacher/exams/:id/stats`), `app-ui/src/pages/ExamResultsPage.jsx` (link "Thống kê" beside the appeals link), `app-ui/src/index.css` (bar styles)

**Interfaces:**
- Consumes: `GET /api/teacher/exams/:id/stats` from Task 2 and `getExamDetail` for the title.

- [ ] **Step 1: Write failing tests** (mock `../src/api.js` as in `ExamAppeals.test.jsx`): renders title, "thang 100" note, the mean, the ten histogram bars, one row per question with pass rate as a percentage, the appeals counts, and "Chưa có bài nộp nào." for an empty exam; shows the error message when the call rejects.
- [ ] **Step 2: Run** `cd app-ui && npx vitest run test/ExamStats.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page with plain tables and CSS bars (no chart library), plus api function, route and link.
- [ ] **Step 4: Run** the new file, then `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(app-ui): teacher exam stats page`.

### Task 4: Analytics Engine events from the queue consumer

**Files:**
- Create: `app-worker/src/metrics.ts`, `app-worker/test/metrics.test.ts`
- Modify: `app-worker/src/jobs.ts` (`processJob`, `queue`), `app-worker/src/env.ts` (`METRICS: AnalyticsEngineDataset`), `app-worker/test/env.d.ts`, `app-worker/wrangler.jsonc` (`"analytics_engine_datasets": [{ "binding": "METRICS", "dataset": "grading_events" }]`), `app-worker/test/helpers.ts` (`drain` and `client` pass a fake `METRICS`)

**Interfaces:**
- Produces: `recordGrading(metrics: AnalyticsEngineDataset | undefined, e: { outcome: "done" | "blank" | "retry" | "failed"; problemId: string; model: string; durationMs: number; score: number; deliveryAttempt: number; passCount: number; total: number }): void`. Writes `indexes: [problemId]`, `blobs: [outcome, problemId, model]`, `doubles: [durationMs, score, deliveryAttempt, passCount, total]`. Never throws.
- Consumes: `processJob(env, submissionId, deliveryAttempt)` already receives the delivery attempt; model name is `out.call_log[0]?.model ?? ""`.

- [ ] **Step 1: Write failing tests** with a fake dataset recording `writeDataPoint` calls: (a) `recordGrading` writes the exact shape above; (b) a dataset whose `writeDataPoint` throws does not make `recordGrading` throw; (c) through `drain`, a normal graded submission produces one `done` point with `duration_ms >= 0`, score 60, pass_count 1, total 2; (d) the unchanged starter code produces one `blank` point and no grader call; (e) a grader 502 on delivery 1 produces a `retry` point, and on the final delivery a `failed` point.
- [ ] **Step 2: Run** `npx vitest run test/metrics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `metrics.ts` (try/catch around the write) and call it at each return point of `processJob`, measuring the `gradeQuestion` wall time.
- [ ] **Step 4: Run** the new file and `npm test`; `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(app-worker): write a grading event to Analytics Engine per attempt`.

### Task 5: Determinism canary

**Files:**
- Create: `app-worker/migrations/0006_canary.sql`, `app-worker/src/canary.ts`, `app-worker/src/db/canary.ts`, `app-worker/test/canary.test.ts`
- Modify: `app-worker/src/index.ts` (`scheduled`)

**Interfaces:**
- Produces:
  - Table `canary_runs(id TEXT PRIMARY KEY, ran_at TEXT NOT NULL, score REAL, sub_scores TEXT, fingerprint TEXT, model TEXT, input_version INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('ok','error')), error TEXT)` with an index on `ran_at`.
  - `CANARY_INPUT_VERSION: number` and `CANARY_INPUT: GradeInput` (one fixed statement, function name, rubric, hidden cases and a fixed correct-but-imperfect solution; constants in `canary.ts`).
  - `runCanary(env: Pick<Env, "DB" | "GRADER" | "INTERNAL_TOKEN">, now: Date): Promise<void>` — never throws; stores an `ok` row (fingerprint = hex SHA-256 of the `raw_response` fields joined with a separator) or an `error` row.
  - `canaryHistory(db: D1Database, limit: number): Promise<{ ran_at: string; score: number | null; status: string; verdict: "baseline" | "stable" | "mismatch" | "error" }[]>`, newest first. Baseline = earliest `ok` row with the same `(model, input_version)`; `mismatch` when score, sub_scores or fingerprint differ from it.

- [ ] **Step 1: Write failing tests** with `fakeGrader`: (a) first run stores an `ok` row and verdict `baseline`; (b) second identical run is `stable`; (c) a run whose raw response differs is `mismatch`; (d) a run with a different `model` is its own `baseline`, not a mismatch; (e) a grader 502 stores an `error` row and does not throw; (f) after bumping `input_version` (insert rows with another version) the first row of that version is `baseline`; (g) `worker.scheduled(...)` runs both the canary and `expireStaleAppeals`, and still expires appeals when the grader fails.
- [ ] **Step 2: Run** `npx vitest run test/canary.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** migration, canary module, history query, and the `scheduled` wiring (canary in its own try/catch).
- [ ] **Step 4: Run** the new file and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(app-worker): daily determinism canary`.

### Task 6: Admin metrics endpoint

**Files:**
- Create: `app-worker/src/admin.ts`, `app-worker/src/db/overturn.ts`, `app-worker/src/analytics_sql.ts`, `app-worker/src/routes/teacher_admin.ts`, `app-worker/test/admin.test.ts`
- Modify: `app-worker/src/env.ts` (`ADMIN_EMAILS?: string`, `CF_ACCOUNT_ID?: string`, `CF_API_TOKEN?: string`), `app-worker/test/env.d.ts`, `app-worker/src/index.ts` (mount the route; `/api/teacher/me` also returns `is_admin`), `app-worker/wrangler.jsonc` (`vars.ADMIN_EMAILS`, `vars.CF_ACCOUNT_ID`)

**Interfaces:**
- Produces:
  - `isAdmin(env: Pick<Env, "ADMIN_EMAILS">, email: string): boolean` — comma-separated, trimmed, lower-case compare.
  - `overturnStats(db): Promise<{ filed: number; decided: number; adjusted: number; mean_delta: number | null }>` (whole platform; delta = latest teacher revision score minus revision 0 score on adjusted appeals).
  - `queryHealth(env: Pick<Env, "CF_ACCOUNT_ID" | "CF_API_TOKEN">, fetchFn?: typeof fetch): Promise<{ day: string; outcome: string; count: number; p50_ms: number; p95_ms: number }[] | null>` — one fixed SQL over `grading_events` for the last 14 days, `SUM(_sample_interval)` for counts, `null` on any failure or missing credentials.
  - `GET /api/teacher/admin/metrics` → `{ canary: ReturnType<canaryHistory> (last 30), overturn, health: rows | null, label: string }` where `label` is the fixed text "overturn signal (selection-biased, single rater)"; 403 for non-admins.
  - `GET /api/teacher/me` → `{ id, email, is_admin }`.

- [ ] **Step 1: Write failing tests**: (a) `isAdmin` matches case-insensitively and rejects empty or absent `ADMIN_EMAILS`; (b) a non-admin gets 403 and an admin gets 200; (c) `queryHealth` sends one POST with the bearer token to the account's `analytics_engine/sql` URL (inject a fake `fetchFn`) and maps rows; (d) non-200, thrown fetch and malformed JSON each return `null`; (e) the endpoint still returns `canary` and `overturn` with `health: null` when the SQL call fails; (f) `overturn` counts an adjusted appeal with delta; (g) `/me` includes `is_admin`.
- [ ] **Step 2: Run** `npx vitest run test/admin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules and route.
- [ ] **Step 4: Run** the new file, `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(app-worker): admin metrics endpoint`.

### Task 7: Developer page

**Files:**
- Create: `app-ui/src/pages/AdminMetricsPage.jsx`, `app-ui/test/AdminMetrics.test.jsx`
- Modify: `app-ui/src/api.js` (`getAdminMetrics`), `app-ui/src/main.jsx` (route `/teacher/admin`), `app-ui/src/pages/TeacherHomePage.jsx` (header link "Chỉ số AI" only when `getMe()` says `is_admin`), `app-ui/test/Teacher.test.jsx`

- [ ] **Step 1: Write failing tests**: renders canary rows with a red marker for `mismatch` and an error marker for `error`; shows the overturn numbers with the label text and no word "độ chính xác"; shows "Không có dữ liệu sức khoẻ chấm bài" when `health` is null; shows the health table otherwise; a 403 shows "Không có quyền truy cập"; the home header shows the link only for `is_admin`.
- [ ] **Step 2: Run** `npx vitest run test/AdminMetrics.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement** page, api function, route, header link (dashboard link for Gateway logs: plain text pointing to the Cloudflare dashboard, no URL guessing).
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(app-ui): developer metrics page`.

### Task 8: Docs, live setup and Gateway verification

**Files:**
- Modify: `docs/roadmap.md` (T6.4 deployed note and T6.5 done with a short summary), `app-worker/README.md` (new endpoints, vars, secret), `docs/adr/README.md` if a decision changes

- [ ] **Step 1: Ask the user to do the Cloudflare-side setup** (these cannot be done from tests): create AI Gateway `teacher-app-gateway` with caching off; create an API token with "Account Analytics: Read" and run `wrangler secret put CF_API_TOKEN` in `app-worker/`; set `ADMIN_EMAILS` and `CF_ACCOUNT_ID` vars. State plainly which of these are done.
- [ ] **Step 2: Merge to main**, wait for Deploy green (`gh run watch`).
- [ ] **Step 3: Verify Gateway** — submit one real answer on the live site, confirm it is graded with a normal structured result and that a log line appears in the Gateway dashboard. If grading fails with a schema error, remove `GATEWAY_ID`, redeploy, record the outcome in ADR 0003 (status "superseded: Gateway unusable with json_schema") and tell the user.
- [ ] **Step 4: Verify the pages** — teacher stats page for a real exam, developer page after the 03:17 UTC Cron has run once (or trigger with `wrangler dev --test-scheduled` locally and say so).
- [ ] **Step 5: Update the work-log and kb** per `~/.claude/CLAUDE.md`, then commit docs.
