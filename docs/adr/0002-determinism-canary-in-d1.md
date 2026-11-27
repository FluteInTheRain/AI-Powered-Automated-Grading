# 0002. Determinism is measured by a daily canary stored in D1

Status: accepted, 2026-11-27 (T6.5)

## Context

The project's hard requirement is exact-match scores on identical input. Identical submissions are rare in production, so it cannot be read from traffic. A canary could be stored in Analytics Engine or D1.

## Decision

The daily Cron grades one fixed input through `gradeQuestion` and inserts a row into `canary_runs` (D1): score, sub-scores, SHA-256 of the raw LLM responses, `model`, `input_version`. The baseline is the first row with the same `(model, input_version)`; a row is stable iff all three values equal the baseline's. A grader error stores `status='error'`, shown as an error, not as a mismatch.

## Consequences

One row a day, exact comparison, testable without any token. Deliberately changing the model, prompts or rubric means bumping `input_version`, which starts a new baseline so the page is not red forever. Cron failures in the canary must not stop `expireStaleAppeals`.
