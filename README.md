# AI-Powered Automated Grading

A master's thesis project: a **sub-7B-parameter LLM system for automated
grading of programming assignments**, built around one hard, testable
requirement — **run-to-run score consistency**. Given the exact same
problem statement, rubric, and submission, the system must return the exact
same score every time it's run (temperature=0, greedy decoding, fixed seed,
non-batched inference).

This is a determinism requirement, not a semantic-robustness one:
paraphrased-but-equivalent submissions scoring differently is a separate,
out-of-scope question. What's in scope is that dynamic batching in serving
engines can break *bit-exact* determinism even at temp=0, due to
floating-point non-associativity — so this project treats consistency as
something to measure empirically, not something a config flag guarantees.

## Why hybrid, not "just ask an LLM to grade it"

A single LLM call producing one free-form holistic score has high
run-to-run variance — the model reasons differently each time even at
temp=0 under real serving conditions. Instead, this system:

1. **Scores correctness by running the code for real**, in a sandbox,
   against test cases — deterministic by construction, no LLM involved.
2. **Scores every other rubric dimension** (efficiency, code style,
   edge-case handling) via **small, independent, structured-output LLM
   calls** — one narrow prompt per dimension, each returning a
   JSON-schema-constrained answer (a boolean or a short enum, not free
   text) instead of one long reasoning trace toward a number.
3. **Aggregates the final score in plain code** — a fixed weighted sum,
   never computed or adjusted by the LLM.

Decomposing the rubric into small, closed-form, independently-answerable
checks — instead of one holistic judgment — is itself one of this thesis's
candidate contributions, alongside the empirical consistency measurements.
See [`docs/architecture.md`](docs/architecture.md) for the full design
rationale and the literature it's grounded in.

## Project status

See [`docs/roadmap.md`](docs/roadmap.md) for the phase-by-phase task plan
and current progress (infrastructure → consistency experiments → ablation
→ dataset validation → optional fine-tuning → writing).

## Layout

```
src/grader/       grading pipeline (sandbox, LLM checks, aggregation)
prompts/          one prompt per rubric dimension, scoped narrowly
experiments/      consistency test, ablation, metrics
configs/          model/serving config (determinism-relevant settings)
data/             pilot dataset + generator (problems.py, build_dataset.py)
docs/             architecture notes, roadmap, literature references
results/          experiment outputs (gitignored, dir kept)
.claude/commands/ project-specific slash commands (see below)
```

## Quick start

```
pip install -r requirements.txt
python3 data/build_dataset.py                 # regenerates data/dataset.json locally
# start llama.cpp's llama-server (OpenAI-compatible) serving Qwen2.5-Coder-1.5B/3B-Instruct GGUF
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100
```

`data/dataset.json` is generated, not committed — always regenerate it
locally from `data/problems.py` rather than expecting it in a fresh clone.

## Working with Claude Code on this project

This repo has a `CLAUDE.md` (project rules and conventions) and a few
project-specific slash commands for the repetitive parts of running this
project:

| Command | Does |
|---|---|
| `/run-consistency <sample_id> [n]` | Runs the consistency experiment, reports a terse summary |
| `/run-ablation` | Runs the free-form vs. hybrid vs. decomposed comparison |
| `/add-problem <spec>` | Scaffolds a new problem into `data/problems.py`, regenerates the dataset |
| `/thesis-section <name>` | Drafts a report section from what's actually in `docs/` and `results/` |

## Known dataset limitation

The 33-sample pilot dataset has real, sandbox-executed labels for
correctness and edge-case handling, but efficiency/style labels are
single-rater (self-annotated by the author), not independent human ground
truth. Full detail and what's needed to fix it before making a
correlation-with-humans claim: [`data/script.md`](data/script.md).
