# Cloudflare Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the teacher/exam web app from two free Cloudflare Python Workers: `grading` (FastAPI + D1 + Workers AI + static frontend) and `grading-sandbox` (runs student code, no bindings, private), reusing `src/grader/`.

**Architecture:** The main Worker mirrors the `server/` API contract on D1. It grades with `grader.pipeline.grade`, passing a remote runner that calls `grading-sandbox` over a service binding, and calls Workers AI through a client with `LLMClient`'s interface. All async binding calls are bridged into the sync grader with `pyodide.ffi.run_sync`. The built frontend is served as static assets from the same origin.

**Tech Stack:** Python 3.13 on Pyodide (Cloudflare Python Workers), FastAPI, Pydantic, D1, Workers AI, service bindings, `pywrangler` (`workers-py`, needs uv ≥ 0.13.4), pytest, React/Vite.

**Spec:** `docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`. Read "Spike results" and "Decision after the spike"; they override earlier sections.

## Global Constraints

- Workers **Free** plan; nothing may require Workers Paid.
- Model `@cf/qwen/qwen2.5-coder-32b-instruct`, `temperature=0`, `seed=1`.
- API paths and request/response JSON are identical to `server/teacher.py`, `server/exam.py` and `POST /api/syntax-check` of `server/main.py`.
- `src/grader/` changes are limited to the two in the spec (`TYPE_CHECKING` import, injectable `run_submission`). Grader code is copied into bundles at build time, never committed twice.
- Student code only ever executes inside `grading-sandbox`, never in the main Worker.
- `grading-sandbox` has no bindings, no vars, and `workers_dev: false`.
- No Cloudflare token or account secret in git. D1 `database_id` may be committed.
- `CLAUDE.md` design rules hold (sandbox-only correctness, one structured call per dimension, score summed in Python). Comments and UI copy are in English.
- Spike facts to rely on:
  - `Default = asgi.entrypoint(app)` is required;
  - `run_sync(env.AI.run(...))` returns a Python object;
  - `db.batch()` takes a plain Python list;
  - prompts are found when the package is at `src/vendor/grader` and the prompts at `src/prompts`.

## Review Focus

1. **Student code walks frames or tracebacks, or imports `js`, to reach data:** inside `grading-sandbox` it finds no `DB`/`AI`. Covered in Task 8, Step 3 (live probe).
2. **`grading-sandbox` is called directly from the internet:** no public URL answers. Covered in Task 8, Step 3.
3. **Workers AI fails or the daily allocation runs out:** submit returns 502 with a readable detail and persists nothing. Covered in Task 6, `test_submit_ai_failure_persists_nothing`.
4. **A submission that loops forever:** the sandbox invocation dies, and the student sees "exceeded the time/resource limit", not a raw Cloudflare page; nothing is persisted. Covered in Task 6, `test_submit_sandbox_failure_persists_nothing`, Task 1 (frontend mapping) and the Task 8 live check.
5. **Vietnamese text and 300-line code** round-trip through D1 identical. Covered in Task 4, `test_unicode_and_long_text_roundtrip`.

---

### Task 0: Spike — DONE (2026-11-18)

Results are in the spec. No further work.

### Task 1: Frontend works same-origin and shows limit errors plainly

**Files:**
- Modify: `frontend/src/api.js:1-13`, `frontend/vite.config.js`

- [ ] **Step 1: Point the frontend at its own origin.** Set `API_BASE = ''` and add `server.proxy: { '/api': 'http://localhost:8001' }` to the Vite config.
- [ ] **Step 2: Make non-JSON errors readable.** In `request()`, a `!res.ok` response with a non-JSON body throws `new Error('Your submission exceeded the time/resource limit or the server is busy. Please try again.')`. JSON bodies keep `body.detail`.
- [ ] **Step 3: Verify.**
  - `cd frontend && npm run build && ! grep -r "localhost:8001" dist/` exits 0.
  - `npm run dev` against uvicorn on 8001: the teacher page creates a problem.
- [ ] **Step 4: Commit:** `fix: relative API base + readable non-JSON errors in frontend`.

### Task 2: Grader loadable in a Worker, runner injectable

**Files:**
- Create: `requirements-dev.txt` (`pytest>=8`), `tests/__init__.py`, `tests/conftest.py` (puts repo root, `src`, `data`, `worker/src`, `sandbox-worker/src` on `sys.path`)
- Modify: `src/grader/pipeline.py:13-26`, `src/grader/rubric_checks.py:10`, `src/grader/feedback.py:13`
- Test: `tests/test_grader_worker_compat.py`

