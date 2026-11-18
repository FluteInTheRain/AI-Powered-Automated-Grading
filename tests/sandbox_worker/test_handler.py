import pytest

from data.problems import PROBLEMS
from grader.sandbox import compute_reference_outputs
import handler

ADD = "def add(a, b):\n    return a + b\n"


def _payload(code=ADD, func="add", args=None):
    return {"code": code, "func_name": func, "args_list": [[1, 2], [3, 4]] if args is None else args}


def test_outputs_match_local_sandbox_p01():
    p = PROBLEMS[0]
    code = p["submissions"][0]["code"]
    args = [list(a) for a, _ in p["test_cases"]]
    got = handler.execute({"code": code, "func_name": p["func_name"], "args_list": args})
    assert got == compute_reference_outputs(code, p["func_name"], [tuple(a) for a in args])


def test_reference_outputs():
    got = handler.execute(_payload())
    assert [c["output"] for c in got["cases"]] == [3, 7]


def test_nan_output_is_json_safe():
    got = handler.execute(_payload("def f():\n    return float('nan')\n", "f", [[]]))
    c = got["cases"][0]
    assert c["output"] is None and c["error"].startswith("return value is not JSON-serializable: nan")


def test_arbitrary_object_output_is_json_safe():
    got = handler.execute(_payload("def f():\n    return object()\n", "f", [[]]))
    c = got["cases"][0]
    assert c["output"] is None and "not JSON-serializable" in c["error"]


def test_long_repr_truncated():
    got = handler.execute(_payload("def f():\n    return {1, *range(500)}\n", "f", [[]]))
    assert len(got["cases"][0]["error"]) <= 200 + 60


@pytest.mark.parametrize("bad", [
    None, [], "x", {},
    {"code": 1, "func_name": "f", "args_list": []},
    {"code": "", "func_name": None, "args_list": []},
    {"code": "", "func_name": "f"},
    {"code": "", "func_name": "f", "args_list": "ab"},
    {"code": "", "func_name": "f", "args_list": ["ab"]},
    {"code": "", "func_name": "f", "args_list": [1]},
])
def test_bad_payload_raises(bad):
    with pytest.raises(handler.BadPayload):
        handler.validate(bad)
    with pytest.raises(handler.BadPayload):
        handler.execute(bad)


def test_old_modes_not_accepted():
    with pytest.raises(handler.BadPayload):
        handler.execute({"mode": "run", "code": ADD, "func_name": "add", "cases": []})
