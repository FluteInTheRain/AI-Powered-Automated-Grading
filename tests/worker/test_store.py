import asyncio

import pytest

from app import store
from tests.worker.fake_d1 import FakeD1

RUBRIC = {"correctness": 5, "efficiency": 2, "code_style": 2, "edge_case_handling": 1}
CASES = [{"args": [1, 2], "expected": 3, "is_public": True}]


def _problem(db, **over):
    kw = dict(statement="Add", func_name="add", param_names=["a", "b"], rubric=RUBRIC,
              reference_solution="def add(a, b): return a + b", test_cases=CASES,
              starter_code="def add(a, b):\n    pass")
    kw.update(over)
    return store.create_problem(db, **kw)


def _log(i):
    return dict(kind="structured", schema=f"S{i}", model="m", system_prompt="s",
                user_prompt="u", raw_response="{}")


def test_problem_exam_submission_roundtrip():
    async def go():
        db = FakeD1()
        pid = await _problem(db)
        got = await store.get_problem(db, pid)
        assert got["id"] == pid and got["rubric"] == RUBRIC and got["test_cases"] == CASES
        assert got["param_names"] == ["a", "b"]
        assert [p["id"] for p in await store.list_problems(db)] == [pid]
        assert await store.get_problem(db, "nope") is None

        exam = await store.create_exam(db, problem_id=pid, student_token="st", admin_token="ad",
                                       deadline=None, time_limit_seconds=600)
        by_s = await store.get_exam_by_student_token(db, "st")
        by_a = await store.get_exam_by_admin_token(db, "ad")
        assert by_s["id"] == by_a["id"] == exam["id"]
        assert by_s["problem"]["func_name"] == "add" and by_s["deadline"] is None
        assert await store.get_exam_by_student_token(db, "zz") is None
        await store.set_deadline(db, exam["id"], "2030-01-01T00:00:00+00:00")
        assert (await store.get_exam_by_admin_token(db, "ad"))["deadline"] == "2030-01-01T00:00:00+00:00"

        sid = await store.add_submission(db, exam_id=exam["id"], student_name="An", code="x",
                                         result={"total": 9}, logs=[_log(0), _log(1)])
        sub = await store.get_submission(db, sid)
        assert sub["result"] == {"total": 9} and sub["student_name"] == "An"
        assert [s["id"] for s in await store.list_submissions(db, exam["id"])] == [sid]
        logs = await store.get_logs(db, sid)
        assert [l["call_index"] for l in logs] == [0, 1]
        assert logs[1]["schema_name"] == "S1"
        assert await store.get_submission(db, "nope") is None
    asyncio.run(go())


def test_add_submission_is_atomic():
    async def go():
        db = FakeD1()
        pid = await _problem(db)
        exam = await store.create_exam(db, problem_id=pid, student_token="st", admin_token="ad",
                                       deadline=None, time_limit_seconds=60)
        db.fail_on_batch_statement(2)  # submission insert=0, log0=1, log1=2
        with pytest.raises(RuntimeError):
            await store.add_submission(db, exam_id=exam["id"], student_name="An", code="x",
                                       result={}, logs=[_log(0), _log(1)])
        n_sub = await db.prepare("SELECT COUNT(*) AS n FROM submissions").first()
        n_log = await db.prepare("SELECT COUNT(*) AS n FROM grading_logs").first()
        assert n_sub.n == 0 and n_log.n == 0
    asyncio.run(go())


def test_unicode_and_long_text_roundtrip():
    async def go():
        db = FakeD1()
        text = "Tính tổng hai số ☃ \U0001F600 \"quote\" 'q' ; DROP TABLE problems; --\n" * 5000
        pid = await _problem(db, statement=text, rubric={"ghi chú": "tiếng Việt ☃"})
        got = await store.get_problem(db, pid)
        assert got["statement"] == text and got["rubric"] == {"ghi chú": "tiếng Việt ☃"}
        exam = await store.create_exam(db, problem_id=pid, student_token="st", admin_token="ad",
                                       deadline=None, time_limit_seconds=60)
        sid = await store.add_submission(db, exam_id=exam["id"], student_name="Nguyễn Văn Á",
                                         code=text, result={"msg": text}, logs=[])
        sub = await store.get_submission(db, sid)
        assert sub["code"] == text and sub["student_name"] == "Nguyễn Văn Á"
        assert sub["result"]["msg"] == text
    asyncio.run(go())


async def _exam(db, pid=None):
    pid = pid or await _problem(db)
    return await store.create_exam(db, problem_id=pid, student_token="st", admin_token="ad",
                                   deadline=None, time_limit_seconds=60)


def test_unknown_ids_and_tokens_return_none_or_empty():
    async def go():
        db = FakeD1()
        for bad in ("", "nope", "' OR 1=1 --", "ünï"):
            assert await store.get_problem(db, bad) is None
            assert await store.get_exam_by_student_token(db, bad) is None
            assert await store.get_exam_by_admin_token(db, bad) is None
            assert await store.get_submission(db, bad) is None
            assert await store.get_logs(db, bad) == []
            assert await store.list_submissions(db, bad) == []
        assert await store.list_problems(db) == []
        # tokens are not interchangeable
        await _exam(db)
        assert await store.get_exam_by_student_token(db, "ad") is None
        assert await store.get_exam_by_admin_token(db, "st") is None
    asyncio.run(go())


