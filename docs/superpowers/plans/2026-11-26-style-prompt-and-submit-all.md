# Style prompt fix and one-shot exam submit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Correct code is no longer marked down on code style just because it has no comments. (2) A student submits the whole exam once; all questions are graded in parallel and the results appear together with the total.

**Architecture:** (1) Only the `code_style` and `feedback` prompts change, measured before and after on the live model with the dataset's correct, uncommented submissions. (2) One new endpoint `POST .../attempts/:attemptId/submit` stores a submission and a queued job for every question in one D1 batch and enqueues them together; the per-question submit route is removed; the UI has a single "Nộp bài" button with a confirm step and a progress view.

**Tech Stack:** Python (prompts, pytest), Hono Worker + D1 + Queues + Durable Object, React UI, vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md`; decisions approved by the author on 2026-11-26 (see conversation): comments/docstrings/type hints are optional for style; one "Nộp bài" for all questions; unanswered questions submit the starter code and score 0; no merging of questions into one LLM call (one prompt per dimension per question stays, `CLAUDE.md`).

## Global Constraints

- "Free plan only, $0 budget, workers.dev hostname." Workers AI budget is counted per graded question (about 100 per day).
- Non-correctness dimensions stay small, independent, schema-constrained LLM calls; the final score stays a fixed weighted sum in Python; correctness only from the sandbox (`CLAUDE.md`). Do not change schemas or `aggregator.py`.
- Students never see test inputs or expected values. Scores stay append-only.
- Keep `pytest`, `npm --prefix app-worker test`, `npm --prefix app-ui test` green (baseline 141 + 129 + 44). Branch `feat/style-prompt-and-submit-all`; commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Style: correct code with no comments scores a clean/acceptable style level on the live model, while genuinely poor code (bad names, no structure) still scores low (Task 1 measurement).
2. Submit all: a retried or double-clicked submit never creates a second set of submissions, and a half-failed enqueue leaves every question recoverable (Task 2).
3. Timer expiry and "Nộp bài" at the same moment submit exactly once; the UI never sends a second submit (Task 3).
4. A student with blank or partly answered questions can still submit; blank ones score 0 and cost no LLM budget (Task 2).
5. After submit the editors are read-only and a reload resumes in the "submitted, grading" view with the right progress (Task 3).

## File Structure

| Path | Responsibility |
|---|---|
| `prompts/code_style.txt`, `prompts/feedback.txt` (modify) | explicit "comments optional" rules |
| `tests/test_prompts.py` (create) | the prompts state the rule |
| `app-worker/src/db/jobs.ts`, `src/routes/student.ts` (modify) | batch insert, `submit` endpoint, remove per-question submit |
| `app-worker/src/db/attempts.ts` (modify) | `submitted` flag on resume |
| `app-worker/test/student.test.ts`, `jobs_db.test.ts`, `test/helpers.ts` (modify) | tests for the new flow |
| `app-ui/src/api.js`, `src/pages/ExamPage.jsx`, `test/ExamPage.test.jsx`, `test/api.test.js` (modify) | single submit, progress and summary |
| `app-worker/README.md`, `docs/report/results.md` (modify) | docs and the prompt-change note |

---

### Task 1: Style prompt (and feedback prompt) without a comments penalty

**Files:** Modify `prompts/code_style.txt`, `prompts/feedback.txt`; create `tests/test_prompts.py`. The live measurement uses a throwaway script in the scratchpad, not committed.

**Interfaces:** `check_code_style(client, submission_code)` and `StyleCheck.level` are unchanged. The new `code_style` prompt must keep the `{submission_code}` placeholder and the instruction to answer with the required JSON only, and must state: comments, docstrings and type hints are optional and must never lower the level; judge only naming, structure and formatting. The feedback prompt gains one line: do not criticise missing comments or docstrings unless the logic is hard to follow without them.

- [ ] **Step 1: Failing test** in `tests/test_prompts.py`: `test_code_style_prompt_says_comments_are_optional` (the loaded prompt text contains "comments" and "optional" and `{submission_code}`), `test_code_style_prompt_still_formats` (`.format(submission_code="x = 1")` works, no stray braces), `test_feedback_prompt_does_not_ask_for_comments`.
- [ ] **Step 2:** `.venv/bin/python -m pytest tests/test_prompts.py -q` — Expected: FAIL.
- [ ] **Step 3: Measure BEFORE** (throwaway script): for every problem in `data/problems.py` take the first submission (correct, uncommented in the dataset), run the **current** prompt with `LLMClient(base_url=<Workers AI OpenAI endpoint>, model="@cf/qwen/qwen2.5-coder-32b-instruct", api_key=<token>, seed=1)` once each at temperature 0 and record the level; also run 3 genuinely poor submissions (dataset samples labelled poor style). If the Workers AI call cannot be made with the available token, record that and skip the measurement (the test and prompt change still ship, flagged as unmeasured).
- [ ] **Step 4: Edit the prompts**, rerun Step 2 (PASS), then **measure AFTER** the same way. Expected: the correct uncommented samples move to clean or acceptable; poor samples stay poor or acceptable-at-best. Paste the before/after table into `docs/report/results.md` under a new "Style prompt change (2026-11-26)" note that also says the earlier consistency and ablation numbers were measured with the previous prompt.
- [ ] **Step 5:** `.venv/bin/python -m pytest -q` — Expected: PASS. Commit `fix(prompts): comments are optional for code style` (create the branch first: `git switch -c feat/style-prompt-and-submit-all`).

### Task 2: One-shot submit endpoint

**Files:** Modify `app-worker/src/db/jobs.ts`, `src/db/attempts.ts`, `src/routes/student.ts`, `test/helpers.ts`, `test/student.test.ts`, `test/jobs_db.test.ts`.

**Interfaces:**
- Produces `insertSubmissionsWithJobs(db, a: { attemptId: string; items: { problemId: string; code: string }[] }): Promise<string[]>` in `db/jobs.ts` (one batch of N submissions + N queued jobs; any UNIQUE conflict rolls back everything and throws `AlreadySubmitted`; returns submission ids in input order).
- Route `POST /api/exam/:token/attempts/:attemptId/submit` body `{ answers: { [problemId]: string } }`: rate limit `RL_ACTION` by attempt id first; then token, attempt, `closed`/clock checks as `questionContext` does (reuse it split into a code-free guard); each key must be one of the exam's problem ids (else 400) and each value a string of at most 20,000 chars (else 400); a missing or empty answer becomes that problem's `starter_code`; any existing submission for the attempt → 409 "Already submitted"; `claim("__exam__", now)` false → 409 "A submission is already in progress"; insert all in one batch (`AlreadySubmitted` → 409, other error → release and rethrow); then `GRADING_QUEUE.sendBatch` of one message per submission; a throwing send answers 503 and leaves every job queued (the per-question `/retry` recovers them once stuck). Success: `202 { status: "queued", problem_ids: string[] }`.
- Remove the per-question `POST …/questions/:problemId/submit` route. Keep `run`, `status`, `retry`.
- `GET …/attempts/:attemptId` (resume) gains `submitted: boolean` (any question has a submission); start answers `submitted: false`.

- [ ] **Step 1: Failing tests** (rewrite the submit-based tests to the new flow; `submit` helper becomes `submitAll(token, attempt, answers?, c?)`): `submit_all_stores_every_question_and_enqueues_one_message_each_in_one_call`; `unanswered_and_empty_answers_use_the_starter_code`; `a_blank_question_scores_zero_without_an_llm_call` (a blank answer's grade request body `code` equals the starter code; with the real pipeline a stub scores 0 — assert via the fake grader recording the call and the consumer storing the returned score); `second_submit_is_409_and_creates_no_second_set` and `concurrent_double_submit_one_202_one_409` (count `submissions` rows == question count); `unknown_problem_id_or_oversized_code_is_400_and_nothing_is_stored`; `submit_after_time_or_on_a_closed_exam_is_403`; `queue_send_failure_is_503_all_jobs_queued_and_each_question_retries_once_stuck`; `a_storage_error_after_the_claim_releases_it`; `rate_limited_submit_is_429_before_any_work` (key = attempt id); `resume_reports_submitted_and_per_question_status`; `the_old_per_question_submit_route_is_gone` (404). In `jobs_db.test.ts`: `batch_insert_creates_n_jobs_and_rolls_back_on_a_conflict`. Update the receipt/results/total tests to submit both questions together (the total is null until both are graded).
- [ ] **Step 2:** `npm --prefix app-worker test` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** as specified (no per-question loops over D1; one batch, one `sendBatch`).
- [ ] **Step 4:** `npm --prefix app-worker test && npm --prefix app-worker run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(app-worker): submit the whole exam once`.

### Task 3: UI with one "Nộp bài" button and a progress/summary view

**Files:** Modify `app-ui/src/api.js`, `app-ui/src/pages/ExamPage.jsx`, `app-ui/test/ExamPage.test.jsx`, `app-ui/test/api.test.js`.

**Interfaces:** `api.js`: remove `submitQuestion`, add `submitExam(token, attemptId, answers)` → `{ status: "queued", problem_ids }`. `ExamPage`: no per-question Submit; a single "Nộp bài" button (header area, always visible while not submitted) that first shows an inline confirm ("Nộp bài? Sau khi nộp không thể sửa." with "Xác nhận nộp" and "Hủy"); on confirm it sends all current codes in one call, marks every question `queued` and polls each question's status as before; editors become read-only; the "Run Tests" button stays per question until submitted. While grading show "Đã chấm X/N câu"; when all are done show a summary box with the total ("Tổng điểm: …", from `getAttemptByReceipt`) and the per-question tabs show each result. Timer expiry calls the same submit once (guard with a ref shared with the button). On reload `resumeAttempt` returning `submitted: true` goes straight to the submitted view (read-only, polling the non-done questions). A 409 from submit ("already submitted/in progress") is treated as submitted: switch to the submitted view and poll. Keep per-question "Chấm lại" for failed/stuck jobs.

- [ ] **Step 1: Failing tests:** `there_is_no_per_question_submit_button`; `nop_bai_asks_for_confirmation_then_sends_every_answer_in_one_call` (answers keyed by problem id, current editor text for edited questions, starter code for untouched); `cancel_keeps_the_exam_open`; `after_submit_editors_are_read_only_and_run_tests_is_disabled`; `progress_counts_graded_questions_then_shows_the_total_and_each_result`; `timer_expiry_submits_once_and_a_late_click_does_not_send_a_second_submit` (Review Focus 3); `a_409_on_submit_switches_to_the_submitted_view`; `a_reload_with_submitted_true_resumes_the_submitted_view_and_polls` (Review Focus 5); `a_network_error_on_submit_keeps_the_exam_open_and_allows_another_try`; keep the retry/stuck/permanent-failure/Turnstile/resume tests, adapted to the new submit step. `api.test.js`: `submitExam_posts_the_answers_map_to_the_exam_submit_path`.
- [ ] **Step 2:** `npm --prefix app-ui test` — Expected: FAIL. **Step 3: Implement.** **Step 4:** `npm --prefix app-ui test && npm --prefix app-ui run build` — Expected: PASS. **Step 5: Commit** `feat(app-ui): one Nộp bài button with progress and a results summary`.

### Task 4: Docs, PR, deploy

**Files:** Modify `app-worker/README.md` (API line for submit-all, remove per-question submit, note the style prompt rule), `docs/roadmap.md` (one line). Steps marked **(live)** use GitHub/Cloudflare.

- [ ] **Step 1:** full local check: `.venv/bin/python -m pytest -q && npm --prefix app-worker test && npm --prefix app-worker run typecheck && npm --prefix app-ui test && npm --prefix app-ui run build` — Expected: all PASS.
- [ ] **Step 2:** update the docs, commit `docs: one-shot submit and the style prompt rule`.
- [ ] **Step 3 (live):** push, open the PR, wait for CI; merge only when the author asks; merging triggers the Deploy workflow, which applies no new migration (none is added).
