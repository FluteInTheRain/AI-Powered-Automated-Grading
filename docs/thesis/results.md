# Results

Setup for all experiments below: `Qwen2.5-Coder-7B-Instruct` (GGUF, Q4_K_M
quantization) — the project default, the largest model still inside the
thesis's sub-7B scope — served locally via llama.cpp's `llama-server` on
Apple Silicon (Metal backend), temperature=0, fixed seed=0. See
`configs/model.yaml` for full serving configuration. An earlier pass of the
same experiments on `Qwen2.5-Coder-1.5B-Instruct` (Q8_0) is archived in
`results/archive_1.5b/`; both model sizes' headline numbers are compared in
the tables below.

## Consistency (Phase 1)

**Setup:** one fixed sample graded repeatedly through the full pipeline
(`src/grader/pipeline.py`), scores compared for exact match.

| Condition | Samples tested | Runs per sample | Exact-match rate (7B) | Exact-match rate (1.5B, archived) |
|---|---|---|---|---|
| No batching (`--parallel 1`-equivalent, sequential requests) | P01_two_sum, P02_is_prime, P04_binary_search, P08_fizzbuzz (all `S1_correct_clean`) | 100 | 1.0 (all 4) | 1.0 (all 4) |
| Batched (`--parallel 4`, 8 concurrent requests, confirmed via server logs showing concurrent slot IDs) | same 4 samples | 100 | 1.0 (all 4) | 1.0 (all 4) |

Per-check breakdown (correctness, efficiency, code_style,
edge_case_handling) also showed exactly one unique value across all 100
runs, in both conditions, for all 4 samples, at both model sizes — zero
variance anywhere in this formal test.

**Finding:** no batching-induced inconsistency was observed at either model
size (1.5B or 7B, n=100, concurrency=8). This is notable given that
dynamic-batching-induced non-determinism (floating-point non-associativity
across batch compositions) is a documented risk for LLM serving generally.

**Important nuance — a real inconsistency *was* observed, just not in this
formal test:** during manual demo-UI testing (outside this experiment's
n=100 protocol), two back-to-back calls to `check_edge_case_handling` with
identical input, seed=0, and the 7B model returned different `handled`
verdicts (`True` then `False`) for the same `two_sum` submission. This does
not contradict the 1.0 exact-match rate above — it means the inconsistency,
if real and not a one-off artifact of that manual session, is rare enough
not to have appeared in 100 runs on these particular 4 samples. Treat the
table above as "no inconsistency detected at this n," not "proven
consistent" — a formal repeat with larger n and/or harder submissions
(see Open items) is needed before drawing a stronger conclusion either way.

**Scope caveats (do not overstate this result):**
- All 4 samples tested are the `S1_correct_clean` submission for their
  problem — the easiest case for the LLM checks to judge (clean, obviously
  correct code). Submissions with bugs, poor style, or edge-case issues
  (`S2`-`S4` per problem) are untested here and more likely to surface real
  judgment variance — and are exactly the kind of harder, more ambiguous
  input where the manual-testing inconsistency above was actually seen.
- This measures llama.cpp's specific continuous-batching implementation.
  It does not necessarily generalize to vLLM's batching (the engine most of
  the cited literature and the original project plan assumed) or to even
  higher concurrency than tested here.
- No paper found in the literature review specifically measures exact-match
  consistency of LLM grading under batched serving — this remains a gap the
  thesis can note, with the caveat above about how far this particular
  result can be stretched to fill it.

Raw data: `results/consistency_*.json` (7B, current) and
`results/archive_1.5b/consistency_*.json` (1.5B, archived).

**Follow-up: harder submissions (7B only).** To address the scope caveat
above, the same test was repeated on 4 submissions with real, subtle bugs
(not the `S1_correct_clean` easy case): a self-pairing logic bug
(`P01_two_sum__S3`), a negative-input edge case (`P02_is_prime__S3`), a
correct-but-exponential-time solution (`P05_fibonacci__S2`), and a
missing-lowercasing edge case (`P07_palindrome_check__S2`). Result: **still
1.0 exact-match on all 4, both batched and unbatched, with zero variance in
every per-check breakdown** (`results/consistency_P01_two_sum__S3_*.json`
etc.). This meaningfully strengthens the consistency finding beyond the
easy-case caveat — the pipeline held up on genuinely ambiguous judgment
calls (e.g. `P05_fibonacci__S2` scored `efficiency=0.4` consistently,
correctly penalizing the exponential-time-but-correct solution every time).
It does not resolve the separate manual-testing observation above (that was
about non-determinism between repeated identical calls, a different
question from "does this input produce a stable modal score"), but it does
rule out "only tested on easy inputs" as an explanation for the high
exact-match rate.

## Ablation (Phase 2)

