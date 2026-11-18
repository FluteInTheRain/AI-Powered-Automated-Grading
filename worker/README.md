# Cloudflare Workers deployment

The exam app (teacher pages, student exam links, admin results) runs on
Cloudflare's **Workers Free** plan as two Python Workers:

| Worker | Folder | What it does | Bindings | Public URL |
|---|---|---|---|---|
| `grading` | `worker/` | FastAPI API (`/api/*`) + the React app as static assets | `DB` (D1), `AI` (Workers AI), `SANDBOX` (service binding), `ASSETS` | https://grading.khangnguyen.workers.dev |
| `grading-sandbox` | `sandbox-worker/` | Runs student code and returns outputs only | none | none (`workers_dev: false`) |

```
browser ──> grading ──(service binding SANDBOX)──> grading-sandbox   (runs student code)
              │
              ├── D1 database "grading"   (problems, exams, submissions, LLM call logs)
              └── Workers AI              (rubric checks + feedback, @cf/qwen/qwen2.5-coder-32b-instruct)
```

Correctness is still scored only by executing the code (in `grading-sandbox`).
Expected values never enter the sandbox Worker, so student code cannot read them
while it runs; `grading` compares the outputs. They are not secret from students,
though: the submit result lists failed hidden cases (see "Known limitations"). The design and the reasons for it are in
`docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`
("Decision after the spike").

## Prerequisites

- `uv` >= 0.13.4 (pywrangler needs it) and Node.js/npm (wrangler and the frontend build).
- A logged-in wrangler: `npx wrangler login` once. Every command below that talks
  to Cloudflare uses that login.

All `pywrangler` commands run through `uv run` inside `worker/` or `sandbox-worker/`;
pywrangler hands non-Python subcommands straight to `npx wrangler`.

## First deploy (already done once, 2026-11-18)

```bash
# 1. Remote database. Put the printed database_id into worker/wrangler.jsonc.
cd worker
uv run pywrangler d1 create grading
uv run pywrangler d1 migrations apply grading --remote
cd ..

# 2. Build: copy the shared code into each Worker bundle, build the frontend.
./sandbox-worker/build.sh
./worker/build.sh

# 3. Deploy the sandbox first (grading's SANDBOX binding points at it), then grading.
(cd sandbox-worker && uv run pywrangler deploy)
(cd worker && uv run pywrangler deploy)
```

A brand-new workers.dev hostname can return 404 or fail the TLS handshake for
about 30 seconds after the first deploy. Wait and retry.

The current database id is `55195641-a141-4a76-bd0b-858f35503fe2` (region APAC).

## Redeploy after a code change

```bash
# Optional DEMO_EXAM_PATH shows a "try it" box on the home page linking to a sample exam.
./sandbox-worker/build.sh && DEMO_EXAM_PATH=/exam/<student_token> ./worker/build.sh
(cd sandbox-worker && uv run pywrangler deploy)   # only if src/grader/sandbox.py or sandbox-worker/ changed
(cd worker && uv run pywrangler deploy)
```

- The build scripts must run first: `worker/src/vendor/`, `worker/src/prompts/`,
  `worker/src/server/` and `sandbox-worker/src/vendor/` are gitignored copies of
  `src/grader`, `prompts/` and `server/rules.py`. Deploying without a build ships
  stale copies.
- `pywrangler deploy` runs `sync` (installs the Python packages into
  `python_modules/`) for its own Worker.
- A new migration in `worker/migrations/` needs
  `uv run pywrangler d1 migrations apply grading --remote` before the deploy.

## Local run (both Workers in one process)

```bash
./sandbox-worker/build.sh && ./worker/build.sh
(cd sandbox-worker && uv run pywrangler sync)   # required: dev only syncs the worker/ project
cd worker
uv run pywrangler d1 migrations apply grading --local
uv run pywrangler dev -c wrangler.jsonc -c ../sandbox-worker/wrangler.jsonc --port 8787
```

