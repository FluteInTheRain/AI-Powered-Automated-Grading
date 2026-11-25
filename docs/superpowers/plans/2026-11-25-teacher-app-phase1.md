# Teacher App — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed TypeScript Worker (`app-worker/`) where a teacher logs in through Cloudflare Access, picks or authors questions, creates a multi-question exam, and a student can start an attempt and submit code that is graded synchronously by the existing Python Worker, with scores stored as append-only revisions. API only; no UI.

**Architecture:** New Hono-on-Workers app with its own D1. It calls the existing `worker/` Python Worker through a service binding at new token-gated stateless endpoints (`/api/internal/*`) that wrap `grade()`, `rules.preview()` and `rules.validate_new_problem()` unchanged. The demo's routes and D1 stay as they are.

**Tech Stack:** TypeScript, Hono, jose (Access JWT), D1, vitest + `@cloudflare/vitest-pool-workers`, wrangler; Python 3.13 FastAPI on the existing Python Worker; pytest.

**Spec:** `docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md` (Phase 1 of section 9). Phases 2–4 (Queues, Durable Object, R2, Turnstile, appeals, Workflows, Cron, AI Gateway, UI) get their own plans.

## Global Constraints

- "Free plan only, $0 budget, workers.dev hostname." Never move to Workers Paid; a product with no usable free tier is dropped and noted.
- Correctness comes only from sandbox execution; non-correctness dimensions are small schema-constrained LLM calls; the final score is a fixed weighted sum in Python; no agent framework in the grading path (`CLAUDE.md`). Do not touch `src/grader/*` behaviour.
- "Scores are append-only revisions" — never `UPDATE` or `DELETE` a score row. "Submissions are immutable once written."
- Student-facing responses never include hidden test inputs or expected values.
- The Python `worker/` demo routes keep working; `pytest` (whole repo) stays green, including `tests/test_route_parity.py`.
- Code comments in English. Paths in this plan are relative to the repo root. Work on branch `feat/teacher-app-phase1`.
- End every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not copy `DEV_AUTH_BYPASS` into any deployed config (`wrangler.jsonc`); it lives only in `app-worker/.dev.vars` (gitignored).

## Review Focus

1. Student code never terminates or kills the sandbox: grader returns 502, nothing is persisted, the student can retry (Task 9).
2. Exam deadline already passed: starting an attempt and submitting are both rejected with 403 (Task 9).
3. Teacher A asks for teacher B's exam or private problem: 404, never 403 or data (Tasks 7, 8).
4. Guessing a receipt code or student token: uniform 404; no hidden expected values in any student response (Task 9).
5. Same student double-submits one question concurrently: exactly one wins, the other gets 409 (Task 9); weights that are zero, negative or non-finite, a duplicate question in one exam, a student name over 100 chars and code over 20,000 chars are rejected with 400 (Tasks 8, 9).

## File Structure

| Path | Responsibility |
|---|---|
| `worker/src/app/routes.py` (modify) | Add `/api/internal/{grade,preview,validate-problem}` and the token dependency |
| `tests/worker/test_internal.py` (create) | Tests for those endpoints |
| `app-worker/wrangler.jsonc`, `package.json`, `tsconfig.json`, `vitest.config.ts` | Worker config and tooling |
| `app-worker/src/index.ts` | Exports `createApp()` default fetch handler |
| `app-worker/src/env.ts` | `Env`, `Teacher` types |
| `app-worker/src/ids.ts` | `newToken`, `newReceiptCode`, `newId` |
| `app-worker/src/auth.ts` | Access JWT verification + `requireTeacher` middleware |
| `app-worker/src/grader.ts` | Typed client of the Python Worker's internal endpoints |
| `app-worker/src/scoring.ts` | `computeTotal` |
| `app-worker/src/routes/{teacher_problems,teacher_exams,student}.ts` | HTTP routes |
| `app-worker/src/db/*.ts` | D1 queries, one file per entity group |
| `app-worker/migrations/0001_init.sql` | Schema + append-only triggers |
| `scripts/export_bank_seed.py` (create), `app-worker/seed/bank.sql` (generated) | Bank seed from `data/problems.py` |
| `app-worker/README.md` | Deploy runbook |

