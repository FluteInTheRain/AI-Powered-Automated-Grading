"""The restore drill must pass on a dump of the real schema and fail when the dump is damaged."""
import importlib.util
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "app-worker" / "migrations"

spec = importlib.util.spec_from_file_location("d1_restore_drill", ROOT / "scripts" / "d1_restore_drill.py")
drill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill)


def migrated_db():
    db = sqlite3.connect(":memory:")
    for f in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(f.read_text())
    return db


def dump(db):
    return "PRAGMA defer_foreign_keys=TRUE;\n" + "\n".join(db.iterdump())


def filled_db():
    """Real migrations plus one row in every table the append-only triggers or foreign keys care about."""
    db = migrated_db()
    db.execute("INSERT INTO teachers (id, email, created_at) VALUES ('t','t@x.com','2026-01-01')")
    db.execute("INSERT INTO problems (id, visibility, statement, func_name, param_names, rubric, "
               "reference_solution, test_cases, starter_code, created_at) "
               "VALUES ('p','system','s','f','[]','{}','x','[]','','2026-01-01')")
    db.execute("INSERT INTO exams (id, teacher_id, title, student_token, time_limit_seconds, created_at) "
               "VALUES ('e','t','T','tok',600,'2026-01-01')")
    db.execute("INSERT INTO attempts (id, exam_id, student_name, receipt_code, started_at, name_key) "
               "VALUES ('a','e','An','R1','2026-01-01','an')")
    db.execute("INSERT INTO submissions (id, attempt_id, problem_id, code, submitted_at) "
               "VALUES ('s','a','p','pass','2026-01-01')")
    db.execute("INSERT INTO score_revisions (id, submission_id, revision, source, score, sub_scores, detail, "
               "author, created_at) VALUES ('r','s',0,'ai',90,'{}','{}','pipeline','2026-01-01')")
    db.commit()
    return db


def by_name(rows):
    return {name: (ok, detail) for name, ok, detail in rows}


def test_expected_schema_comes_from_the_migrations():
    tables, triggers = drill.expected_schema()
    assert {"teachers", "submissions", "score_revisions", "grading_jobs", "appeals", "canary_runs"} <= set(tables)
    assert {n for n, _, _ in triggers} == {
        "score_revisions_no_update", "score_revisions_no_delete",
        "submissions_no_update", "submissions_no_delete"}


def test_empty_database_passes_with_triggers_only_checked_structurally():
    rows = by_name(drill.run_drill(dump(migrated_db())))
    assert all(ok for ok, _ in rows.values()), rows
    assert "not exercised" in rows["trigger: submissions_no_update"][1]


def test_filled_database_passes_and_triggers_are_exercised():
    rows = by_name(drill.run_drill(dump(filled_db())))
    assert all(ok for ok, _ in rows.values()), rows
    assert rows["rows: teachers"] == (True, "1")
    assert rows["rows: score_revisions"] == (True, "1")
    assert rows["trigger: score_revisions_no_delete"] == (True, "blocks DELETE")
    assert rows["trigger: submissions_no_update"] == (True, "blocks UPDATE")


def test_missing_trigger_fails():
    text = dump(filled_db()).replace("submissions_no_delete", "renamed_trigger")
    rows = by_name(drill.run_drill(text))
    assert rows["trigger: submissions_no_delete"][0] is False
    assert rows["trigger: submissions_no_update"][0] is True


def test_trigger_that_no_longer_raises_fails():
    text = dump(filled_db()).replace("SELECT RAISE(ABORT, 'score_revisions is append-only')", "SELECT 1")
    rows = by_name(drill.run_drill(text))
    assert rows["trigger: score_revisions_no_update"][0] is False


def test_missing_table_fails():
    text = dump(filled_db()).replace('canary_runs', 'canary_gone')
    rows = by_name(drill.run_drill(text))
    assert rows["tables"][0] is False
    assert "canary_runs" in rows["tables"][1]


def test_orphan_row_fails_foreign_key_check():
    db = filled_db()
    db.execute("INSERT INTO attempts (id, exam_id, student_name, receipt_code, started_at, name_key) "
               "VALUES ('b','no-such-exam','Bo','R2','2026-01-01','bo')")
    rows = by_name(drill.run_drill(dump(db)))
    assert rows["foreign keys"][0] is False


def test_main_exit_codes(tmp_path, capsys):
    good = tmp_path / "good.sql"
    good.write_text(dump(filled_db()))
    assert drill.main(["drill", str(good)]) == 0
    assert "RESULT: PASS" in capsys.readouterr().out
    bad = tmp_path / "bad.sql"
    bad.write_text("this is not sql")
    assert drill.main(["drill", str(bad)]) == 1
