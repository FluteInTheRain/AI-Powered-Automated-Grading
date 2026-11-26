# Teacher App — Phase 2 (async grading, attempt timer, audit log, abuse limits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Students' submissions are graded in the background through Queues; each attempt's clock and one-submit-at-a-time lock live in a Durable Object; every grading call is archived in R2; student endpoints are rate limited and the attempt start is protected by Turnstile.

**Architecture:** `app-worker` gains four bindings (queue producer+consumer `grading-jobs`, Durable Object `ATTEMPT`, R2 bucket `AUDIT`, rate limit bindings) and a `queue()` handler. `submit` stores the submission plus a `grading_jobs` row and returns 202; the consumer calls the Python grader, writes score revision 0 to D1 and the audit blob to R2. Exam questions are served only after an attempt exists, and an attempt can be resumed after a refresh.

**Tech Stack:** Hono Worker, D1, Queues, Durable Objects (SQLite-backed, RPC), R2, Rate Limiting binding, Turnstile, vitest + `@cloudflare/vitest-plugin`; React UI (`app-ui/`).

**Spec:** `docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md` (section 9, Phase 2). Decisions agreed with the author on 2026-11-26 are listed under "Decisions" below. Free-tier facts were checked on 2026-11-25/26: Queues 10,000 operations/day; Durable Objects SQLite-backed only; R2 10 GB + 1M Class A + 10M Class B per month; Turnstile 20 widgets, 10 hostnames per widget; Rate Limiting binding plan availability and Turnstile on `workers.dev` are **unconfirmed** (Task 1 settles both).

## Decisions (author-approved 2026-11-26 unless marked "call")

- All four items are in scope; the author enabled R2 on the account.
- Exam questions are only returned after an attempt is created (fixes "read the questions before starting").
- Refresh resumes the same attempt (attempt id kept in the browser) with the server's clock; starting a second attempt under the same name (case-insensitive) in the same exam is refused with 409 "use your receipt code to continue". A different name still starts a fresh clock (no student identity; documented).
- Call: grading failures after 3 delivery attempts mark the job `failed` in D1 (no dead-letter queue: it costs operations and adds nothing here); the student gets a "retry" button. A student-code kill (grader answers "time/resource") is permanent at once, never retried.
- Call: attempts created before Phase 2 have no Durable Object state and can no longer act (they only exist from testing).
- Call: if the Rate Limiting binding is unavailable on Free, use Durable Object counters instead; if Turnstile rejects the `workers.dev` hostname, skip Task 7 and record it in the roadmap.

## Global Constraints

- "Free plan only, $0 budget, workers.dev hostname." Never move to Workers Paid.
- Students never see test inputs or expected values; the AI never decides scores (`CLAUDE.md`). Scores stay append-only (`score_revisions` triggers).
- Do not edit `frontend/` or `src/grader/*` behaviour. `pytest`, `npm --prefix app-worker test`, `npm --prefix app-ui test` stay green (baseline today: 140 + 83 + 33).
- Work on branch `feat/teacher-app-phase2`; end commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Comments in English.

## Review Focus

1. A queue message delivered twice (at-least-once) must not create two score revisions or two audit objects (Task 4).
2. R2 write succeeds but the D1 write fails: the retry must be safe and end with exactly one revision (Task 4).
3. Student refreshes during grading or mid-exam: the status poll still reaches `done`, and the timer resumes from the server (Tasks 5, 8).
4. `queue.send` fails after the submission is stored: the question is not stuck forever; retry recovers it (Task 5).
5. Student code that kills the sandbox: one attempt, permanent `failed`, no retries that burn the Workers AI budget (Task 4).

## File Structure

| Path | Responsibility |
|---|---|
| `app-worker/wrangler.jsonc` (modify) | queue, DO, R2, rate limit bindings and vars |
| `app-worker/migrations/0002_phase2.sql` (create) | `grading_jobs`, `attempts.name_key` + unique index |
| `app-worker/src/attempt_do.ts` (create) | `AttemptDO` Durable Object |
| `app-worker/src/jobs.ts` (create) | enqueue, process, queue consumer |
| `app-worker/src/limits.ts`, `src/turnstile.ts` (create) | rate limit and Turnstile helpers |
| `app-worker/src/routes/student.ts`, `src/db/attempts.ts`, `src/index.ts`, `src/env.ts` (modify) | new student flow |
| `app-ui/src/pages/ExamPage.jsx`, `src/api.js`, `src/components/TurnstileWidget.jsx` (modify/create) | async UI |

