"""Deadline edge cases: rules.is_closed boundaries, and the exam routes on both
backends (server/ on SQLite via tests/test_route_parity.py's harness, worker/ on
the D1 fake) for past/future/cleared deadlines and naive/offset datetimes."""
import datetime

import pytest

from server import rules
from tests.test_route_parity import REF, PROBLEM, _sqlite_shims, backend  # noqa: F401

UTC = datetime.timezone.utc
NOW = datetime.datetime(2030, 1, 1, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def frozen_now(monkeypatch):
    class FrozenDT(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    monkeypatch.setattr(rules.datetime, "datetime", FrozenDT)


def test_is_closed_boundaries(frozen_now):
    assert rules.is_closed(None) is False
    assert rules.is_closed(NOW) is True  # exactly now: closed (<=)
    assert rules.is_closed(NOW - datetime.timedelta(microseconds=1)) is True
    assert rules.is_closed(NOW + datetime.timedelta(microseconds=1)) is False


def test_is_closed_compares_instants_across_offsets(frozen_now):
    plus7 = datetime.timezone(datetime.timedelta(hours=7))
    assert rules.is_closed(datetime.datetime(2030, 1, 1, 19, 0, tzinfo=plus7)) is True  # == NOW
    assert rules.is_closed(datetime.datetime(2030, 1, 1, 19, 0, 1, tzinfo=plus7)) is False


def test_is_closed_rejects_naive_datetime():
    # Documents the contract: callers must pass aware datetimes (the worker
    # tags naive input as UTC before it gets here).
    with pytest.raises(TypeError):
        rules.is_closed(datetime.datetime(2000, 1, 1))


def _exam(c, deadline="absent", **extra):
    pid = c.post("/api/teacher/problems", json=PROBLEM).json()["id"]
    body = {"problem_id": pid, **extra}
    if deadline != "absent":
        body["deadline"] = deadline
    r = c.post("/api/teacher/exams", json=body)
    assert r.status_code == 200
    return r.json()


def _iso(delta):
    return (datetime.datetime.now(UTC) + delta).isoformat()


@pytest.mark.parametrize("delta,closed", [
    (datetime.timedelta(seconds=-1), True),
    (datetime.timedelta(0), True),  # already past by the time the request is checked
    (datetime.timedelta(minutes=5), False),
])
def test_deadline_near_now(backend, delta, closed):
    _, c = backend
    ex = _exam(c, deadline=_iso(delta))
    st = ex["student_token"]
    assert c.get(f"/api/exam/{st}").json()["is_closed"] is closed
    assert c.get(f"/api/teacher/exams/{ex['admin_token']}").json()["is_closed"] is closed
    run = c.post(f"/api/exam/{st}/run", json={"code": REF})
    sub = c.post(f"/api/exam/{st}/submit", json={"student_name": "A", "code": REF})
    assert (run.status_code, sub.status_code) == ((403, 403) if closed else (200, 200))
    if closed:
        assert run.json() == sub.json() == {"detail": "This exam is closed"}


def test_deadline_in_past_at_creation_is_accepted_and_closed(backend):
    _, c = backend
    ex = _exam(c, deadline="2000-01-01T00:00:00Z")
    info = c.get(f"/api/exam/{ex['student_token']}").json()
    assert info["is_closed"] is True and info["deadline"] is not None
    res = c.get(f"/api/teacher/exams/{ex['admin_token']}").json()
    assert res["submissions"] == []


def test_clearing_deadline_reopens_exam(backend):
    _, c = backend
    ex = _exam(c, deadline="2000-01-01T00:00:00Z")
    st, ad = ex["student_token"], ex["admin_token"]
    assert c.post(f"/api/exam/{st}/run", json={"code": REF}).status_code == 403
    r = c.patch(f"/api/teacher/exams/{ad}", json={"deadline": None})
    assert r.status_code == 200 and r.json() == {"deadline": None}
    info = c.get(f"/api/exam/{st}").json()
    assert info["deadline"] is None and info["is_closed"] is False
    assert c.post(f"/api/exam/{st}/run", json={"code": REF}).status_code == 200


def test_patch_without_deadline_field_clears_it(backend):
    # UpdateExamRequest.deadline defaults to None, so an empty body clears the deadline.
    _, c = backend
    ex = _exam(c, deadline="2999-01-01T00:00:00Z")
    assert c.patch(f"/api/teacher/exams/{ex['admin_token']}", json={}).json() == {"deadline": None}


def test_set_deadline_closes_then_extends(backend):
    _, c = backend
    ex = _exam(c)
    st, ad = ex["student_token"], ex["admin_token"]
    c.patch(f"/api/teacher/exams/{ad}", json={"deadline": "2000-01-01T00:00:00Z"})
    assert c.get(f"/api/exam/{st}").json()["is_closed"] is True
    c.patch(f"/api/teacher/exams/{ad}", json={"deadline": "2999-01-01T00:00:00Z"})
    assert c.get(f"/api/exam/{st}").json()["is_closed"] is False


def test_unparseable_deadline_is_422(backend):
    _, c = backend
    ex = _exam(c)
    r = c.patch(f"/api/teacher/exams/{ex['admin_token']}", json={"deadline": "not a date"})
    assert r.status_code == 422


def test_time_limit_default_and_override(backend):
    _, c = backend
    default = _exam(c)
    custom = _exam(c, time_limit_seconds=90)
    assert c.get(f"/api/exam/{default['student_token']}").json()["time_limit_seconds"] == 600
    assert c.get(f"/api/exam/{custom['student_token']}").json()["time_limit_seconds"] == 90


# Worker-only: naive and non-UTC datetimes. server/ cannot be exercised here
# because SQLite drops tzinfo (Postgres timestamptz returns aware values).

def test_worker_naive_deadline_is_taken_as_utc(backend):
    name, c = backend
    if name != "worker":
        pytest.skip("naive-datetime handling needs Postgres timestamptz semantics on server/")
    past = (datetime.datetime.now(UTC) - datetime.timedelta(hours=1)).replace(tzinfo=None).isoformat()
    future = (datetime.datetime.now(UTC) + datetime.timedelta(hours=1)).replace(tzinfo=None).isoformat()
    ex_past, ex_future = _exam(c, deadline=past), _exam(c, deadline=future)
    assert c.get(f"/api/exam/{ex_past['student_token']}").json()["is_closed"] is True
    info = c.get(f"/api/exam/{ex_future['student_token']}").json()
    assert info["is_closed"] is False and info["deadline"].endswith("+00:00")


def test_worker_offset_deadline_compares_as_instant(backend):
    name, c = backend
    if name != "worker":
        pytest.skip("offset round-trip needs Postgres timestamptz semantics on server/")
    plus7 = datetime.timezone(datetime.timedelta(hours=7))
    past = (datetime.datetime.now(plus7) - datetime.timedelta(minutes=1)).isoformat()
    future = (datetime.datetime.now(plus7) + datetime.timedelta(hours=1)).isoformat()
    assert c.get(f"/api/exam/{_exam(c, deadline=past)['student_token']}").json()["is_closed"] is True
    assert c.get(f"/api/exam/{_exam(c, deadline=future)['student_token']}").json()["is_closed"] is False
