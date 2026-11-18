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


EXIT_MSG = "COMPILE_ERROR: program exited (SystemExit: "


@pytest.mark.parametrize("code", [
    "import sys\nsys.exit(3)\ndef f():\n    return 1\n",          # top level, at exec time
    "def f():\n    raise SystemExit(1)\n",                         # inside the function, per case
    "def f():\n    exit()\n",                                      # the site builtin
])
def test_system_exit_is_a_compile_error_not_a_crash(code):
    got = handler.execute(_payload(code, "f", [[]]))
    assert got["status"] == "compile_error" and got["cases"] == []
    assert got["message"].startswith(EXIT_MSG)


def test_other_base_exceptions_from_student_code_are_caught():
    for exc in ("KeyboardInterrupt", "GeneratorExit"):
        got = handler.execute(_payload(f"def f():\n    raise {exc}('x')\n", "f", [[]]))
        assert got == {"status": "compile_error", "cases": [],
                       "message": f"COMPILE_ERROR: program exited ({exc}: x)"}


def test_exit_message_is_capped():
    got = handler.execute(_payload("def f():\n    raise SystemExit('y' * 5000)\n", "f", [[]]))
    assert got["status"] == "compile_error" and len(got["message"]) <= 300


def test_runtime_cpu_limit_is_not_swallowed():
    # Live, the runtime raises _cloudflare...CpuLimitExceeded inside student code when
    # the sandbox hits its CPU ceiling; it must keep killing the request.
    code = ("class CpuLimitExceeded(BaseException):\n    __module__ = '_cloudflare.introspection'\n"
            "def f():\n    raise CpuLimitExceeded('Python Worker exceeded CPU time limit')\n")
    with pytest.raises(BaseException, match="exceeded CPU time limit"):
        handler.execute(_payload(code, "f", [[]]))


def test_huge_output_is_dropped():
    got = handler.execute(_payload("def f():\n    return 'x' * 70000\n", "f", [[]]))
    c = got["cases"][0]
    assert c["output"] is None and c["error"] == "return value too large (70002 bytes)"


def test_output_just_under_cap_is_kept():
    got = handler.execute(_payload("def f():\n    return 'x' * 60000\n", "f", [[]]))
    assert got["cases"][0]["output"] == "x" * 60000 and got["cases"][0]["error"] is None
