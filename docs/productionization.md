# Productionization ideas

This is a separate track from `docs/roadmap.md` (the thesis task tracker).
`docs/roadmap.md` Phases 0-5 are about producing the thesis (experiments,
writing). This file is about what it would take to turn the same pipeline
into something a real instructor could actually use to grade real student
submissions — captured here so it isn't lost, to implement later, not
before Phase 1/2/5 thesis work is done.

**Do not start on any of this speculatively** — it's out of scope for the
thesis itself. Only pick an item up when the user explicitly asks to work
on productionization, and confirm which item first (they're independent,
not a strict sequence like the thesis phases).

Checkbox protocol matches `docs/roadmap.md`: check an item off (`[ ]` ->
`[x]`) in the same turn it's actually implemented, don't leave it stale.

## A — Blockers (must fix before grading any real student code)

- [ ] **PR-A1 — Sandbox isolation.** `src/grader/sandbox.py` currently
  runs submitted code via `exec()` directly inside the server's own Python
  process — no time limit, no memory limit, no filesystem/network
  isolation. Fine for self-authored pilot data; a real security hole
  against actual student submissions (arbitrary code execution: can read
  server files, spawn shell commands, infinite-loop the server). Needs one
  of: subprocess with hard CPU-time/memory limits (`resource` module +
  `subprocess.run(timeout=...)`), an OS-level sandbox (Docker container per
  run, gVisor, firejail), or at minimum `RestrictedPython`. This blocks
  everything else in this list — don't grade real submissions before it's
  done.

- [ ] **PR-A2 — Multi-language support.** Pipeline currently assumes
  Python (`exec()` + call `func_name` directly in-process). Real use in a
  non-Python course needs a compile-then-run-subprocess model per
  language, which is a different sandbox architecture than PR-A1's
  in-process fix — do PR-A1 first, then decide whether to generalize the
  sandbox interface or keep Python-only as a stated scope limit.

## B — Teacher side: authoring & importing questions

- [ ] **PR-B1 — Non-code question authoring.** Problems currently have to
  be hand-written into `data/problems.py` as Python literals — not usable
  by an instructor who isn't reading this codebase. Needs a form/UI to
  enter statement, rubric weights, and test cases (input/output pairs)
  without touching code.

- [ ] **PR-B2 — Bulk import.** Import problems from a format instructors
  already have: CSV/Excel, or an export from Moodle/Google Classroom, or at
  minimum a simple fill-in JSON template — instead of requiring every
  problem to be authored one at a time in the UI from PR-B1.

- [ ] **PR-B3 — Test-suite coverage checker.** There's already a real,
  documented finding (`data/script.md`, "Notable finding from running the
  real pipeline") that a weak test suite lets buggy submissions score
  100%. A simple mutation-testing-style checker that warns an instructor
  "this test suite doesn't actually catch bug X" before they use it to
  grade for real would directly address that failure mode.

## C — Student side: submission experience

- [ ] **PR-C1 — Real code editor.** Replace the Streamlit plain textarea
  with Monaco or CodeMirror — syntax highlighting and real line numbers,
  which the existing per-line feedback feature (`src/grader/feedback.py`)
  already assumes but the current UI doesn't surface well.

- [ ] **PR-C2 — Public vs. hidden test cases.** Let students run public
  test cases before final submission; keep some test cases hidden for the
  actual correctness score, matching how real assignments are usually run.

- [ ] **PR-C3 — Resubmission flow.** Let a student resubmit and see their
  submission history, not just a single one-shot grade.

## D — Operating at class scale

- [ ] **PR-D1 — Centralized server + queue.** Current setup is one script
  against one locally-run `llama-server` — not workable for 30-50 students
  submitting concurrently. Needs a queue (submissions processed against a
  shared server) instead of everyone running their own local model.

- [ ] **PR-D2 — REST API packaging.** Wrap `src/grader/pipeline.py` as an
  HTTP API so it can be integrated into a real LMS (Canvas/Moodle via LTI)
  instead of only being runnable as a CLI script or local Streamlit demo.

- [ ] **PR-D3 — Grade export.** Export results to CSV/Excel in a format an
  LMS gradebook can import, instead of only living in `results/*.json`.

## E — Transparency & trust (matters once scores affect real people)

- [ ] **PR-E1 — Audit trail.** Log the prompt, model version, and raw
  model output behind every graded score, so a grade can actually be
  explained and defended if a student disputes it — not just the final
  number.

- [ ] **PR-E2 — Low-confidence flagging.** Flag borderline scores or cases
  where the model's rubric-check output looks uncertain, for manual
  instructor review, instead of treating every AI score as final.

- [ ] **PR-E3 — Plagiarism / code-similarity check.** Not present
  anywhere in the current pipeline; needed before grading counts for real.

## Where this came from

Captured from a conversation on 2026-08-21 proposing concrete next steps
to move the project from thesis-prototype to something usable in a real
class. See `docs/roadmap.md` for the thesis track this is deliberately
kept separate from.