**Setup:** three arms compared on the pilot dataset (`data/dataset.json`),
each producing a predicted final score compared against the dataset's
rule-based reference labels via Spearman rank correlation. Originally run
on the 33-sample / 8-problem pilot set; rerun on the expanded 65-sample /
16-problem set after T3.1 (dataset expansion — see `docs/roadmap.md`) added
8 problems covering string processing, simple data structures, and
recursion beyond fibonacci.

1. **free_form** — one prompt, one holistic 0-100 score, no sandbox
   execution, no structured output (the "naive" baseline: just ask the LLM
   to grade it).
2. **hybrid_freeform** — real sandbox-executed correctness +
   one free-form LLM call covering efficiency, code_style, and
   edge_case_handling combined (not decomposed).
3. **hybrid_decomposed** — this project's actual pipeline: sandbox
   correctness + three independent, structured-output LLM calls (one per
   non-correctness rubric dimension) + fixed code-side weighted aggregation.

| Arm | ρ (7B, n=65) | p-value | ρ (7B, n=33, archived) | ρ (1.5B, n=33, archived) |
|---|---|---|---|---|
| free_form | 0.60 | 1.2e-07 | 0.59 | 0.52 |
| hybrid_freeform | 0.85 | 2.3e-19 | 0.88 | 0.75 |
| hybrid_decomposed | **0.88** | 2.1e-22 | 0.89 | 0.87 |

0/65 parse failures in both free-form arms on the current 65-sample run
(0/33 on the archived 33-sample runs). The 33-sample columns are archived
at `results/ablation_33samples_7b.json` (7B) and
`results/archive_1.5b/ablation.json` (1.5B); the current `results/ablation.json`
is the 65-sample run.

**Finding:** agreement with the reference labels increases monotonically
with each decomposition step, at both model sizes — replacing "ask the LLM
to judge everything in one shot" with (a) real sandbox execution for
correctness, then (b) independent structured calls per rubric dimension,
each measurably improves agreement. This is the empirical justification for
the architecture described in `docs/architecture.md`, consistent with the
rubric-decomposition literature it cites (arXiv:2606.08625, arXiv:2411.15594).

**7B vs. 1.5B:** the larger model improves all three arms on the original
33-sample set, but narrows rather than closes the gap between the naive
free-form arm and the hybrid arms — hybrid_decomposed is still the best arm
at both sizes. This suggests the architecture's benefit may be largest for
small models and matter less as model size grows, though 7B is still the
largest size tested (sub-7B scope) — this trend should not be extrapolated
past 7B without more data points.

**33 vs. 65 samples (both 7B):** conclusion is stable across dataset size —
same ordering (free_form < hybrid_freeform < hybrid_decomposed), p-values
tighten with the larger n as expected. hybrid_freeform and hybrid_decomposed
moved closer together on the larger set (0.85 vs 0.88, a 3-point gap,
versus 0.88 vs 0.89 on the smaller set) — worth watching if the dataset
grows further (T3.1 follow-up), but not yet a meaningful reversal.

**Caveat — read before citing this table as "accuracy":** the reference
labels for `efficiency` and `code_style` are single-rater (self-annotated by
the dataset author), not independent human ground truth — see
`data/script.md`. This table shows agreement with a rule-based reference,
not agreement with human graders. `correctness` and `edge_case_handling`
labels are real sandbox-execution ground truth, so agreement on those
specific dimensions is on firmer footing than the aggregate score suggests.

Raw data: `results/ablation.json` (7B, current) and
`results/archive_1.5b/ablation.json` (1.5B, archived).

## Open items

- T1.3's zero-variance finding and T2.2's ablation table were both run on
  clean/correct-leaning samples or the full pilot set respectively — a
  natural follow-up (not yet done) is re-running the consistency experiment
  (T1.1/T1.2 style) across a harder mix of submissions (buggy, poor-style)
  to see if the near-perfect consistency observed holds up, since the
  ablation's free-form arm already shows that harder judgment calls (no
  sandbox to anchor on) can move scores more — and since this is exactly
  the kind of input where the manual-testing inconsistency noted above was
  actually seen.
- Exact-match consistency has not yet been compared across the three
  ablation arms (only the default `hybrid_decomposed` pipeline was tested
  for consistency in Phase 1) — noted as a gap in `docs/roadmap.md` T2.2.
- The `check_edge_case_handling` scoring formula bug (an empty
  `missing_cases` list with `handled=False` used to silently score 1.0,
  the maximum) was found and fixed (`src/grader/rubric_checks.py`) during
  this model-switch work, after the 1.5B results were already archived.
  The archived 1.5B numbers above were NOT rerun with the fix — treat any
  precise comparison of per-check scores (not just the aggregate/ρ numbers
  reported here) between the two archives with that in mind.
