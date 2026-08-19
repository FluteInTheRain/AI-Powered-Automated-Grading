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

- [ ] **T0.2 — Install deps, smoke-test the pipeline end to end.**
  `pip install -r requirements.txt`. Run `python3 data/build_dataset.py`,
  then run the grading pipeline (`src/grader/pipeline.py`) on one sample
  manually and sanity-check the output shape matches `dataset.json`.
  ~1-2h.

## Phase 1 — Consistency experiment (the thesis's core claim)

- [ ] **T1.1 — Baseline consistency, no batching.**
  Serve with `--parallel 1`. Run `/run-consistency <sample_id> 100` on
  3-4 samples of different problems. Record exact-match rate per sample.
  *Done when:* `results/consistency_*.json` exists for each sample tested.
  ~half day (mostly wait time, low effort).

- [ ] **T1.2 — Consistency under normal (batched) serving.**
  Same samples, same n=100, but with `--parallel` > 1 (batching enabled).
  Compare exact-match rate against T1.1. *This is the empirical answer to
  the project's central open question* — write the numbers down even if
  they're not what you expect.
  ~half day.

- [ ] **T1.3 — Isolate which rubric dimension is least consistent.**
  From the JSON logs, break down variance by check (efficiency vs.
  code_style vs. edge_case_handling) rather than only the final aggregated
  score. This tells you where to focus if consistency isn't 100%.
  ~2-4h analysis, no new experiments.

## Phase 2 — Ablation (justifies the architecture choice)

- [ ] **T2.1 — Implement the free-form baseline arm.**
  Fill in the TODO in `experiments/ablation.py`: one prompt, one holistic
  0-100 score, no structured output. This is the "naive" comparison point.
  ~2-3h.

- [ ] **T2.2 — Run all 3 arms on the full 33-sample pilot set.**
  Free-form vs. hybrid (sandbox + free-form rest) vs. hybrid + decomposed
  (current default). Record exact-match consistency AND Spearman agreement
  with the dataset's rule-based labels for each arm.
  ~half day run + `/run-ablation` for the summary.

- [ ] **T2.3 — Write up the ablation comparison.**
  Table: arm × (consistency rate, agreement). This is likely your main
  results table. `/thesis-section results` once the numbers exist.
  ~2-3h.

## Phase 3 — Dataset scale-up and validation (addresses the known limitation)

- [ ] **T3.1 — Expand the pilot dataset.**
  Use `/add-problem` to add 8-12 more problems (aim for ~15-20 total,
  ~70-100 samples), covering problem types not yet represented (e.g.
  string processing, simple data structures, recursion beyond fibonacci).
  ~1-2 days spread over several sessions.

- [ ] **T3.2 — Recruit 1-2 independent graders.**
  Get an instructor/TA to grade a subsample (won't need all of them —
  20-30 samples is enough for a kappa/ICC estimate) using the same rubric,
  blind to your rule-based labels. *This is a scheduling task, not a coding
  one — start it early since it depends on someone else's time.*
  ~start in parallel with T3.1, don't block on it.

- [ ] **T3.3 — Compute Cohen's kappa / ICC vs. real grader labels.**
  Once T3.2 data is back: agreement between rule-based efficiency/style
  labels and the real grader. This determines whether the rule-based
  labels can be trusted to scale the dataset further, or need rework.
  ~half day once data is in hand.

## Phase 4 — Fine-tuning decision point (conditional, may be skipped)

- [ ] **T4.1 — Go/no-go check.**
  Only if T1.2/T2.2 show consistency or agreement below an acceptable bar
  (define a threshold with your advisor, e.g. >98% exact-match). If
  prompting + structured output already clears the bar, **skip Phase 4
  entirely** and note that in the thesis as a finding.
  ~1h decision, not implementation.

- [ ] **T4.2 — LoRA fine-tune on the weakest rubric check(s) only.**
  Only if T4.1 says go. Build a small labeled set from `data/problems.py`'s
  `expected_profile` fields, targeted at whichever check (efficiency /
  style / edge_case) had the worst consistency or agreement.
  ~2-3 days.

- [ ] **T4.3 — Re-run T1 and T2 with the fine-tuned model, compare.**
  Same experiments, same metrics, before/after fine-tuning table.
  ~half day.

## Phase 5 — Writing

- [ ] **T5.1 — Literature review section.**
  `/thesis-section "literature review"` — draft from `docs/architecture.md`
  citations, expand with any additional arXiv sources found while writing.
  ~1-2 days.

- [ ] **T5.2 — Proposed method section.**
  `/thesis-section "proposed method"` from `docs/architecture.md`.
  ~1 day.

- [ ] **T5.3 — Experiments + results sections.**
  `/thesis-section "experiments"` and `/thesis-section "results"`, pulling
  numbers only from files that actually exist in `results/` — no invented
  numbers.
  ~1-2 days.

- [ ] **T5.4 — Limitations section.**
  Must include the dataset caveat from `data/script.md` (single-rater
  labels) and the T3.3 outcome, whichever way it went.
  ~half day.

## Notes

- Phases 1 and 2 are the load-bearing ones — everything else (dataset
  scale-up, fine-tuning, writing) depends on their numbers. Don't start
  Phase 3/4 work speculatively before Phase 1/2 numbers exist.
- Phase 4 has a real chance of being skipped entirely — that's a valid,
  even interesting, thesis outcome ("prompting + structured decoding alone
  achieves the consistency target"), not a failure to fine-tune.
