"""D1 persistence for problems, exams, submissions and grading logs.

All functions take a D1-like `db` (prepare/bind/all/first/run + batch). Rows
are read by explicit column name via attribute access and converted to plain
dicts here. SQL uses `?` placeholders only. ids are uuid4().hex, timestamps
ISO-8601 UTC, JSON columns are TEXT (decoded on read)."""
import json
import uuid
from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def _id():
    return uuid.uuid4().hex


def _dumps(v):
    return json.dumps(v, ensure_ascii=False)


def _problem_dict(r):
    return {
        "id": r.id,
        "statement": r.statement,
        "func_name": r.func_name,
        "param_names": json.loads(r.param_names),
        "rubric": json.loads(r.rubric),
        "reference_solution": r.reference_solution,
        "test_cases": json.loads(r.test_cases),
        "starter_code": r.starter_code,
        "created_at": r.created_at,
    }


def _submission_dict(r):
    return {
        "id": r.id,
        "exam_id": r.exam_id,
        "student_name": r.student_name,
        "code": r.code,
        "result": json.loads(r.result),
        "submitted_at": r.submitted_at,
    }


def _log_dict(r):
    return {
        "id": r.id,
        "submission_id": r.submission_id,
        "call_index": r.call_index,
        "kind": r.kind,
        "schema_name": r.schema_name,
        "model": r.model,
        "system_prompt": r.system_prompt,
        "user_prompt": r.user_prompt,
        "raw_response": r.raw_response,
        "created_at": r.created_at,
    }


async def create_problem(db, *, statement, func_name, param_names, rubric,
                         reference_solution, test_cases, starter_code):
    pid = _id()
    await db.prepare(
        "INSERT INTO problems (id, statement, func_name, param_names, rubric,"
        " reference_solution, test_cases, starter_code, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(pid, statement, func_name, _dumps(param_names), _dumps(rubric),
           reference_solution, _dumps(test_cases), starter_code, _now()).run()
    return pid


async def list_problems(db):
    res = await db.prepare("SELECT * FROM problems ORDER BY created_at DESC, id").all()
    return [_problem_dict(r) for r in res.results]


async def get_problem(db, problem_id):
    r = await db.prepare("SELECT * FROM problems WHERE id = ?").bind(problem_id).first()
    return None if r is None else _problem_dict(r)


async def create_exam(db, *, problem_id, student_token, admin_token, deadline, time_limit_seconds):
    exam = {
        "id": _id(),
        "problem_id": problem_id,
        "student_token": student_token,
        "admin_token": admin_token,
        "deadline": deadline,
        "time_limit_seconds": time_limit_seconds,
        "created_at": _now(),
    }
    await db.prepare(
        "INSERT INTO exams (id, problem_id, student_token, admin_token, deadline,"
        " time_limit_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(exam["id"], problem_id, student_token, admin_token, deadline,
           time_limit_seconds, exam["created_at"]).run()
    return exam


async def _exam_by(db, column, token):
    # `column` is one of two hard-coded names below, never caller input.
    r = await db.prepare(f"SELECT * FROM exams WHERE {column} = ?").bind(token).first()
    if r is None:
        return None
    exam = {
        "id": r.id,
        "problem_id": r.problem_id,
        "student_token": r.student_token,
        "admin_token": r.admin_token,
        "deadline": r.deadline,
        "time_limit_seconds": r.time_limit_seconds,
        "created_at": r.created_at,
    }
    exam["problem"] = await get_problem(db, r.problem_id)
    return exam


async def get_exam_by_student_token(db, token):
    return await _exam_by(db, "student_token", token)


async def get_exam_by_admin_token(db, token):
    return await _exam_by(db, "admin_token", token)


async def set_deadline(db, exam_id, deadline):
    await db.prepare("UPDATE exams SET deadline = ? WHERE id = ?").bind(deadline, exam_id).run()


async def add_submission(db, *, exam_id, student_name, code, result, logs):
    """Insert the submission and its grading logs in one all-or-nothing batch.
    Each log is a dict with kind, schema, model, system_prompt, user_prompt,
    raw_response (the shape of LLMClient.call_log entries)."""
    sid = _id()
    now = _now()
    stmts = [
        db.prepare(
            "INSERT INTO submissions (id, exam_id, student_name, code, result, submitted_at)"
            " VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(sid, exam_id, student_name, code, _dumps(result), now)
    ]
    for i, e in enumerate(logs):
        stmts.append(db.prepare(
            "INSERT INTO grading_logs (id, submission_id, call_index, kind, schema_name,"
            " model, system_prompt, user_prompt, raw_response, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(_id(), sid, i, e["kind"], e.get("schema"), e["model"],
               e["system_prompt"], e["user_prompt"], e["raw_response"], now))
    await db.batch(stmts)
    return sid


async def list_submissions(db, exam_id):
    res = await db.prepare(
        "SELECT * FROM submissions WHERE exam_id = ? ORDER BY submitted_at, id"
    ).bind(exam_id).all()
    return [_submission_dict(r) for r in res.results]


async def get_submission(db, submission_id):
    r = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submission_id).first()
    return None if r is None else _submission_dict(r)


async def get_logs(db, submission_id):
    res = await db.prepare(
        "SELECT * FROM grading_logs WHERE submission_id = ? ORDER BY call_index"
    ).bind(submission_id).all()
    return [_log_dict(r) for r in res.results]
