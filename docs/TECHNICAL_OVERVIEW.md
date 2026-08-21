# Technical Overview

A deep dive into the engineering decisions behind this project, written for
readers evaluating the work as a portfolio piece (not the academic framing —
see `docs/architecture.md` and `docs/thesis/` for that). Every claim below
is backed by a specific file or experiment result in this repo.

## The actual problem

"Grade code with an LLM" is not a hard engineering problem — a single
prompt does that in an afternoon. The hard problem this project solves is:

> Given the exact same problem statement, rubric, and submission, can the
> system be made to return the **exact same score every time**, including
> under a normally-batched production serving setup — and can that claim be
> backed by a measurement, not a config flag?

That's a determinism-under-real-serving-conditions problem, which turns out
to touch model output structure, decoding strategy, and the serving
engine's batching internals — three layers that don't normally get treated
as one problem.

## Why naive LLM-as-grader fails this requirement

A single free-form call asked to produce one holistic 0–100 score has high
run-to-run variance: at `temperature=0`, the model still has many
equally-plausible free-text reasoning paths to the same conclusion, and
which path it takes is sensitive to serving-level noise. This project
measured that gap directly rather than taking it on faith — the ablation
experiment (`experiments/ablation.py`) compares three architectures on the
same 65-sample dataset:

| Arm | What it does | Spearman ρ vs. reference labels |
|---|---|---|
| `free_form` | One prompt, one holistic score, no structure | 0.60 |
| `hybrid_freeform` | Real sandbox correctness + one free-form call for the rest | 0.85 |
| `hybrid_decomposed` | Sandbox correctness + one structured call per rubric dimension | **0.88** |

Agreement rises monotonically with each decomposition step. This is the
empirical justification for the architecture below, not just a design
preference — see `docs/thesis/results.md` for the full table including a
1.5B-vs-7B comparison and p-values.

## Architecture

```
input: statement, rubric, submission_code, test_cases
   │
   ├─ sandbox.run_submission()                   → correctness (real execution, zero LLM involvement)
   │
   ├─ rubric_checks.check_efficiency()            → structured JSON, temp=0, fixed seed
   ├─ rubric_checks.check_code_style()            → structured JSON, temp=0, fixed seed
   ├─ rubric_checks.check_edge_case_handling()    → structured JSON, temp=0, fixed seed
   │
   └─ aggregator.aggregate()                      → final_score = Σ(sub_score·weight) / Σ(weight) × 100
```

`src/grader/pipeline.py` is a single sequential function — deliberately
**not** built on an agent framework (LangChain, CrewAI, etc.). There's no
multi-step exploration or tool routing to coordinate here: three
independent classification calls and one arithmetic sum. Every layer an
orchestration framework would add is another place for non-determinism or
tokens to leak in, for zero benefit on this workload. Recognizing when
*not* to reach for an agent framework was as deliberate a decision as
anything else in this design.

## Key engineering decisions

### 1. Correctness never touches the LLM

`src/grader/sandbox.py` executes submitted code against real test cases in
an isolated namespace and computes `pass_rate` directly — no model
inference on the path that matters most for determinism. This also
surfaced a subtler lesson during dataset construction
(`data/script.md`): two submissions *designed* to contain bugs still
passed 100% of tests, because the test suite didn't happen to exercise the
specific failure mode. Sandboxed correctness is only as trustworthy as the
test suite behind it — a finding worth designing for, not just noting.

### 2. Schema-constrained decoding, not "ask nicely for JSON"

Each non-correctness rubric dimension gets its own narrow prompt
(`prompts/*.txt`) and its own tiny Pydantic schema (`src/grader/schemas.py`)
— an `EfficiencyCheck` (boolean + a short observed-pattern string), a
`StyleCheck` (a 3-value ordinal enum), an `EdgeCaseCheck` (boolean +
optional missing-cases list). These are enforced at the decoding level via
`response_format: json_schema`, compiled to a GBNF grammar by llama.cpp
(`src/grader/llm_client.py`) — the model is *structurally incapable* of
emitting anything outside the schema, not merely prompted to. This is the
mechanism, not just the design intent, behind why per-check variance can be
driven to zero (see Results below).

### 3. Score mapping lives in code, and one mapping bug is worth knowing about

Sub-scores are deterministic functions of the structured output, e.g.:

```python
# edge_case_handling: handled=False must never silently score 1.0
score = max(0.25, 1.0 - 0.25 * max(1, len(result.missing_cases)))
```

The `max(1, ...)` exists because an earlier version of this formula
computed `1.0 - 0.25 * 0 == 1.0` whenever the model returned
`handled=False` but an empty `missing_cases` list — silently overriding the
model's own "not handled" verdict with a perfect score. An empty list here
means "unspecified," not "zero penalty." This is a small bug, but it's the
kind that a pure spot-check of the happy path won't catch, and it directly
undermines the project's central determinism/correctness claim if left in
— worth having in a portfolio write-up as evidence of actually reading
the failure modes of your own scoring logic, not just the success path.

### 4. Determinism is measured, not assumed

