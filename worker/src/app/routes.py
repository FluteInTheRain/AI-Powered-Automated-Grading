"""FastAPI routes of the main Worker: same paths, status codes and JSON as
server/teacher.py, server/exam.py and POST /api/syntax-check in server/main.py,
but backed by D1 (app.store), Workers AI and the sandbox Worker.

Every route is `async def` (Pyodide has no threads). Teacher/student code is
never executed here — it always goes through the sandbox dependency. The
pure rules come from server/rules.py; server/db.py and the ORM are not
imported (SQLAlchemy cannot load in Pyodide).
"""
from __future__ import annotations

import datetime
import io
import logging
import secrets
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from grader.feedback import generate_feedback
from grader.pipeline import grade
from server import rules
from server.rules import (
    CreateExamRequest, CreateProblemRequest, ExamRunRequest, ExamSubmitRequest,
    PreviewRequest, SyntaxCheckRequest, UpdateExamRequest,
)

from . import store
from .bridges import RemoteSandbox, SandboxError, SandboxKilled, WorkersAIClient

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_LLM_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct"
# Matches server/teacher.py's default time limit.
DEFAULT_TIME_LIMIT_SECONDS = 600

# Fixed client-facing error texts: raw exception text (D1 SQL, model names,
# pydantic dumps) is logged, never sent to the browser.
SERVICE_ERROR = "Grading service error, please try again."
GRADING_FAILED = "Grading failed, please try again. If it keeps happening, contact your teacher."
NOT_SAVED = "Your submission was graded but could not be saved. Please try again."


# --- dependencies (tests override these via app.dependency_overrides) ---
# async on purpose: FastAPI runs plain `def` dependencies in a thread pool,
# and Pyodide has no threads.

async def get_db(request: Request):
    return request.scope["env"].DB


async def get_llm_client(request: Request):
    # New client per request so call_log only holds this submission's calls.
    env = request.scope["env"]
    model = getattr(env, "LLM_MODEL", None)
    if not model:
        logger.warning("LLM_MODEL is not set in the Worker env; using %s", DEFAULT_LLM_MODEL)
        model = DEFAULT_LLM_MODEL
    return WorkersAIClient(env.AI, model=model)


async def get_sandbox(request: Request):
    return RemoteSandbox(request.scope["env"].SANDBOX)


# --- helpers ---

def _parse_dt(value: Optional[str]) -> Optional[datetime.datetime]:
    """Stored ISO string -> aware datetime (naive values are taken as UTC)."""
    if value is None:
        return None
    dt = datetime.datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)