## API contract (student, after this plan)

- `GET /api/exam/:token` → `{ title, deadline, time_limit_seconds, is_closed, question_count, turnstile_site_key }` (no questions).
- `POST attempts { student_name, turnstile_token }` → `{ attempt_id, receipt_code, remaining_seconds, questions: [<question view of Phase 1b>] }`; 409 on a repeated name; 429 when rate limited; 400 on a failed Turnstile check.
- `GET attempts/:attemptId` (resume) → `{ student_name, receipt_code, remaining_seconds, questions: [{ …question view, status: "none"|"queued"|"grading"|"done"|"failed" }] }`.
- `POST attempts/:attemptId/questions/:problemId/submit { code }` → `202 { status: "queued" }`; 409 already submitted or another submit in flight; 403 closed / time up.
- `GET …/questions/:problemId/status` → `{ status, score?, sub_scores?, tests?, feedback?, error? }`; `POST …/retry` (only when `failed` or stuck `queued`) → `202`.
- `run` and `syntax-check` keep their shapes, plus 429.

---

### Task 1: Resources, bindings and the two Free-tier spikes

**Files:** Modify `app-worker/wrangler.jsonc`, `app-worker/src/env.ts`, `app-worker/test/env.d.ts`; create nothing else. Steps marked **(live)** touch Cloudflare.

**Interfaces:**
- Produces `Env` additions: `GRADING_QUEUE: Queue<{ submission_id: string }>`, `ATTEMPT: DurableObjectNamespace<AttemptDO>`, `AUDIT: R2Bucket`, `RL_START: RateLimit`, `RL_SYNTAX: RateLimit`, `RL_ACTION: RateLimit`, `TURNSTILE_SECRET: string`, `TURNSTILE_SITE_KEY: string`, `TURNSTILE_HOSTNAMES: string` (comma list). `wrangler.jsonc`: `queues.producers/consumers` for `grading-jobs` (`max_batch_size: 1`, `max_retries: 3`), `durable_objects.bindings` `{ name: "ATTEMPT", class_name: "AttemptDO" }` with `migrations: [{ tag: "v1", new_sqlite_classes: ["AttemptDO"] }]`, `r2_buckets` `{ binding: "AUDIT", bucket_name: "teacher-app-audit" }`, `ratelimits` (`RL_START` limit 5/60 s, `RL_SYNTAX` 60/60 s, `RL_ACTION` 30/60 s, distinct `namespace_id`s).

- [ ] **Step 1 (live): create resources:** `npx wrangler queues create grading-jobs` and `npx wrangler r2 bucket create teacher-app-audit` in `app-worker/`. Expected: both succeed on Free; if either is refused, stop and record it.
- [ ] **Step 2: add the bindings** and a stub `export class AttemptDO` exported from `src/index.ts` (so the DO migration can deploy), then `npm --prefix app-worker test && npm --prefix app-worker run typecheck` — Expected: still green (83).
- [ ] **Step 3 (live): spike A, Rate Limiting on Free:** deploy and call a throwaway route that runs `env.RL_START.limit({ key: "spike" })` six times; Expected: `success` true then false after the limit. If the deploy is refused or the binding is missing, record "Rate Limiting binding unavailable on Free" in the ledger and use Durable Object counters in Task 6.
- [ ] **Step 4 (live): spike B, Turnstile on workers.dev:** `POST /accounts/<id>/challenges/widgets` with `domains: ["teacher-app.khangnguyen.workers.dev"]`, `mode: "managed"` using the author's `CLOUDFLARE_API_TOKEN` (the author supplies it; if it lacks Turnstile edit, ask them to create the widget in the dashboard and send the site key and secret). Then test the siteverify round trip from the live page in Task 10. Record the site key; the secret becomes `wrangler secret put TURNSTILE_SECRET`. If the hostname is refused, skip Task 7.
- [ ] **Step 5: remove the spike route, commit** `feat(app-worker): Phase 2 bindings and infrastructure` (create the branch first: `git switch -c feat/teacher-app-phase2`).