**Interfaces:**
- Produces: `grade(sample: dict, client, run_submission=sandbox.run_submission) -> dict`. Same output as today when the default is used.

- [ ] **Step 1: Write failing tests:**
```python
import importlib, sys

def test_grader_imports_without_openai(monkeypatch):
    monkeypatch.setitem(sys.modules, "openai", None)  # import openai -> ImportError
    for m in ["grader.llm_client", "grader.pipeline", "grader.rubric_checks", "grader.feedback"]:
        sys.modules.pop(m, None)
    importlib.import_module("grader.pipeline"); importlib.import_module("grader.feedback")

def test_grade_uses_injected_runner():
    from grader.pipeline import grade
    calls = []
    def fake_run(code, func_name, cases):
        calls.append(func_name)
        return {"pass_count": 0, "total": 1, "pass_rate": 0.0, "errors": ["x"], "status": "ran"}
    out = grade({"submission_code": "x", "func_name": "f", "test_cases": [((1,), 1)],
                 "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
                 "statement": "s"}, client=None, run_submission=fake_run)
    assert calls == ["f"] and out["final_score_0_to_100"] == 0.0
```
- [ ] **Step 2: Run** `python3 -m pytest tests/test_grader_worker_compat.py -v`. Expected: both FAIL.
- [ ] **Step 3: Implement.**
  - Move each `from .llm_client import LLMClient` under `if TYPE_CHECKING:`. The files already use `from __future__ import annotations`.
  - Add the `run_submission` keyword parameter to `grade`, and call it instead of the module-level import.
- [ ] **Step 4: Run** the tests. Then check that `python3 data/build_dataset.py` prints 65 samples with unchanged pass rates. Expected: PASS.
- [ ] **Step 5: Commit:** `refactor(grader): loadable without openai, injectable sandbox runner`.

### Task 3: Sandbox Worker

**Files:**
- Create: `sandbox-worker/src/handler.py`, `sandbox-worker/src/main.py`, `sandbox-worker/wrangler.jsonc`, `sandbox-worker/pyproject.toml`, `sandbox-worker/.gitignore`
- Test: `tests/sandbox_worker/test_handler.py`

**Interfaces:**
- Produces `handler.execute(payload: dict) -> dict`, a pure function that is testable on CPython:
  - `payload = {"mode": "run" | "cases" | "reference", "code": str, "func_name": str, "cases": list}`.
  - For `run` / `cases`, `cases` is `[[args_list, expected], ...]`; for `reference` it is `[args_list, ...]`.
  - It converts `args_list` to a tuple and returns exactly `run_submission(...)`, `run_submission_cases(...)` or `compute_reference_outputs(...)` from `grader.sandbox`.
  - An unknown mode raises `ValueError`.
- Produces HTTP `POST /execute` (JSON in, JSON out) on Worker `grading-sandbox`. It answers 400 on a bad payload.

- [ ] **Step 1: Write failing tests:**
  - `test_run_mode_matches_local_sandbox`: P01 S1 from `data/problems.py` through `execute` equals `run_submission` directly;
  - `test_cases_mode_returns_per_case_detail`;
  - `test_reference_mode_returns_outputs`;
  - `test_unknown_mode_raises`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement `handler.py`.** `main.py` is a minimal FastAPI app with `POST /execute`, followed by `Default = asgi.entrypoint(app)`.
