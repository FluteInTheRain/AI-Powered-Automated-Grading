# Cloudflare Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the teacher/exam web app from one free Cloudflare Python Worker (FastAPI + D1 + Workers AI binding + static frontend), reusing `src/grader/` unchanged.

**Architecture:** A throwaway spike (Task 0) checks the Pyodide/Free-plan unknowns and is a hard go/no-go gate. If it passes, a new `worker/` project mirrors the `server/` API contract on D1, calls Workers AI through a client with the same interface as `LLMClient`, and serves `frontend/dist` as static assets from the same origin. Pure route rules are pulled out of `server/` into `server/rules.py` so both backends share them.

**Tech Stack:** Python 3.13 on Pyodide (Cloudflare Python Workers), FastAPI, Pydantic, D1 (SQLite), Workers AI, `pywrangler` (`workers-py`), uv, pytest, React/Vite.

**Spec:** `docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`

## Global Constraints

- Workers **Free** plan only; nothing may require Workers Paid.
- CPU per request ≤ 10 ms on Free (network waits excluded).
- Model `@cf/qwen/qwen2.5-coder-32b-instruct`, `temperature=0`, `seed=1`.
- API paths, request and response JSON identical to `server/teacher.py`, `server/exam.py` and `/api/syntax-check` in `server/main.py`.
- `src/grader/` is never copied into git or edited for Worker-only reasons. The build copies it into the bundle. The only allowed change to it is Task 2's import guard.
- No Cloudflare account ID, token or database ID secret in git. The D1 `database_id` in `wrangler.jsonc` is not a secret and may be committed.
- `CLAUDE.md` design rules hold: correctness from the sandbox only, one structured LLM call per dimension, score summed in Python.
- Code comments and UI copy in English.

## Review Focus

1. **A submission that burns CPU** (`while True: pass`, exponential recursion): the Worker is killed. Expected: the student sees "Your submission exceeded the time/resource limit" instead of a raw Cloudflare page, and no half-written submission row is left. Covered in Task 1 (frontend mapping) and the Task 7 live check.
2. **The Workers AI daily allocation runs out, or AI errors:** submit returns 502 with a readable detail and persists nothing. Covered in Task 5, `test_submit_ai_failure_persists_nothing`.
3. **Student code tries `import js` / `from pyodide.http import pyfetch`** to reach the network: it scores as `compile_error` and no outbound call happens. Covered in Task 2.
4. **The deadline passes while a student is mid-exam:** run and submit return 403, as on `server/`. Covered in Task 5, `test_closed_exam_rejects_run_and_submit`.
5. **Vietnamese text and long code** (statement in Vietnamese, 300-line submission) round-trip through D1 byte-identical. Covered in Task 3, `test_unicode_and_long_text_roundtrip`.

---

### Task 0: Spike (throwaway) and go/no-go gate

**Files:**
- Create (scratch, NOT committed): `$SCRATCH/cf-spike/` (a pywrangler project)
- Modify: `docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md` (fill in "Spike results")

**Interfaces:**
- Produces: the recorded answers to Q1–Q7 below. Tasks 3–6 branch on Q3, Q5 and Q6.

- [ ] **Step 1: Khang logs in.** In his own terminal: `npx wrangler login` (browser OAuth). Claude cannot do this step.
- [ ] **Step 2: Scaffold the spike** from `cloudflare/python-workers-examples/fastapi`. Add bindings `AI` (Workers AI) and `DB` (`wrangler d1 create grading-spike`). Copy `src/grader/` and `prompts/` into the spike's `src/`.
- [ ] **Step 3: Add routes that each answer one question:**
  - Q1 `GET /` returns 200 when deployed (`uv run pywrangler deploy`).
  - Q2 `POST /grade-local` runs `run_submission` on `P01_two_sum__S1` and `P16_power__S3`, plus `aggregate`, with the LLM faked. CPU is read from `wrangler tail` (`cpuTime`). Record warm median, max, and the first (cold) request.
  - Q3 `GET /ai-sync` calls `env.AI.run(model, {...})` from a plain `def` via `pyodide.ffi.run_sync`. Record: works / raises.
  - Q4 `GET /d1` creates a table, inserts and selects a row with Vietnamese text.
  - Q5 `GET /xlsx` builds a 2-row `openpyxl` workbook into `BytesIO`.
  - Q6 `GET /prompt` reads `prompts/efficiency.txt` via `Path(__file__)` as `rubric_checks._load_prompt` does.
  - Q7 `POST /exec-js` execs `import js; js.fetch("https://example.com")` and reports whether a request left the Worker.