`temperature=0` + fixed seed + constrained decoding does **not** guarantee
bit-exact repeats under a batching serving engine — floating-point
non-associativity across different batch compositions is a documented,
real phenomenon in LLM serving, not a theoretical concern. Rather than
asserting the config makes the system deterministic,
`experiments/consistency_test.py` measures it directly: run one fixed
sample N=100 times, compare `--parallel 1` (no batching) against a
normally-batched server (`--parallel 4`, confirmed via server logs showing
concurrent slot IDs, not just the flag), and count unique score values.

**Result:** 1.0 exact-match rate — zero variance across 100 runs, in every
per-check breakdown, at both `--parallel 1` and `--parallel 4`, on both
easy (`S1_correct_clean`) and deliberately-hard submissions (a self-pairing
logic bug, a negative-input edge case, an exponential-time-but-correct
solution, a missing-lowercasing bug). Full detail and scope caveats (this
tests llama.cpp's specific batching implementation, not vLLM's, at one
concurrency level) in `docs/thesis/results.md`.

### 5. Deploying around a hardware constraint, not despite it

The original plan assumed vLLM, the dominant serving engine in the
LLM-as-judge literature this project builds on. The dev machine is Apple
Silicon (M1 Pro) with no CUDA-capable GPU — vLLM has no supported backend
there. Rather than developing against a cloud GPU box to match the
literature's assumptions, the project pivoted to `llama.cpp`'s
`llama-server`: OpenAI-API-compatible (so `src/grader/llm_client.py` needed
zero changes beyond `base_url`), Metal-accelerated, and — critically for
this project's core requirement — supports GBNF grammar-constrained
decoding, which is what makes decision #2 above possible at all on this
hardware. `scripts/model_server.sh` wraps process lifecycle (start/stop/
health-check with a readiness poll) around the raw `llama-server` binary.

## Quantified results

| Experiment | Setup | Result |
|---|---|---|
| Consistency, unbatched | 4 samples × 100 runs, `--parallel 1` | 1.0 exact-match, all 4 |
| Consistency, batched | Same 4 samples × 100 runs, `--parallel 4`, 8 concurrent | 1.0 exact-match, all 4 |
| Consistency, hard submissions | 4 buggy/edge-case submissions × 100 runs, both conditions | 1.0 exact-match, all 4 |
| Ablation (architecture justification) | 65 samples, 3 arms, Spearman ρ vs. reference labels | free_form 0.60 → hybrid_freeform 0.85 → hybrid_decomposed **0.88** |
| Parse failures, free-form arms | 65 samples, both free-form conditions | 0/65 |

Source data: `docs/thesis/results.md` (the numbers here are drawn from
there, not recomputed).

## Stack

- **Model:** Qwen2.5-Coder-7B-Instruct (GGUF, Q4_K_M) — largest model kept
  inside the project's deliberate sub-7B scope.
- **Serving:** `llama.cpp`'s `llama-server`, Metal backend, GBNF
  grammar-constrained JSON decoding, OpenAI-compatible API.
- **Grading core:** plain Python, `pydantic` for schema definition/
  validation, `openai` SDK as a thin client against the local server.
- **Experiments:** `scipy` for Spearman correlation; custom harnesses for
  exact-match consistency counting and 3-arm ablation.
- **Demo UI:** `streamlit` (`app.py`) — a thin shell around the real
  pipeline for live, interactive grading against the running server; not a
  reimplementation, so every determinism/scoring rule still applies to what
  it shows.

## Engineering practices worth calling out

- **Shared code path between the dataset builder and the live pipeline:**
  `sandbox.run_submission()` is the same function `data/build_dataset.py`
  uses to generate reference labels, so the grading pipeline and the
  dataset it's validated against can't silently drift apart.
- **Regenerated, not committed, generated data:** `data/dataset.json` is
  built from `data/problems.py` via `data/build_dataset.py` and gitignored
  — the source of truth is the generator, not a stale JSON blob.
- **Archived comparisons, not overwritten results:** every re-run at a new
  model size or dataset scale keeps the prior run
  (`results/archive_1.5b/`, `results/ablation_33samples_7b.json`) so
  before/after claims are checkable, not just asserted.
- **Known limitations stated where the data lives, not buried:**
  `data/script.md` documents in the dataset's own directory that
  `efficiency`/`code_style` labels are single-rater self-annotations, not
  independent ground truth — every result table that uses them repeats
  this caveat rather than letting a downstream reader assume otherwise.

## What's explicitly out of scope (and why that's a decision, not a gap)

- **Fine-tuning (LoRA):** built as a fallback path, gated behind a
  go/no-go check. Since prompting + structured decoding already cleared
  the project's consistency and agreement thresholds (table above), the
  fine-tuning phase was skipped — recorded as a finding
  (`docs/roadmap.md`, Phase 4), not an unfinished feature.
- **Real human-grader validation:** the current agreement numbers are
  against rule-based reference labels, explicitly not claimed as
  "agreement with human graders" anywhere in this repo's docs (see the
  caveat in `data/script.md`). Recruiting an independent grader is a
  scoped, not-yet-started next step (`docs/roadmap.md` T3.2), separated
  cleanly from the numbers that don't depend on it.
