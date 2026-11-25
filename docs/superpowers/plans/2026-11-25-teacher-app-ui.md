# Teacher App — UI (Phase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser UI for the deployed `teacher-app`: teachers list/create multi-question exams from the bank and read results; students take a multi-question exam with the existing look (Monaco editor, timer, test runs, score + AI feedback) and can look their score up by receipt code.

**Architecture:** A new React + Vite SPA (`app-ui/`) built to static files and served by the existing `teacher-app` Worker through Workers Static Assets (static requests cost no Worker CPU and have no script-size limit). Existing components and `index.css` are copied so the look is unchanged. Three small API additions in `app-worker` (public-test run, syntax check, richer student exam view) plus one stateless endpoint in the Python Worker back them.

**Tech Stack:** React 18.3, Vite, react-router-dom (library mode), `@monaco-editor/react`, `react-markdown`, vitest + jsdom + Testing Library; Hono Worker + D1 (existing); Python FastAPI Worker (existing).

**Spec:** `docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md` (UI is "left to the builder"); stack decision made with the author on 2026-11-25: React + Vite static assets, Hono backend, no Next.js (OpenNext vs the 3 MiB Free limit, SSR CPU on a 10 ms budget).

## Global Constraints

- "Free plan only, $0 budget, workers.dev hostname." Never move to Workers Paid.
- The UI looks like the current `frontend/`: copy `frontend/src/index.css` unchanged and reuse the same class names, component structure and Vietnamese strings; no new CSS framework.
- Students never see hidden or public test inputs/expected values (the old UI shows counts only); the AI never decides scores (`CLAUDE.md` rules unchanged).
- Do not edit `frontend/` (the demo's UI still ships from `worker/`). Do not touch `src/grader/*` behaviour.
- `pytest` and `npm --prefix app-worker test` stay green. Code comments in English. Work on branch `feat/teacher-app-ui`; end commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Python tests run with `.venv/bin/python -m pytest`; the UI tests with `npm --prefix app-ui test`.

## Review Focus

1. Teacher's Access session expires while the page is open: the API call gets a cross-origin redirect; the UI must reload to the login, not fail silently (Task 3 test).
2. Student refreshes or closes the tab mid-exam: the attempt is lost in the browser but the server clock runs; the receipt code must be on screen from the moment the attempt starts so the student can look scores up (Task 4 test).
3. Timer expires with unsubmitted questions: each is auto-submitted exactly once; a 409 "Already submitted" is treated as done, not as an error (Task 4 test).
4. Unknown/closed exam link or network failure: a readable message, never a blank page (Task 4 test).
5. Public/hidden test inputs and expected values never appear in the student DOM (Task 4 test).

## File Structure

| Path | Responsibility |
|---|---|
| `worker/src/app/routes.py` (modify) | `POST /api/internal/run` |
| `tests/worker/test_internal.py` (modify) | tests for it |
| `app-worker/src/grader.ts` (modify), `src/routes/student.ts` (modify), `src/index.ts` (modify) | run-tests route, syntax-check route, richer exam view |
| `app-worker/wrangler.jsonc` (modify) | `assets` binding to `../app-ui/dist` |
| `app-ui/package.json`, `vite.config.js`, `index.html`, `src/main.jsx` | SPA shell and routes |
| `app-ui/src/index.css`, `src/components/{CodeEditor,Timer,TestRunPanel}.jsx` | copied unchanged from `frontend/` |
| `app-ui/src/components/ResultPanel.jsx` | copied, adapted to the new result shape |
| `app-ui/src/api.js` | fetch client (the only module that calls `fetch`) |
| `app-ui/src/pages/{ExamPage,TeacherHomePage,ExamResultsPage}.jsx` | the three pages |
| `app-ui/test/*.test.jsx` | vitest tests |

## API contract used by the UI

Student (`/api/exam/:token/...`, no login), after Task 2:
- `GET ""` → `{ title, deadline, time_limit_seconds, is_closed, questions: [{ problem_id, position, weight, statement, starter_code, rubric, public_case_count, hidden_case_count }] }` (no `public_cases` array any more).
- `POST attempts {student_name}` → `{ attempt_id, receipt_code }`.
- `POST attempts/:attemptId/questions/:problemId/run {code}` → `{ status, message, cases: [{ passed, error }] }` (public cases only, same shape `TestRunPanel` already reads).
- `POST attempts/:attemptId/questions/:problemId/submit {code}` → `{ problem_id, score, sub_scores, tests: { passed, total }, feedback }`.
- `GET attempts/by-receipt/:receipt` → `{ student_name, questions: [{ problem_id, score, feedback }], total }`.
- `POST /api/syntax-check {code}` → `{ ok: true }` or `{ ok: false, message, line }`.

Teacher (`/api/teacher/*`, behind Access): `GET me|bank|exams`, `POST exams {title, deadline?, time_limit_seconds?, questions:[{problem_id, weight?}]}`, `GET exams/:id`, `GET exams/:id/results`, `PATCH exams/:id {deadline}`.

---

### Task 1: Python Worker — `/api/internal/run`

**Files:** Modify `worker/src/app/routes.py` (next to the other internal endpoints); Test `tests/worker/test_internal.py`

**Interfaces:**
- Consumes: `require_internal_token`, `get_sandbox`, `rules.run_response`, `_sandbox_http_error`.
- Produces: `POST /api/internal/run` body `{ code: str, func_name: str, cases: [{args, expected, is_public}] }` → `rules.run_response(sandbox.run_submission_cases(code, func_name, [(tuple(args), expected) ...]))` over the given cases (the caller sends only public ones). Stateless, no DB. Killed sandbox → 502 "Your code exceeded the time/resource limit."

- [ ] **Step 1: Failing tests** (same app builder as the other internal tests): `test_run_requires_token` (401); `test_run_returns_pass_fail_per_case_without_values` (code `REF`, cases `[CASES[0]]` → 200, `cases == [{"passed": True, "error": None}]`, response text contains no `"expected"`); `test_run_reports_failures` (wrong code → `passed: False`); `test_run_killed_sandbox_is_502`.
- [ ] **Step 2:** `.venv/bin/python -m pytest tests/worker/test_internal.py -q` — Expected: new tests FAIL (404).
- [ ] **Step 3: Implement** `internal_run(req: InternalRunRequest, sandbox=Depends(get_sandbox))` with `class InternalRunRequest(BaseModel)`; mirror the sandbox-error mapping of `run_exam_tests` in this file.
- [ ] **Step 4:** `.venv/bin/python -m pytest -q` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(worker): internal run endpoint for public tests` (switch to `feat/teacher-app-ui` first: `git switch -c feat/teacher-app-ui`).

### Task 2: `app-worker` — run, syntax check, richer exam view, assets binding

**Files:** Modify `app-worker/src/grader.ts`, `src/routes/student.ts`, `src/index.ts`, `src/db/attempts.ts`, `wrangler.jsonc`; Test `app-worker/test/student.test.ts` (modify), `app-worker/test/syntax.test.ts` (create)

**Interfaces:**
- Consumes: `gradeQuestion` pattern in `grader.ts`, `toClientError`, the closed/time-limit checks in `submit`.
- Produces: `runCases(env, input: { code: string; func_name: string; cases: TestCase[] }): Promise<{ status: string; message: string | null; cases: { passed: boolean; error: string | null }[] }>` (posts to `/api/internal/run`); `checkSyntax(env: Pick<Env,"GRADER">, code: string): Promise<unknown>` (posts to the grader's existing public `/api/syntax-check`, no token); routes `POST /api/exam/:token/attempts/:attemptId/questions/:problemId/run` and `POST /api/syntax-check`; the exam view of the API contract. `wrangler.jsonc` gains `"assets": { "directory": "../app-ui/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/health"] }`.
- `run` applies the same checks as `submit` except the 409 (404 unknown token/attempt/question, 403 closed, 403 "Time limit exceeded", 400 code not 1-20000 chars) and sends only the problem's public cases. `/api/syntax-check`: 400 unless `code` is a string of at most 20,000 chars.

- [ ] **Step 1: Failing tests:** in `student.test.ts` replace the old `public_cases` assertion with: exam view has `rubric`, `public_case_count: 1`, `hidden_case_count: 1`, `time_limit_seconds: 600`, `is_closed: false` per the contract, and its text contains neither `PUBEXP` nor `HIDDENEXP`; add `run_sends_only_public_cases_and_returns_the_grader_body`, `run_after_time_limit_is_403`, `run_closed_exam_is_403`, `run_unknown_attempt_is_404`, `run_grader_502_is_passed_through_as_fixed_text`. `syntax.test.ts`: `forwards_code_and_returns_the_grader_answer`, `rejects_non_string_and_over_20000_chars_with_400` (grader fake records no call).
- [ ] **Step 2:** `npm --prefix app-worker test` — Expected: new/changed tests FAIL. If the vitest plugin fails on the missing assets directory, add script `"pretest": "mkdir -p ../app-ui/dist"` in `app-worker/package.json`.
- [ ] **Step 3: Implement** the functions/routes above, reusing one shared guard for `run` and `submit` (do not copy the checks); update `getExamByStudentToken` consumers so `is_closed` is computed with the injected `now`.
- [ ] **Step 4:** `npm --prefix app-worker test && npm --prefix app-worker run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(app-worker): public-test run, syntax check and richer student exam view`.

### Task 3: `app-ui` scaffold, copied look, API client

**Files:** Create `app-ui/{package.json,vite.config.js,index.html,.gitignore}`, `app-ui/src/{main.jsx,api.js,index.css}`, `app-ui/src/components/{CodeEditor,Timer,TestRunPanel,ResultPanel}.jsx`, `app-ui/test/{api.test.js,ResultPanel.test.jsx}`

**Interfaces:**
- Produces `app-ui/src/api.js` named exports (all return parsed JSON, throw `Error(detail)` on non-2xx): `getExam(token)`, `startAttempt(token, studentName)`, `runTests(token, attemptId, problemId, code)`, `submitQuestion(token, attemptId, problemId, code)`, `getAttemptByReceipt(token, receipt)`, `checkSyntax(code)`, `getMe()`, `listBank()`, `listExams()`, `createExam(body)`, `getExamDetail(id)`, `getResults(id)`, `updateDeadline(id, deadline)`. Calls use `redirect: "manual"`; an `opaqueredirect` response calls `window.location.reload()` and throws `Error("Session expired, reloading")`. Non-JSON error bodies keep the old friendly text from `frontend/src/api.js`.
- `ResultPanel({ result })` now reads `{ score, sub_scores, tests: { passed, total }, feedback }` and renders the same markup as `frontend/src/components/ResultPanel.jsx` minus the per-case error list (no `execution_result.errors`). `CodeEditor`, `Timer`, `TestRunPanel` are byte-identical copies; `CodeEditor` imports `checkSyntax` from `../api.js` and must debounce syntax calls at 1000 ms (was 500) to spare the Free request budget.
- `src/main.jsx` routes with react-router-dom: `/exam/:token` → `ExamPage`, `/teacher` → `TeacherHomePage`, `/teacher/exams/:id` → `ExamResultsPage`, `/` → redirect to `/teacher`. `vite.config.js`: react plugin, dev proxy `/api` → `http://localhost:8787`, vitest env `jsdom`.
- Deps: `react@18.3`, `react-dom`, `react-router-dom`, `@monaco-editor/react`, `react-markdown`; dev: `vite`, `@vitejs/plugin-react`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.