## API contract (used by several tasks)

Internal (Python Worker, header `X-Internal-Token`, all under `/api/internal/`):
- `POST grade` body `{statement, func_name, rubric, hidden_cases:[{args,expected,is_public}], code}` → `200 {result, call_log}` where `result` is the dict `submit_exam` stores today (incl. `feedback`).
- `POST preview` body = `PreviewRequest` → the dict `rules.preview` returns.
- `POST validate-problem` body = `CreateProblemRequest` → `200 {"ok": true}` or `400 {detail}`.

Public (`app-worker`): teacher routes under `/api/teacher/*` require Access; student routes under `/api/exam/*` do not.
`GET /api/teacher/bank`, `GET|POST /api/teacher/problems`, `POST /api/teacher/problems/preview`, `POST|GET /api/teacher/exams`, `GET|PATCH /api/teacher/exams/:id`, `GET /api/teacher/exams/:id/results`; `GET /api/exam/:student_token`, `POST /api/exam/:student_token/attempts`, `POST /api/exam/:student_token/attempts/:attempt_id/questions/:problem_id/submit`, `GET /api/exam/:student_token/attempts/by-receipt/:receipt_code`.

---

### Task 1: Python Worker — token-gated `/api/internal/grade`

**Files:**
- Modify: `worker/src/app/routes.py` (add after `submit_exam`; reuse `get_llm_client`, `get_sandbox`, `_sandbox_http_error`, `GRADING_FAILED`)
- Create: `tests/worker/test_internal.py`

**Interfaces:**
- Produces: `POST /api/internal/grade` as in the API contract; dependency `async def require_internal_token(request: Request) -> None` (401 unless header `X-Internal-Token` equals `request.scope["env"].INTERNAL_TOKEN` by `secrets.compare_digest`; missing/empty env token also 401); `class InternalGradeRequest(BaseModel)` in `routes.py` with the five fields above.
- The route is under `/api/` because `worker/wrangler.jsonc` sets `run_worker_first: ["/api/*"]`; other paths go to the static assets handler.

- [ ] **Step 1: `git switch -c feat/teacher-app-phase1`; write failing tests** in `tests/worker/test_internal.py`, building the app like `make_client` in `tests/worker/test_routes.py` but **without** overriding `routes.get_db` (so any DB use raises) and with `app.dependency_overrides[routes.require_internal_token]` only in the authorized tests:
  - `test_grade_without_token_is_401` / `test_grade_wrong_token_is_401` (real dependency, env token `"s3cret"`, header absent / `"nope"`)
  - `test_grade_returns_result_and_call_log`: POST `PROBLEM`'s statement/func_name/rubric, `hidden_cases=[CASES[1]]`, code `REF` → 200, `body["result"]["final_score_0_to_100"]` is a number, `len(body["call_log"]) >= 1`, `body["result"]["feedback"]` present.
  - `test_grade_never_touches_db`: same request succeeds with no `get_db` override.
  - `test_grade_killed_sandbox_is_502_time_limit`: `SwitchBinding.killed = True` → 502, detail contains "time/resource".
  - `test_grade_ai_failure_is_502_fixed_text`: `FakeAI(fail=True)` → 502, detail == `routes.GRADING_FAILED`.
- [ ] **Step 2: Run** `python3 -m pytest tests/worker/test_internal.py -v` — Expected: FAIL (route/dependency missing).
- [ ] **Step 3: Implement** the model, dependency and route in `routes.py`. Body mirrors `submit_exam` (build sample with `rules.build_submit_sample`, `grade(...)`, then best-effort `generate_feedback` with `result["feedback"] = None` on failure, same error mapping) but takes inputs from the request body and returns `{"result": result, "call_log": client.call_log}`; it must not depend on `get_db`.
- [ ] **Step 4: Run** `python3 -m pytest tests/worker -v` — Expected: all PASS (existing tests unchanged).
- [ ] **Step 5: Commit** `git add worker/src/app/routes.py tests/worker/test_internal.py && git commit -m "feat(worker): token-gated stateless /api/internal/grade"`

