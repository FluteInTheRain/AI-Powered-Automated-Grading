# 0003. AI Gateway in front of Workers AI, response cache off

Status: accepted, 2026-11-27 (T6.5)

## Context

The parent spec wants AI Gateway for logs, token counts and latency. A Gateway cache hit would return a stored answer and fake the score consistency the project claims. The vendored `llm_client.py` also warns that `json_schema` through Gateway is untested.

## Decision

Pass `{ gateway: { id, skipCache: true } }` in `worker/src/app/bridges.py` (project code, not vendored). Cache is never enabled. The first real graded call through the Gateway verifies structured output; if it breaks, the option is removed and the Gateway is documented as unusable with schema-constrained output.

## Consequences

Token and per-call latency are read in the Cloudflare dashboard, not copied into the app. If the Gateway fails verification, the rest of T6.5 (events, canary, pages) is unaffected.
