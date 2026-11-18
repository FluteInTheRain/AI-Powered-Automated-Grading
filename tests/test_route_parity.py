"""Route parity: drive the same scenario against server/ (FastAPI + SQLAlchemy,
run here on in-memory SQLite) and worker/ (FastAPI + D1 fake) and compare
status codes and JSON shape. Ids, tokens and timestamps are masked.

Test-only shims for server/ on SQLite (production uses Postgres):
- JSONB is rendered as JSON,
- str ids are accepted for UUID columns (Postgres does this natively),
- SQLite drops tzinfo from DateTime(timezone=True), so deadlines are re-tagged UTC.
No LLM or network: both sides use the same canned answers; code runs in the
local sandbox (server) or the in-process sandbox handler (worker).
"""
import datetime
import io
import json
import uuid

import pytest

import tests.worker  # noqa: F401  (puts worker/src first on sys.path)

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import StaticPool, create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

from app import routes as worker_routes
from app.bridges import RemoteSandbox, WorkersAIClient
from server import db as server_db, exam as server_exam, main as server_main
from server.models import Base, Exam
from tests.worker.fake_d1 import FakeD1
from tests.worker.test_bridges import FakeBinding
from tests.worker.test_routes import ANSWERS, CASES, PROBLEM, REF, FakeAI

ident = lambda x: x
UTC = datetime.timezone.utc


@compiles(JSONB, "sqlite")
def _jsonb_as_json(type_, compiler, **kw):
    return "JSON"


class FakeServerLLM:
    """Stand-in for grader.llm_client.LLMClient with the same canned answers."""

    def __init__(self, base_url, model, seed=0):
        self.call_log = []

    def structured_call(self, system_prompt, user_prompt, schema):
        raw = json.dumps(ANSWERS[schema.__name__])
        self.call_log.append({"kind": "structured", "schema": schema.__name__, "model": "m",
                              "system_prompt": system_prompt, "user_prompt": user_prompt,
                              "raw_response": raw})
        return schema.model_validate(json.loads(raw))


def _tag_utc(dt):
    return dt.replace(tzinfo=UTC) if dt is not None and dt.tzinfo is None else dt


@pytest.fixture(scope="module", autouse=True)
def _sqlite_shims():
    """Process-wide ORM hooks; harmless for other tests (nothing else loads Exam)."""
    @event.listens_for(Exam, "load")
    @event.listens_for(Exam, "refresh")
    def _on_load(target, *args):
        target.deadline = _tag_utc(target.deadline)
    yield
    event.remove(Exam, "load", _on_load)
    event.remove(Exam, "refresh", _on_load)


