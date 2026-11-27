# 0005. Metric writes never affect grading

Status: accepted, 2026-11-27 (T6.5)

## Context

One Analytics Engine data point is written per `processJob` call. A metrics fault must not fail, retry or slow a grade.

## Decision

`writeDataPoint` (synchronous, no `waitUntil` needed) is wrapped in try/catch and errors are dropped. Events are per delivery attempt, not per job; `delivery_attempt` is the Queues `msg.attempts`; "retry count" is the number of `retry` events. Counts sum `_sample_interval` so sampled data stays correct.

## Consequences

A silent metrics fault shows only as an empty series on the developer page, which is the intended visible symptom.
