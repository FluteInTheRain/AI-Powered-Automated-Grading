import inspect
import io
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app import routes
from app.bridges import RemoteSandbox, WorkersAIClient
from tests.worker.fake_d1 import FakeD1
from tests.worker.test_bridges import FakeBinding

ident = lambda x: x

REF = "def add(a, b):\n    return a + b\n"
RUBRIC = {"correctness": 40, "efficiency": 20, "code_style": 20, "edge_case_handling": 20}
CASES = [
    {"args": [1, 2], "expected": 3, "is_public": True},
    {"args": [2, 2], "expected": 4, "is_public": False},
]
PROBLEM = {
    "statement": "Add two numbers", "func_name": "add", "param_names": ["a", "b"],
    "rubric": RUBRIC, "reference_solution": REF, "test_cases": CASES,
}

# One canned answer per schema name (the schema's title is in the payload).
ANSWERS = {
    "EfficiencyCheck": {"meets_expected_complexity": True, "observed_pattern": "O(1)"},
    "StyleCheck": {"level": "clean"},
    "EdgeCaseCheck": {"handled": True, "missing_cases": []},
    "CodeFeedback": {"summary": "ok", "issues": []},
}


class FakeAI:
    def __init__(self, fail=False):
        self.fail = fail

    def run(self, model, payload):
        if self.fail:
            raise RuntimeError("ai down")
        return {"response": ANSWERS[payload["response_format"]["json_schema"]["title"]]}


class Env:
    def __init__(self, ai=None, sandbox=None):
        self.db = FakeD1()
        self.ai = ai or FakeAI()
        self.sandbox = sandbox or FakeBinding()


@pytest.fixture
def env():
    return Env()


def make_client(env):
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_db] = lambda: env.db
    app.dependency_overrides[routes.get_llm_client] = lambda: WorkersAIClient(env.ai, "m", run_sync=ident)
    app.dependency_overrides[routes.get_sandbox] = lambda: RemoteSandbox(env.sandbox, run_sync=ident)
    return TestClient(app)


def new_exam(c, **exam_body):
    pid = c.post("/api/teacher/problems", json=PROBLEM).json()["id"]
    return c.post("/api/teacher/exams", json={"problem_id": pid, **exam_body}).json()


def test_teacher_create_problem_exam_and_results(env):
    c = make_client(env)
    assert c.post("/api/syntax-check", json={"code": "def ("}).json()["ok"] is False
    assert c.post("/api/syntax-check", json={"code": REF}).json() == {"ok": True}

    prev = c.post("/api/teacher/preview-test-cases", json={
        "reference_solution": REF, "func_name": "add", "cases": [{"args": [1, 2]}],
        "wrong_solution": "def add(a, b):\n    return a - b\n",
    }).json()
    assert prev["status"] == "ok" and prev["cases"][0]["expected"] == 3
    assert prev["wrong_solution_check"]["still_passes_all"] is False

    bad = dict(PROBLEM, rubric={**RUBRIC, "efficiency": 10})
    r = c.post("/api/teacher/problems", json=bad)
    assert r.status_code == 400 and r.json()["detail"] == "Rubric weights must sum to 100, got 90"
    assert c.post("/api/teacher/problems", json=dict(PROBLEM, reference_solution="def add(a, b):\n    return 0\n")).status_code == 400

    pid = c.post("/api/teacher/problems", json=PROBLEM).json()["id"]
    listing = c.get("/api/teacher/problems").json()
    assert [p["id"] for p in listing] == [pid] and listing[0]["statement_excerpt"] == "Add two numbers"

    assert c.post("/api/teacher/exams", json={"problem_id": "nope"}).status_code == 404
    ex = c.post("/api/teacher/exams", json={"problem_id": pid}).json()
    assert ex["student_path"] == f"/exam/{ex['student_token']}"
    assert ex["admin_path"] == f"/admin/{ex['admin_token']}"

    info = c.get(f"/api/exam/{ex['student_token']}").json()
    assert info["public_test_case_count"] == 1 and info["hidden_test_case_count"] == 1
    assert info["time_limit_seconds"] == 600 and info["is_closed"] is False and info["deadline"] is None
    assert c.get("/api/exam/unknown").status_code == 404

    res = c.get(f"/api/teacher/exams/{ex['admin_token']}").json()
    assert res["problem"] == {"id": pid, "statement": "Add two numbers"} and res["submissions"] == []
    assert c.get("/api/teacher/exams/unknown").status_code == 404

    r = c.patch(f"/api/teacher/exams/{ex['admin_token']}", json={"deadline": "2999-01-01T00:00:00Z"})
    assert r.status_code == 200 and r.json()["deadline"].startswith("2999-01-01")
    assert c.get(f"/api/teacher/exams/{ex['admin_token']}").json()["is_closed"] is False


def test_exam_submit_persists_result_and_logs(env):
    c = make_client(env)
    ex = new_exam(c)
    run = c.post(f"/api/exam/{ex['student_token']}/run", json={"code": REF}).json()
    assert run == {"status": "ran", "message": None, "cases": [{"passed": True, "error": None}]}

    r = c.post(f"/api/exam/{ex['student_token']}/submit", json={"student_name": "An", "code": REF})
    assert r.status_code == 200
    body = r.json()
    assert body["final_score_0_to_100"] == 100.0 and body["feedback"]["summary"] == "ok"

    res = c.get(f"/api/teacher/exams/{ex['admin_token']}").json()
    assert len(res["submissions"]) == 1 and res["submissions"][0]["student_name"] == "An"
    assert res["submissions"][0]["final_score_0_to_100"] == 100.0
    sid = res["submissions"][0]["id"]

    audit = c.get(f"/api/teacher/exams/{ex['admin_token']}/submissions/{sid}/audit").json()
    assert len(audit) == 4 and [a["call_index"] for a in audit] == [0, 1, 2, 3]
    assert audit[-1]["schema"] == "CodeFeedback" and audit[0]["kind"] == "structured"

    other = new_exam(c)
    assert c.get(f"/api/teacher/exams/{other['admin_token']}/submissions/{sid}/audit").status_code == 404