- [ ] **Step 4: Gate.** Go only if Q1, Q2 (warm max < 8 ms, cold request not killed) and Q4 pass. **On no-go: stop, record results, and return to Khang with approach A. Do not improvise.**
- [ ] **Step 5: Record Q1–Q7 results** with numbers in the spec's "Spike results" section. Delete the spike Worker and D1 (`wrangler delete`, `wrangler d1 delete grading-spike`).
- [ ] **Step 6: Commit** the spec update: `git commit -m "docs: record Cloudflare spike results"`.

Branch rules for later tasks:
- **Q3 fails** → Task 4 implements `async structured_call`, and Task 5 adds `grade_async`. See the notes in those tasks.
- **Q5 fails** → the export route returns CSV (`text/csv`, same columns) instead of xlsx, and the frontend link label changes to "Export CSV".
- **Q6 fails** → the build script generates `worker/src/_prompts.py` (a dict of filename → text), and `rubric_checks._load_prompt` / `feedback.PROMPT_PATH` fall back to it via a `GRADER_PROMPTS` module lookup. That is the only other permitted `src/grader` change.

---

### Task 1: Frontend works same-origin and shows limit errors plainly

**Files:**
- Modify: `frontend/src/api.js:1-13`
- Modify: `frontend/vite.config.js`

**Interfaces:**
- Produces: `request()` throws `Error` with a readable message for any non-JSON error body.

- [ ] **Step 1: Change `API_BASE` to `''`** and add `server.proxy: { '/api': 'http://localhost:8001' }` in `vite.config.js`. Local dev still reaches uvicorn, and `deploy/` (nginx, same origin) starts working too.
- [ ] **Step 2: In `request()`, when `!res.ok` and the body is not JSON,** throw `new Error('Your submission exceeded the time/resource limit or the server is busy. Please try again.')`. Keep `body.detail` for JSON errors.
- [ ] **Step 3: Verify.** `cd frontend && npm run build && ! grep -r "localhost:8001" dist/` exits 0. Then `npm run dev` with uvicorn on 8001: the teacher page loads and the problem list fetch succeeds.
- [ ] **Step 4: Commit:** `git commit -m "fix: relative API base + readable non-JSON errors in frontend"`.

### Task 2: Sandbox refuses JS-bridge imports

**Files:**
- Create: `requirements-dev.txt` (`pytest>=8`), `tests/__init__.py`, `tests/conftest.py` (adds repo root, `src`, `data` and `worker/src` to `sys.path`, so `grader`, `server.rules` and `app` import the same way as inside the Worker bundle)
- Modify: `src/grader/sandbox.py:20-27` (`_execute` namespace)
- Test: `tests/test_sandbox_guard.py`

**Interfaces:**
- Produces: `run_submission` / `run_submission_cases` return `status == "compile_error"` when the code imports `js`, `pyodide` or `workers` at module level. Imports inside the function make that test case fail with an `error` instead.

