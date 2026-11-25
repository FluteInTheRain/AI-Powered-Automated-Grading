import ast
import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("export_bank_seed", ROOT / "scripts" / "export_bank_seed.py")
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

from grader import sandbox  # noqa: E402


@pytest.fixture(scope="module")
def rows():
    return seed.build_rows()


def test_seed_has_16_problems_with_valid_rubrics(rows):
    assert len(rows) == 16
    assert len({r["id"] for r in rows}) == 16
    assert all(r["id"].startswith("bank:") for r in rows)
    assert all(sum(r["rubric"].values()) == 100 for r in rows)


def test_every_reference_passes_its_cases(rows):
    for r in rows:
        cases = [(tuple(tc["args"]), tc["expected"]) for tc in r["test_cases"]]
        res = sandbox.run_submission(r["reference_solution"], r["func_name"], cases)
        assert res["status"] == "ran" and res["pass_rate"] == 1.0, r["id"]


def test_at_least_one_hidden_case_each(rows):
    for r in rows:
        assert any(not tc["is_public"] for tc in r["test_cases"]), r["id"]
        assert sum(tc["is_public"] for tc in r["test_cases"]) <= 1


def test_param_names_match_def(rows):
    for r in rows:
        fn = next(n for n in ast.parse(r["reference_solution"]).body
                  if isinstance(n, ast.FunctionDef) and n.name == r["func_name"])
        assert r["param_names"] == [a.arg for a in fn.args.args], r["id"]


def test_sql_loads_into_the_real_schema_twice(rows):
    db = sqlite3.connect(":memory:")
    db.executescript((ROOT / "app-worker" / "migrations" / "0001_init.sql").read_text())
    sql = seed.render_sql(rows)
    db.executescript(sql)
    db.executescript(sql)  # idempotent
    assert db.execute("SELECT count(*) FROM problems WHERE visibility = 'system'").fetchone()[0] == 16
    stored = db.execute("SELECT test_cases, rubric FROM problems WHERE id = 'bank:P01_two_sum'").fetchone()
    assert json.loads(stored[0])[0]["args"] == [[2, 7, 11, 15], 9]
    assert json.loads(stored[1])["correctness"] == 60
