# Problem titles, categories, difficulty, filter and sort (short design)

Status: requested and discussed with the author on 2026-11-26; awaiting final approval of this document.

## Intent
The exam form lists the 16 bank problems as a 120-character cut of the statement, which is hard to scan and impossible to narrow down. Give every problem a short title, a category and a difficulty, and let the teacher filter and sort the list when choosing questions. Teacher-authored problems carry the same fields, chosen by the teacher.

## Goals
- Every problem (bank and teacher-authored) has `title` (short, up to 80 chars), `category` (up to 40 chars) and `difficulty` (`easy | medium | hard`).
- Bank problems get hand-written titles and one of five categories: Math, Strings, Arrays & Search, Basics, Data Structures; difficulty is set per problem.
- Teacher-authored problems: `title`, `category` and `difficulty` are required on the API. Difficulty is one of the three levels. Category is free text, so a teacher can reuse an existing one or create a new one (the UI suggests the categories already in use).
- The exam form's question picker shows both the bank and the teacher's own problems with: search by title, filter by category and by difficulty, sort by title, difficulty or category, a result count, one row per problem (title, category, difficulty in Vietnamese, optional "Xem đề" to read the statement), and the chosen questions with their weights stay chosen while the list is filtered.

## Non-goals
A screen to author new problems (still API only; that needs a test-case and reference-solution editor and is a separate feature). Editing the metadata of existing problems. Tags with several values per problem. Server-side filtering and paging (the lists are small, filtering is client-side).

## Approaches considered
- Filter on the server with query params: needless round trips and code for 16 to a few hundred rows. Rejected.
- Free-form tags: flexible but filtering and sorting become fuzzy. Rejected for now.
- **Three plain columns on `problems`, filter and sort in the browser** (chosen).

## Design
- Migration `0004`: `problems.title`, `problems.category`, `problems.difficulty` (nullable columns, because SQLite cannot add NOT NULL without a default). Backfill for rows that exist: `title` = the first line of the statement cut at 60 characters, `category` = `Other`, `difficulty` = `medium`.
- Bank metadata lives in `data/problems.py` (new keys `title`, `category`, `difficulty` per problem); `scripts/export_bank_seed.py` writes them into `seed/bank.sql` using an upsert that only refreshes these three columns on rows that already exist, so statements and tests of problems that exams already use are never rewritten. `data/build_dataset.py` and `data/dataset.json` stay unchanged (the research dataset ignores the new keys; verified by a test that rebuilds the dataset and compares).
- API: `GET /bank` and `GET /problems` return `title, category, difficulty` too; `POST /problems` validates them (title 1-80 chars, category 1-40 chars, difficulty enum) and the grader preview/validate endpoints are untouched.
- UI: a `ProblemPicker` component replaces the checkbox list in the exam form; filter, sort and the visible list are plain functions with unit tests.
- Applying to the live database: the deploy applies migration `0004`; the bank metadata is applied once with `wrangler d1 execute teacher-app --remote --file seed/bank.sql` after the deploy (documented in the README runbook).

## Calls made by the builder
- Titles and categories of bank problems are English, following the project rule that data is in English; difficulty labels in the UI are Vietnamese.
- The category list is open (free text), with suggestions; difficulty is a closed list of three.

## Left to the builder
The exact titles and difficulty of the 16 bank problems, and the layout of the picker inside the existing visual language.