def _iso(dt: Optional[datetime.datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.isoformat()


def _new_token() -> str:
    return secrets.token_urlsafe(16)


def _sandbox_http_error(e: Exception, killed_detail: str, context: str) -> HTTPException:
    """Log a failed sandbox call with its context and pick the client message.

    Only a killed sandbox (SandboxKilled) is the student's or teacher's code
    running out of time; anything else is our service failing.
    """
    logger.exception("sandbox call failed (%s)", context)
    return HTTPException(status_code=502,
                         detail=killed_detail if isinstance(e, SandboxKilled) else SERVICE_ERROR)


def _row_view(sub: dict) -> SimpleNamespace:
    """Adapt a store submission dict to the attribute shape rules.submission_row wants."""
    return SimpleNamespace(
        id=sub["id"], student_name=sub["student_name"], result=sub["result"],
        submitted_at=datetime.datetime.fromisoformat(sub["submitted_at"]),
    )


async def _exam_by_admin_token(admin_token: str, db) -> dict:
    exam = await store.get_exam_by_admin_token(db, admin_token)
    if exam is None:
        raise HTTPException(status_code=404, detail="Unknown admin token")
    return exam


async def _exam_by_student_token(student_token: str, db) -> dict:
    exam = await store.get_exam_by_student_token(db, student_token)
    if exam is None:
        raise HTTPException(status_code=404, detail="Unknown exam link")
    return exam


# --- syntax check ---

@router.post("/api/syntax-check")
async def syntax_check(req: SyntaxCheckRequest):
    # compile() only parses; it never runs the code, so it is safe here.
    try:
        compile(req.code, "<submission>", "exec")
    except SyntaxError as e:
        return {"ok": False, "message": e.msg, "line": e.lineno or 1}
    return {"ok": True}


# --- teacher ---

@router.post("/api/teacher/preview-test-cases")
async def preview_test_cases(req: PreviewRequest, sandbox=Depends(get_sandbox)):
    args_list = [tuple(c.args) for c in req.cases]
    try:
        return rules.preview(
            req.reference_solution, req.func_name, args_list, req.wrong_solution,
            compute_reference_outputs=sandbox.compute_reference_outputs,
            run_submission=sandbox.run_submission,
        )
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Reference or wrong solution exceeded the time/resource limit.",
                                  f"preview func_name={req.func_name}")


@router.post("/api/teacher/problems")
async def create_problem(req: CreateProblemRequest, db=Depends(get_db), sandbox=Depends(get_sandbox)):
    rubric = req.rubric.model_dump()
    test_cases = [tc.model_dump() for tc in req.test_cases]
    try:
        rules.validate_new_problem(rubric, test_cases, sandbox.run_submission,
                                   req.reference_solution, req.func_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Reference solution exceeded the time/resource limit.",
                                  f"create_problem func_name={req.func_name}")
    pid = await store.create_problem(
        db, statement=req.statement, func_name=req.func_name, param_names=req.param_names,
        rubric=rubric, reference_solution=req.reference_solution, test_cases=test_cases,
        starter_code=rules.starter_code(req.func_name, req.param_names),
    )
    return {"id": pid}


@router.get("/api/teacher/problems")
async def list_problems(db=Depends(get_db)):
    return [
        {
            "id": p["id"],
            "statement_excerpt": rules.statement_excerpt(p["statement"]),
            "created_at": p["created_at"],
        }
        for p in await store.list_problems(db)
    ]


@router.post("/api/teacher/exams")
async def create_exam(req: CreateExamRequest, db=Depends(get_db)):
    problem = await store.get_problem(db, req.problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail=f"Unknown problem_id: {req.problem_id}")
    exam = await store.create_exam(
        db, problem_id=problem["id"], student_token=_new_token(), admin_token=_new_token(),
        deadline=_iso(req.deadline),
        time_limit_seconds=req.time_limit_seconds or DEFAULT_TIME_LIMIT_SECONDS,
    )
    return {
        "student_token": exam["student_token"],
        "admin_token": exam["admin_token"],
        "student_path": f"/exam/{exam['student_token']}",
        "admin_path": f"/admin/{exam['admin_token']}",
    }


@router.get("/api/teacher/exams/{admin_token}")
async def get_exam_results(admin_token: str, db=Depends(get_db)):
    exam = await _exam_by_admin_token(admin_token, db)
    submissions = await store.list_submissions(db, exam["id"])
    return {
        "student_path": f"/exam/{exam['student_token']}",
        "deadline": exam["deadline"],
        "is_closed": rules.is_closed(_parse_dt(exam["deadline"])),
        "time_limit_seconds": exam["time_limit_seconds"],
        "problem": {"id": exam["problem"]["id"], "statement": exam["problem"]["statement"]},
        "submissions": [rules.submission_row(_row_view(s)) for s in submissions],
    }


@router.get("/api/teacher/exams/{admin_token}/submissions/{submission_id}/audit")
async def get_submission_audit(admin_token: str, submission_id: str, db=Depends(get_db)):
    """Every LLM call made while grading one submission, gated by the exam's
    admin token so submission ids alone cannot leak another exam's prompts."""
    exam = await _exam_by_admin_token(admin_token, db)
    submission = await store.get_submission(db, submission_id)
    if submission is None or submission["exam_id"] != exam["id"]:
        raise HTTPException(status_code=404, detail="Unknown submission for this exam")
    return [
        {
            "call_index": log["call_index"],
            "kind": log["kind"],
            "schema": log["schema_name"],
            "model": log["model"],
            "system_prompt": log["system_prompt"],
            "user_prompt": log["user_prompt"],
            "raw_response": log["raw_response"],
            "created_at": log["created_at"],
        }
        for log in await store.get_logs(db, submission_id)
    ]


@router.patch("/api/teacher/exams/{admin_token}")
async def update_exam(admin_token: str, req: UpdateExamRequest, db=Depends(get_db)):
    exam = await _exam_by_admin_token(admin_token, db)
    deadline = _iso(req.deadline)
    await store.set_deadline(db, exam["id"], deadline)
    return {"deadline": deadline}


@router.get("/api/teacher/exams/{admin_token}/export.xlsx")
async def export_exam_results(admin_token: str, db=Depends(get_db)):
    from openpyxl import Workbook  # lazy: only this route needs it

    exam = await _exam_by_admin_token(admin_token, db)
    submissions = await store.list_submissions(db, exam["id"])

    wb = Workbook()
    ws = wb.active
    ws.title = "Results"
    ws.append(rules.EXPORT_HEADER)
    for sub in submissions:
        ws.append(rules.export_row(sub["student_name"], sub["result"], sub["submitted_at"]))

    buffer = io.BytesIO()
    wb.save(buffer)
    # Plain Response, not StreamingResponse: streaming would iterate in a thread pool.
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=exam_{admin_token}_results.xlsx"},
    )