- [ ] **Step 1: Write failing tests:**
```python
from grader.sandbox import run_submission, run_submission_cases

def test_module_level_js_import_is_compile_error():
    r = run_submission("import js\ndef f(x):\n    return x", "f", [((1,), 1)])
    assert r["status"] == "compile_error" and "js" in r["errors"][0]

def test_pyodide_import_inside_function_fails_case():
    code = "def f(x):\n    from pyodide.http import pyfetch\n    return x"
    r = run_submission_cases(code, "f", [((1,), 1)])
    assert r["status"] == "ran" and r["cases"][0]["passed"] is False and r["cases"][0]["error"]

def test_normal_imports_still_work():
    r = run_submission("import math\ndef f(x):\n    return math.isqrt(x)", "f", [((9,), 3)])
    assert r["pass_rate"] == 1.0
```
- [ ] **Step 2: Run** `python3 -m pytest tests/test_sandbox_guard.py -v`. Expected: the first two FAIL.
- [ ] **Step 3: Implement.** In `_execute`, build the namespace with `__builtins__` set to a copy of `builtins.__dict__` whose `__import__` raises `ImportError("import of '<name>' is not allowed in submissions")` when the top-level module name is in `_BLOCKED_MODULES = frozenset({"js", "pyodide", "workers"})`, and otherwise delegates to the real `__import__`.
- [ ] **Step 4: Run** the tests and `python3 data/build_dataset.py`. Expected: tests PASS, and the dataset summary is unchanged (65 samples, same pass_rates).
- [ ] **Step 5: Commit:** `git commit -m "feat: sandbox refuses js/pyodide/workers imports"`.

### Task 3: D1 schema and store

**Files:**
- Create: `worker/migrations/0001_init.sql`, `worker/src/app/__init__.py`, `worker/src/app/store.py`
- Test: `tests/worker/fake_d1.py`, `tests/worker/test_store.py`

**Interfaces:**
- Consumes: a D1-like `db` object: `db.prepare(sql).bind(*params)` with async `.all()` (→ `{"results": [dict]}`), `.first()` (→ `dict | None`) and `.run()`, plus async `db.batch(list_of_bound_statements)` (all-or-nothing). The Worker passes the real binding through a thin adapter in Task 6. Tests pass `FakeD1` (the same API over `sqlite3`, applying `0001_init.sql`).
- Produces (all `async`, ids are `uuid4().hex`, timestamps ISO-8601 UTC, JSON columns stored as TEXT and returned decoded):
  - `create_problem(db, *, statement, func_name, param_names: list[str], rubric: dict, reference_solution, test_cases: list[dict], starter_code) -> str`
  - `list_problems(db) -> list[dict]` (newest first; keys `id, statement, created_at`)
  - `get_problem(db, problem_id) -> dict | None`
  - `create_exam(db, *, problem_id, student_token, admin_token, deadline: str | None, time_limit_seconds: int) -> dict`
  - `get_exam_by_student_token(db, token) -> dict | None` / `get_exam_by_admin_token(db, token) -> dict | None` (each includes the nested `problem` dict)
  - `set_deadline(db, exam_id, deadline: str | None) -> None`
  - `add_submission(db, *, exam_id, student_name, code, result: dict, logs: list[dict]) -> str`, writing the submission and all `grading_logs` rows in **one** `db.batch([...])`, so a failure leaves nothing
  - `list_submissions(db, exam_id) -> list[dict]` (oldest first) / `get_submission(db, submission_id) -> dict | None` / `get_logs(db, submission_id) -> list[dict]` (by `call_index`)

- [ ] **Step 1: Write `0001_init.sql`:** tables `problems`, `exams` (UNIQUE `student_token`, `admin_token`), `submissions`, `grading_logs`, with the columns of `server/models.py`. UUID → TEXT, JSONB → TEXT, DateTime → TEXT.
- [ ] **Step 2: Write failing tests:** `test_problem_exam_submission_roundtrip`, `test_add_submission_is_atomic` (FakeD1 configured to fail the 2nd log insert, so 0 submissions and 0 logs remain), and `test_unicode_and_long_text_roundtrip` (statement `"Viết hàm đảo ngược chuỗi — có dấu"`, code `"x = 1\n" * 300`, both equal after reading back).
- [ ] **Step 3: Run** `python3 -m pytest tests/worker/test_store.py -v`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement `store.py`** with plain parameterized SQL (`?` placeholders only, never string formatting).
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit:** `git commit -m "feat(worker): D1 schema and store"`.

### Task 4: Workers AI client

**Files:**
- Create: `worker/src/app/llm.py`
- Test: `tests/worker/test_llm.py`

