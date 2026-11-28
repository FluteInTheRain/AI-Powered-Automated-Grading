# System architecture

## Design decision: no agent framework, no multi-agent orchestration

The pipeline is one sequential function (`src/grader/pipeline.py`), not a set
of agents coordinating over a framework (LangChain/CrewAI/etc). Reasons,
given the project's stated priorities (simple, fast, token-frugal) and the
literature:

- Determinism is the core requirement. Every layer of orchestration
  (planning steps, tool-call routing, agent-to-agent messages) is another
  place non-determinism or extra tokens can creep in for zero benefit here —
  there is no multi-step exploration or tool use to coordinate, just three
  independent classification calls and one code-side sum.
- The literature on rubric-based LLM-as-judge (survey: arXiv:2411.15594;
  rubric decomposition: arXiv:2606.08625) converges on the same shape we're
  using: decompose a holistic judgment into small, independent, structured
  checks and aggregate outside the model. That's a data/prompt design
  problem, not an orchestration problem.
- CodEv (arXiv:2501.10421) and StepGrade (arXiv:2503.20851) both show
  chain-of-thought / step-by-step grading improves quality over one holistic
  call — but CoT free text is exactly what we're avoiding for variance
  reasons. Our version of "step-by-step" is decomposition into separate
  *calls*, each with a tiny closed-form output, which gets the
  step-structure benefit without the free-text variance cost.

## Pipeline

```
input: statement, rubric, submission_code, test_cases
   |
   ├─ sandbox.run_submission()          -> correctness sub-score (deterministic, no LLM)
   │
   ├─ rubric_checks.check_efficiency()          -> structured JSON, temp=0, seed fixed
   ├─ rubric_checks.check_code_style()          -> structured JSON, temp=0, seed fixed
   ├─ rubric_checks.check_edge_case_handling()  -> structured JSON, temp=0, seed fixed
   │
   └─ aggregator.aggregate()             -> final_score = sum(sub_score * rubric_weight) / sum(weight) * 100
```

Each LLM check:
- has its own prompt (`prompts/*.txt`) scoped to exactly one rubric
  dimension — smaller context, less for the model to reason about, less
  variance surface.
