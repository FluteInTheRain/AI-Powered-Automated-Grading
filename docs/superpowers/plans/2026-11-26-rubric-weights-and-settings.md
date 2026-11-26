# Per-exam Rubric Weights and Teacher Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the author chose inline execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A teacher sets four criterion weights per exam (default from their Settings), and grading uses them.

**Architecture:** Nullable `exams.rubric` JSON snapshot plus `teachers.settings` JSON. Effective rubric is `exam.rubric ?? problem.rubric`, read in the grading job and in the student payload. A shared validator is used by problems, settings and exams. New Settings page in the SPA.

**Tech Stack:** Hono on Workers, D1, vitest with `@cloudflare/vitest-plugin`; React, vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-26-rubric-weights-and-settings-design.md`

## Global Constraints

- Rubric keys exactly `correctness, efficiency, code_style, edge_case_handling`; non-negative integers; sum > 0.
- `exams.rubric` NULL means "use each problem's own rubric" (existing exams keep today's behaviour).
- Weights are set at exam creation only; there is no endpoint that edits them afterwards.
- Scores stay append-only; no existing score is touched. LLM never computes the final score.
- Code comments in English; UI copy in Vietnamese; follow the existing visual language (flat, `index.css` tokens).
- Baselines to keep green: app-worker 134 tests, app-ui 55 tests, pytest unchanged.

## Review Focus

- A teacher-default rubric is saved, then the teacher creates an exam without sending `rubric`: the exam must still get that default (and a teacher with no default gets NULL).
- A bank problem used by two exams with different weights: each grading job must use its own exam's weights, and the bank problem row must stay unchanged.
- Old exam (NULL rubric) must grade and display exactly as before.
- `{correctness: 0, ...}` with all zeros, a negative, a float, a missing or an extra key must be rejected with 400 for settings and for exam creation.
- Settings page: invalid total (0) disables Save; a failed save shows the error and keeps the typed values.

---

### Task 1: Migration, shared rubric validator, settings API

**Files:**
- Create: `app-worker/migrations/0003_rubric_settings.sql`, `app-worker/src/rubric.ts`, `app-worker/src/routes/teacher_settings.ts`, `app-worker/test/settings.test.ts`
- Modify: `app-worker/src/routes/teacher_problems.ts` (use the shared validator), `app-worker/src/db/teachers.ts`, `app-worker/src/index.ts`

**Interfaces:**
- Produces: `RUBRIC_KEYS: string[]`; `parseRubric(v: unknown): Record<string, number> | string` (string = error message); `type TeacherSettings = { default_rubric?: Record<string, number>; default_time_limit_seconds?: number }`; `getSettings(db, teacherId): Promise<TeacherSettings>`; `putSettings(db, teacherId, s: TeacherSettings): Promise<void>`; routes `GET /api/teacher/settings` -> `TeacherSettings` and `PUT /api/teacher/settings` (body `TeacherSettings`, replies the saved value).

- [ ] **Step 1: Write failing tests** in `settings.test.ts`: `GET` for a new teacher returns `{}`; `PUT {default_rubric:{correctness:50,efficiency:20,code_style:20,edge_case_handling:10}, default_time_limit_seconds:1800}` then `GET` returns the same; each of these `PUT`s answers 400: all-zero rubric, negative value, float value, missing key, extra key, `default_time_limit_seconds` of 0 or 1.5; one teacher's settings are invisible to another; the existing problems tests (bad rubric -> 400) still pass.
- [ ] **Step 2: Run** `cd app-worker && npx vitest run test/settings.test.ts` and expect FAIL (404 route).
- [ ] **Step 3: Implement.** Migration adds `ALTER TABLE teachers ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'` and `ALTER TABLE exams ADD COLUMN rubric TEXT`. `parseRubric` enforces the Global Constraints; `teacher_problems.ts` calls it instead of its inline check (keep its error text assertions passing). `getSettings` parses the JSON column; `putSettings` stores a validated object only. Mount the routes after `teacherExamRoutes` in `index.ts`.
- [ ] **Step 4: Run** the whole `app-worker` suite (`npx vitest run`) and expect all pass, plus `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(app-worker): teacher settings API and shared rubric validator`.

### Task 2: Exam rubric at creation and in grading

**Files:**
- Modify: `app-worker/src/routes/teacher_exams.ts`, `app-worker/src/db/exams.ts`, `app-worker/src/db/jobs.ts`, `app-worker/src/db/attempts.ts`
- Test: `app-worker/test/exams.test.ts`, `app-worker/test/jobs_db.test.ts`, `app-worker/test/student.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseRubric`, `getSettings`.
- Produces: `POST /api/teacher/exams` accepts optional `rubric` (400 via `parseRubric`); omitted -> teacher's `default_rubric`, else NULL; `ExamRow.rubric: string | null`; exam detail JSON gains `rubric: Record<string, number> | null` (the stored snapshot, null when each problem's own applies); `getSubmissionBundle(...)` returns `problem.rubric` already replaced by the exam rubric when set; the student exam payload `questions[].rubric` is `exam.rubric ?? problem.rubric`.