### Task 2: Python Worker — `/api/internal/preview` and `/api/internal/validate-problem`

**Files:** Modify `worker/src/app/routes.py`; Test: `tests/worker/test_internal.py`

**Interfaces:**
- Consumes: `require_internal_token` (Task 1), `rules.preview`, `rules.validate_new_problem`, `PreviewRequest`, `CreateProblemRequest`.
- Produces: the two endpoints in the API contract.

- [ ] **Step 1: Add failing tests** (same app builder): `test_preview_returns_cases_and_requires_token`; `test_validate_ok_for_good_problem` (`PROBLEM` shape → `{"ok": true}`); `test_validate_rubric_not_100_is_400` (detail "Rubric weights must sum to 100"); `test_validate_all_public_is_400`; `test_validate_killed_sandbox_is_502`.
- [ ] **Step 2: Run** `python3 -m pytest tests/worker/test_internal.py -v` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** both routes as thin wrappers copying the error handling of `preview_test_cases` and `create_problem` (ValueError → 400 with `str(e)`; sandbox errors via `_sandbox_http_error`); no DB, no insert.
- [ ] **Step 4: Run** `python3 -m pytest -q` (whole repo) — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(worker): internal preview and validate-problem endpoints"` (add new files first).

### Task 3: `app-worker/` scaffold with a tested `/health`

**Files:** Create `app-worker/{package.json,tsconfig.json,wrangler.jsonc,vitest.config.ts,.gitignore,src/index.ts,src/env.ts,src/ids.ts,test/health.test.ts,test/ids.test.ts}`; modify root `.gitignore` only if `app-worker/node_modules/` is not covered.

**Interfaces:**
- Produces: `export type Env = { DB: D1Database; GRADER: Fetcher; INTERNAL_TOKEN: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; DEV_AUTH_BYPASS?: string }`; `export type Teacher = { id: string; email: string }`; `export function createApp(deps?: { keyResolver?: JWTVerifyGetKey }): Hono<{ Bindings: Env; Variables: { teacher: Teacher } }>` in `src/index.ts` (default export `{ fetch }` of `createApp()`); `newToken(): string` (32 hex from `crypto.getRandomValues`), `newReceiptCode(): string` (10 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), `newId(): string` (`crypto.randomUUID()` without dashes) in `src/ids.ts`.
- `wrangler.jsonc`: name `teacher-app`, `compatibility_date` `2026-11-01`, `d1_databases` binding `DB` (`database_name` `teacher-app`, `migrations_dir` `migrations`), `services` binding `GRADER` → service `grading`, `observability.enabled` true, vars `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` (placeholders until Task 10). No `DEV_AUTH_BYPASS`.

- [ ] **Step 1: Write failing tests**: `health.test.ts` — `SELF.fetch("https://x/health")` → 200 `{ ok: true }`; `ids.test.ts` — `newToken()` matches `/^[0-9a-f]{32}$/` and 1000 calls are unique; `newReceiptCode()` matches `/^[A-HJ-NP-Z2-9]{10}$/`.
- [ ] **Step 2: Install and run**: `cd app-worker && npm init -y` then `npm i hono jose` and `npm i -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types` (use the vitest version that `@cloudflare/vitest-pool-workers` lists in its `peerDependencies`); configure vitest as that package's README says (`wrangler.configPath`, migrations applied in a setup file once Task 4 exists). `npx vitest run` — Expected: FAIL.
- [ ] **Step 3: Implement** `src/*` and set `package.json` scripts `test` = `vitest run`, `typecheck` = `tsc --noEmit`.
- [ ] **Step 4: Run** `cd app-worker && npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git add app-worker && git commit -m "feat(app-worker): scaffold Hono Worker with health route"` (do not add `node_modules`).

### Task 4: D1 schema with append-only triggers

**Files:** Create `app-worker/migrations/0001_init.sql`, `app-worker/test/schema.test.ts`; modify vitest setup to apply migrations before each test file.

