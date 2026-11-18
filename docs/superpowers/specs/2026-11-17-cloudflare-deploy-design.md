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

Run 2026-11-18 on `grading-spike.khangnguyen.workers.dev` (deleted afterwards
together with its D1). Account assumed on Workers Free; the plan could not be
read through the API with the wrangler OAuth token. CPU from `wrangler tail`
(`cpuTime`).

| Q | Question | Result |
|---|---|---|
| Q1 | FastAPI app deploys and serves | Pass, after adding `Default = asgi.entrypoint(app)` |
| Q2 | CPU per graded request ≤ 10 ms | **Fail.** Over 32 requests, `/grade-fake` (sandbox, scoring, pydantic; LLM faked) had median **91 ms**, min 18 ms, max 201 ms. Over 8 requests, `/grade-ai` (real Workers AI) had median **95 ms**, max 281 ms. Even an empty `GET /` had median 17.5 ms. Pyodide was about **45×** slower than CPython (1.95 ms). Every request still returned `outcome: ok`: the 10 ms limit was **not enforced** in practice, but it is the documented limit |
| Q3 | Sync code can call the AI binding | Pass. `pyodide.ffi.run_sync(env.AI.run(...))` works, and the result is already a Python object (no `.to_py()`). A real grade of `P01_two_sum__S1` gave 94.0, the same as the REST API run |
| Q4 | D1 from Python | Pass. Vietnamese text plus 300 lines round-trip identical. `db.batch(python_list)` works, while `Array.push` and `to_js(create_pyproxies=False)` do not |
| Q5 | `openpyxl` on Pyodide | Pass (1476 ms CPU on the first, cold call) |
| Q6 | `prompts/*.txt` readable | Pass **if** `grader` sits in `src/vendor/grader` with prompts in `src/prompts`, which keeps `parents[2]/prompts` valid. With `src/grader` it fails |
| Q7 | Student code reaching out | **Fail, serious.** `run_sync(js.fetch(...))` from exec'd code got HTTP 200. Walking `sys._getframe()`, or **a traceback with no import at all**, reached `request.scope["env"]` with `DB`, so student code can read and modify all data and spend the AI quota. `urllib.request` is refused |

Other findings:
- `src/grader/{pipeline,rubric_checks,feedback}.py` import `llm_client`, which imports `openai` at module load. `openai` cannot load in a Worker ("Randomness is not allowed while a Worker is starting"). Fix: import `LLMClient` under `TYPE_CHECKING` only.
- Dynamic Workers (`globalOutbound: null`) would isolate student code, but they need Workers Paid.
- A new `workers.dev` subdomain (`khangnguyen`) took about 30 s to get its TLS certificate.

## Decision after the spike (2026-11-18, Khang)

**Go with C on Workers Free, accepting the risks below** (option 3 of: C on
Workers Paid, A on Containers, C on Free).

Changes to the design above:
- **Sandbox isolation:** student code runs in a second Worker,
  `grading-sandbox`, which has **no bindings** and **no public URL**
  (`workers_dev: false`). It is reachable only through a service binding
  `SANDBOX` from the main Worker. Frame-walking there finds no DB or AI. The
  `js`/`pyodide` import guard is dropped (`sys.modules["js"]` bypasses it).
- **`src/grader` changes allowed, both behavior-preserving:**
  (1) import `LLMClient` under `TYPE_CHECKING` in `pipeline.py`,
  `rubric_checks.py` and `feedback.py`;
  (2) `grade(sample, client, run_submission=run_submission)`, so the Worker
  can pass a remote runner.
- **Bundle layout:** `src/vendor/grader` plus `src/prompts`.
- **LLM calls:** sync via `pyodide.ffi.run_sync`.

Accepted risks (Khang chose these knowingly):
1. Grading uses about 90 ms CPU against a documented 10 ms Free limit that
   is not enforced today. If Cloudflare starts enforcing it, grading
   requests fail. The fix then is Workers Paid ($5/mo) with no code change.
2. Student code in `grading-sandbox` can still make outbound HTTP requests
   (no egress control on Free). It has no secrets or data to send.
3. Teacher pages have no login, so anyone with the URL can create problems
   and use up the 10,000 Neurons/day. That costs no money, but grading can
   be unavailable until the 00:00 UTC reset.

**Gate (as originally designed): no-go for C as designed.** It works today only because the Free CPU limit is not being enforced; at about 90 ms per grade that is ~9× over the documented limit, too fragile for a long-term demo. The in-process sandbox also exposes the DB to student code (Q7). Next step: Khang decides between A (Containers, $5/mo), C on Workers Paid ($5/mo, 30 s CPU), or C on Free accepting the risk.
