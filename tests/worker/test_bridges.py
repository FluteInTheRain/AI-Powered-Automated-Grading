import json

import pytest
from pydantic import BaseModel

import handler
from app.bridges import RemoteSandbox, WorkersAIClient
from grader import sandbox as local
from problems import PROBLEMS

ident = lambda x: x


class Out(BaseModel):
    score: int


class FakeAI:
    def __init__(self, response):
        self.response, self.calls = response, []

    def run(self, model, payload):
        self.calls.append((model, payload))
        return {"response": self.response}


def test_ai_sends_bare_schema_seed_temperature():
    ai = FakeAI({"score": 3})
    c = WorkersAIClient(ai, "m1", seed=7, run_sync=ident)
    c.structured_call("sys", "usr", Out)
    model, p = ai.calls[0]
    assert model == "m1" and p["temperature"] == 0 and p["seed"] == 7
    assert p["response_format"] == {"type": "json_schema", "json_schema": Out.model_json_schema()}
    assert p["messages"][0] == {"role": "system", "content": "sys"}


def test_ai_dict_response_logged_as_string():
    c = WorkersAIClient(FakeAI({"score": 3}), "m1", run_sync=ident)
    assert c.structured_call("s", "u", Out).score == 3
    e = c.call_log[0]
    assert isinstance(e["raw_response"], str) and json.loads(e["raw_response"]) == {"score": 3}
    assert e["kind"] == "structured" and e["schema"] == "Out" and e["model"] == "m1"


def test_ai_str_response_and_attr_object():
    class R:
        response = '{"score": 4}'
    class AI:
        def run(self, m, p):
            return R()
    assert WorkersAIClient(AI(), "m", run_sync=ident).structured_call("s", "u", Out).score == 4


@pytest.mark.parametrize("resp", [None, ""])
def test_ai_empty_response_raises(resp):
    c = WorkersAIClient(FakeAI(resp), "m1", run_sync=ident)
    with pytest.raises(RuntimeError):
        c.structured_call("s", "u", Out)
    assert c.call_log == []


class _Resp:
    def __init__(self, status, body):
        self.status, self._body = status, body

    def text(self):
        return self._body


class FakeBinding:
    def __init__(self, status=200):
        self.status, self.posted = status, []

    def fetch(self, url, init):
        assert url == "https://sandbox/execute" and init["method"] == "POST"
        payload = json.loads(init["body"])
        self.posted.append(payload)
        return _Resp(self.status, json.dumps(handler.execute(payload)))


CODE = "def add(a, b):\n    return a + b\n"


def test_remote_sandbox_roundtrip():
    rs = RemoteSandbox(FakeBinding(), run_sync=ident)
    r = rs.run_submission(CODE, "add", [((1, 2), 3), ((2, 2), 5)])
    assert r["pass_count"] == 1 and r["total"] == 2 and r["pass_rate"] == 0.5
    assert r["errors"] == ["input=(2, 2) expected=5 got=4"]
    cs = rs.run_submission_cases(CODE, "add", [((1, 2), 3)])
    assert cs["cases"] == [{"passed": True, "args": (1, 2), "expected": 3, "actual": 3, "error": None}]
    ref = rs.compute_reference_outputs(CODE, "add", [(1, 2)])
    assert ref == local.compute_reference_outputs(CODE, "add", [(1, 2)])
    assert rs.run_submission("def (", "add", [((1, 2), 3)])["status"] == "compile_error"
    assert rs.run_submission(CODE, "nope", [((1, 2), 3)])["errors"] == ["FUNC_NOT_FOUND: nope"]


def test_remote_sandbox_never_sends_expected():
    b = FakeBinding()
    RemoteSandbox(b, run_sync=ident).run_submission(CODE, "add", [((1, 2), 987654)])
    assert set(b.posted[0]) == {"code", "func_name", "args_list"}
    assert "987654" not in json.dumps(b.posted[0]) and "expected" not in json.dumps(b.posted[0])


def test_remote_matches_local_on_pilot():
    rs = RemoteSandbox(FakeBinding(), run_sync=ident)
    for p in PROBLEMS:
        for s in p["submissions"]:
            a = rs.run_submission(s["code"], p["func_name"], p["test_cases"])
            b = local.run_submission(s["code"], p["func_name"], p["test_cases"])
            assert (a["pass_count"], a["status"], a["total"]) == (b["pass_count"], b["status"], b["total"]), s["sub_id"]


def test_remote_sandbox_non_200_raises():
    with pytest.raises(RuntimeError, match="sandbox failed: 500"):
        RemoteSandbox(FakeBinding(500), run_sync=ident).run_submission(CODE, "add", [((1, 2), 3)])
