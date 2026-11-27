# Roadmap

Each task is sized to be finishable in one sitting (roughly half a day to
2 days). Do them roughly in order — later phases depend on earlier ones
producing real numbers, not assumptions.

**For Claude / any AI session working in this repo:** this file is the
source of truth for project status, not a one-off plan to read once.
- Before starting new work, scan for the first unchecked `[ ]` task in
  order — that's the current task, unless the user names a different one.
- When a task is verifiably done (file exists, experiment ran, section
  written), check it off (`[ ]` -> `[x]`) in the same turn you finish it —
  don't leave it for the user to do by hand.
- If a task turns out to be blocked, skipped, or done differently than
  planned, edit its line to say so (e.g. `[x] T4.1 — skipped: T1.2 already
  cleared the consistency bar`) instead of leaving stale text.
- Each task ID (T0.1, T1.2, ...) is stable — refer to tasks by ID in commits
  and in `results/` filenames where convenient, so progress stays
  traceable across sessions.

## Phase 0 — Infrastructure (prerequisite for everything else)

- [x] **T0.1 — Stand up a local model server.**
  Dev machine is Apple Silicon (M1 Pro, no CUDA) — vLLM has no supported GPU
  backend here, so use **llama.cpp's `llama-server`** instead (OpenAI-API
  compatible, Metal-accelerated, GBNF grammar for constrained JSON output).
  Install via `brew install llama.cpp`, pull a GGUF build of
  `Qwen2.5-Coder-1.5B-Instruct` first (smallest, fastest to iterate on),
  serve it, and verify `configs/model.yaml` points at it and a single manual
  `structured_call` succeeds. *Done when:* one call to
  `experiments/consistency_test.py --n 1` returns a score without error.
  ~2-4h.

- [x] **T0.2 — Install deps, smoke-test the pipeline end to end.**
  `pip install -r requirements.txt`. Run `python3 data/build_dataset.py`,
  then run the grading pipeline (`src/grader/pipeline.py`) on one sample
  manually and sanity-check the output shape matches `dataset.json`.
  ~1-2h.

## Phase 1 — Consistency experiment (the project's core claim)

- [x] **T1.1 — Baseline consistency, no batching.** 100/100 exact-match on
  all 4 samples tested (P01, P02, P04, P08) — see `results/consistency_*.json`.
  Serve with `--parallel 1`. Run `/run-consistency <sample_id> 100` on
  3-4 samples of different problems. Record exact-match rate per sample.
  *Done when:* `results/consistency_*.json` exists for each sample tested.
  ~half day (mostly wait time, low effort).

- [x] **T1.2 — Consistency under normal (batched) serving.**
  Same 4 samples, n=100, `--parallel 4` server + `--concurrency 8` client
  (real overlapping requests — confirmed via server log showing concurrent
  slot IDs, not just the flag). Result: **1.0 exact-match on all 4 samples**,
  identical to T1.1 — no batching-induced inconsistency detected for
  Qwen2.5-Coder-1.5B-Instruct (Q8_0) via llama.cpp at this scale. Caveat:
  this is llama.cpp's continuous-batching implementation specifically, on
  a 1.5B model, n=100, concurrency=8 — does not necessarily generalize to
  vLLM's batching, larger models, or higher concurrency; worth
  a note-not-a-headline in the write-up, and a candidate for revisiting with
  higher concurrency/larger n if time allows.

- [x] **T1.3 — Isolate which rubric dimension is least consistent.**
  Added `per_check_unique_values` to `consistency_test.py`'s output, reran
  T1.1/T1.2's 4 samples. Result: **every check (correctness, efficiency,
  code_style, edge_case_handling) had exactly 1 unique value across all 100
  runs, in both conditions** — zero variance anywhere, nothing to isolate.
  Scope caveat addressed (7B follow-up): repeated on 4 submissions with real
  bugs/inefficiency (`P01_two_sum__S3` self-pairing bug, `P02_is_prime__S3`
  negative-input edge case, `P05_fibonacci__S2` correct-but-exponential,
  `P07_palindrome_check__S2` missing lowercasing) — **still 1.0 exact-match,
  zero variance in every per-check breakdown**, both batched and unbatched.
  See `docs/report/results.md` "harder submissions" section for detail.
  Not fully closed: this still doesn't explain the separate manual-testing
  inconsistency noted in `docs/architecture.md` — that remains open.

