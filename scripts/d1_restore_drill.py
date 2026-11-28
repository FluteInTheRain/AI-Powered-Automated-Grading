#!/usr/bin/env python3
"""Restore drill: load a D1 export into a throw-away local sqlite database and check it.

Checks: every table the migrations create exists, row counts per table, the append-only
triggers exist (and block UPDATE and DELETE when the table has rows), foreign key integrity.
Nothing here touches Cloudflare. Usage: python3 scripts/d1_restore_drill.py <export.sql>
Exit code 0 when every check passes, 1 otherwise. Prints counts only, never row contents.
"""
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "app-worker" / "migrations"

TABLE_RE = re.compile(r"^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`]?(\w+)", re.I | re.M)
TRIGGER_RE = re.compile(
    r"^\s*CREATE\s+TRIGGER\s+(\w+)\s+BEFORE\s+(UPDATE|DELETE)\s+ON\s+(\w+)", re.I | re.M)


def expected_schema(migrations_dir=MIGRATIONS):
    """Return (tables, triggers) declared by the migrations; triggers are (name, event, table)."""
    tables, triggers = [], []
    for f in sorted(Path(migrations_dir).glob("*.sql")):
        text = f.read_text()
        tables += TABLE_RE.findall(text)
        triggers += [(n, e.upper(), t) for n, e, t in TRIGGER_RE.findall(text)]
    return tables, triggers


def load_export(sql_text, db_path):
    db = sqlite3.connect(db_path)
    db.executescript(sql_text)
    db.commit()
    return db


def check_tables(db, tables):
    have = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = [t for t in tables if t not in have]
    return not missing, ("all %d present" % len(tables)) if not missing else "missing: " + ", ".join(missing)


def row_counts(db, tables):
    return {t: db.execute('SELECT count(*) FROM "%s"' % t).fetchone()[0] for t in tables if _exists(db, t)}


def _exists(db, t):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone() is not None


def _blocked(db, sql):
    """Run a write inside a savepoint that is always rolled back; True if the database aborted it."""
    db.execute("SAVEPOINT probe")
    try:
        db.execute(sql)
    except sqlite3.DatabaseError as e:
        db.execute("ROLLBACK TO probe")
        db.execute("RELEASE probe")
        return "append-only" in str(e)
    db.execute("ROLLBACK TO probe")
    db.execute("RELEASE probe")
    return False


def check_triggers(db, triggers, counts):
    """Each trigger must exist on the right table with a RAISE; if the table has rows, prove it blocks."""
    results = []
    for name, event, table in triggers:
        row = db.execute(
            "SELECT tbl_name, sql FROM sqlite_master WHERE type='trigger' AND name=?", (name,)).fetchone()
        if row is None or row[0] != table or "RAISE" not in row[1].upper() or event not in row[1].upper():
            results.append((name, False, "missing or altered"))
            continue
        if counts.get(table, 0) == 0:
            results.append((name, True, "present (table empty, not exercised)"))
            continue
        col = db.execute('PRAGMA table_info("%s")' % table).fetchone()[1]
        sql = ('UPDATE "%s" SET "%s"="%s"' % (table, col, col)) if event == "UPDATE" else 'DELETE FROM "%s"' % table
        ok = _blocked(db, sql)
        results.append((name, ok, "blocks %s" % event if ok else "DID NOT BLOCK %s" % event))
    return results


def check_foreign_keys(db):
    bad = db.execute("PRAGMA foreign_key_check").fetchall()
    return not bad, "no violations" if not bad else "%d violating rows" % len(bad)


def run_drill(sql_text, migrations_dir=MIGRATIONS):
    """Return a list of (check, ok, detail) rows."""
    tables, triggers = expected_schema(migrations_dir)
    with tempfile.TemporaryDirectory(prefix="d1-drill-") as tmp:
        db = load_export(sql_text, str(Path(tmp) / "drill.sqlite"))
        try:
            rows = []
            ok, detail = check_tables(db, tables)
            rows.append(("tables", ok, detail))
            counts = row_counts(db, tables)
            for t, n in counts.items():
                rows.append(("rows: " + t, True, str(n)))
            for name, ok, detail in check_triggers(db, triggers, counts):
                rows.append(("trigger: " + name, ok, detail))
            ok, detail = check_foreign_keys(db)
            rows.append(("foreign keys", ok, detail))
        finally:
            db.close()
    return rows


def print_table(rows):
    w = max(len(r[0]) for r in rows)
    for name, ok, detail in rows:
        print("%-4s %-*s  %s" % ("PASS" if ok else "FAIL", w, name, detail))
    print("RESULT:", "PASS" if all(r[1] for r in rows) else "FAIL")


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[-2], file=sys.stderr)
        return 2
    try:
        rows = run_drill(Path(argv[1]).read_text())
    except (OSError, sqlite3.DatabaseError) as e:
        print("FAIL could not load the export: %s" % e)
        return 1
    print_table(rows)
    return 0 if all(r[1] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