- [ ] **Step 1: Failing tests:** `api.test.js` (stub `fetch`): `startAttempt posts the name to the right path`, `non-2xx throws the detail text`, `non-JSON error body gives the friendly message`, `opaqueredirect reloads the page and throws` (Review Focus 1; stub `window.location.reload`). `ResultPanel.test.jsx`: renders `94.0 / 100`, `3/3`, the feedback summary and an issue's "Gợi ý sửa", and never renders a list of per-case errors.
- [ ] **Step 2:** `npm --prefix app-ui test` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the scaffold, copies and `api.js`; `index.html` is the old one with title "AI-Powered Automated Grading".
- [ ] **Step 4:** `npm --prefix app-ui test && npm --prefix app-ui run build` — Expected: tests PASS, `app-ui/dist/index.html` exists.
- [ ] **Step 5: Commit** `feat(app-ui): scaffold with the existing look and an API client`.

### Task 4: Student `ExamPage` (multi-question)

**Files:** Create `app-ui/src/pages/ExamPage.jsx`, `app-ui/test/ExamPage.test.jsx`

**Interfaces:**
- Consumes: Task 3's `api.js`, `CodeEditor`, `Timer`, `TestRunPanel`, `ResultPanel`.
- Produces `ExamPage()` reading `:token` from the route. Phases like the old page (`loading | closed | name_gate | in_progress | done | error`) plus a receipt lookup on the name gate. Layout as the old page: header with title and `Timer`; problem panel (`ReactMarkdown` statement, rubric chips, the "N public / M hidden test case(s)" note); question tabs ("Câu 1", "Câu 2"…) above the editor, each keeping its own code, run result and submit result; per-question "Run Tests" and "Submit". The receipt code is shown (with a note to keep it) as soon as the attempt starts. Timer duration = `min(time_limit_seconds, seconds until deadline)`; on expiry every unsubmitted question is submitted once with its current code. When all are submitted show the total (`computeTotal` is server-side: fetch `getAttemptByReceipt` and show `total`).