**Interfaces:** Produces the tables other tasks read/write (ids `TEXT`, timestamps ISO-8601 UTC `TEXT`, JSON columns `TEXT`):
- `teachers(id PK, email UNIQUE NOT NULL, created_at)`
- `problems(id PK, owner_teacher_id NULL REFERENCES teachers, visibility CHECK IN ('system','private'), statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code, created_at)`
- `exams(id PK, teacher_id NOT NULL REFERENCES teachers, title, student_token UNIQUE, deadline NULL, time_limit_seconds INTEGER, created_at)`
- `exam_questions(exam_id, problem_id, position INTEGER, weight REAL, PRIMARY KEY(exam_id, problem_id))`
- `attempts(id PK, exam_id, student_name, receipt_code UNIQUE, started_at)`
- `submissions(id PK, attempt_id, problem_id, code, submitted_at, UNIQUE(attempt_id, problem_id))`
- `score_revisions(id PK, submission_id, revision INTEGER, source CHECK IN ('ai','teacher'), score REAL, sub_scores, detail, author, reason NULL, created_at, UNIQUE(submission_id, revision))`
- `grading_logs(id PK, submission_id, call_index, kind, schema_name NULL, model, system_prompt, user_prompt, raw_response, created_at)`
- Triggers: `BEFORE UPDATE` and `BEFORE DELETE` on `score_revisions` and on `submissions` → `RAISE(ABORT, '<table> is append-only')`.

- [ ] **Step 1: Write failing tests** in `schema.test.ts`: `test_score_revision_update_is_rejected` and `test_score_revision_delete_is_rejected` (insert one revision, `UPDATE`/`DELETE` rejects with "append-only"); `test_submission_update_is_rejected`; `test_duplicate_revision_number_is_rejected`; `test_duplicate_attempt_problem_submission_is_rejected`; `test_visibility_check_rejects_unknown_value`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (no tables).
- [ ] **Step 3: Write the migration** as specified.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(app-worker): D1 schema with append-only score and submission triggers"`

### Task 5: Cloudflare Access login middleware

**Files:** Create `app-worker/src/auth.ts`, `app-worker/src/db/teachers.ts`, `app-worker/test/auth.test.ts`; modify `src/index.ts` to mount `requireTeacher` on `/api/teacher/*` and add `GET /api/teacher/me` → `{ id, email }`.

**Interfaces:**
- Consumes: `Env`, `Teacher`, `createApp(deps)`.
- Produces: `requireTeacher: MiddlewareHandler` (sets `c.set("teacher", Teacher)`; 401 `{detail:"Not signed in"}` on any failure); `upsertTeacher(db: D1Database, email: string): Promise<Teacher>` (same email → same id, case-insensitive: store lower-case).
- Verification: header `Cf-Access-Jwt-Assertion`; `jose.jwtVerify` with issuer `https://${ACCESS_TEAM_DOMAIN}`, audience `ACCESS_AUD`, keys from `createRemoteJWKSet(new URL("https://" + ACCESS_TEAM_DOMAIN + "/cdn-cgi/access/certs"))` unless `deps.keyResolver` is given (tests); identity = `email` claim. Bypass: only if `env.DEV_AUTH_BYPASS === "1"`, the teacher email is the header `X-Dev-Teacher`.

- [ ] **Step 1: Write failing tests** (generate an RSA keypair with `jose.generateKeyPair`, inject `keyResolver`): `test_valid_token_returns_me`; `test_expired_token_401`; `test_wrong_audience_401`; `test_wrong_issuer_401`; `test_missing_header_401`; `test_dev_header_ignored_when_bypass_off`; `test_dev_header_accepted_when_bypass_on`; `test_first_login_creates_teacher_second_reuses_row` (count rows == 1); `test_email_case_insensitive`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces; never log the token.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(app-worker): Cloudflare Access JWT login middleware"`

### Task 6: Typed grader client

**Files:** Create `app-worker/src/grader.ts`, `app-worker/test/grader.test.ts`

