# Results

Setup for all experiments below: `Qwen2.5-Coder-1.5B-Instruct` (GGUF, Q8_0
quantization), served locally via llama.cpp's `llama-server` on Apple
Silicon (Metal backend), temperature=0, fixed seed=0. See
`configs/model.yaml` for full serving configuration.

## Consistency (Phase 1)

**Setup:** one fixed sample graded repeatedly through the full pipeline
(`src/grader/pipeline.py`), scores compared for exact match.

| Condition | Samples tested | Runs per sample | Exact-match rate |
|---|---|---|---|
| No batching (`--parallel 1`, sequential requests) | P01_two_sum, P02_is_prime, P04_binary_search, P08_fizzbuzz (all `S1_correct_clean`) | 100 | 1.0 (all 4 samples) |
| Batched (`--parallel 4`, 8 concurrent requests, confirmed via server logs showing concurrent slot IDs) | same 4 samples | 100 | 1.0 (all 4 samples) |

Per-check breakdown (correctness, efficiency, code_style,
edge_case_handling) also showed exactly one unique value across all 100
runs, in both conditions, for all 4 samples — zero variance anywhere.

**Finding:** at this scale (1.5B model, Q8_0, n=100, concurrency=8), no
batching-induced inconsistency was observed. This is notable given that
dynamic-batching-induced non-determinism (floating-point non-associativity
across batch compositions) is a documented risk for LLM serving generally.

**Scope caveats (do not overstate this result):**
- All 4 samples tested are the `S1_correct_clean` submission for their
  problem — the easiest case for the LLM checks to judge (clean, obviously
  correct code). Submissions with bugs, poor style, or edge-case issues
  (`S2`-`S4` per problem) are untested here and more likely to surface real
  judgment variance.
- This measures llama.cpp's specific continuous-batching implementation.
  It does not necessarily generalize to vLLM's batching (the engine most of
  the cited literature and the original project plan assumed) or to larger
  models / higher concurrency.
- No paper found in the literature review specifically measures exact-match
  consistency of LLM grading under batched serving — this remains a gap the
  thesis can note, with the caveat above about how far this particular
  result can be stretched to fill it.

Raw data: `results/consistency_*.json` (4 samples × {no batching, batched}).

## Ablation (Phase 2)

**Setup:** three arms compared on the full 33-sample pilot dataset
(`data/dataset.json`), each producing a predicted final score compared
against the dataset's rule-based reference labels via Spearman rank
correlation.

1. **free_form** — one prompt, one holistic 0-100 score, no sandbox
   execution, no structured output (the "naive" baseline: just ask the LLM
   to grade it).
2. **hybrid_freeform** — real sandbox-executed correctness +
   one free-form LLM call covering efficiency, code_style, and
   edge_case_handling combined (not decomposed).
3. **hybrid_decomposed** — this project's actual pipeline: sandbox
   correctness + three independent, structured-output LLM calls (one per
   non-correctness rubric dimension) + fixed code-side weighted aggregation.

| Arm | Spearman ρ | p-value | n | Parse failures |
|---|---|---|---|---|
| free_form | 0.52 | 0.0019 | 33 | 0/33 |
| hybrid_freeform | 0.75 | 3.9e-07 | 33 | 0/33 |
| hybrid_decomposed | **0.87** | 4.5e-11 | 33 | — (structured output, no parsing) |

**Finding:** agreement with the reference labels increases monotonically
with each decomposition step — replacing "ask the LLM to judge everything
in one shot" with (a) real sandbox execution for correctness, then (b)
independent structured calls per rubric dimension, each measurably improves
agreement. This is the empirical justification for the architecture
described in `docs/architecture.md`, consistent with the rubric-decomposition
literature it cites (arXiv:2606.08625, arXiv:2411.15594).

**Caveat — read before citing this table as "accuracy":** the reference
labels for `efficiency` and `code_style` are single-rater (self-annotated by
the dataset author), not independent human ground truth — see
`data/script.md`. This table shows agreement with a rule-based reference,
not agreement with human graders. `correctness` and `edge_case_handling`
labels are real sandbox-execution ground truth, so agreement on those
specific dimensions is on firmer footing than the aggregate score suggests.

Raw data: `results/ablation.json`.

## Open items

- T1.3's zero-variance finding and T2.2's ablation table were both run on
  clean/correct-leaning samples or the full pilot set respectively — a
  natural follow-up (not yet done) is re-running the consistency experiment
  (T1.1/T1.2 style) across a harder mix of submissions (buggy, poor-style)
  to see if the near-perfect consistency observed holds up, since the
  ablation's free-form arm already shows that harder judgment calls (no
  sandbox to anchor on) can move scores more.
- Exact-match consistency has not yet been compared across the three
  ablation arms (only the default `hybrid_decomposed` pipeline was tested
  for consistency in Phase 1) — noted as a gap in `docs/roadmap.md` T2.2.