**Interfaces:**
- Produces: `WorkersAIClient(ai_binding, model: str, seed: int = 1)` with `structured_call(system_prompt: str, user_prompt: str, schema: type[T]) -> T` and `call_log: list[dict]` (same keys as `LLMClient.call_log`: `kind, schema, model, system_prompt, user_prompt, raw_response`). `raw_response` is always a JSON **string**. Sends `{"messages": [...], "temperature": 0, "seed": seed, "response_format": {"type": "json_schema", "json_schema": schema.model_json_schema()}}`. Reads `result["response"]`, which may be a dict or a string. Raises `RuntimeError` on missing/empty response.
- If Q3 failed: `structured_call` is `async def`, and tests use `asyncio.run`.

- [ ] **Step 1: Write failing tests** with a fake binding recording calls: `test_sends_bare_schema_seed_and_temperature`, `test_dict_response_parsed_and_logged_as_string`, `test_empty_response_raises` (`{"response": None}` → `RuntimeError`, nothing appended to `call_log`).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Convert Python → JS with the `to_js(..., dict_converter=Object.fromEntries)` helper only when running under Pyodide (`"pyodide" in sys.modules`); the fake binding takes plain dicts. Use `run_sync` per Q3.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(worker): Workers AI client with LLMClient interface"`.

### Task 5: Shared route rules + Worker routes

**Files:**
- Create: `server/rules.py` (no DB, FastAPI or SQLAlchemy imports)
- Modify: `server/teacher.py`, `server/exam.py` (import helpers from `server/rules.py`, behavior unchanged)
- Create: `worker/src/app/routes.py`
- Test: `tests/test_rules.py`, `tests/worker/test_routes.py`

**Interfaces:**
- Produces in `server/rules.py`, moved verbatim from the current modules: `json_normalize(value)`, `starter_code(func_name, param_names) -> str`, `split_cases(test_cases) -> tuple[list, list]`, `is_closed(deadline: datetime | None) -> bool`, `validate_new_problem(rubric: dict, test_cases: list[dict], reference_solution: str, func_name: str) -> None` (raises `ValueError(detail)` with the exact current messages), `preview(reference_solution, func_name, args_list, wrong_solution) -> dict` (the body of `preview_test_cases`), and `submission_row(sub: dict) -> dict`.
- Produces in `worker/src/app/routes.py`: `router = APIRouter()` with every path of `server/teacher.py` and `server/exam.py`, plus `POST /api/syntax-check`. Same status codes and JSON. Dependencies `get_db(request)` / `get_ai(request)` read `request.scope["env"]`, and tests override them. Submit flow: `grade(sample, client)` → `generate_feedback` (best effort, as now) → `store.add_submission(..., logs=client.call_log)`. Any exception before persistence → 502 `"Grading failed: ..."` with nothing stored.
- Consumes: `store.*` (Task 3), `WorkersAIClient` (Task 4), `grader.pipeline.grade`, `grader.feedback.generate_feedback`, `grader.sandbox.*`.
- If Q3 failed: add `async def grade_async(sample, client)` to `src/grader/pipeline.py`, with the same body as `grade` awaiting `structured_call`, plus a test that it returns exactly what `grade` returns for the same fake responses. Routes await it.

- [ ] **Step 1: Write failing `tests/test_rules.py`:** rubric not summing to 100, no test cases, and all-public test cases each raise the current messages; a bad reference solution raises; `split_cases` and `starter_code` match current outputs.
- [ ] **Step 2: Move the helpers** into `server/rules.py` and make `server/teacher.py` / `server/exam.py` call them (translating `ValueError` → `HTTPException(400, detail)`). Run `python3 -m pytest tests/test_rules.py -v`. Expected: PASS. Run `uvicorn server.main:app` against local Postgres and create one problem through the UI; it still works.
- [ ] **Step 3: Write failing `tests/worker/test_routes.py`** (FastAPI `TestClient`, `FakeD1`, fake AI returning fixed check JSON): `test_teacher_create_problem_exam_and_results`, `test_exam_submit_persists_result_and_logs` (audit endpoint returns 4 logs: 3 checks + feedback), `test_closed_exam_rejects_run_and_submit` (403 both), `test_submit_ai_failure_persists_nothing` (fake AI raises → 502, results list empty), `test_export_has_header_and_rows`.
- [ ] **Step 4: Run** them. Expected: FAIL.
- [ ] **Step 5: Implement `routes.py`.**
- [ ] **Step 6: Run** `python3 -m pytest tests -v`. Expected: all PASS.
- [ ] **Step 7: Commit:** `git commit -m "feat(worker): routes mirroring server API on D1 + Workers AI"`.

