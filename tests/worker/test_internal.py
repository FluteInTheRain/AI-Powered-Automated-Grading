"""Tests for the token-gated /api/internal/* endpoints of the grading Worker.

The app is built WITHOUT overriding routes.get_db: the internal endpoints are
stateless, so any DB use would raise.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import routes
from app.bridges import RemoteSandbox, WorkersAIClient
from tests.worker.test_routes import CASES, PROBLEM, REF, Env, FakeAI, ident

TOKEN = "s3cret"
HEADERS = {"X-Internal-Token": TOKEN}


class WithEnv:
    """ASGI wrapper that puts a fake Worker env into scope, like the Python Workers runtime."""

    def __init__(self, app, env):
        self.app, self.env = app, env

    async def __call__(self, scope, receive, send):
        scope["env"] = self.env
        await self.app(scope, receive, send)


def make_client(env, *, real_auth=True):
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_llm_client] = lambda: WorkersAIClient(env.ai, "m", run_sync=ident)
    app.dependency_overrides[routes.get_sandbox] = lambda: RemoteSandbox(env.sandbox, run_sync=ident)
    if not real_auth:
        app.dependency_overrides[routes.require_internal_token] = lambda: None
    env.INTERNAL_TOKEN = TOKEN
    return TestClient(WithEnv(app, env))


GRADE_BODY = {
    "statement": PROBLEM["statement"], "func_name": PROBLEM["func_name"], "rubric": PROBLEM["rubric"],
    "hidden_cases": [CASES[1]], "code": REF,
}


@pytest.fixture
def env():
    return Env()


def test_grade_without_token_is_401(env):
    assert make_client(env).post("/api/internal/grade", json=GRADE_BODY).status_code == 401


def test_grade_wrong_token_is_401(env):
    r = make_client(env).post("/api/internal/grade", json=GRADE_BODY, headers={"X-Internal-Token": "nope"})
    assert r.status_code == 401


def test_grade_unset_env_token_is_401(env):
    c = make_client(env)
    env.INTERNAL_TOKEN = ""
    assert c.post("/api/internal/grade", json=GRADE_BODY, headers={"X-Internal-Token": ""}).status_code == 401


def test_grade_returns_result_and_call_log(env):
    r = make_client(env).post("/api/internal/grade", json=GRADE_BODY, headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["result"]["final_score_0_to_100"], (int, float))
    assert len(body["call_log"]) >= 1
    assert body["result"]["feedback"] is not None


def test_grade_never_touches_db(env):
    # No get_db override and no env.DB: succeeding proves the route is stateless.
    assert make_client(env, real_auth=False).post("/api/internal/grade", json=GRADE_BODY).status_code == 200


def test_grade_killed_sandbox_is_502_time_limit(env):
    env.sandbox.killed = True
    r = make_client(env, real_auth=False).post("/api/internal/grade", json=GRADE_BODY)
    assert r.status_code == 502
    assert "time/resource" in r.json()["detail"]


def test_grade_ai_failure_is_502_fixed_text():
    env = Env(ai=FakeAI(fail=True))
    r = make_client(env, real_auth=False).post("/api/internal/grade", json=GRADE_BODY)
    assert r.status_code == 502
    assert r.json()["detail"] == routes.GRADING_FAILED


def test_preview_requires_token_and_returns_cases(env):
    c = make_client(env)
    body = {"reference_solution": REF, "func_name": "add", "cases": [{"args": [1, 2]}]}
    assert c.post("/api/internal/preview", json=body).status_code == 401
    r = c.post("/api/internal/preview", json=body, headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["cases"][0]["expected"] == 3


def test_validate_requires_token(env):
    assert make_client(env).post("/api/internal/validate-problem", json=PROBLEM).status_code == 401


def test_validate_ok_for_good_problem(env):
    r = make_client(env, real_auth=False).post("/api/internal/validate-problem", json=PROBLEM)
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_validate_rubric_not_100_is_400(env):
    bad = {**PROBLEM, "rubric": {**PROBLEM["rubric"], "correctness": 50}}
    r = make_client(env, real_auth=False).post("/api/internal/validate-problem", json=bad)
    assert r.status_code == 400
    assert "Rubric weights must sum to 100" in r.json()["detail"]


def test_validate_all_public_is_400(env):
    bad = {**PROBLEM, "test_cases": [{**CASES[0]}, {**CASES[1], "is_public": True}]}
    r = make_client(env, real_auth=False).post("/api/internal/validate-problem", json=bad)
    assert r.status_code == 400
    assert "hidden" in r.json()["detail"]


def test_validate_killed_sandbox_is_502(env):
    env.sandbox.killed = True
    r = make_client(env, real_auth=False).post("/api/internal/validate-problem", json=PROBLEM)
    assert r.status_code == 502


def test_grade_feedback_prompt_never_contains_hidden_case_details():
    seen = []

    class SpyAI(FakeAI):
        def run(self, model, payload):
            seen.append(str(payload))
            return super().run(model, payload)

    wrong = {**GRADE_BODY, "code": "def add(a, b):\n    return 0\n"}
    r = make_client(Env(ai=SpyAI()), real_auth=False).post("/api/internal/grade", json=wrong)
    assert r.status_code == 200
    feedback_calls = [s for s in seen if "CodeFeedback" in s]
    assert feedback_calls
    assert all("expected=" not in s for s in feedback_calls)


RUN_BODY = {"code": REF, "func_name": "add", "cases": [CASES[0]]}


def test_run_requires_token(env):
    assert make_client(env).post("/api/internal/run", json=RUN_BODY).status_code == 401


def test_run_returns_pass_fail_per_case_without_values(env):
    r = make_client(env, real_auth=False).post("/api/internal/run", json=RUN_BODY)
    assert r.status_code == 200
    assert r.json()["cases"] == [{"passed": True, "error": None}]
    assert "expected" not in r.text


def test_run_reports_failures(env):
    wrong = {**RUN_BODY, "code": "def add(a, b):\n    return 0\n"}
    r = make_client(env, real_auth=False).post("/api/internal/run", json=wrong)
    assert r.status_code == 200
    assert r.json()["cases"][0]["passed"] is False


def test_run_killed_sandbox_is_502(env):
    env.sandbox.killed = True
    r = make_client(env, real_auth=False).post("/api/internal/run", json=RUN_BODY)
    assert r.status_code == 502
    assert "time/resource" in r.json()["detail"]


def test_run_never_returns_error_text_that_can_carry_case_values(env):
    leaky = {**RUN_BODY, "code": "def add(a, b):\n    raise ValueError(repr((a, b)))\n"}
    r = make_client(env, real_auth=False).post("/api/internal/run", json=leaky)
    assert r.status_code == 200
    case = r.json()["cases"][0]
    assert case["passed"] is False and case["error"]
    assert "(1, 2)" not in r.text


CHECK_BODY = {"func_name": "add", "reference_solution": REF, "test_cases": [CASES[0], CASES[1]]}


def test_check_tests_requires_token(env):
    assert make_client(env).post("/api/internal/check-tests", json=CHECK_BODY).status_code == 401


def test_check_tests_reports_score_and_hides_mutant_code(env):
    r = make_client(env, real_auth=False).post("/api/internal/check-tests", json=CHECK_BODY)
    assert r.status_code == 200
    b = r.json()
    assert b["total"] > 0 and b["killed"] + len(b["survivors"]) == b["total"]
    assert b["weak_threshold"] == 0.8 and b["capped"] is False
    assert all(set(s) == {"kind", "description"} for s in b["survivors"])


def test_check_tests_is_capped(env, monkeypatch):
    monkeypatch.setattr(routes, "CHECK_MAX_MUTANTS", 2)
    body = {**CHECK_BODY, "reference_solution": "def add(a, b):\n    if a > 100:\n        return 0\n    return a + b + 0\n"}
    b = make_client(env, real_auth=False).post("/api/internal/check-tests", json=body).json()
    assert b["total"] == 2 and b["generated"] > 2 and b["capped"] is True


def test_check_tests_bad_reference_is_400(env):
    body = {**CHECK_BODY, "reference_solution": "def add(a, b):\n    return 0\n"}
    r = make_client(env, real_auth=False).post("/api/internal/check-tests", json=body)
    assert r.status_code == 400 and "own tests" in r.json()["detail"]


def test_check_tests_limits_are_400(env):
    c = make_client(env, real_auth=False)
    assert c.post("/api/internal/check-tests", json={**CHECK_BODY, "test_cases": []}).status_code == 400
    long_ref = {**CHECK_BODY, "reference_solution": REF + "#" * routes.CHECK_MAX_CODE_CHARS}
    assert c.post("/api/internal/check-tests", json=long_ref).status_code == 400


def test_check_tests_killed_sandbox_on_baseline_counts_as_bad_reference(env):
    env.sandbox.killed = True
    r = make_client(env, real_auth=False).post("/api/internal/check-tests", json=CHECK_BODY)
    assert r.status_code == 400
