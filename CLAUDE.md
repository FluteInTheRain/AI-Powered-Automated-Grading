# AI-Powered-Automated-Grading — project memory

Master's thesis: sub-7B LLM system for grading programming assignments.
Hard requirement: exact-match score consistency across repeated runs on the
same input (temp=0, greedy, fixed seed, non-batched inference).

Read `docs/architecture.md` for the full design rationale and citations
before proposing architecture changes — don't re-derive it from scratch.

`docs/roadmap.md` is the live task tracker (checkboxes, task IDs T0.1...).
Check it at the start of a work session to find the current task, and check
off items there as they're completed — see that file's own header for the
exact protocol.

## Non-negotiable design rules (don't relitigate these without being asked)

- Correctness is scored ONLY by real sandboxed test execution
  (`src/grader/sandbox.py`), never by the LLM.
- Non-correctness rubric dimensions are scored by small, independent,
  structured-output LLM calls (`src/grader/rubric_checks.py` +
  `src/grader/schemas.py`) — one prompt per dimension, JSON-schema-constrained
  output, never one free-form holistic score.
- Final score is a fixed weighted sum computed in Python
  (`src/grader/aggregator.py`), never by the LLM.
- No agent framework / multi-agent orchestration in the grading pipeline
  itself (`src/grader/pipeline.py` is one sequential function) — there's
  nothing here for an orchestrator to buy, and every extra layer is a place
  determinism or tokens leak out.
- Fine-tuning (LoRA) is a fallback, only after `experiments/consistency_test.py`
  and `experiments/ablation.py` show prompting + structured output on the base
  model isn't enough. Don't propose fine-tuning as a first move.

## Known dataset limitation (repeat this caveat, don't drop it silently)

`data/dataset.json`: correctness + edge_case_handling labels are real
(sandbox-executed). efficiency + code_style labels are single-rater
(self-annotated by the author when writing `data/problems.py`) — NOT
independent human ground truth. Never report agreement with these labels as
"agreement with human graders" in thesis text; call it a pipeline sanity
check pending real instructor annotation. Full detail: `data/script.md`.

## Working style for this project

- Priority order: simple > fast > token-frugal > clever. If a task can be
  done with a plain script or a slash command instead of spawning a
  subagent, do that.
- Keep code comments and all data (`data/problems.py`, `data/dataset.json`,
  `data/script.md`) in English.
- When adding a problem to the pilot dataset, edit `data/problems.py` then
  run `python3 data/build_dataset.py` to regenerate `data/dataset.json` —
  never hand-edit the JSON.
- Experiment outputs go in `results/` (gitignored) as JSON, not inline in
  chat — summarize results in prose, don't dump raw numbers.
