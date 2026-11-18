"""In-memory stand-in for the Cloudflare D1 binding, over sqlite3.

Mimics the surface worker/src/app/store.py uses: prepare(sql).bind(*p) with
async all()/first()/run(), and an atomic async batch(list). Rows are
SimpleNamespace (attribute access by column name), like the Python Workers
binding."""
import sqlite3
from pathlib import Path
from types import SimpleNamespace

MIGRATION = Path(__file__).resolve().parents[2] / "worker" / "migrations" / "0001_init.sql"


class _Stmt:
    def __init__(self, db, sql, params=()):
        self._db, self.sql, self.params = db, sql, params

    def bind(self, *params):
        return _Stmt(self._db, self.sql, params)

    def _rows(self):
        cur = self._db._conn.execute(self.sql, self.params)
        cols = [c[0] for c in cur.description or []]
        return [SimpleNamespace(**dict(zip(cols, r))) for r in cur.fetchall()]

    async def all(self):
        return SimpleNamespace(results=self._rows())

    async def first(self):
        rows = self._rows()
        return rows[0] if rows else None

    async def run(self):
        self._db._conn.execute(self.sql, self.params)
        return SimpleNamespace(success=True)


class FakeD1:
    def __init__(self):
        self._conn = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(MIGRATION.read_text())
        self._fail_at = None

    def fail_on_batch_statement(self, index):
        """Make the next batch raise at the statement with this 0-based index."""
        self._fail_at = index

    def prepare(self, sql):
        return _Stmt(self, sql)

    async def batch(self, stmts):
        fail_at, self._fail_at = self._fail_at, None
        self._conn.execute("BEGIN")
        try:
            for i, s in enumerate(stmts):
                if i == fail_at:
                    raise RuntimeError(f"injected failure at batch statement {i}")
                self._conn.execute(s.sql, s.params)
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return [SimpleNamespace(success=True) for _ in stmts]