Without the `sync` in `sandbox-worker/`, the sandbox fails at startup with
`ModuleNotFoundError: No module named 'fastapi'`. Workers AI calls go to the real
service even in local dev (they use your account's daily allowance). The local
runtime does not enforce CPU limits, so the infinite-loop case only shows up live.

## Logs

```bash
cd worker
npx wrangler tail grading --format json
npx wrangler tail grading-sandbox --format json
```

Each event has `outcome` (`ok`, `exception`, `exceededCpu`, ...), `cpuTime` and
`wallTime` in milliseconds. Observability is also on in both configs, so the same
data is in the dashboard.

## Measured CPU time (live, 2026-11-18)

From `wrangler tail --format json` during one normal submit (a correct `add(a, b)`,
1 public + 2 hidden cases, 4 Workers AI calls):

| Worker | Request | `cpuTime` | `wallTime` | `outcome` |
|---|---|---|---|---|
| `grading` | `POST /api/exam/{token}/submit` | 176 ms | 12 810 ms | ok |
| `grading-sandbox` | `POST /execute` (the hidden-case run) | 60 ms | 61 ms | ok |

Other requests in the same session: grading submits 82–92 ms, `run` 42–211 ms,
preview 221 ms, admin results 92–155 ms, `export.xlsx` 1 408 ms (openpyxl);
sandbox `/execute` 18–120 ms. Wall time of a submit is mostly waiting for
Workers AI, which does not count as CPU.

All of these are far over the documented 10 ms Free-plan CPU limit, and all had
`outcome: ok`, so that limit is not enforced today (accepted risk 1). There is a
hard ceiling, though: an infinite loop in student code was stopped by the
runtime after 1 864 ms and 1 951 ms CPU (`CpuLimitExceeded`, outcome `exception`).
`export.xlsx` (1 408 ms for one row) is the request closest to that ceiling, so
exporting a very large exam could fail.

## Workers AI usage per submit (measured 2026-11-18)

A graded submit makes 4 Workers AI calls: 3 rubric checks plus 1 feedback call.
The calls were replayed through the REST API with the same model and
`max_tokens=2048`, and the token counts were converted at the published rate for
`@cf/qwen/qwen2.5-coder-32b-instruct`: 60,000 Neurons per M input tokens and
90,909 per M output tokens.

| Sample | Input tokens | Output tokens | Neurons |
|---|---|---|---|
| `P01_two_sum__S1_correct_clean` | 1,034 | 439 | 102 |
| `P02_is_prime__S3_edge_case_bug_negative` | 1,008 | 376 | 95 |
| `P05_fibonacci__S2_correct_but_exponential` | 877 | 445 | 93 |

That is about **100 Neurons per submit**, so the free 10,000 Neurons per day
cover roughly **100 graded submits per day**.
- A submit that passes no test skips the 3 checks. It costs only the feedback
  call, roughly a quarter of the above.
- `run`, preview and syntax-check use no Workers AI.
- These figures come from token counts × the published rate, not from the
  billing dashboard. Longer statements or code cost proportionally more.

## Accepted risks (Khang chose these knowingly)

1. **CPU limit.** Grading uses well over the documented 10 ms Free-plan CPU
   limit (see the table). It works only because Cloudflare does not enforce that
   limit today. If it starts to, grading requests fail. The fix is Workers Paid,
   with no code change (see below).
2. **Outbound requests from student code.** Code in `grading-sandbox` can still
   make HTTP requests to the internet; the Free plan has no egress control. The
   sandbox has no bindings, secrets or expected answers, so there is nothing of
   ours to send.
3. **No login on teacher pages.** Anyone with the URL can create problems and
   submit, and use up the 10,000 Workers AI Neurons per day. That costs no money
   (Free plan), but grading stops working until the daily reset at 00:00 UTC.
4. **Shared sandbox state.** The sandbox Worker reuses a warm isolate across
   requests, so student code can change module or builtins state and affect later
   submissions on that isolate. There is no Free-plan fix (Dynamic Workers need
   Paid, and Python-level guards can be bypassed). Mitigation: the sandbox only
   returns outputs and `grading` compares them, so expected answers are never in
   the sandbox for running code to read or tamper with. (They still reach the
   student through the submit result; see "Known limitations".)

What the live checks showed for the sandbox boundary (2026-11-18):

- Student code that walks the call stack (`sys._getframe()` and a traceback's
  `tb_frame`) reaches the sandbox's own request `env`. Asking it for `DB`, `AI`,
  `SANDBOX`, `ASSETS` or `LLM_MODEL` raises `AttributeError` every time: that env
  is empty.
- `https://grading-sandbox.khangnguyen.workers.dev/execute` answers
  `404 error code: 1042` from Cloudflare and never reaches the Worker.
- An infinite loop is stopped after about 2 s CPU. On submit the student sees
  `502 Grading failed: your submission exceeded the time/resource limit.` and no
  submission row is saved.

## Known limitations (pre-existing in `server/`, not Cloudflare-specific)

These are product behaviours the Worker copies from `server/`; they are not part
of the spec's accepted risks.

- **Hidden test cases are visible after a wrong submit.** The submit response's
  `execution_result.errors` lists each failed hidden case as
  `input=... expected=... got=...` (the student's return value). Nothing stops a
  student from submitting again under the same exam link, so hidden cases can be
  learned across attempts. Same behaviour as `server/exam.py`.

## Worker-specific behaviour (differs from `server/`)

- **Error messages.** `server/` has no execution time limit at all; on the Worker
  the runtime stops student code after about 2 s CPU. A stopped sandbox (the
  fetch raises) and a failing sandbox (non-200 status) are told apart, and every
  5xx is logged with the exam/problem ids (see `wrangler tail`). All are JSON
  `502` with a fixed `detail`:

  | Route | Code ran out of time | Sandbox or other service error |
  |---|---|---|
  | submit | `Grading failed: your submission exceeded the time/resource limit.` | `Grading service error, please try again.` (sandbox) / `Grading failed, please try again. If it keeps happening, contact your teacher.` (Workers AI etc.) |
  | Run Tests | `Your code exceeded the time/resource limit.` | `Grading service error, please try again.` |
  | preview | `Reference or wrong solution exceeded the time/resource limit.` | `Grading service error, please try again.` |
  | create problem | `Reference solution exceeded the time/resource limit.` | `Grading service error, please try again.` |

  If saving a graded submission fails: `Your submission was graded but could not
  be saved. Please try again.` Nothing is stored in any of these cases.
- **`exit()` / `sys.exit()` in student code** is a `COMPILE_ERROR: program exited
  (SystemExit: ...)` result (correctness 0), not a crash. Return values over 64 KB
  of JSON become a per-case error `return value too large (N bytes)`.
- **Outputs are compared after a JSON round trip** (ruling R4): the sandbox sends
  outputs back as JSON, so a function returning a tuple passes against a list
  expected value. `server/` compares Python objects directly and fails it.
- **Consistency is not established here.** The hosted demo runs a 32B model
  (`@cf/qwen/qwen2.5-coder-32b-instruct`) on shared Workers AI, so the project's
  sub-7B and exact-match-consistency claims do not carry over. In one check (n=2)
  two identical submits gave the same score but different raw LLM text.
- **Cloudflare AI Gateway is unverified.** `grader.llm_client.LLMClient` warns when `base_url` is `gateway.ai.cloudflare.com`: how Workers AI handles `json_schema` behind the gateway is untested, so structured calls may fail or come back unconstrained. The Worker itself uses the AI binding, not this client.

## What is not supported on Cloudflare

- **The `/demo` page.** It uses the pilot-dataset endpoints of `server/main.py`
  (`/api/problems`, `/api/run`, `/api/submit`), which the Worker does not have, so
  the page loads but its API calls return 404. `worker/build.sh` builds the
  frontend with `VITE_HIDE_DEMO=1`, which hides the "Demo mode" button in the
  teacher page header; local and `deploy/` builds keep it. Use the local server
  (`uvicorn server.main:app`) for the demo.
- The research experiments (`experiments/`) still run locally against llama.cpp;
  the Worker only serves the exam app.

## Switching to Workers Paid

Do this if requests start failing with CPU-limit errors (tail shows
`outcome: exceededCpu`, users see `Grading failed` or a Cloudflare 1102 page).

1. In the Cloudflare dashboard, upgrade the account's Workers plan to
   **Workers Paid** ($5/month).
2. That's it. No code or config change and no redeploy: Paid allows 30 s CPU per
   request by default, far above what grading uses.

Side effect: an infinite loop in student code may then run much longer than the
~2 s seen on Free before it is stopped (not measured). Setting
`"limits": { "cpu_ms": 5000 }` in `sandbox-worker/wrangler.jsonc` should lower
that ceiling, but this is untested.

Paid also makes the risk 4 fix possible (a fresh isolate per submission with
Dynamic Workers), but that one does need code changes.

## Remove the deployment

```bash
cd worker && npx wrangler delete grading
cd ../sandbox-worker && npx wrangler delete grading-sandbox
npx wrangler d1 delete grading   # deletes all problems, exams and submissions
```