### Task 2: Migration `0002_phase2.sql` and job queries

**Files:** Create `app-worker/migrations/0002_phase2.sql`, `app-worker/src/db/jobs.ts`, `app-worker/test/jobs_db.test.ts`

**Interfaces:**
- Migration: `ALTER TABLE attempts ADD COLUMN name_key TEXT;` backfill `name_key = lower(trim(student_name))`; `CREATE UNIQUE INDEX idx_attempts_exam_name ON attempts(exam_id, name_key);` `grading_jobs(submission_id PK REFERENCES submissions, status CHECK IN ('queued','grading','done','failed'), attempts INTEGER NOT NULL DEFAULT 0, error TEXT, audit_key TEXT, updated_at TEXT NOT NULL)`.
- `db/jobs.ts` produces: `insertSubmissionWithJob(db, a: { attemptId; problemId; code }): Promise<string>` (submission + job `queued` in one batch; throws `AlreadySubmitted` on the UNIQUE), `getJob(db, submissionId)`, `setJobStatus(db, submissionId, status, extra?: { error?: string; auditKey?: string; bumpAttempts?: boolean })`, `getSubmissionBundle(db, submissionId): Promise<{ submission; problem } | null>`.

- [ ] **Step 1: failing tests:** `job_is_created_queued_with_the_submission`; `second_submission_for_same_attempt_and_problem_throws_AlreadySubmitted`; `status_cannot_be_set_to_an_unknown_value` (CHECK); `unique_index_rejects_the_same_name_in_one_exam_case_insensitively` (insert two attempts with `name_key` "an"); `same_name_is_allowed_in_different_exams`.
- [ ] **Step 2:** `npm --prefix app-worker test` — Expected: new tests FAIL.
- [ ] **Step 3: implement** the migration and helpers; update `createAttempt` in `db/attempts.ts` to write `name_key` and rethrow a typed `NameTaken` on that UNIQUE.
- [ ] **Step 4:** `npm --prefix app-worker test && npm --prefix app-worker run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(app-worker): grading jobs table and unique attempt names`.

### Task 3: `AttemptDO`

**Files:** Create `app-worker/src/attempt_do.ts`, `app-worker/test/attempt_do.test.ts`; modify `src/index.ts` (export the real class).

**Interfaces:** `export class AttemptDO extends DurableObject<Env>` (from `cloudflare:workers`), RPC methods: `begin(limitSeconds: number, nowMs: number): Promise<void>` (idempotent: a second call keeps the first start); `check(nowMs: number): Promise<{ started: boolean; running: boolean; remainingSeconds: number }>` (`running` is true until `endsAt + 10_000` ms; `remainingSeconds = max(0, ceil((endsAt - now)/1000))`); `claim(problemId: string): Promise<boolean>` (true for the first caller only); `release(problemId: string): Promise<void>`. Usage: `env.ATTEMPT.get(env.ATTEMPT.idFromName(attemptId))`.

- [ ] **Step 1: failing tests** (use `env.ATTEMPT`): `check_before_begin_says_not_started`; `begin_then_check_counts_down_from_the_limit` (now = start + 100 s of a 600 s limit → 500); `running_until_ten_seconds_after_the_end_then_false`; `begin_twice_keeps_the_first_start`; `claim_succeeds_once_then_fails_until_released`; `two_attempt_ids_do_not_share_state`; `concurrent_claims_have_exactly_one_winner` (`Promise.all` of 5).
- [ ] **Step 2:** run — Expected: FAIL. **Step 3: implement** with `ctx.storage` (`put`/`get`); `claim` reads and writes inside `ctx.blockConcurrencyWhile` or a single synchronous storage transaction so it is atomic. **Step 4:** `npm --prefix app-worker test` — Expected: PASS. **Step 5: Commit** `feat(app-worker): attempt Durable Object for the clock and submit lock`.

### Task 4: Grading jobs: enqueue, process, queue consumer

**Files:** Create `app-worker/src/jobs.ts`, `app-worker/test/jobs.test.ts`; modify `src/index.ts` (default export gains `queue`).

