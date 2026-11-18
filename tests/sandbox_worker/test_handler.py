import pytest

from data.problems import PROBLEMS
from grader.sandbox import compute_reference_outputs, run_submission, run_submission_cases
import handler

ADD = "def add(a, b):\n    return a + b\n"


def _p01():
    p = PROBLEMS[0]
    code = p["submissions"][0]["code"]
    return p, code


def test_run_mode_matches_local_sandbox():
    cases = [(tuple(a), e) for a, e in [([1, 2], 3), ([2, 2], 4)]]
    payload_cases = [[list(a), e] for a, e in cases]
    got = handler.execute({"mode": "run", "code": ADD, "func_name": "add", "cases": payload_cases})
    assert got == run_submission(ADD, "add", cases)
    assert got["pass_count"] == 2


def test_run_mode_p01_s1_roundtrip():
    p, code = _p01()
    func = p["func_name"]
    tcs = p["test_cases"]
    cases = [[list(a), e] for a, e in tcs]
    got = handler.execute({"mode": "run", "code": code, "func_name": func, "cases": cases})
    assert got == run_submission(code, func, [(tuple(a), e) for a, e in tcs])


def test_cases_mode_returns_per_case_detail():
    got = handler.execute({"mode": "cases", "code": ADD, "func_name": "add",
                           "cases": [[[1, 2], 3], [[1, 1], 5]]})
    assert got == run_submission_cases(ADD, "add", [((1, 2), 3), ((1, 1), 5)])
    assert [c["passed"] for c in got["cases"]] == [True, False]


def test_reference_mode_returns_outputs():
    got = handler.execute({"mode": "reference", "code": ADD, "func_name": "add",
                           "cases": [[1, 2], [3, 4]]})
    assert got == compute_reference_outputs(ADD, "add", [(1, 2), (3, 4)])
    assert [c["output"] for c in got["cases"]] == [3, 7]


def test_unknown_mode_raises():
    with pytest.raises(ValueError):
        handler.execute({"mode": "nope", "code": "", "func_name": "f", "cases": []})
