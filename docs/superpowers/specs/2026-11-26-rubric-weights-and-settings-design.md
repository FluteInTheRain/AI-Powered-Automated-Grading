# Per-exam rubric weights and teacher Settings (short design)

Status: proposal agreed with the author in conversation on 2026-11-26; this document is awaiting final approval.

## Intent
Teachers want to decide how much each grading criterion counts (correctness, efficiency, code style, edge cases) for their own exam, and to keep their preferred defaults in a Settings page. Today the weights live on the problem row, and bank problems are shared by every teacher, so editing them there would change other teachers' exams and already graded scores.

## Goals
- One set of four integer weights per **exam**, applied to every question of that exam, chosen by the teacher who creates it.
- Default for the set: the teacher's own default from Settings, else each problem's own rubric on the API (so old exams are unchanged). The exam form always shows and sends explicit weights (60/15/15/10 when Settings has none), so exams created in the UI never fall back to a problem's own weights.
- A Settings page for the teacher: default criterion weights and default time limit (minutes). The exam creation form is pre-filled from it.
- Weights are fixed when the exam is created, so one exam never mixes two ways of grading.

## Non-goals
Per-question weights inside an exam (a possible later step). Editing an exam's weights after creation (create a new exam instead). Changing bank problems. Other settings (display name etc.).

## Approaches considered
- Edit the problem's rubric: breaks shared bank problems and old scores. Rejected.
- Copy each bank problem per exam: heavy, duplicates test cases. Rejected.
- **Store a rubric snapshot on the exam, read it at grading time** (chosen): one nullable column, no copies, old exams keep working.

## Design
- Migration `0003`: `exams.rubric TEXT` (JSON, NULL = use each problem's rubric) and `teachers.settings TEXT NOT NULL DEFAULT '{}'` (JSON `{default_rubric?, default_time_limit_seconds?}`).
- Validation shared with problems: exactly the four keys, non-negative integers, **sum exactly 100** (changed after review: the grader sends the raw edge-case weight into its LLM prompt as points, so the scale must be the same for every exam).
- API: `GET/PUT /api/teacher/settings`; `POST /api/teacher/exams` accepts optional `rubric` (omitted: the teacher's default, else NULL); exam detail returns the effective rubric.
- Effective rubric = `exam.rubric ?? problem.rubric`, used wherever the problem rubric is read today: the grading job (and its zero result keys) and the student exam payload.
- UI: `/teacher/settings` page (linked from the header), weight fields with live percentage and total, plus the exam form section "Trọng số tiêu chí" pre-filled from Settings; the results page shows the exam's weights read-only.
- Scores stay append-only; nothing already graded is touched.

## Left to the builder
Exact copy and layout inside the existing visual language; error messages in the language each layer already uses.