def test_closed_exam_rejects_run_and_submit(env):
    c = make_client(env)
    ex = new_exam(c, deadline="2000-01-01T00:00:00Z")
    t = ex["student_token"]
    assert c.get(f"/api/exam/{t}").json()["is_closed"] is True
    assert c.post(f"/api/exam/{t}/run", json={"code": REF}).status_code == 403
    assert c.post(f"/api/exam/{t}/submit", json={"student_name": "x", "code": REF}).status_code == 403
    assert c.get(f"/api/teacher/exams/{ex['admin_token']}").json()["submissions"] == []


def _count(env, table):
    return env.db._conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_submit_ai_failure_persists_nothing(env):
    c = make_client(env)
    ex = new_exam(c)
    env.ai.fail = True
    r = c.post(f"/api/exam/{ex['student_token']}/submit", json={"student_name": "An", "code": REF})
    assert r.status_code == 502 and r.json()["detail"].startswith("Grading failed: ")
    assert _count(env, "submissions") == 0 and _count(env, "grading_logs") == 0


def test_submit_sandbox_failure_persists_nothing(env):
    c = make_client(env)
    ex = new_exam(c)
    env.sandbox.status = 500
    r = c.post(f"/api/exam/{ex['student_token']}/submit", json={"student_name": "An", "code": REF})
    assert r.status_code == 502
    assert r.json()["detail"] == "Grading failed: your submission exceeded the time/resource limit."
    assert _count(env, "submissions") == 0 and _count(env, "grading_logs") == 0


def test_submit_persistence_failure_persists_nothing(env):
    c = make_client(env)
    ex = new_exam(c)
    env.db.fail_on_batch_statement(2)  # a grading_logs insert, after the submission row
    r = c.post(f"/api/exam/{ex['student_token']}/submit", json={"student_name": "An", "code": REF})
    assert r.status_code == 502 and r.json()["detail"].startswith("Grading failed: ")
    assert _count(env, "submissions") == 0 and _count(env, "grading_logs") == 0


def test_dependencies_are_coroutines_and_export_returns_xlsx(env):
    # Pyodide has no threads: sync deps/streaming responses would use the thread pool.
    for dep in (routes.get_db, routes.get_llm_client, routes.get_sandbox):
        assert inspect.iscoroutinefunction(dep), dep.__name__


def test_all_execution_goes_through_sandbox_without_expected(env):
    c = make_client(env)
    code = "def f(a):\n    return a * 1000 + 7\n"
    problem = {**PROBLEM, "func_name": "f", "param_names": ["a"], "reference_solution": code,
               "test_cases": [{"args": [1], "expected": 1007, "is_public": True},
                              {"args": [2], "expected": 2007, "is_public": False}]}
    n = len(env.sandbox.posted)
    c.post("/api/teacher/preview-test-cases", json={
        "reference_solution": code, "func_name": "f", "cases": [{"args": [1]}], "wrong_solution": code})
    assert len(env.sandbox.posted) > n  # preview ran in the sandbox
    n = len(env.sandbox.posted)
    pid = c.post("/api/teacher/problems", json=problem).json()["id"]
    assert len(env.sandbox.posted) == n + 1  # reference check
    ex = c.post("/api/teacher/exams", json={"problem_id": pid}).json()
    n = len(env.sandbox.posted)
    c.post(f"/api/exam/{ex['student_token']}/run", json={"code": code})
    assert len(env.sandbox.posted) == n + 1
    n = len(env.sandbox.posted)
    assert c.post(f"/api/exam/{ex['student_token']}/submit", json={"student_name": "A", "code": code}).status_code == 200
    assert len(env.sandbox.posted) == n + 1
    for payload in env.sandbox.posted:
        assert set(payload) == {"code", "func_name", "args_list"}
        assert "expected" not in json.dumps(payload)
        assert "1007" not in json.dumps(payload) and "2007" not in json.dumps(payload)


def test_export_has_header_and_rows(env):
    c = make_client(env)
    ex = new_exam(c)
    c.post(f"/api/exam/{ex['student_token']}/submit", json={"student_name": "An", "code": REF})
    r = c.get(f"/api/teacher/exams/{ex['admin_token']}/export.xlsx")
    assert r.status_code == 200
    assert f"exam_{ex['admin_token']}_results.xlsx" in r.headers["content-disposition"]
    rows = list(load_workbook(io.BytesIO(r.content)).active.iter_rows(values_only=True))
    assert rows[0] == ("student_name", "final_score", "correctness", "efficiency",
                       "code_style", "edge_case_handling", "submitted_at")
    assert len(rows) == 2 and rows[1][0] == "An" and rows[1][1] == 100.0
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")


def test_export_injected_name_is_text_not_formula(env):
    c = make_client(env)
    ex = new_exam(c)
    c.post(f"/api/exam/{ex['student_token']}/submit",
           json={"student_name": '=HYPERLINK("http://x")', "code": REF})
    r = c.get(f"/api/teacher/exams/{ex['admin_token']}/export.xlsx")
    cell = load_workbook(io.BytesIO(r.content)).active["A2"]
    assert cell.data_type == "s" and cell.value == "'=HYPERLINK(\"http://x\")"
