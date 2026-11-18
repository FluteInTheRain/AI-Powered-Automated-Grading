# Cloudflare deployment: design

Date: 2026-11-17. Status: approach chosen by Khang (C, spike first); this doc
records the decisions so the plan can argue from them.

## Intent

Host the product web app (teacher authors a problem, shares an exam link,
students submit, teacher reviews results and audit trail) on Cloudflare,
**long-term and free**, so Khang can test it and later hand the link to
recruiters as a portfolio demo.

## Goals

- Always-on public URL (no dependency on Khang's Mac being awake).
- $0/month: Workers Free plan, D1 Free, Workers AI free allocation
  (10,000 Neurons/day).
- Same API contract as `server/` (teacher + exam + syntax-check routes), so
  the React frontend works unchanged apart from where it points.
- A stranger pasting hostile code cannot hang the app, read secrets, or
  reach the network from the sandbox.

## Non-goals

- Replacing `server/` + Postgres + `deploy/` (the VM path stays as is; the
  Worker is a parallel backend).
- The `/demo` page and its routes (`/api/problems`, `/api/run`,
  `/api/submit`, backed by `data/problems.py`).
- Changing the research pipeline, experiments, or llama.cpp path.
- Accounts/login, rate limiting, plagiarism checks.

## Anti-goals (would make this a failure even if it "works")

- Grading logic forked into a second copy that can drift from `src/grader/`.
- A recruiter's first click showing a raw Cloudflare error page.
- Any Cloudflare credential committed to the repo.

## Constraints

- Workers Free: **10 ms CPU per request** (network waits, incl. Workers AI
  and D1, do not count), 128 MB memory, 100,000 requests/day.
- Python Workers run on Pyodide: only pure-Python / PyEmscripten / Pyodide
  packages. `psycopg`, SQLAlchemy's Postgres path and Alembic are out.
- Workers AI: `seed` must be >= 1; JSON-schema output via the binding.
  Model: `@cf/qwen/qwen2.5-coder-32b-instruct` (verified working
  2026-11-17 through the REST API, see the KB gotcha note
  `cloudflare-workers-ai-openai-compat-quirks`).
- Measured on CPython (Mac M2, LLM mocked): sandbox median 0.04 ms / max
  0.97 ms over 65 submissions; full `/api/submit` median 1.95 ms / max
  2.09 ms over 16 problems. Pyodide overhead unmeasured.
- Project rules (`CLAUDE.md`): correctness only from sandbox execution; one
  structured LLM call per dimension; final score summed in Python; pipeline
  stays one sequential function.

## Approaches considered

| | What | Cost | Trade-off |
|---|---|---|---|
| A | Cloudflare Containers running `deploy/Dockerfile.backend` + Neon Postgres + static frontend | $5/mo (Workers Paid) | Reuses all code; cold start on first visit; sandbox still `exec()` next to secrets |
| B | Static frontend on Cloudflare, backend on another free host (e.g. Render) + Neon | $0 | Free hosts sleep, so long first-load waits for recruiters; two providers |
| **C (chosen)** | Python Worker (FastAPI) + D1 + Workers AI binding + static assets, all in one Worker | $0 if within 10 ms CPU | Rewrite of the DB layer; Pyodide unknowns; best sandbox containment |

C chosen because it is the only $0, always-fast, single-provider option, and
the CPU measurements above suggest it fits. A is the fallback if the spike
fails the CPU gate.

## Decisions

- **Spike first, throwaway**, answering: CPU per graded request on Free
  (warm and cold), sync-vs-async access to the AI binding, D1 from Python,
  bundling of `src/grader` + `prompts/`, `openpyxl` on Pyodide, and whether
  `exec`'d code can reach `js.fetch`. Go/no-go before any real code.
- One Worker serves both the API (`/api/*`, worker-first) and the built
  frontend (static assets, SPA fallback). Same origin, no CORS.
- `src/grader/` is reused as-is, copied into the Worker bundle by a build
  script; no fork. Workers-specific code lives in `worker/`.
- LLM calls go through a `WorkersAIClient` exposing the same
  `structured_call(system_prompt, user_prompt, schema)` and `call_log` as
  `LLMClient`, using the `AI` binding (no API key), `seed=1`.
- Storage: D1 with the same 4 tables as `server/models.py` (TEXT ids,
  JSON stored as TEXT, ISO-8601 timestamps).
- Sandbox: `exec` namespace refuses imports of `js`, `pyodide`, `workers`
  (defense in depth; harmless on CPython). The Worker's CPU limit is the
  timeout.
- Frontend: relative API base (`''`) plus a Vite dev proxy for `/api` to
  `localhost:8001`; non-JSON error responses (Cloudflare limit pages) are
  shown as a plain "submission exceeded the time/resource limit" message.

## Left to the builder

File-internal structure, SQL style, test helpers, exact copy of UI error
strings (English, matching existing UI tone).

## Spike results

_(filled in by Task 0)_
