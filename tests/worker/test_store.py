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
