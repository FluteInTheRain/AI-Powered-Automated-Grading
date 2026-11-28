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


EXPECTED = len(seed.PROBLEMS) + len(seed.BANK_EXTRA)


def test_seed_has_every_problem_with_valid_rubrics(rows):
    assert len(rows) == EXPECTED
    assert len({r["id"] for r in rows}) == EXPECTED
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


MIGRATIONS = ["0001_init.sql", "0002_phase2.sql", "0003_rubric_settings.sql", "0004_problem_catalog.sql"]


def _schema():
    db = sqlite3.connect(":memory:")
    for name in MIGRATIONS:
        db.executescript((ROOT / "app-worker" / "migrations" / name).read_text())
    return db


def test_every_problem_has_valid_catalog_metadata(rows):
    for r in rows:
        assert 1 <= len(r["title"]) <= 80, r["id"]
        assert 1 <= len(r["category"]) <= 40, r["id"]
        assert r["difficulty"] in {"easy", "medium", "hard"}, r["id"]
    assert len({r["title"] for r in rows}) == len(rows)
    assert {r["category"] for r in rows} == {"Math", "Strings", "Arrays & Search", "Basics", "Data Structures"}


def test_sql_loads_into_the_real_schema_twice(rows):
    db = _schema()
    sql = seed.render_sql(rows)
    db.executescript(sql)
    db.executescript(sql)  # idempotent
    assert db.execute("SELECT count(*) FROM problems WHERE visibility = 'system'").fetchone()[0] == EXPECTED
    stored = db.execute("SELECT test_cases, rubric FROM problems WHERE id = 'bank:P01_two_sum'").fetchone()
    assert json.loads(stored[0])[0]["args"] == [[2, 7, 11, 15], 9]
    assert json.loads(stored[1])["correctness"] == 60
    assert db.execute("SELECT title, category, difficulty FROM problems WHERE id = 'bank:P01_two_sum'").fetchone() == (
        "Two Sum", "Arrays & Search", "medium")


def test_reseeding_only_refreshes_the_metadata(rows):
    db = _schema()
    sql = seed.render_sql(rows)
    db.executescript(sql)
    db.execute("UPDATE problems SET statement = 'CHANGED', title = 'Old title' WHERE id = 'bank:P01_two_sum'")
    db.executescript(sql)
    statement, title = db.execute("SELECT statement, title FROM problems WHERE id = 'bank:P01_two_sum'").fetchone()
    assert statement == "CHANGED"  # exams may use the problem: its statement, tests and rubric are never rewritten
    assert title == "Two Sum"


def test_reseeding_works_while_exams_reference_the_problems(rows):
    db = _schema()
    sql = seed.render_sql(rows)
    db.executescript(sql)
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("INSERT INTO teachers (id, email, created_at) VALUES ('t', 't@x', 'now')")
    db.execute("INSERT INTO exams (id, teacher_id, title, student_token, time_limit_seconds, created_at) VALUES ('e','t','T','tok',60,'now')")
    db.execute("INSERT INTO exam_questions (exam_id, problem_id, position, weight) VALUES ('e','bank:P01_two_sum',0,1)")
    db.executescript(sql)  # INSERT OR REPLACE would break the foreign key here
    assert db.execute("SELECT count(*) FROM exam_questions").fetchone()[0] == 1