- [ ] **Step 1: Failing tests** (mock `../src/api.js`; mock `@monaco-editor/react` as a `<textarea>`): `name_gate_requires_a_name_before_start`; `start_creates_an_attempt_and_shows_the_receipt_code_immediately` (Review Focus 2); `submit_sends_code_for_the_selected_question_and_shows_score_and_feedback`; `run_tests_shows_pass_fail_counts`; `switching_tabs_keeps_each_questions_code`; `timer_expiry_submits_each_unsubmitted_question_exactly_once_and_treats_409_as_done` (fake timers; Review Focus 3); `all_submitted_shows_the_total`; `closed_exam_shows_the_closed_message`; `unknown_token_and_network_error_show_a_readable_message` (Review Focus 4); `no_test_inputs_or_expected_values_in_the_dom` (Review Focus 5: API mocks carry `PUBEXP`/`HIDDENEXP` strings that must not appear); `receipt_lookup_shows_per_question_scores_and_total`.
- [ ] **Step 2:** `npm --prefix app-ui test` — Expected: FAIL.
- [ ] **Step 3: Implement** `ExamPage` using the old `frontend/src/pages/ExamPage.jsx` as the structural base (same class names: `app app-wide`, `solve-grid`, `name-gate`, `submit-row`, `status-line`).
- [ ] **Step 4:** `npm --prefix app-ui test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(app-ui): multi-question student exam page`.

