"""Quality gate for data/bank_extra: structure, unique ids, and that every reference passes its own tests."""
import ast
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
for p in (ROOT, ROOT / "src", ROOT / "data"):
    sys.path.insert(0, str(p))

from bank_extra import BANK_EXTRA  # noqa: E402
from grader import sandbox  # noqa: E402
from problems import PROBLEMS  # noqa: E402

REQUIRED = {"id", "title", "category", "difficulty", "statement", "func_name", "rubric",
            "reference_solution", "test_cases"}
RUBRIC_KEYS = {"correctness", "efficiency", "code_style", "edge_case_handling"}
MIN_CASES = 8


def test_ids_unique_across_all_problems():
    ids = [p["id"] for p in [*PROBLEMS, *BANK_EXTRA]]
    assert len(ids) == len(set(ids)), sorted({i for i in ids if ids.count(i) > 1})


def test_titles_unique_across_all_problems():
    titles = [p["title"].lower() for p in [*PROBLEMS, *BANK_EXTRA]]
    assert len(titles) == len(set(titles)), sorted({t for t in titles if titles.count(t) > 1})


@pytest.mark.parametrize("p", BANK_EXTRA, ids=[p["id"] for p in BANK_EXTRA])
def test_problem(p):
    assert REQUIRED <= set(p), REQUIRED - set(p)
    assert "submissions" not in p
    assert re.fullmatch(r"P(1[7-9]|[2-9]\d)_[a-z][a-z0-9_]*", p["id"]), p["id"]
    assert 1 <= len(p["title"]) <= 80
    assert 1 <= len(p["category"]) <= 40
    assert p["difficulty"] in {"easy", "medium", "hard"}
    assert set(p["rubric"]) == RUBRIC_KEYS and sum(p["rubric"].values()) == 100
    assert len(p["statement"]) >= 60 and p["func_name"] in p["statement"]

    tree = ast.parse(p["reference_solution"])
    fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == p["func_name"]]
    assert fn, "reference defines func_name"

    cases = p["test_cases"]
    assert len(cases) >= MIN_CASES, f"only {len(cases)} test cases"
    n_params = len(fn[0].args.args)
    seen = set()
    for args, expected in cases:
        assert isinstance(args, tuple) and len(args) == n_params, (args, n_params)
        # Must survive the JSON round trip the bank applies (tuples become lists), with no floats or NaN.
        norm = json.loads(json.dumps([list(args), expected]))
        assert json.dumps(norm, sort_keys=True) not in seen, f"duplicate case {args}"
        seen.add(json.dumps(norm, sort_keys=True))

    # Run against the JSON-normalized cases: that is exactly what the bank stores and grades with.
    stored = [(tuple(json.loads(json.dumps(list(a)))), json.loads(json.dumps(e))) for a, e in cases]
    res = sandbox.run_submission(p["reference_solution"], p["func_name"], stored)
    assert res["status"] == "ran" and res["pass_rate"] == 1.0, res