- returns a small pydantic-schema JSON object (`src/grader/schemas.py`) via
  guided/constrained decoding (`response_format: json_schema`, backed by
  llama.cpp's GBNF grammar engine), so there's no free-form number to be
  inconsistent about — only a bounded enum or boolean, then a fixed,
  code-side mapping to a 0..1 sub-score.

## Determinism verification (not just config)

temp=0 + fixed seed + guided decoding does not guarantee bit-exact repeats
under a batching serving engine (floating-point non-associativity across
batch compositions — this is an active, measured phenomenon, not
theoretical). `experiments/consistency_test.py` is the empirical check:
run one fixed sample N=100 times, sequential requests, count unique scores.
Compare with `--parallel 1` (no batching) vs. a normally-batched
`llama-server` to isolate how much of any inconsistency is batching-induced.

## Planned ablation (experiments/ablation.py)

1. Free-form: one prompt, one holistic 0-100 score, no structure.
2. Hybrid: sandbox correctness + one free-form LLM call for the rest.
3. Hybrid + decomposed rubric (this repo's default pipeline).

Compare exact-match consistency rate (own metric, no ground truth needed)
and Spearman agreement with the dataset's rule-based labels — remembering
the label caveat in `data/script.md`: efficiency/style labels are
single-rater, not independent human ground truth, so agreement numbers here
are a pipeline sanity check, not a thesis-grade validity claim until
re-annotated by a real grader.

## Rubric-check granularity: bounded multi-criteria decomposition

The original `efficiency`/`code_style`/`edge_case_handling` checks each
asked ONE closed-form question per dimension (a boolean, a 3-level enum,
or a boolean + free-text list) and mapped the answer to a coarse 0..1 score
(2-3 discrete buckets). Two problems with that:

1. **Too coarse for partial credit.** `code_style` could only ever land on
   0.2 / 0.6 / 1.0 — no way to reward "mostly good naming, one long
   function" differently from "unreadable throughout."
2. **`edge_case_handling`'s old `missing_cases: List[str]` was an unbounded
   free-form list in disguise.** The score was `f(len(missing_cases))`, and
   list *length* is generated free-form by the model even though no single
   field is literally a float — exactly the "free-form number" risk this
   project otherwise avoids (see "Pipeline" above). Not theoretical: the
   model-size finding below already caught two back-to-back
   `check_edge_case_handling` calls (same input, seed=0) returning
   different `handled` verdicts on 7B.

Fix: replace each single coarse field with a small **fixed set of
independent boolean/enum sub-criteria**, still ONE structured call per
dimension (per-dimension prompt scoping unchanged), still nothing but
bounded enum/boolean fields — no free-form list length left to hide entropy
in. Score = fraction of sub-criteria satisfied, computed in code — more
possible score values, same "bounded choice, not composed text" decoding
profile as before.

- `EfficiencyCheck`: `meets_time_complexity`, `avoids_redundant_computation`,
  `uses_appropriate_data_structure` (3 booleans -> 4 possible scores).
  `observed_pattern` (free text) stays for explanation only, same as
  before — never read by the scoring formula.
- `StyleCheck`: `descriptive_naming`, `single_responsibility`,
  `consistent_formatting`, `no_dead_or_redundant_code` (4 booleans -> 5
  possible scores).
- `EdgeCaseCheck`: 5 fixed, problem-agnostic categories
  (`empty_or_minimal_input`, `boundary_or_extreme_values`,
  `duplicate_or_repeated_elements`, `no_result_or_invalid_case`,
  `case_or_format_insensitivity`), each answered `not_applicable` /
  `not_handled` / `handled`. Score = handled / applicable, over whichever
  categories the model judges relevant to *this* problem — no per-problem
  authoring needed in `data/problems.py`, unlike a per-problem named list
  would require. These 5 categories were chosen by scanning all 16
  problems in `data/problems.py` for recurring edge-case themes; add a 6th
  if a future problem type doesn't fit any of the five.

**Known gap this doesn't fix**: `data/dataset.json`'s rule-based labels
(`data/build_dataset.py`) still use the *old* scoring rule (3-level style,
binary efficiency, pass-rate-as-edge-case) — they were not regenerated
against the new criteria. `experiments/ablation.py` agreement numbers
against `dataset.json` are stale at the sub-score level until the
dataset's `expected_profile` tags are re-authored for the new criteria;
comparing at `final_score_0_to_100` only is less sensitive to this than a
sub_score-by-sub_score comparison would be, but still worth re-running
before citing. Tracked here rather than silently left inconsistent — see
`data/script.md`'s existing label caveat.

## Model choice

Started with Qwen2.5-Coder-1.5B-Instruct for Phase 0-2 (cheap, fast,
repeated experiments — the consistency experiment alone is 100+ sequential
calls per condition), then escalated within the family up to
**Qwen2.5-Coder-7B-Instruct**, the project default as of the model-size
comparison below — the largest model still inside the thesis's sub-7B scope.
LoRA fine-tuning remains a fallback if prompting + structured output isn't
sufficient — not a starting assumption.

**Model-size finding (informal, from manual demo-UI testing, not yet a
formal experiment):** bigger was not more reliable for the line-by-line
feedback feature (`src/grader/feedback.py`, outside the scored pipeline).
1.5B gave generic-but-honest feedback when it couldn't pin down a specific
issue; 3B produced confident, specific, but factually wrong claims about
the code (hallucinated a missing null-check that was actually present);
7B was better but still contradicted its own `edge_case_handling` check
result in one observed case. Also caught: two back-to-back calls to
`check_edge_case_handling` with identical input, seed=0, and the 7B model
returned different `handled` verdicts — a real run-to-run inconsistency,
directly relevant to the thesis's central claim, found outside the formal
Phase 1 experiment. Worth a proper repeat of T1.1/T1.2 on 7B and on harder
(non-`correct_clean`) submissions before treating either finding as
conclusive — see `docs/roadmap.md` Phase 1 notes.

## References

- Survey on LLM-as-a-Judge — arXiv:2411.15594
- From Holistic Evaluation to Structured Criteria: Rubrics Across the
  Evolving LLM Landscape — arXiv:2606.08625
- Reliability without Validity: Systematic Evaluation of LLM-as-a-Judge —
  arXiv:2606.19544
- CodEv: Automated Grading Framework — arXiv:2501.10421
- StepGrade: Grading Programming Assignments with Context-Aware LLMs —
  arXiv:2503.20851
- Automating Autograding: LLMs as Test Suite Generators — arXiv:2411.09261
- Multi-Programming Language Sandbox for LLMs — arXiv:2410.23074