def server_client(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    class StrIdSession(Session):
        def get(self, entity, ident_, *a, **kw):
            if isinstance(ident_, str):
                try:
                    ident_ = uuid.UUID(ident_)
                except ValueError:
                    return None
            return super().get(entity, ident_, *a, **kw)

    maker = sessionmaker(bind=engine, autoflush=False, class_=StrIdSession)

    def get_session():
        s = maker()
        try:
            yield s
        finally:
            s.close()

    monkeypatch.setattr(server_exam, "LLMClient", FakeServerLLM)
    # server.main.app carries the routers and /api/syntax-check; its routers
    # all share server.db.get_session.
    monkeypatch.setitem(server_main.app.dependency_overrides, server_db.get_session, get_session)
    return TestClient(server_main.app)


def worker_client(monkeypatch):
    db, ai, sandbox = FakeD1(), FakeAI(), FakeBinding()
    app = FastAPI()
    app.include_router(worker_routes.router)
    app.dependency_overrides[worker_routes.get_db] = lambda: db
    app.dependency_overrides[worker_routes.get_llm_client] = lambda: WorkersAIClient(ai, "m", run_sync=ident)
    app.dependency_overrides[worker_routes.get_sandbox] = lambda: RemoteSandbox(sandbox, run_sync=ident)
    return TestClient(app)


@pytest.fixture(params=["server", "worker"])
def backend(request, monkeypatch):
    return request.param, (server_client if request.param == "server" else worker_client)(monkeypatch)


MASKED = {"id", "student_token", "admin_token", "student_path", "admin_path",
          "created_at", "submitted_at", "deadline"}


def mask(value, key=None):
    if isinstance(value, dict):
        return {k: mask(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [mask(v) for v in value]
    if key in MASKED and value is not None:
        return "<masked>"
    return value


def scenario(c, deadline=None):
    """Run the full flow; return [(label, status, masked json)]."""
    trace = []

    def rec(label, r, body=True):
        trace.append((label, r.status_code, mask(r.json()) if body else None))
        return r

    rec("syntax_bad", c.post("/api/syntax-check", json={"code": "def ("}))
    rec("syntax_ok", c.post("/api/syntax-check", json={"code": REF}))
    rec("preview", c.post("/api/teacher/preview-test-cases", json={
        "reference_solution": REF, "func_name": "add", "cases": [{"args": [1, 2]}],
        "wrong_solution": "def add(a, b):\n    return a - b\n"}))
    rec("create_problem_bad_rubric", c.post("/api/teacher/problems", json=dict(
        PROBLEM, rubric={**PROBLEM["rubric"], "efficiency": 10})))
    pid = rec("create_problem", c.post("/api/teacher/problems", json=PROBLEM)).json()["id"]
    rec("list_problems", c.get("/api/teacher/problems"))
    rec("exam_unknown_problem", c.post("/api/teacher/exams", json={"problem_id": "nope"}))
    ex = rec("create_exam", c.post("/api/teacher/exams", json={"problem_id": pid})).json()
    st, ad = ex["student_token"], ex["admin_token"]
    rec("get_exam", c.get(f"/api/exam/{st}"))
    rec("get_exam_unknown", c.get("/api/exam/unknown"))
    rec("run", c.post(f"/api/exam/{st}/run", json={"code": REF}))
    rec("submit", c.post(f"/api/exam/{st}/submit", json={"student_name": "An", "code": REF}))
    rec("submit_wrong", c.post(f"/api/exam/{st}/submit",
                               json={"student_name": "Bo", "code": "def add(a, b):\n    return 0\n"}))
    res = rec("results", c.get(f"/api/teacher/exams/{ad}")).json()
    sid = res["submissions"][0]["id"]
    rec("results_unknown", c.get("/api/teacher/exams/unknown"))
    rec("audit", c.get(f"/api/teacher/exams/{ad}/submissions/{sid}/audit"))
    rec("audit_unknown_sub", c.get(f"/api/teacher/exams/{ad}/submissions/nope/audit"))
    rec("set_deadline", c.patch(f"/api/teacher/exams/{ad}", json={"deadline": "2999-01-01T00:00:00Z"}))
    rec("clear_deadline", c.patch(f"/api/teacher/exams/{ad}", json={"deadline": None}))
    rec("close_exam", c.patch(f"/api/teacher/exams/{ad}", json={"deadline": "2000-01-01T00:00:00Z"}))
    rec("run_closed", c.post(f"/api/exam/{st}/run", json={"code": REF}))
    rec("submit_closed", c.post(f"/api/exam/{st}/submit", json={"student_name": "C", "code": REF}))
    x = c.get(f"/api/teacher/exams/{ad}/export.xlsx")
    rows = list(load_workbook(io.BytesIO(x.content)).active.values)
    trace.append(("export", x.status_code, {
        "content_type": x.headers["content-type"],
        "header": list(rows[0]), "n_rows": len(rows) - 1,
        "scores": sorted(r[1] for r in rows[1:]),
    }))
    return trace


@pytest.fixture
def traces(monkeypatch):
    return {name: scenario(make(monkeypatch)) for name, make in
            (("server", server_client), ("worker", worker_client))}


def test_scenario_runs_on_both_backends(traces):
    for name, t in traces.items():
        statuses = {label: status for label, status, _ in t}
        assert statuses["submit"] == 200 and statuses["submit_closed"] == 403, name
        assert statuses["export"] == 200 and statuses["audit"] == 200, name


def test_status_codes_match(traces):
    s = {k: [(l, st) for l, st, _ in t] for k, t in traces.items()}
    assert s["server"] == s["worker"]


def test_response_json_matches(traces):
    server, worker = ({l: b for l, _, b in t} for t in (traces["server"], traces["worker"]))
    assert server.keys() == worker.keys()
    for label in server:
        assert server[label] == worker[label], label