- [ ] **Step 4: Write `wrangler.jsonc`:** `"name": "grading-sandbox"`, `"main": "src/main.py"`, `"compatibility_flags": ["python_workers"]`, `"workers_dev": false`, `"preview_urls": false`, observability on, **no** other bindings. `pyproject.toml` needs only `fastapi` (dev: `workers-py`, `workers-runtime-sdk`). The build copies only `src/grader/sandbox.py` into `src/vendor/grader/` (with an empty `__init__.py`).
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(sandbox-worker): isolated code-execution Worker`.

### Task 4: D1 schema and store

**Files:**
- Create: `worker/migrations/0001_init.sql`, `worker/src/app/__init__.py`, `worker/src/app/store.py`
- Test: `tests/worker/fake_d1.py`, `tests/worker/test_store.py`

**Interfaces:**
- Consumes: a D1-like `db`:
  - `db.prepare(sql).bind(*params)` with async `.all()` (→ object with `.results`, a list of rows with attribute access), `.first()` (→ row or `None`) and `.run()`;
  - async `db.batch(list)` (all-or-nothing).

  `FakeD1` provides exactly this over `sqlite3` and applies `0001_init.sql`.
- Produces (all `async`, ids `uuid4().hex`, timestamps ISO-8601 UTC, JSON columns stored as TEXT and returned decoded):
  - `create_problem(db, *, statement, func_name, param_names, rubric, reference_solution, test_cases, starter_code) -> str`
  - `list_problems(db) -> list[dict]`
  - `get_problem(db, problem_id) -> dict | None`
  - `create_exam(db, *, problem_id, student_token, admin_token, deadline, time_limit_seconds) -> dict`
  - `get_exam_by_student_token(db, token) -> dict | None` / `get_exam_by_admin_token(db, token) -> dict | None` (each with a nested `problem`)
  - `set_deadline(db, exam_id, deadline) -> None`
  - `add_submission(db, *, exam_id, student_name, code, result, logs) -> str` (one `db.batch`)
  - `list_submissions(db, exam_id) -> list[dict]` / `get_submission(db, submission_id) -> dict | None` / `get_logs(db, submission_id) -> list[dict]`

- [ ] **Step 1: Write `0001_init.sql`** with the 4 tables of `server/models.py` (TEXT ids and JSON, UNIQUE tokens).
- [ ] **Step 2: Write failing tests:**
  - `test_problem_exam_submission_roundtrip`;
  - `test_add_submission_is_atomic` (FakeD1 fails the 2nd log insert, so 0 submissions and 0 logs remain);
  - `test_unicode_and_long_text_roundtrip`.
- [ ] **Step 3: Run** them. Expected: FAIL.
- [ ] **Step 4: Implement `store.py`** with `?` placeholders only.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit:** `feat(worker): D1 schema and store`.

### Task 5: Bridges: Workers AI client and remote sandbox

**Files:**
- Create: `worker/src/app/bridges.py`
- Test: `tests/worker/test_bridges.py`

**Interfaces:**
- Produces `WorkersAIClient(ai_binding, model: str, seed: int = 1, run_sync=None)`:
  - `structured_call(system_prompt, user_prompt, schema) -> T` and `call_log`, with the same keys as `LLMClient.call_log`;
  - sends `{"messages", "temperature": 0, "seed", "response_format": {"type": "json_schema", "json_schema": <bare schema>}}`;
  - reads `result["response"]`, which may be a dict or a str;
  - `raw_response` is always a str;
  - `None`/empty → `RuntimeError`, with nothing logged.
- Produces `RemoteSandbox(sandbox_binding, run_sync=None)` with sync methods `run_submission(code, func_name, cases)`, `run_submission_cases(code, func_name, cases)` and `compute_reference_outputs(code, func_name, args_list)`. Each POSTs to `https://sandbox/execute` via `binding.fetch`. A non-200 response raises `RuntimeError("sandbox failed: <status>")`.
- `run_sync=None` means `pyodide.ffi.run_sync`; tests pass `lambda x: x` with fakes returning plain values.