### Task 6: Worker entry, config and build

**Files:**
- Create: `worker/src/main.py`, `worker/wrangler.jsonc`, `worker/pyproject.toml`, `worker/build.sh`, `worker/.gitignore`
- Create: `worker/src/app/d1.py` (adapter giving the real binding the `prepare/bind/all/first/run/batch` API used by `store`, converting JS ↔ Python)

**Interfaces:**
- Consumes: `routes.router` (Task 5).
- Produces: `uv run pywrangler dev` (from `worker/`) serving API + frontend on `localhost:8787`.

- [ ] **Step 1: `main.py`:** a `FastAPI()` app that includes `router`, then `from workers import asgi; Default = asgi.entrypoint(app)`.
- [ ] **Step 2: `wrangler.jsonc`:**
  - `"main": "src/main.py"`, `"compatibility_flags": ["python_workers"]`, `compatibility_date` set to the day of the build;
  - `"ai": {"binding": "AI"}` and `"d1_databases": [{"binding": "DB", "database_name": "grading", "database_id": "<from wrangler d1 create>", "migrations_dir": "migrations"}]`;
  - `"assets": {"directory": "../frontend/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"]}`;
  - `"vars": {"LLM_MODEL": "@cf/qwen/qwen2.5-coder-32b-instruct"}`.
- [ ] **Step 3: `build.sh`** (set -euo pipefail):
  1. `rm -rf src/grader src/prompts src/server`;
  2. copy `../src/grader` → `src/grader`, `../prompts` → `src/prompts` (or generate `_prompts.py` if Q6 failed), and `../server/rules.py` → `src/server/rules.py` with an empty `src/server/__init__.py`, so `from server.rules import ...` resolves the same as in the repo;
  3. `(cd ../frontend && npm ci && npm run build)`.

  `.gitignore` lists the copied paths.
- [ ] **Step 4: `pyproject.toml`:** `requires-python = ">=3.13"`, deps `fastapi`, `pydantic`, plus `openpyxl` if Q5 passed; dev group `workers-py`, `workers-runtime-sdk`.
- [ ] **Step 5: Verify locally.**
  1. `./build.sh`, then `uv run pywrangler d1 migrations apply grading --local`, then `uv run pywrangler dev`.
  2. In the browser at `localhost:8787`: create a problem, create an exam, open the student link, Run Tests, Submit. Then open the admin link: the score and the "Chi tiết" audit are shown.
  3. `git status` shows no copied files.
- [ ] **Step 6: Commit:** `git commit -m "feat(worker): entry point, wrangler config, build script"`.

### Task 7: Deploy, live check, docs

**Files:**
- Create: `worker/README.md` (deploy and redeploy steps, Free-plan limits, what is not supported: `/demo`)
- Modify: `README.md` (one short "Cloudflare deployment" pointer to `worker/README.md`)

- [ ] **Step 1: Create the database.** `uv run pywrangler d1 create grading`, put the id in `wrangler.jsonc`, then `uv run pywrangler d1 migrations apply grading --remote`.
- [ ] **Step 2: Deploy.** `./build.sh && uv run pywrangler deploy`, and note the `*.workers.dev` URL.
- [ ] **Step 3: Live check on the URL:**
  - the full teacher → student → admin flow from Task 6, Step 5;
  - submit `def f(x):\n    while True: pass` → the readable limit message (Review Focus 1), and the admin list shows no new row;
  - submit `import js` code → score 0 with a `compile_error`.

  Run `wrangler tail` during a normal submit and record `cpuTime` in `worker/README.md`.
- [ ] **Step 4: Commit and push:** `git commit -m "docs: Cloudflare Worker deploy guide"`, then push the branch.