# --- student exam ---

@router.get("/api/exam/{student_token}")
async def get_exam(student_token: str, db=Depends(get_db)):
    exam = await _exam_by_student_token(student_token, db)
    problem = exam["problem"]
    public_cases, hidden_cases = rules.split_cases(problem["test_cases"])
    return {
        "statement": problem["statement"],
        "rubric": problem["rubric"],
        "starter_code": problem["starter_code"],
        "time_limit_seconds": exam["time_limit_seconds"],
        "deadline": exam["deadline"],
        "is_closed": rules.is_closed(_parse_dt(exam["deadline"])),
        "public_test_case_count": len(public_cases),
        "hidden_test_case_count": len(hidden_cases),
    }


@router.post("/api/exam/{student_token}/run")
async def run_exam_public_tests(student_token: str, req: ExamRunRequest,
                                db=Depends(get_db), sandbox=Depends(get_sandbox)):
    exam = await _exam_by_student_token(student_token, db)
    if rules.is_closed(_parse_dt(exam["deadline"])):
        raise HTTPException(status_code=403, detail="This exam is closed")

    public_cases, _ = rules.split_cases(exam["problem"]["test_cases"])
    cases_for_sandbox = [(tuple(tc["args"]), tc["expected"]) for tc in public_cases]
    try:
        detailed = sandbox.run_submission_cases(req.code, exam["problem"]["func_name"], cases_for_sandbox)
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Your code exceeded the time/resource limit.",
                                  f"run exam_id={exam['id']} problem_id={exam['problem']['id']}")
    return rules.run_response(detailed)


@router.post("/api/exam/{student_token}/submit")
async def submit_exam(student_token: str, req: ExamSubmitRequest, db=Depends(get_db),
                      client=Depends(get_llm_client), sandbox=Depends(get_sandbox)):
    exam = await _exam_by_student_token(student_token, db)
    if rules.is_closed(_parse_dt(exam["deadline"])):
        raise HTTPException(status_code=403, detail="This exam is closed")

    problem = exam["problem"]
    context = f"exam_id={exam['id']} problem_id={problem['id']}"
    _, hidden_cases = rules.split_cases(problem["test_cases"])
    sample = rules.build_submit_sample(
        problem["statement"], problem["func_name"], problem["rubric"], hidden_cases, req.code
    )
    # grade() is sync; the bridges call run_sync internally, which is fine here.
    try:
        result = grade(sample, client, run_submission=sandbox.run_submission)
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Grading failed: your submission exceeded the time/resource limit.",
                                  f"submit {context}")
    except Exception:
        logger.exception("grading failed (submit %s)", context)
        raise HTTPException(status_code=502, detail=GRADING_FAILED)

    # Explanatory only, generated after the score is fixed; best effort.
    try:
        feedback = generate_feedback(
            client, problem["statement"], req.code,
            result["execution_result"], result["sub_scores_0_to_1"], result["check_details"],
        )
        result["feedback"] = feedback.model_dump()
    except Exception:
        logger.exception("generate_feedback failed (submit %s)", context)
        result["feedback"] = None

    try:
        await store.add_submission(
            db, exam_id=exam["id"], student_name=req.student_name, code=req.code,
            result=result, logs=client.call_log,
        )
    except Exception:
        logger.exception("saving the graded submission failed (submit %s)", context)
        raise HTTPException(status_code=502, detail=NOT_SAVED)
    return result