**Interfaces:** `processJob(env: Env, submissionId: string, deliveryAttempt: number): Promise<"done" | "retry" | "failed">`; `queue(batch: MessageBatch<{ submission_id: string }>, env: Env): Promise<void>` (per message: `done`/`failed` → `ack()`, `retry` → `retry({ delaySeconds: 30 * deliveryAttempt })`); constant `MAX_DELIVERIES = 3`. Behaviour of `processJob`: job already `done` → return `"done"` without grading; set `grading`; call `gradeQuestion` with the problem's hidden cases; on success `AUDIT.put("audit/<submission_id>.json", JSON.stringify({ call_log, graded_at }))` (fixed key, so reruns overwrite) then one D1 batch: `score_revisions` revision 0 (`INSERT … WHERE NOT EXISTS`/`OR IGNORE` so a duplicate cannot add a second) + job `done` with `audit_key`; on `GraderError`: permanent when `detail` contains `time/resource` or status is 400 → job `failed` with that fixed text, return `"failed"`; otherwise if `deliveryAttempt >= MAX_DELIVERIES` → `failed` with `Grading service error, please try again.`, else job back to `queued`, return `"retry"`.

- [ ] **Step 1: failing tests** (fake `GRADER`, real `AUDIT` and D1): `success_writes_revision0_audit_object_and_marks_done`; `audit_object_holds_the_call_log`; `redelivered_message_after_done_does_nothing_and_adds_no_second_revision` (Review Focus 1); `r2_ok_but_d1_failure_then_retry_ends_with_one_revision_and_one_audit_object` (stub the D1 batch to throw once; Review Focus 2); `sandbox_kill_fails_permanently_on_the_first_delivery_without_retry` (Review Focus 5); `grader_5xx_retries_until_the_third_delivery_then_fails_with_fixed_text`; `consumer_acks_done_and_failed_and_retries_with_backoff` (fake `Message` objects recording `ack`/`retry`).
- [ ] **Step 2:** run — Expected: FAIL. **Step 3: implement** `jobs.ts` using Task 2's helpers. **Step 4:** `npm --prefix app-worker test && npm --prefix app-worker run typecheck` — Expected: PASS. **Step 5: Commit** `feat(app-worker): background grading jobs with R2 audit log`.

### Task 5: Student routes on the new flow

**Files:** Modify `app-worker/src/routes/student.ts`, `src/db/attempts.ts`, `src/index.ts`, `test/helpers.ts` (client accepts env overrides: fake `GRADING_QUEUE` capturing messages, fake rate limit bindings allowing everything, `TURNSTILE_*`), `test/student.test.ts` (rewrite the affected tests), add `test/student_flow.test.ts`.

**Interfaces:** the student API contract above. `POST attempts` order: exam exists, name valid, closed → 403, (Task 6/7 hooks go here), create attempt (`NameTaken` → 409), `AttemptDO.begin(exam.time_limit_seconds, now)`, return questions. `run`/`submit` guard replaces the `started_at` arithmetic with `AttemptDO.check(now)` (`!started` or `!running` → 403 "Time limit exceeded"). `submit`: `claim(problemId)` false → 409 "A submission for this question is already in progress"; then `insertSubmissionWithJob` (`AlreadySubmitted` → release, 409), then `GRADING_QUEUE.send({ submission_id })`; a throwing send keeps the job `queued`, calls `release`, and answers `503 { detail: "Could not queue grading, please retry." }`. `retry`: allowed when the job is `failed`, or `queued` and older than 60 s; resets `attempts`, sets `queued`, sends, `202`. `status` reads the job and, when `done`, the latest revision (score) plus revision 0 detail (sub_scores, tests counts, feedback; never `errors`).