## Phase 2 — Ablation (justifies the architecture choice)

- [x] **T2.1 — Implement the free-form baseline arm.**
  `free_form_grade()` in `experiments/ablation.py` + `prompts/free_form_holistic.txt`
  + `LLMClient.free_form_call()` (no schema). Parses a `FINAL_SCORE: N` line
  via regex; returns `None` on parse failure (a real failure mode of this
  arm, tracked as `n_failed_to_parse` rather than hidden). Smoke-tested on
  2 samples, both parsed successfully.

- [x] **T2.2 — Run all 3 arms on the full 33-sample pilot set.**
  `results/ablation.json`. Spearman agreement with rule-based labels (single-rater
  caveat applies, see `data/script.md`): **free_form ρ=0.52 (p=0.002) → hybrid_freeform
  ρ=0.75 (p=4e-7) → hybrid_decomposed ρ=0.87 (p=4e-11)**. Monotonic improvement
  with each decomposition step — the architecture's core empirical justification.
  0/33 parse failures in both free-form arms. Exact-match consistency across
  arms not yet compared (T1.x only covered the default hybrid_decomposed
  pipeline) — note as a gap, revisit only if time allows since T2.2's main
  purpose (agreement comparison) is answered.

- [x] **T2.3 — Write up the ablation comparison.**
  `docs/report/results.md` — consistency table (T1.1/T1.2) + ablation table
  (T2.2) + scope caveats for both, citing arXiv:2606.08625/2411.15594 from
  `docs/architecture.md`.

## Phase 3 — Dataset scale-up and validation (addresses the known limitation)

- [x] **T3.1 — Expand the pilot dataset.**
  Added 8 problems (P09-P16) covering the 3 previously-missing types:
  string processing (`count_vowels`, `is_anagram`, `caesar_cipher`),
  simple data structures (`valid_parentheses`, `merge_sorted_lists`),
  recursion beyond fibonacci (`factorial`, `gcd_euclidean`, `power`).
  16 problems, 65 samples total (was 8/33). Verified every `S1` submission
  passes 100% and every injected-bug submission actually fails on some test
  case (`P12_valid_parentheses__S3`'s bug initially passed 6/6 — fixed by
  adding an unclosed-bracket test case, see `data/script.md`). Ablation
  (T2.2) rerun on the full 65-sample set: free_form ρ=0.60, hybrid_freeform
  ρ=0.85, hybrid_decomposed ρ=0.88 — same ordering as the original 33-sample
  run, conclusion holds on the larger, more varied set. 33-sample run
  archived at `results/ablation_33samples_7b.json`, 65-sample is the current
  `results/ablation.json`. See `docs/report/results.md` for full table.

- [x] **T3.2 — skipped for now (user decision).** Recruiting an
  instructor/TA to independently grade a subsample is deferred — not
  ruled out, just not being pursued at the moment. Revisit if there's time
  before writing, since T3.3 and the "agreement with humans" claim
  both depend on it; until then, `data/script.md`'s single-rater caveat
  stands as-is and any agreement numbers (T2.2/ablation) stay framed as
  "agreement with rule-based labels," never "agreement with human graders."

- [x] **T3.3 — skipped, depends on T3.2.** No independent grader data to
  compute kappa/ICC against. Revisit only if T3.2 is picked back up.

## Phase 4 — Fine-tuning decision point (conditional, may be skipped)

