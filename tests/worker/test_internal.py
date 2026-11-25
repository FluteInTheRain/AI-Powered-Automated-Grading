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
