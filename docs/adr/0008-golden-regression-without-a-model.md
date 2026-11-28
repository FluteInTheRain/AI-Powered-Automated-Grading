# 0008. Grading drift is caught in CI by golden files that need no model

Status: accepted, 2026-11-28 (T7.5)

## Context

Prompts, schemas, weights and scoring formulas decide every score, and a change to any of them can shift grades without a test failing. CI has no Workers AI token, so it cannot call a model.

## Decision

Two golden checks run in the existing Python job on every pull request. A prompt snapshot stores the hash and rendered text of every prompt, and a replay grades 13 frozen submissions through the real `grade()` with recorded LLM answers and compares exact scores. `python3 scripts/update_golden.py` regenerates the expected values, and the diff is reviewed and committed with the change. The recorded answers are hand authored and labeled as such. A live comparison against the real model is documented in `docs/golden-regression.md` but not built.

## Consequences

A prompt, weight, formula or schema change can no longer be accidental. CI stays token free and takes about a second more. The replay says nothing about how the real model answers, so a model change or a prompt that reads worse is still found only by the canary or by the live job once it exists. Golden files must be regenerated and reviewed with each deliberate change.
