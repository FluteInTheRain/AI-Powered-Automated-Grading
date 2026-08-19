# AI-Powered-Automated-Grading

Master's thesis project: a sub-7B LLM system for automated grading of
programming assignments, designed around one hard requirement —
run-to-run score consistency (same input -> same score, every time).

Correctness is scored by real sandboxed test execution (deterministic,
no LLM). The rest of the rubric (efficiency, style, edge cases) is scored
by an LLM, but decomposed into small closed-form checks with structured
output (temp=0, fixed seed, constrained decoding) instead of one free-form
holistic score. Final score is a fixed weighted aggregation computed in
code. See [`docs/architecture.md`](docs/architecture.md) for the full
design and literature grounding, and [`data/script.md`](data/script.md)
for the pilot dataset and its known label-quality limitations.

## Layout

```
src/grader/       grading pipeline (sandbox, LLM checks, aggregation)
prompts/          one prompt per rubric dimension, scoped narrowly
experiments/      consistency test, ablation, metrics
configs/          model/serving config (determinism-relevant settings)
data/             pilot dataset + generator (problems.py, build_dataset.py)
docs/             architecture notes, literature references
results/          experiment outputs (gitignored contents, kept dir)
```

## Quick start

```
pip install -r requirements.txt
# start a vLLM (or other OpenAI-compatible) server serving Qwen2.5-Coder-3B-Instruct
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100
```
