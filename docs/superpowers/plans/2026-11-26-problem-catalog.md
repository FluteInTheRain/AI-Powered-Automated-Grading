# Problem Catalog (titles, categories, difficulty, filter, sort) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the author chose inline execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every problem has a short title, a category and a difficulty, and the exam form picks questions through a searchable, filterable, sortable list.

**Architecture:** Three nullable columns on `problems` (migration 0004, backfilled), bank metadata kept in `data/problems.py` and written by the seed script as a metadata-only upsert, the API returns and validates the fields, and a client-side `ProblemPicker` filters and sorts.

**Tech Stack:** Python (seed script, pytest), Hono on Workers + D1 (vitest), React (vitest).

**Spec:** `docs/superpowers/specs/2026-11-26-problem-catalog-design.md`

## Global Constraints

- `difficulty` is exactly `easy | medium | hard`; `title` 1-80 chars; `category` 1-40 chars (free text).
- Code comments and data in English; UI copy in Vietnamese (difficulty labels: Dễ, Vừa, Khó).
- Never hand-edit `data/dataset.json` or `app-worker/seed/bank.sql`; `data/dataset.json` must stay byte-identical after `python3 data/build_dataset.py`.
- The seed must never rewrite a bank problem's statement, tests or rubric (exams reference them); it only refreshes title, category and difficulty on rows that exist.
- Baselines: pytest 144 passed / 2 skipped, app-worker 165, app-ui 65.

## Review Focus

- Re-running the seed on a database that already has exams using the bank problems must not fail or change statements, tests or rubrics.
- A problem created before this change (no title) still lists with a sensible title, category `Other`, difficulty `medium`.
- `POST /problems` rejects a missing or over-long title, a missing or over-long category, an unknown difficulty, and non-string values.
- Filtering to zero results shows an empty state, not a broken list; chosen questions and their weights survive any filter, search or sort change.
- Search ignores case and accents' absence (plain case-insensitive substring is enough) and trims spaces; sort is stable and does not change which problems are chosen.

---

### Task 1: Bank metadata and the seed upsert

**Files:**
- Modify: `data/problems.py` (add `title`, `category`, `difficulty` to the 16 problems), `scripts/export_bank_seed.py`, `tests/test_export_bank_seed.py`
- Regenerate: `app-worker/seed/bank.sql`

**Interfaces:**
- Produces: `build_rows()` rows gain `title: str`, `category: str`, `difficulty: str`; `render_sql(rows)` writes `INSERT INTO problems (... , title, category, difficulty) VALUES (...) ON CONFLICT(id) DO UPDATE SET title = excluded.title, category = excluded.category, difficulty = excluded.difficulty;` (no more `INSERT OR REPLACE`).

Bank values (title, category, difficulty): P01 Two Sum, Arrays & Search, medium; P02 Is Prime, Math, easy; P03 Reverse a String, Strings, easy; P04 Binary Search, Arrays & Search, medium; P05 Fibonacci, Math, easy; P06 Sum of Digits, Math, easy; P07 Palindrome Check, Strings, easy; P08 FizzBuzz, Basics, easy; P09 Count Vowels, Strings, easy; P10 Valid Anagram, Strings, medium; P11 Caesar Cipher, Strings, medium; P12 Valid Parentheses, Data Structures, medium; P13 Merge Sorted Lists, Arrays & Search, medium; P14 Factorial, Math, easy; P15 GCD (Euclid), Math, medium; P16 Power, Math, medium.

- [ ] **Step 1: Write failing tests** in `tests/test_export_bank_seed.py`: every row has a title of 1-80 chars, a category of 1-40 chars and a difficulty in the allowed set, titles are unique, the five expected categories are all used; the SQL loads into a schema made from migrations `0001`, `0002`, `0003` and `0004` (read from `app-worker/migrations`), and loading it twice is idempotent; after the first load, an `UPDATE problems SET statement = 'CHANGED' WHERE id = 'bank:P01_two_sum'` followed by a second load leaves `statement` as `CHANGED` while title, category and difficulty are restored to the seed values (proves metadata-only upsert); the old `test_sql_loads_into_the_real_schema_twice` is updated to use all four migrations.
- [ ] **Step 2: Run** `python3 -m pytest tests/test_export_bank_seed.py -q` and expect FAIL (KeyError / missing migration file).
- [ ] **Step 3: Implement.** Add the three keys to each problem in `data/problems.py` (values above, a `# metadata for the teacher app question bank` comment once). `build_rows` copies them and validates them against the Global Constraints (raise `ValueError` otherwise). `render_sql` uses the upsert described in Interfaces. Create `app-worker/migrations/0004_problem_catalog.sql` now as part of this task (adds the three nullable columns and the backfill `UPDATE problems SET title = substr(trim(replace(statement, char(10), ' ')), 1, 60), category = 'Other', difficulty = 'medium' WHERE title IS NULL`), because the test loads it. Regenerate with `python3 scripts/export_bank_seed.py`.
- [ ] **Step 4: Run** `python3 -m pytest tests/test_export_bank_seed.py -q`, then the whole `python3 -m pytest -q` (expect 144 passed / 2 skipped plus the new tests), then `python3 data/build_dataset.py && git diff --stat data/dataset.json` (expect empty).
- [ ] **Step 5: Commit** `feat(data): bank problem titles, categories and difficulty; metadata-only seed upsert`.

### Task 2: API returns and validates the fields

