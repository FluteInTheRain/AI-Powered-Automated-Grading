# 0006. Feature flags are kill switches in one env var

Status: accepted, 2026-11-28 (T7.6)

## Context

Four features carry more risk than the core flow: similarity checking, CSV export, bulk import and appeals. If one misbehaves in production we want to
turn it off without writing and reviewing a code change under pressure.

## Decision

A single variable `DISABLED_FEATURES` in `wrangler.jsonc` `vars` lists the features to disable (`similarity`, `csv_export`, `bulk_import`, `appeals`). A small Hono middleware (`src/flags.ts`) answers 404
`{"detail":"feature disabled"}` on the gated routes before the handler runs, so a disabled feature does no D1, R2 or queue work. `GET /api/teacher/me` and the student exam summary expose the state so app-ui can hide the control.

Why an env var: it needs no table, no migration and no extra binding, and it is read from the request's own `env`, so there is nothing new to fail. Why the default is "enabled": the flag only removes
features. A missing, empty or mistyped value leaves the app as it was, and a typo cannot switch off grading by accident (unknown names are ignored and logged once with `console.warn`). The core flow (exam, attempts, grading) has no flag.

## Consequences

Changing the value means a new Worker version. This repo's CI deploy (`npx wrangler deploy`, no `keep_vars`) takes `wrangler.jsonc` as the source of truth, so a dashboard edit is overwritten by the next merge to `main`. The safe
procedure is to change `wrangler.jsonc` and merge. For an emergency, edit the dashboard first and commit the same value straight after. Details in `app-worker/README.md`.

Limits: all or nothing per feature (no per teacher or percentage rollout); a flag hides the feature but keeps stored data; a page already open in a browser keeps its button until reload, though the API refuses the call; the flags cannot turn something on.