- [ ] **Step 1: failing tests:** exam view has no questions and has `question_count` and `turnstile_site_key`; `start_returns_questions_remaining_seconds_and_receipt` (question view has no test values); `second_start_with_same_name_is_409_with_the_receipt_hint`; `resume_returns_questions_remaining_and_per_question_status` (Review Focus 3); `resume_with_unknown_or_foreign_attempt_is_404`; `submit_returns_202_and_enqueues_one_message_and_stores_a_queued_job`; `submit_twice_is_409` and `concurrent_double_submit_one_202_one_409`; `submit_after_time_is_403` (inject `now` past the limit); `closed_exam_rejects_start_run_submit`; `queue_send_failure_is_503_and_retry_recovers_it` (Review Focus 4); `status_shows_queued_then_done_after_the_consumer_runs_with_score_and_feedback_but_no_expected_values`; `failed_job_exposes_the_fixed_error_and_retry_requeues_it`; `retry_on_a_done_job_is_409`; by-receipt keeps working for graded questions. Replace the Phase 1 submit tests that expected a synchronous 200.
- [ ] **Step 2:** run — Expected: new/changed tests FAIL. **Step 3: implement.** **Step 4:** `npm --prefix app-worker test && npm --prefix app-worker run typecheck` — Expected: PASS. **Step 5: Commit** `feat(app-worker): async submit, attempt resume and name uniqueness`.

### Task 6: Rate limiting

**Files:** Create `app-worker/src/limits.ts`, `app-worker/test/limits.test.ts`; modify `src/routes/student.ts`, `src/routes/syntax.ts`.

**Interfaces:** `allow(limiter: RateLimit, key: string): Promise<boolean>` (`(await limiter.limit({ key })).success`). Keys: `RL_START` by `CF-Connecting-IP` on `POST attempts`; `RL_SYNTAX` by IP on `/api/syntax-check`; `RL_ACTION` by `attemptId` on `run`, `submit`, `retry`. A denied call answers `429 { detail: "Too many requests, slow down." }` before any other work. If Task 1 recorded the binding as unavailable, implement `allow` over `AttemptDO` counters (add `hit(window: string, limit: number, nowMs: number): Promise<boolean>`) and keep the same call sites.

- [ ] **Step 1: failing tests:** `allow_maps_the_binding_outcome`; `start_is_429_when_the_limiter_denies_and_creates_no_attempt`; `syntax_check_is_429_when_denied_and_never_reaches_the_grader`; `run_submit_retry_are_429_keyed_by_attempt_id` (assert the key passed to the fake limiter).
- [ ] **Step 2–4:** run (FAIL), implement, `npm --prefix app-worker test` (PASS). **Step 5: Commit** `feat(app-worker): rate limit student endpoints`.

### Task 7: Turnstile on attempt start (skip if Task 1 spike B failed)

**Files:** Create `app-worker/src/turnstile.ts`, `app-worker/test/turnstile.test.ts`; modify `src/routes/student.ts`.

**Interfaces:** `verifyTurnstile(env: Pick<Env,"TURNSTILE_SECRET"|"TURNSTILE_HOSTNAMES">, token: string | undefined, ip: string | null): Promise<boolean>` — POST form `secret`, `response`, `remoteip` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`; true only when `success === true` and the answer's `hostname` is in `TURNSTILE_HOSTNAMES`; a missing token, a missing secret or any fetch error is false (fail closed). `POST attempts` answers 400 `{ detail: "Please complete the verification." }` when false. Local/dev uses Cloudflare's always-pass test keys.

- [ ] **Step 1: failing tests** (stub `fetch`): `true_for_success_with_an_allowed_hostname`; `false_for_wrong_hostname`; `false_when_success_is_false`; `false_without_a_token_or_secret_and_without_calling_fetch`; `false_when_fetch_throws`; `start_is_400_on_failed_verification_and_creates_no_attempt`.
- [ ] **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat(app-worker): Turnstile check when a student starts an attempt`.

### Task 8: UI for async grading, resume and Turnstile

**Files:** Modify `app-ui/src/api.js`, `app-ui/src/pages/ExamPage.jsx`, `app-ui/test/ExamPage.test.jsx`, `app-ui/test/api.test.js`; create `app-ui/src/components/TurnstileWidget.jsx`.

