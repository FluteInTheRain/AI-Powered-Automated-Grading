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
  guided/constrained decoding (vLLM `guided_json` / outlines backend), so
  there's no free-form number to be inconsistent about — only a bounded
  enum or boolean, then a fixed, code-side mapping to a 0..1 sub-score.

## Determinism verification (not just config)

temp=0 + fixed seed + guided decoding does not guarantee bit-exact repeats
under a batching serving engine (floating-point non-associativity across
batch compositions — this is an active, measured phenomenon, not
theoretical). `experiments/consistency_test.py` is the empirical check:
run one fixed sample N=100 times, sequential requests, count unique scores.
Compare with `--max-num-seqs 1` (no batching) vs. a normally-batched vLLM
server to isolate how much of any inconsistency is batching-induced.

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

## Model choice

Start with Qwen2.5-Coder (1.5B, then 3B) — code-capable, instruction-tuned,
small enough for cheap, fast, repeated experiments (the consistency
experiment alone is 100+ sequential calls per condition). Escalate to
DeepSeek-Coder-6.7B-Instruct only if the small model's checks are too
unreliable. LoRA fine-tuning is a fallback if prompting + structured output
isn't sufficient — not a starting assumption.

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