### Task 5: Teacher pages

**Files:** Create `app-ui/src/pages/TeacherHomePage.jsx`, `app-ui/src/pages/ExamResultsPage.jsx`, `app-ui/test/Teacher.test.jsx`

**Interfaces:**
- Consumes: `api.js` teacher functions.
- Produces: `TeacherHomePage()` — header with the signed-in email (`getMe`), "Your exams" list (title, deadline, student link `window.location.origin + student_path` with a copy button, link to `/teacher/exams/:id`), and a create form (`teacher-section`, `field-row`): title, deadline (`datetime-local`), time limit in minutes (default 10), bank questions as checkboxes with statement excerpt and a weight input (default 1); submit disabled until a title and at least one question; on success the new exam's link is shown. `ExamResultsPage()` — like `AdminResultsPage`: exam title, student link, deadline field with "Lưu hạn chót" and "Đóng ngay" (`updateDeadline`), status chip, and a `results-table` with student, one score column per question (`—` when null), total and start time. No Excel export and no audit trail yet (Phase 3).

- [ ] **Step 1: Failing tests:** `home_lists_own_exams_with_student_links`; `create_form_is_disabled_until_title_and_a_question_are_chosen`; `create_posts_title_minutes_as_seconds_deadline_iso_and_weighted_questions`; `create_error_message_is_shown`; `results_table_shows_scores_dashes_for_missing_and_the_total`; `save_deadline_and_close_now_call_updateDeadline` (close now sends a past ISO time).
- [ ] **Step 2:** `npm --prefix app-ui test` — Expected: FAIL.
- [ ] **Step 3: Implement** both pages with the old class names (`app`, `app-header`, `teacher-section`, `field-row`, `admin-controls`, `results-table`, `status-chip`).
- [ ] **Step 4:** `npm --prefix app-ui test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(app-ui): teacher exam list, creation and results pages`.

### Task 6: Build, Access for the pages, deploy, runbook

**Files:** Modify `app-worker/README.md`, `docs/roadmap.md`, root `.gitignore` if `app-ui/node_modules/` and `app-ui/dist/` are not covered. Steps marked **(user)** need something only the author has.

- [ ] **Step 1: Full local check:** `.venv/bin/python -m pytest -q && npm --prefix app-worker test && npm --prefix app-ui test && npm --prefix app-ui run build` — Expected: all PASS.
- [ ] **Step 2: Deploy the Python Worker first** (new `/api/internal/run`): `DEMO_EXAM_PATH=/exam/Gj4_eCLot4LOiksK_JMf-w ./worker/build.sh && (cd worker && uv run pywrangler deploy)`.
- [ ] **Step 3: Protect the teacher pages.** The Access application `teacher-app (teacher API)` currently covers only `/api/teacher/*`; add `teacher-app.khangnguyen.workers.dev/teacher/*` as a second destination (Cloudflare API `PUT /accounts/<id>/access/apps/<app id>` with an API token that has Access: Apps and Policies edit; **(user)** supply the token via `CLOUDFLARE_API_TOKEN`; the app id is `2374ba00-719a-42c6-a416-4e4aa0bd3057`). Without this the `/teacher` pages load without a login (the API still refuses).
- [ ] **Step 4: Deploy** `npm --prefix app-ui run build && (cd app-worker && npx wrangler deploy)`.
- [ ] **Step 5: Live smoke test and record the result in `app-worker/README.md`:** `/teacher` without a session -> 302 to the Access login; `/health` -> 200; `/exam/00000000000000000000000000smoke1` serves the SPA (HTTP 200, `<div id="root">`); **(user)** open `/teacher` signed in, create an exam from the bank, open its student link in a private window, solve one question, read the score back by receipt code.
- [ ] **Step 6:** Update `docs/roadmap.md` (new "T6.2b UI" item) and the README API/UI sections; commit `docs: teacher app UI runbook and roadmap`.