**Interfaces:**
- Produces: `class GraderError extends Error { status: number; detail: string }`; `gradeQuestion(env: Pick<Env,"GRADER"|"INTERNAL_TOKEN">, input: GradeInput): Promise<GradeOutput>`; `previewProblem(env, body: unknown): Promise<unknown>`; `validateProblem(env, body: unknown): Promise<void>` (400 → throws `GraderError` with the Worker's `detail`). `GradeInput = { statement; func_name; rubric: Record<string,number>; hidden_cases: {args: unknown[]; expected: unknown; is_public: boolean}[]; code }`, `GradeOutput = { result: { final_score_0_to_100: number; sub_scores_0_to_1: Record<string,number>; execution_result: { pass_count: number; total: number; status: string; errors?: string[] }; check_details: unknown; feedback: unknown }; call_log: LogEntry[] }`, `LogEntry = { kind: string; schema?: string; model: string; system_prompt: string; user_prompt: string; raw_response: string }`.
- Calls `env.GRADER.fetch("https://grader/api/internal/<name>", { method: "POST", headers: {"content-type": "application/json", "X-Internal-Token": env.INTERNAL_TOKEN}, body })`.

- [ ] **Step 1: Write failing tests** with a fake `{ fetch }` binding recording the request: `sends_token_and_json_to_internal_grade`; `returns_parsed_output_on_200`; `non_200_throws_GraderError_with_status_and_detail` (502 `{detail:"Grading failed…"}`); `network_error_becomes_GraderError_502`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the three functions over one private `post(env, name, body)` helper.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(app-worker): typed client for the Python grading Worker"`

### Task 7: Question bank and teacher problems

**Files:** Create `scripts/export_bank_seed.py`, `tests/test_export_bank_seed.py`, `app-worker/seed/bank.sql` (generated, committed), `app-worker/src/db/problems.ts`, `app-worker/src/routes/teacher_problems.ts`, `app-worker/test/problems.test.ts`; mount the routes in `src/index.ts`.

**Interfaces:**
- Consumes: `requireTeacher`, `previewProblem`, `validateProblem`, `GraderError`, `newId`.
- Produces: `listBank(db)`, `listOwnProblems(db, teacherId)`, `getVisibleProblem(db, teacherId, problemId): Promise<Problem|null>` (system problems or ones the teacher owns), `insertProblem(db, teacherId, p)`; routes `GET /api/teacher/bank` → `[{id, statement, func_name, rubric}]` (never `reference_solution`/`test_cases`), `GET /api/teacher/problems` (own only), `POST /api/teacher/problems/preview` (proxy), `POST /api/teacher/problems` (body = `CreateProblemRequest` shape; calls `validateProblem` first, 400 passes the detail through, then inserts as `private`, returns `{id}`; `GraderError` status ≥ 500 → 502 `"Grading service error, please try again."`).
- Seed rules in `export_bank_seed.py` (writes `INSERT OR REPLACE` statements, ids `bank:<problem id>`, `visibility='system'`, `owner_teacher_id` NULL): reference solution = the first submission's code in `data/problems.py`; `param_names` parsed with `ast` from that code's `def`; test cases `{args, expected, is_public}` with only the first case public (all hidden if there is one case); `starter_code` from the same template as `rules.starter_code`; the script exits non-zero if any reference fails its own cases (checked with `grader.sandbox`) or a rubric does not sum to 100.

- [ ] **Step 1: Write failing tests.** Python (`tests/test_export_bank_seed.py`): `test_seed_has_16_problems_with_valid_rubrics`, `test_every_reference_passes_its_cases`, `test_at_least_one_hidden_case_each`, `test_param_names_match_def`. TS (`problems.test.ts`): `bank_lists_system_problems_without_secrets` (response JSON has no `reference_solution`/`test_cases` keys), `teacher_sees_only_own_private_problems`, `create_problem_calls_validate_then_inserts`, `create_problem_validation_400_is_passed_through_and_not_inserted`, `grader_outage_is_502_fixed_text`, `other_teachers_private_problem_is_404_via_getVisibleProblem`.
- [ ] **Step 2: Run** `python3 -m pytest tests/test_export_bank_seed.py -v` and `cd app-worker && npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** the script (run `python3 scripts/export_bank_seed.py` to write `app-worker/seed/bank.sql`), the db module and routes. Never hand-edit `bank.sql`.
- [ ] **Step 4: Run** both suites — Expected: PASS.
- [ ] **Step 5: Commit** `git add scripts tests app-worker && git commit -m "feat(app-worker): question bank seed and teacher problem routes"`

### Task 8: Teacher exams

**Files:** Create `app-worker/src/db/exams.ts`, `app-worker/src/routes/teacher_exams.ts`, `app-worker/test/exams.test.ts`; mount in `src/index.ts`.

**Interfaces:**
- Consumes: `getVisibleProblem`, `newToken`, `requireTeacher`.
- Produces: `POST /api/teacher/exams` body `{ title: string (1–120 chars), deadline?: ISO string, time_limit_seconds?: number (default 600), questions: {problem_id: string, weight?: number}[] }` → `{ id, student_token, student_path: "/exam/<token>" }`. Rules: ≥1 question; no duplicate `problem_id`; every problem visible to the teacher (else 404 `"Unknown problem_id: …"`); weight default 1, must be finite and > 0 (else 400); positions follow array order. `GET /api/teacher/exams` (own only, newest first); `GET /api/teacher/exams/:id` (questions with title excerpt and weight; 404 if not the teacher's); `PATCH /api/teacher/exams/:id` body `{deadline: string|null}`.

- [ ] **Step 1: Write failing tests:** `create_exam_with_two_questions_defaults_equal_weight`; `create_exam_rejects_empty_duplicate_zero_negative_and_nan_weights` (table-driven, all 400); `create_exam_with_other_teachers_private_problem_is_404`; `bank_problem_allowed`; `get_other_teachers_exam_is_404`; `list_returns_only_own_exams`; `patch_deadline_sets_and_clears`; `student_token_is_32_hex_and_unique`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** — insert exam and `exam_questions` in one `db.batch`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(app-worker): teacher exam routes with weighted questions"`

### Task 9: Student attempt, synchronous grading, scores

**Files:** Create `app-worker/src/scoring.ts`, `app-worker/src/db/attempts.ts`, `app-worker/src/routes/student.ts`, `app-worker/test/scoring.test.ts`, `app-worker/test/student.test.ts`; mount in `src/index.ts`.

**Interfaces:**
- Consumes: `gradeQuestion`, `GraderError`, `newId`, `newReceiptCode`, the tables of Task 4.
- Produces: `computeTotal(items: { weight: number; score: number }[]): number` = Σ(weight·score)/Σ(weight) rounded to 2 decimals (0 for an empty list).
- Routes (see API contract):
  - `GET /api/exam/:student_token` → `{ title, deadline, questions: [{ problem_id, position, weight, statement, starter_code, public_cases: [{args, expected}] }] }`; no hidden cases, no reference solution.
  - `POST …/attempts` body `{ student_name }` (1–100 chars) → `{ attempt_id, receipt_code }`; closed exam (`deadline` ≤ now) → 403 `"This exam is closed"`.
  - `POST …/attempts/:attempt_id/questions/:problem_id/submit` body `{ code }` (1–20,000 chars): 404 if the attempt does not belong to this exam or the problem is not in it; 403 if closed; 409 `"Already submitted"` if a submission exists; else call `gradeQuestion` with the problem's hidden cases, then **in one `db.batch`** insert the submission, `score_revisions` row `revision 0, source 'ai', author 'pipeline'` (`score` = `final_score_0_to_100`, `sub_scores` = `sub_scores_0_to_1`, `detail` = whole `result`), and one `grading_logs` row per `call_log` entry. Response: `{ problem_id, score, sub_scores, tests: { passed, total }, feedback }` — never `execution_result.errors`. Grader failure → 502 (`GraderError.detail` if it is a time-limit message, otherwise `"Grading service error, please try again."`) and nothing persisted.
  - `GET …/attempts/by-receipt/:receipt_code` → `{ student_name, questions: [{ problem_id, score|null, feedback|null }], total: number|null }`; each score is the latest revision; `total` is `null` until every question has a submission.
  - `GET /api/teacher/exams/:id/results` (teacher-owned only, else 404) → `[{ attempt_id, student_name, started_at, questions: [{problem_id, score|null}], total|null }]`.

- [ ] **Step 1: Write failing tests** with a fake `GRADER` binding: `scoring.test.ts` — `computeTotal([{weight:1,score:80},{weight:3,score:60}]) === 65`, empty → 0, single item → its score. `student.test.ts` — `student_exam_view_has_no_hidden_cases_or_reference`; `attempt_then_submit_stores_submission_revision0_and_logs` (counts 1/1/n); `submit_response_contains_no_expected_values` (stringified body lacks the hidden case's expected value and the word `"expected"`); `second_submit_same_question_is_409`; `concurrent_double_submit_one_200_one_409` (`Promise.all`); `closed_exam_rejects_attempt_and_submit_403`; `grader_502_persists_nothing_and_allows_retry` (retry after a fake success returns 200); `attempt_from_other_exam_is_404`; `unknown_student_token_and_receipt_are_404`; `name_over_100_and_code_over_20000_are_400`; `total_is_null_until_all_questions_submitted_then_weighted`; `teacher_results_only_for_own_exam`; `latest_revision_wins` (insert a `teacher` revision 1 directly; by-receipt shows its score).
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.** The 409 comes from the `UNIQUE(attempt_id, problem_id)` constraint inside the batch (catch it), not from a read-then-write check.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(app-worker): student attempts with synchronous grading and score revisions"`

### Task 10: Deploy, Access setup, runbook, roadmap

**Files:** Create `app-worker/README.md`; modify `docs/roadmap.md` (add "Phase 6 — Teacher app on Cloudflare" with T6.1 = this plan's Phase 1, check items as they are verified), `worker/README.md` (note the internal endpoints and `INTERNAL_TOKEN`), `app-worker/wrangler.jsonc` (real `database_id`, Access vars). Steps marked **(user)** need the author's Cloudflare login or dashboard; the executing agent prepares commands and stops there.

- [ ] **Step 1 (user): Create the D1 database** `cd app-worker && npx wrangler d1 create teacher-app`; put the printed `database_id` in `wrangler.jsonc`.
- [ ] **Step 2: Apply schema and seed remotely:** `npx wrangler d1 migrations apply teacher-app --remote` then `npx wrangler d1 execute teacher-app --remote --file seed/bank.sql`. Verify: `npx wrangler d1 execute teacher-app --remote --command "SELECT count(*) FROM problems WHERE visibility='system'"` → 16.
- [ ] **Step 3 (user): Set one random value as `INTERNAL_TOKEN` on both Workers:** `(cd worker && uv run pywrangler secret put INTERNAL_TOKEN)` and `(cd app-worker && npx wrangler secret put INTERNAL_TOKEN)`.
- [ ] **Step 4 (user): Deploy** the Python Worker (`./sandbox-worker/build.sh && ./worker/build.sh && (cd worker && uv run pywrangler deploy)`), then `cd app-worker && npx wrangler deploy`.
- [ ] **Step 5 (user): Protect the teacher paths with Access** in the Zero Trust dashboard: create a Self-hosted application for the `teacher-app` workers.dev hostname with path `/api/teacher/*`, policy "emails: the author's address" using One-time PIN; copy the Application Audience (AUD) tag and the team domain into `wrangler.jsonc` vars, redeploy. Also record in the README whether the Free plan's user/app limits were confirmed in the docs.
- [ ] **Step 6: Smoke test and record the evidence** in `app-worker/README.md`: unauthenticated `curl https://teacher-app.<subdomain>.workers.dev/api/teacher/me` → 302/401; after signing in through the browser, `/api/teacher/me` → teacher JSON; create an exam from the bank, start an attempt and submit a known-good solution with `curl`, then read it back by receipt code → total 100 (or the model's real score; paste what happened); `curl -X POST …/api/internal/grade` on the `grading` Worker without the token → 401. Note the Python endpoint is publicly reachable but token-gated (the spec wanted service-binding-only; recorded as a deviation with the reason: the `grading` Worker has a public workers.dev URL and assets routing).
- [ ] **Step 7: Run everything** `python3 -m pytest -q && (cd app-worker && npm test && npm run typecheck)` — Expected: PASS; update the roadmap; commit `git commit -m "docs: teacher app phase 1 runbook and roadmap"`.