- [ ] **Step 1: Write failing tests:** explicit rubric stored and returned in detail; teacher default applied when omitted; no default -> `rubric: null`; invalid rubric forms from the Review Focus -> 400; two exams on the same bank problem with different rubrics: `getSubmissionBundle` for a submission in each returns the matching rubric and the `problems` row is unchanged; student exam payload shows the exam rubric, and a NULL-rubric exam still shows the problem rubric; a queue-processed job (existing fake grader) receives the exam rubric in the `grade` call body.
- [ ] **Step 2: Run** the three files and expect FAIL.
- [ ] **Step 3: Implement.** `insertExam` takes `rubric: Record<string, number> | null` and stores `JSON.stringify` or NULL. Resolve in the route: body rubric, else `(await getSettings(...)).default_rubric ?? null`. `getSubmissionBundle` additionally selects the exam rubric through `submissions -> attempts -> exams` and overrides `problem.rubric`. `getExamByStudentToken` selects `e.rubric` and uses `COALESCE`-style resolution in code so `questions[].rubric` is the effective rubric.
- [ ] **Step 4: Run** the full `app-worker` suite and `npx tsc --noEmit`; expect all pass.
- [ ] **Step 5: Commit** `feat(app-worker): per-exam rubric weights used by grading and the student view`.

### Task 3: Settings page and rubric in the exam form

**Files:**
- Create: `app-ui/src/pages/SettingsPage.jsx`, `app-ui/src/components/RubricFields.jsx`, `app-ui/test/Settings.test.jsx`
- Modify: `app-ui/src/api.js` (`getSettings`, `putSettings`, and `createExam` already takes a body), `app-ui/src/main.jsx` (route `/teacher/settings`), `app-ui/src/pages/TeacherHomePage.jsx`, `app-ui/src/pages/ExamResultsPage.jsx`, `app-ui/src/index.css`, `app-ui/test/Teacher.test.jsx`

**Interfaces:**
- Produces: `<RubricFields value={Record<string,string>} onChange(next) />` renders four labelled number inputs (labels "Đúng sai (correctness)", "Hiệu năng", "Phong cách code", "Trường hợp biên"), the live percentage next to each and the total; `isValidRubric(value): boolean` exported from the same file (all non-negative integers, sum > 0); a header link "Cài đặt" on both teacher pages.

- [ ] **Step 1: Write failing tests:** `SettingsPage` loads saved values, shows percentages (50/20/20/10 -> 50%, 20%, 20%, 10%), Save is disabled when the total is 0, a successful save calls `putSettings` with integers and shows "Đã lưu", a failed save shows the error and keeps the typed values; `TeacherHomePage` pre-fills the exam form's weights and minutes from settings, sends `rubric` and `time_limit_seconds` in `createExam`, and still creates an exam when settings are empty (fields then start at 60/15/15/10 and 10 minutes); `ExamResultsPage` shows the exam's weights read-only when `rubric` is non-null and says weights follow each problem when null.
- [ ] **Step 2: Run** `cd app-ui && npx vitest run` and expect FAIL on the new tests only.
- [ ] **Step 3: Implement** the page, the shared component and the wiring; keep existing accessible names so the 55 current tests pass; use existing classes (`field-row`, `btn`, `top`, `wrap`) and add only the small CSS needed (percentage column).
- [ ] **Step 4: Run** `npx vitest run` and `npx vite build`; expect all pass. Look at the page with the mock-fetch harness used for the UI redesign (light and phone width) and remove the harness afterwards.
- [ ] **Step 5: Commit** `feat(app-ui): Settings page and per-exam rubric weights`.

### Task 4: Docs, review, ship

**Files:** Modify `app-worker/README.md` (API list, Known limits: weights fixed after creation), `README.md` and `README.vi.md` only if they list teacher features, `docs/roadmap.md`.

- [ ] **Step 1:** Update the docs; verify every path and anchor mentioned exists.
- [ ] **Step 2:** Run all suites (`pytest`, `app-worker`, `app-ui`) and expect baselines plus the new tests.
- [ ] **Step 3:** One independent review of the whole branch diff against the spec (opus subagent, absolute worktree path and base `origin/main`); verify each finding before fixing it test-first.
- [ ] **Step 4:** Push, open the PR, wait for CI, wait for the author's "merge"; after the Deploy workflow, confirm that migration 0003 was applied on the live D1 and `/health` is 200.