**Files:**
- Modify: `app-worker/src/db/problems.ts`, `app-worker/src/routes/teacher_problems.ts`
- Test: `app-worker/test/problems.test.ts`

**Interfaces:**
- Consumes: Task 1 migration `0004` (columns exist).
- Produces: `listBank` and `listOwnProblems` items gain `title: string`, `category: string`, `difficulty: "easy" | "medium" | "hard"` (a NULL column is returned as the backfill defaults: first 60 chars of the statement, `Other`, `medium`); `NewProblem` gains the three fields; `POST /api/teacher/problems` requires them (400 with a clear message otherwise); `export const DIFFICULTIES = ["easy", "medium", "hard"]` in `app-worker/src/problem_meta.ts` with `parseProblemMeta(b): {title, category, difficulty} | string`.

- [ ] **Step 1: Write failing tests** in `problems.test.ts`: `GET /bank` items (seeded by the test with the three columns) carry the fields; an own problem created with the three fields lists them back; a row inserted without the columns (simulating an old row) lists with the fallback title/category/difficulty; `POST` rejects missing title, 81-char title, blank title, missing category, 41-char category, difficulty `"expert"`, non-string title; the existing valid `NEW_PROBLEM` fixture gains the three fields.
- [ ] **Step 2: Run** `cd app-worker && npx vitest run test/problems.test.ts` and expect FAIL.
- [ ] **Step 3: Implement** the helper and thread the fields through `insertProblem` (columns added to the INSERT), `listBank`, `listOwnProblems`; the fallback is applied in one mapping function used by both lists.
- [ ] **Step 4: Run** the whole `app-worker` suite and `npx tsc --noEmit`; expect all pass.
- [ ] **Step 5: Commit** `feat(app-worker): problem title, category and difficulty`.

### Task 3: Problem picker in the exam form

**Files:**
- Create: `app-ui/src/catalog.js`, `app-ui/src/components/ProblemPicker.jsx`, `app-ui/test/catalog.test.js`, `app-ui/test/ProblemPicker.test.jsx`
- Modify: `app-ui/src/api.js` (`listOwnProblems`), `app-ui/src/pages/TeacherHomePage.jsx`, `app-ui/src/index.css`, `app-ui/test/Teacher.test.jsx`

**Interfaces:**
- Produces: `filterProblems(problems, { search, category, difficulty }): Problem[]`; `sortProblems(problems, key: 'title' | 'difficulty' | 'category'): Problem[]` (stable, new array; difficulty order easy < medium < hard, ties by title); `categoriesOf(problems): string[]` (sorted unique); `DIFFICULTY_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' }`; `<ProblemPicker problems chosen onToggle(id, on) onWeight(id, value) />` where `chosen` is the existing `problem_id -> weight string` map.

- [ ] **Step 1: Write failing tests.** `catalog.test.js`: search is a case-insensitive trimmed substring on the title; category and difficulty filters combine with search; `all` (empty string) means no filter; sort by each key including tie-breaks; sorting returns a new array and does not mutate. `ProblemPicker.test.jsx`: rows show title, category and the Vietnamese difficulty label; typing in "Tìm theo tiêu đề" narrows the rows; the category and difficulty selects and the sort select reorder or narrow; the count line reads "Hiện 2 trên 5 bài"; a filter that matches nothing shows "Không có bài nào khớp bộ lọc"; a chosen problem stays chosen (checkbox and weight) after filtering it out and back in; "Xem đề" reveals the statement text. `Teacher.test.jsx`: the form lists bank and own problems together (`listBank` + `listOwnProblems`), keeps the existing accessible names (checkbox label is now the title, so update the three tests that use `/Add numbers/` and the weight label `Trọng số Add numbers`).
- [ ] **Step 2: Run** `cd app-ui && npx vitest run` and expect the new tests FAIL.
- [ ] **Step 3: Implement** the pure functions, the component (search input with `aria-label`, two selects and a sort select with visible labels, result count in `aria-live="polite"`, one row per problem with checkbox, title, category and difficulty as separate text, weight input when chosen, `details/summary` "Xem đề"), and wire it into `TeacherHomePage` in place of the checkbox list; add the minimal CSS in the existing flat style. Category suggestions come from `categoriesOf`.
- [ ] **Step 4: Run** `npx vitest run` and `npx vite build`; expect all pass. Check the page with the mock-fetch harness (desktop and phone width) and remove the harness afterwards.
- [ ] **Step 5: Commit** `feat(app-ui): searchable problem picker with filters and sorting`.

### Task 4: Docs, review, ship

**Files:** Modify `app-worker/README.md` (API fields, runbook step "apply the bank metadata once: `npx wrangler d1 execute teacher-app --remote --file seed/bank.sql`", note that the seed is now a metadata-only upsert), `docs/roadmap.md`.

- [ ] **Step 1:** Update the docs; verify the paths mentioned exist.
- [ ] **Step 2:** Run all suites (`pytest`, `app-worker`, `app-ui`) and expect baselines plus the new tests.
- [ ] **Step 3:** One independent review of the whole branch against the spec (opus subagent, absolute path, base `origin/main`, Review Focus verbatim); verify each finding, fix Critical and Important test-first, ledger the rest.
- [ ] **Step 4:** Push (as the repo owner account), open the PR, wait for CI and for the author's "merge"; after the deploy applies migration 0004, ask before running the one-off seed against the live database, then confirm the bank lists titles and categories.