- [ ] **Step 1: Write failing tests:**
  - `test_ai_sends_bare_schema_seed_temperature`;
  - `test_ai_dict_response_logged_as_string`;
  - `test_ai_empty_response_raises`;
  - `test_remote_sandbox_roundtrip` (the fake binding calls `handler.execute`);
  - `test_remote_sandbox_non_200_raises`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Convert dicts with `to_js(..., dict_converter=Object.fromEntries)` only under Pyodide.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(worker): Workers AI and remote sandbox bridges`.

### Task 6: Shared route rules + main Worker routes

**Files:**
- Create: `server/rules.py` (no DB, FastAPI or SQLAlchemy imports)
- Modify: `server/teacher.py`, `server/exam.py` (use `server/rules.py`; behavior unchanged)
- Create: `worker/src/app/routes.py`
- Test: `tests/test_rules.py`, `tests/worker/test_routes.py`

**Interfaces:**
- Produces in `server/rules.py`, moved verbatim:
  - `json_normalize`, `starter_code(func_name, param_names)`, `split_cases(test_cases)`, `is_closed(deadline)`;
  - `validate_new_problem(rubric, test_cases, run_submission, reference_solution, func_name) -> None`, which raises `ValueError` with today's exact messages and takes the runner as a parameter;
  - `preview(reference_solution, func_name, args_list, wrong_solution, *, compute_reference_outputs, run_submission) -> dict`;
  - `submission_row(sub)`.
- Produces in `worker/src/app/routes.py`: `router` with every path of `server/teacher.py` and `server/exam.py`, plus `POST /api/syntax-check`. Dependencies `get_db`, `get_ai`, `get_sandbox` read `request.scope["env"]` (`DB`, `AI`, `SANDBOX`), and tests override them.
  - Submit flow: `grade(sample, client, run_submission=sandbox.run_submission)` → `generate_feedback` (best effort) → `store.add_submission(..., logs=client.call_log)`.
  - Any exception before persistence → 502 `"Grading failed: ..."`, with nothing stored.
- Consumes: Tasks 2, 4 and 5.

- [ ] **Step 1: Write failing `tests/test_rules.py`:** the current validation messages (weights ≠ 100, no cases, all public, failing reference), `split_cases`, `starter_code`.
- [ ] **Step 2: Move the helpers** and wire `server/` to them (`ValueError` → `HTTPException(400, detail)`). Run `python3 -m pytest tests/test_rules.py -v`. Expected: PASS.
- [ ] **Step 3: Write failing `tests/worker/test_routes.py`** (`TestClient`, `FakeD1`, fake AI, in-process sandbox):
  - `test_teacher_create_problem_exam_and_results`;
  - `test_exam_submit_persists_result_and_logs` (the audit endpoint returns 4 logs);
  - `test_closed_exam_rejects_run_and_submit`;
  - `test_submit_ai_failure_persists_nothing`;
  - `test_submit_sandbox_failure_persists_nothing`;
  - `test_export_has_header_and_rows`.
- [ ] **Step 4: Run** them. Expected: FAIL.
- [ ] **Step 5: Implement `routes.py`.**
- [ ] **Step 6: Run** `python3 -m pytest tests -v`. Expected: all PASS.
- [ ] **Step 7: Commit:** `feat(worker): routes mirroring server API`.

### Task 7: Main Worker entry, configs, build, local run

**Files:**
- Create: `worker/src/main.py`, `worker/wrangler.jsonc`, `worker/pyproject.toml`, `worker/build.sh`, `worker/.gitignore`, `sandbox-worker/build.sh`

- [ ] **Step 1: Write `worker/src/main.py`.** It puts `src/vendor` on `sys.path`, creates the FastAPI app with `router`, and ends with `Default = asgi.entrypoint(app)`.
- [ ] **Step 2: Write `worker/wrangler.jsonc`:**
  - `"name": "grading"`, `"main": "src/main.py"`, flag `python_workers`;
  - `"ai": {"binding": "AI"}`;
  - `"d1_databases": [{"binding": "DB", "database_name": "grading", "database_id": "<id>", "migrations_dir": "migrations"}]`;
  - `"services": [{"binding": "SANDBOX", "service": "grading-sandbox"}]`;
  - `"assets": {"directory": "../frontend/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"]}`;
  - `"vars": {"LLM_MODEL": "@cf/qwen/qwen2.5-coder-32b-instruct"}`;
  - observability on.
- [ ] **Step 3: Write `worker/build.sh`.** It refreshes `src/vendor/grader` (whole package), `src/prompts`, `src/server/rules.py` (+ empty `__init__.py`), then builds the frontend. `sandbox-worker/build.sh` refreshes `src/vendor/grader/sandbox.py` only. Both `.gitignore` files list the copies.
- [ ] **Step 4: Verify locally.** Run both build scripts, then `uv run pywrangler d1 migrations apply grading --local`, then from `worker/`: `uv run pywrangler dev -c wrangler.jsonc -c ../sandbox-worker/wrangler.jsonc`. In the browser: create a problem, create an exam, open the student link, Run Tests, Submit, then open the admin results and the audit.
- [ ] **Step 5: Check `git status`.** It shows no copied files.
- [ ] **Step 6: Commit:** `feat(worker): entry points, configs, build scripts`.

### Task 8: Deploy, live checks, docs

**Files:**
- Create: `worker/README.md` (deploy/redeploy, the accepted risks from the spec, the `/demo` page being unsupported, how to switch to Workers Paid)
- Modify: `README.md` (one pointer to `worker/README.md`)

- [ ] **Step 1: Create the remote database.** `uv run pywrangler d1 create grading`, put the id in the config, then `uv run pywrangler d1 migrations apply grading --remote`.
- [ ] **Step 2: Deploy** `grading-sandbox` first, then `grading`. The URL is `https://grading.khangnguyen.workers.dev`.
- [ ] **Step 3: Live checks:**
  - the full teacher → student → admin flow;
  - submit a frame-walk probe (the spike's `traceback_walk_no_import` code): the result shows "not reached" or a failure, never `REACHED env`;
  - submit `while True: pass`: the readable limit message appears and no row is added;
  - `curl https://grading-sandbox.khangnguyen.workers.dev/execute` does not reach the Worker;
  - `wrangler tail grading` during a normal submit: record `cpuTime` for both Workers in `worker/README.md`.
- [ ] **Step 4: Commit and push:** `docs: Cloudflare Worker deploy guide`.
