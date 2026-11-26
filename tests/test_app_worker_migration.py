"""Migration 0002 must apply on a live database that already holds duplicate attempt names."""
import sqlite3
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "app-worker" / "migrations"


def test_0002_applies_with_duplicate_names_and_keeps_the_first_one_unique():
    db = sqlite3.connect(":memory:")
    db.executescript((MIGRATIONS / "0001_init.sql").read_text())
    db.execute("INSERT INTO teachers VALUES ('t','t@x.com','2026-01-01')")
    db.execute("INSERT INTO exams VALUES ('e','t','T','tok',NULL,600,'2026-01-01')")
    for i, name in enumerate(["An", "an ", " AN", "Binh"]):
        db.execute("INSERT INTO attempts VALUES (?, 'e', ?, ?, '2026-01-01')", (f"a{i}", name, f"R{i}"))
    db.executescript((MIGRATIONS / "0002_phase2.sql").read_text())  # must not raise
    keys = [r[0] for r in db.execute("SELECT name_key FROM attempts ORDER BY rowid")]
    assert len(set(keys)) == 4
    assert keys[0] == "an" and keys[3] == "binh"  # the first holder keeps the plain key
    try:
        db.execute("INSERT INTO attempts VALUES ('x', 'e', 'AN', 'RX', '2026-01-01', 'an')")
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("the unique index must still reject a new duplicate")