# --- internal endpoints (called by the teacher-app Worker over a service binding) ---
# Stateless: no DB. They live under /api/ because wrangler's run_worker_first only
# routes /api/* to this code; the shared secret keeps them off-limits to the public.

async def require_internal_token(request: Request) -> None:
    expected = getattr(request.scope["env"], "INTERNAL_TOKEN", "") or ""
    given = request.headers.get("x-internal-token", "")
    if not expected or not secrets.compare_digest(given.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")


class InternalGradeRequest(BaseModel):
    statement: str
    func_name: str
    rubric: dict
    hidden_cases: list
    code: str


@router.post("/api/internal/grade", dependencies=[Depends(require_internal_token)])
async def internal_grade(req: InternalGradeRequest, client=Depends(get_llm_client),
                         sandbox=Depends(get_sandbox)):
    context = f"internal func_name={req.func_name}"
    sample = rules.build_submit_sample(req.statement, req.func_name, req.rubric, req.hidden_cases, req.code)
    try:
        result = grade(sample, client, run_submission=sandbox.run_submission)
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Grading failed: your submission exceeded the time/resource limit.",
                                  context)
    except Exception:
        logger.exception("grading failed (%s)", context)
        raise HTTPException(status_code=502, detail=GRADING_FAILED)
    # Explanatory only, generated after the score is fixed; best effort. The per-case error
    # strings carry hidden inputs and expected values, so the feedback prompt only gets counts.
    try:
        feedback = generate_feedback(
            client, req.statement, req.code,
            {**result["execution_result"], "errors": []}, result["sub_scores_0_to_1"], result["check_details"],
        )
        result["feedback"] = feedback.model_dump()
    except Exception:
        logger.exception("generate_feedback failed (%s)", context)
        result["feedback"] = None
    return {"result": result, "call_log": client.call_log}


@router.post("/api/internal/preview", dependencies=[Depends(require_internal_token)])
async def internal_preview(req: PreviewRequest, sandbox=Depends(get_sandbox)):
    # Same behaviour as the teacher preview route, minus the teacher URL prefix.
    return await preview_test_cases(req, sandbox)


@router.post("/api/internal/validate-problem", dependencies=[Depends(require_internal_token)])
async def internal_validate_problem(req: CreateProblemRequest, sandbox=Depends(get_sandbox)):
    """Run the same gate as create_problem, but persist nothing."""
    try:
        rules.validate_new_problem(req.rubric.model_dump(), [tc.model_dump() for tc in req.test_cases],
                                   sandbox.run_submission, req.reference_solution, req.func_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Reference solution exceeded the time/resource limit.",
                                  f"validate_problem func_name={req.func_name}")
    return {"ok": True}


class InternalRunRequest(BaseModel):
    code: str
    func_name: str
    cases: list


@router.post("/api/internal/run", dependencies=[Depends(require_internal_token)])
async def internal_run(req: InternalRunRequest, sandbox=Depends(get_sandbox)):
    """Pass/fail per given case, never the values. The caller sends only the public cases."""
    cases = [(tuple(tc["args"]), tc["expected"]) for tc in req.cases]
    try:
        detailed = sandbox.run_submission_cases(req.code, req.func_name, cases)
    except (SandboxKilled, SandboxError) as e:
        raise _sandbox_http_error(e, "Your code exceeded the time/resource limit.",
                                  f"internal run func_name={req.func_name}")
    return rules.run_response(detailed)