def test_empty_submission_list_and_no_log_submission():
    async def go():
        db = FakeD1()
        exam = await _exam(db)
        assert await store.list_submissions(db, exam["id"]) == []
        sid = await store.add_submission(db, exam_id=exam["id"], student_name="An", code="x",
                                         result={}, logs=[])
        assert await store.get_logs(db, sid) == []
        assert [s["id"] for s in await store.list_submissions(db, exam["id"])] == [sid]
    asyncio.run(go())


def test_list_submissions_orders_by_time_then_id_and_scopes_to_exam(monkeypatch):
    stamps = iter(["2030-01-01T00:00:03+00:00", "2030-01-01T00:00:01+00:00",
                   "2030-01-01T00:00:02+00:00", "2030-01-01T00:00:02+00:00", "2030-01-01T00:00:09+00:00"])
    ids = iter(["a", "b", "c", "d", "e"])

    async def go():
        db = FakeD1()
        exam = await _exam(db)
        pid2 = await _problem(db)
        other = await store.create_exam(db, problem_id=pid2, student_token="st2", admin_token="ad2",
                                        deadline=None, time_limit_seconds=60)
        monkeypatch.setattr(store, "_now", lambda: next(stamps))
        monkeypatch.setattr(store, "_id", lambda: next(ids))
        for name, ex in (("late", exam), ("early", exam), ("tie_z", exam), ("tie_y", exam), ("elsewhere", other)):
            await store.add_submission(db, exam_id=ex["id"], student_name=name,
                                       code="x", result={}, logs=[])
        got = [s["student_name"] for s in await store.list_submissions(db, exam["id"])]
        # early (t=1), then the t=2 tie broken by id (c < d), then late (t=3)
        assert got == ["early", "tie_z", "tie_y", "late"]
        assert [s["student_name"] for s in await store.list_submissions(db, other["id"])] == ["elsewhere"]
    asyncio.run(go())


def test_list_problems_newest_first(monkeypatch):
    stamps = iter(["2030-01-01T00:00:01+00:00", "2030-01-01T00:00:03+00:00", "2030-01-01T00:00:02+00:00"])

    async def go():
        db = FakeD1()
        monkeypatch.setattr(store, "_now", lambda: next(stamps))
        ids = [await _problem(db, statement=s) for s in ("first", "third", "second")]
        assert [p["statement"] for p in await store.list_problems(db)] == ["third", "second", "first"]
        assert set(ids) == {p["id"] for p in await store.list_problems(db)}
    asyncio.run(go())


def test_get_logs_sorted_by_call_index_not_insert_order():
    async def go():
        db = FakeD1()
        exam = await _exam(db)
        sid = await store.add_submission(db, exam_id=exam["id"], student_name="An", code="x",
                                         result={}, logs=[_log(0), _log(1), _log(2)])
        # Rewrite rows so physical order differs from call_index order.
        await db.prepare("UPDATE grading_logs SET call_index = 2 - call_index WHERE submission_id = ?").bind(sid).run()
        logs = await store.get_logs(db, sid)
        assert [l["call_index"] for l in logs] == [0, 1, 2]
        assert [l["schema_name"] for l in logs] == ["S2", "S1", "S0"]
    asyncio.run(go())


@pytest.mark.parametrize("fail_at", [0, 1, 3])
def test_add_submission_atomic_at_any_statement(fail_at):
    async def go():
        db = FakeD1()
        exam = await _exam(db)
        db.fail_on_batch_statement(fail_at)  # 0 = submission insert, 1..3 = logs
        with pytest.raises(RuntimeError):
            await store.add_submission(db, exam_id=exam["id"], student_name="An", code="x",
                                       result={}, logs=[_log(0), _log(1), _log(2)])
        assert await store.list_submissions(db, exam["id"]) == []
        n_log = await db.prepare("SELECT COUNT(*) AS n FROM grading_logs").first()
        assert n_log.n == 0
        # the fake clears the injected failure: a retry succeeds and is complete
        sid = await store.add_submission(db, exam_id=exam["id"], student_name="An", code="x",
                                         result={}, logs=[_log(0)])
        assert len(await store.get_logs(db, sid)) == 1
    asyncio.run(go())


def test_add_submission_for_missing_exam_writes_nothing():
    async def go():
        db = FakeD1()
        with pytest.raises(Exception):
            await store.add_submission(db, exam_id="no-such-exam", student_name="An", code="x",
                                       result={}, logs=[_log(0)])
        n_sub = await db.prepare("SELECT COUNT(*) AS n FROM submissions").first()
        n_log = await db.prepare("SELECT COUNT(*) AS n FROM grading_logs").first()
        assert n_sub.n == 0 and n_log.n == 0
    asyncio.run(go())


def test_large_code_and_odd_characters_roundtrip():
    async def go():
        db = FakeD1()
        exam = await _exam(db)
        code = ("def f():\n    return 'é中\U0001F600\\n\\\"'\n" + "# pad\n" * 200_000
                + "x = '  '\n")
        sid = await store.add_submission(db, exam_id=exam["id"], student_name="  spaced é ",
                                         code=code, result={"code_echo": code[:50]}, logs=[])
        sub = await store.get_submission(db, sid)
        assert sub["code"] == code and len(sub["code"]) > 1_000_000
        assert sub["student_name"] == "  spaced é "
    asyncio.run(go())