- [x] **T4.1 — Go/no-go check: NO-GO, Phase 4 skipped.**
  Threshold: >98% exact-match consistency and reasonable rubric agreement.
  Both cleared: T1.2 shows **1.0 exact-match** consistency (unbatched and
  batched, 7B model, 65-sample dataset), and T2.2 shows
  **hybrid_decomposed ρ=0.88** agreement with rule-based labels, best of
  the three arms. Prompting + structured-output decoding alone clears the
  bar without fine-tuning — recorded as a project finding in its own right
  ("prompting + structured decoding is sufficient; LoRA fine-tuning was not
  necessary to hit the consistency target"), not a skipped step.

- [x] **T4.2 — skipped: T4.1 was no-go.**

- [x] **T4.3 — skipped: T4.1 was no-go.**

## Phase 5 — Writing

- [x] **T5.1 — Literature review section.**
  Written in Vietnamese, LaTeX: `docs/report/latex/main.tex` (single-file
  report doc, per user request — superseded the earlier English Markdown
  draft and a short-lived multi-file `chapters/`+`.bib` split, both
  removed). Draws only on the citations already in `docs/architecture.md`
  (7 arXiv IDs) — bibliography is an inline `thebibliography` in
  `main.tex` with titles + arXiv IDs but missing full author/venue/year
  metadata, flagged there as a to-do before submission.

- [x] **T5.2 — Proposed method section.**
  Written in Vietnamese, LaTeX, same single file: `docs/report/latex/main.tex`.
  Covers pipeline shape, the no-agent-framework rationale, sandbox
  correctness scoring, the three structured rubric checks (efficiency /
  code_style / edge_case_handling) with their exact scoring formulas from
  `src/grader/rubric_checks.py`/`schemas.py`, code-side aggregation
  formula, model/serving choice, and the pilot dataset's annotation-source
  caveat table from `data/script.md`. Needs a Vietnamese-capable LaTeX
  toolchain (XeLaTeX/LuaLaTeX + polyglossia) — not installed on this
  machine, so not yet compiled/verified to build.

- [x] **T5.3 — Experiments + results sections.**
  Added as two new chapters in `docs/report/latex/main.tex`
  (`\chapter{Thực nghiệm}`, `\chapter{Kết quả}`), replacing the placeholder
  comment left by T5.2. `results/` is empty on this machine (gitignored,
  raw JSON not present) — numbers were pulled from `docs/report/results.md`
  instead, which was itself written from those JSON files and is the
  source of truth checked into git; every table cites its underlying
  `results/*.json` path for traceability once that data is available again.
  Carried forward verbatim: the T1.x manual-testing inconsistency caveat,
  the single-rater efficiency/code_style label caveat, and the "Open items"
  note that ρ=0.88 predates the `pipeline.grade()` zero-credit-on-fail fix
  (3/65 samples affected, not yet rerun). Not compiled/verified to build —
  same missing XeLaTeX/LuaLaTeX+polyglossia toolchain issue as T5.2.

- [ ] **T5.4 — Limitations section.**
  Must include the dataset caveat from `data/script.md` (single-rater
  labels) and the T3.3 outcome, whichever way it went.
  ~half day.

## Phase 6 — Teacher app on Cloudflare (new direction, 2026-11-25)

Design: `docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md`.
Phase 1 plan: `docs/superpowers/plans/2026-11-25-teacher-app-phase1.md`. Free plan only.

- [x] **T6.1 — Phase 1 code (Foundation).** `app-worker/` (TypeScript): Access login, question
  bank seed, multi-question exams, student attempts graded synchronously through the Python Worker's
  new token-gated `/api/internal/*`, append-only score revisions. 74 Worker tests + 135 Python tests green; whole-branch review findings fixed.
  No UI yet.
- [x] **T6.2 — Phase 1 deploy (2026-11-25).** D1 created and seeded (16 bank problems), `INTERNAL_TOKEN`
  on both Workers, `grading` and `teacher-app` deployed, student flow smoke-tested live (score 94),
  Access application on `/api/teacher/*` created and a real PIN login verified. Runbook: `app-worker/README.md`.
- [x] **T6.2b — UI (2026-11-25).** `app-ui/` (React + Vite, existing look) served by `teacher-app`; teacher pages behind Access; plan `docs/superpowers/plans/2026-11-25-teacher-app-ui.md`. Real browser walk-through by the author still to confirm.
- [x] **T6.3 — Phase 2 (2026-11-26).** Queues (background grading), AttemptDO (clock, submit claim, resume), R2 audit logs, Rate Limiting and Turnstile; plan `docs/superpowers/plans/2026-11-26-teacher-app-phase2.md`. Free-tier spikes: Rate Limiting binding, sqlite Durable Objects, Queues and R2 all work on Free; Turnstile accepted the workers.dev hostname. Live smoke test still to confirm.
- [x] **T6.3b — style prompt and one-shot submit (2026-11-26).** Comments are optional for the style check (0 -> 13 of 16 correct uncommented samples score clean on the live model); the exam is submitted once and every question is graded in parallel; plan `docs/superpowers/plans/2026-11-26-style-prompt-and-submit-all.md`.
- [x] **T6.3b — Per-exam rubric weights and teacher Settings (2026-11-26).** `exams.rubric` snapshot + `teachers.settings` (migration 0003), `/teacher/settings` page; spec and plan in `docs/superpowers/`.
- [x] **T6.3c — Problem catalog (2026-11-26).** Title, category and difficulty on every problem (migration 0004, bank metadata in `data/problems.py`, metadata-only seed upsert), searchable/filterable/sortable picker in the exam form; spec and plan in `docs/superpowers/`.
- [x] **T6.4 — Phase 3 (2026-11-27):** appeals (student files by receipt code, teacher reviews the AI trail and decides, adjustments are new score revisions), daily Cron expires stale appeals, teacher appeals page. **Workflows skipped:** waiting for the teacher is one API call updating D1, so a Workflow added nothing. **Email skipped:** no domain; Cloudflare email needs one, Brevo with a Gmail sender fails DKIM/DMARC. Spec and plan in `docs/superpowers/`. Not yet deployed or checked on the live site.
- [ ] **T6.5 — Phase 4 plan + build:** AI Gateway, Analytics Engine, logs, CI deploy; plus a UI plan.

## Notes

- **Productionization ideas are tracked separately, not here.** See
  `docs/productionization.md` for what it would take to move this from a
  research prototype to something usable on real student submissions
  (sandbox security, question import, editor UX, class-scale serving,
  audit trail). Deliberately out of scope for Phases 0-5 — only pick it up
  when explicitly asked.
- **Project default model changed to Qwen2.5-Coder-7B-Instruct** (was 1.5B).
  Phase 1/2 rerun on 7B — 1.5B results archived in `results/archive_1.5b/`.
  Current (7B) numbers: consistency still 1.0 exact-match on all 4 samples,
  both batched and unbatched (did not reproduce the manual-testing
  inconsistency noted in `docs/architecture.md` in this 100-run-per-sample
  formal test — that finding stands as a separate, rarer observation, not
  contradicted but not confirmed at this n either). Ablation agreement rose
  across the board: free_form 0.52→0.59, hybrid_freeform 0.75→0.88,
  hybrid_decomposed 0.87→0.89 (7B narrows the free-form-vs-hybrid gap
  without closing it — hybrid_decomposed is still best). See
  `docs/report/results.md` for the full writeup.
- Phases 1 and 2 are the load-bearing ones — everything else (dataset
  scale-up, fine-tuning, writing) depends on their numbers. Don't start
  Phase 3/4 work speculatively before Phase 1/2 numbers exist.
- Phase 4 has a real chance of being skipped entirely — that's a valid,
  even interesting, outcome ("prompting + structured decoding alone
  achieves the consistency target"), not a failure to fine-tune.