**Interfaces:** `api.js`: `startAttempt(token, studentName, turnstileToken)`, `resumeAttempt(token, attemptId)`, `getQuestionStatus(token, attemptId, problemId)`, `retryQuestion(token, attemptId, problemId)`; `submitQuestion` now resolves `{ status: "queued" }`. `TurnstileWidget({ siteKey, onToken })` loads `https://challenges.cloudflare.com/turnstile/v0/api.js` once and calls `onToken(token)`. `ExamPage`: loads the exam summary; name gate shows the widget (start disabled until a token); on start it stores `{ attemptId, receipt }` in `localStorage` key `exam:<token>`; on load with a stored attempt it calls `resumeAttempt` and continues with `remaining_seconds` (Timer `durationSeconds`); a 404 on resume clears the stored key. Submit then polls `getQuestionStatus` every 2 s (stop on `done`/`failed`, give up after 5 minutes with a message that the score will appear in the receipt lookup); `failed` shows the error and a "Chấm lại" button calling `retryQuestion`; `done` renders `ResultPanel` with the status result. The "Đã lưu" 409 handling and timer auto-submit stay.

- [ ] **Step 1: failing tests:** `start_needs_a_turnstile_token_and_sends_it`; `start_stores_the_attempt_and_a_reload_resumes_with_server_remaining_seconds` (Review Focus 3); `resume_404_clears_storage_and_shows_the_name_gate`; `submit_polls_until_done_then_shows_score_and_feedback` (fake timers); `failed_status_shows_the_error_and_retry_requeues_and_polls_again`; `polling_gives_up_after_five_minutes_with_a_message`; `name_taken_409_shows_the_receipt_hint`; `429_shows_a_slow_down_message`; plus the Phase 1b tests that still apply (tabs keep code, timer expiry submits once, no test values in the DOM).
- [ ] **Step 2–4:** FAIL, implement, `npm --prefix app-ui test && npm --prefix app-ui run build` (PASS). **Step 5: Commit** `feat(app-ui): async grading, resume and Turnstile`.

### Task 9: Teacher results show grading state

**Files:** Modify `app-worker/src/db/attempts.ts` (`listResults`), `app-worker/test/student.test.ts` (or a new `results_status.test.ts`), `app-ui/src/pages/ExamResultsPage.jsx`, `app-ui/test/Teacher.test.jsx`.

**Interfaces:** each result question gains `status: "none"|"queued"|"grading"|"done"|"failed"` (still one query for all attempts, joining `grading_jobs`). UI cell: score when `done`, `…` when `queued`/`grading`, `lỗi chấm` when `failed`, `—` when `none`.

- [ ] **Step 1: failing tests:** API returns the status per question in one query (use `countingDb`, still ≤ 6 prepares); UI renders the four cell states. **Step 2–4:** FAIL, implement, PASS. **Step 5: Commit** `feat: teacher results show the grading state`.

### Task 10: Deploy, docs, smoke test

**Files:** Modify `app-worker/README.md`, `docs/roadmap.md`. Steps marked **(live)** touch Cloudflare or need the author.

- [ ] **Step 1: full local check:** `.venv/bin/python -m pytest -q && npm --prefix app-worker test && npm --prefix app-worker run typecheck && npm --prefix app-ui test && npm --prefix app-ui run build` — Expected: all PASS.
- [ ] **Step 2 (live): secrets and vars:** `wrangler secret put TURNSTILE_SECRET`; set `TURNSTILE_SITE_KEY` and `TURNSTILE_HOSTNAMES` (`teacher-app.khangnguyen.workers.dev`) in `wrangler.jsonc` vars.
- [ ] **Step 3: open the PR** and check CI is green; merging deploys through GitHub Actions. If the deploy fails on permissions, the CI token lacks Queues/R2/Durable Objects edit: the author recreates it (Edit Cloudflare Workers + D1, Queues, R2, Turnstile) and replaces the repository secret.
- [ ] **Step 4 (live): smoke test and record the evidence in the README:** start an attempt in a private window (Turnstile passes), refresh and resume, submit one question and watch `queued -> done`, read the audit object (`npx wrangler r2 object get teacher-app-audit/audit/<submission_id>.json --remote`), hit the start endpoint more than 5 times a minute to see a 429.
- [ ] **Step 5:** update the README (queue, DO, R2, limits, Turnstile, the deviation "no dead-letter queue") and the roadmap (T6.3 checked, anything skipped noted); commit `docs: teacher app Phase 2 runbook and roadmap`.
