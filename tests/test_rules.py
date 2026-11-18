import pytest

from grader import sandbox
from server import rules

RUB = {"correctness": 40, "efficiency": 20, "code_style": 20, "edge_case_handling": 20}
CASES = [
    {"args": [1, 2], "expected": 3, "is_public": True},
    {"args": [2, 2], "expected": 4, "is_public": False},
]
REF = "def add(a, b):\n    return a + b\n"


def _validate(rubric=RUB, cases=CASES, ref=REF):
    rules.validate_new_problem(rubric, cases, sandbox.run_submission, ref, "add")


def test_valid_problem_passes():
    _validate()


def test_weights_must_sum_to_100():
    with pytest.raises(ValueError, match=r"^Rubric weights must sum to 100, got 90$"):
        _validate(rubric={**RUB, "efficiency": 10})


def test_no_cases():
    with pytest.raises(ValueError, match=r"^At least one test case is required$"):
        _validate(cases=[])


def test_all_public():
    with pytest.raises(ValueError, match="At least one test case must be hidden"):
        _validate(cases=[{**c, "is_public": True} for c in CASES])


def test_failing_reference():
    with pytest.raises(ValueError, match=r"Reference solution does not pass all test cases \(status=ran, pass_rate=0.5\)"):
        _validate(ref="def add(a, b):\n    return a * b\n")


def test_split_cases_and_starter_code():
    pub, hid = rules.split_cases(CASES)
    assert pub == [CASES[0]] and hid == [CASES[1]]
    assert rules.starter_code("add", ["a", "b"]) == "def add(a, b):\n    # TODO: your solution here\n    pass\n"


def test_is_closed():
    import datetime as dt
    now = dt.datetime.now(dt.timezone.utc)
    assert rules.is_closed(None) is False
    assert rules.is_closed(now - dt.timedelta(seconds=1)) is True
    assert rules.is_closed(now + dt.timedelta(hours=1)) is False


def test_export_row_neutralises_formulas():
    inj = '=HYPERLINK("http://x")'
    assert rules.export_row(inj, {}, "t")[0] == "'" + inj
    for bad in ("+1", "-1", "@SUM(A1)", "\tx", "\rx"):
        assert rules.export_row(bad, {}, "t")[0] == "'" + bad
    row = rules.export_row("An", {"final_score_0_to_100": -5.0}, "t")
    assert row[0] == "An" and row[1] == -5.0 and row[2] is None
