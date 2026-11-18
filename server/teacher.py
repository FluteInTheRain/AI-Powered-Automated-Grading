# -*- coding: utf-8 -*-
"""Teacher-facing problem authoring API — no login (see docs/productionization.md
and the plan this was built from): anyone with the base URL can create
problems and exam links. Ownership/privacy of a specific exam is handled at
the exam level via a secret admin token (server/exam.py), not here.

Test cases are never hand-typed by the teacher: `preview_test_cases` runs a
teacher-supplied reference solution against raw inputs in the same sandbox
used for grading, and the teacher reviews/saves the computed outputs.
"""
from __future__ import annotations

import datetime
import io
import json
import secrets
import sys
from pathlib import Path
from typing import Any, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from grader.sandbox import compute_reference_outputs, run_submission

from . import rules
from .db import get_session
from .models import Exam, Problem, Submission

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

# Matches server/main.py's TIME_LIMIT_SECONDS default — used when an exam
# is created without an explicit time_limit_seconds override.
DEFAULT_TIME_LIMIT_SECONDS = 600


class PreviewCase(BaseModel):
    args: List[Any]


class PreviewRequest(BaseModel):
    reference_solution: str
    func_name: str
    cases: List[PreviewCase]
    # Optional: a deliberately-wrong solution, checked against the same
    # cases. If it still passes all of them, the test suite doesn't
    # actually distinguish right from wrong — the exact failure mode
    # documented in data/script.md ("Notable finding from running the real
    # pipeline"). Purely advisory, never blocks saving.
    wrong_solution: Optional[str] = None


@router.post("/preview-test-cases")
def preview_test_cases(req: PreviewRequest):
    args_list = [tuple(c.args) for c in req.cases]
    return rules.preview(
        req.reference_solution, req.func_name, args_list, req.wrong_solution,
        compute_reference_outputs=compute_reference_outputs, run_submission=run_submission,
    )


class RubricIn(BaseModel):
    correctness: int
    efficiency: int
    code_style: int
    edge_case_handling: int


class TestCaseIn(BaseModel):
    args: List[Any]
    expected: Any
    is_public: bool = False


class CreateProblemRequest(BaseModel):
    statement: str
    func_name: str
    param_names: List[str]
    rubric: RubricIn
    reference_solution: str
    test_cases: List[TestCaseIn]


@router.post("/problems")
def create_problem(req: CreateProblemRequest, session: Session = Depends(get_session)):
    rubric = req.rubric.model_dump()
    try:
        rules.validate_new_problem(
            rubric, [tc.model_dump() for tc in req.test_cases],
            run_submission, req.reference_solution, req.func_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    problem = Problem(
        statement=req.statement,
        func_name=req.func_name,
        param_names=req.param_names,
        rubric=rubric,
        reference_solution=req.reference_solution,
        test_cases=[tc.model_dump() for tc in req.test_cases],
        starter_code=rules.starter_code(req.func_name, req.param_names),
    )
    session.add(problem)
    session.commit()
    session.refresh(problem)
    return {"id": str(problem.id)}


@router.get("/problems")
def list_problems(session: Session = Depends(get_session)):
    problems = session.execute(select(Problem).order_by(Problem.created_at.desc())).scalars().all()
    return [
        {
            "id": str(p.id),
            "statement_excerpt": p.statement if len(p.statement) <= 120 else p.statement[:120] + "…",
            "created_at": p.created_at.isoformat(),
        }
        for p in problems
    ]


def _new_token() -> str:
    return secrets.token_urlsafe(16)


class CreateExamRequest(BaseModel):
    problem_id: str
    deadline: Optional[datetime.datetime] = None
    time_limit_seconds: Optional[int] = None


@router.post("/exams")
def create_exam(req: CreateExamRequest, session: Session = Depends(get_session)):
    problem = session.get(Problem, req.problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail=f"Unknown problem_id: {req.problem_id}")

    exam = Exam(
        problem_id=problem.id,
        student_token=_new_token(),
        admin_token=_new_token(),
        deadline=req.deadline,
        time_limit_seconds=req.time_limit_seconds or DEFAULT_TIME_LIMIT_SECONDS,
    )
    session.add(exam)
    session.commit()
    session.refresh(exam)
    return {
        "student_token": exam.student_token,
        "admin_token": exam.admin_token,
        "student_path": f"/exam/{exam.student_token}",
        "admin_path": f"/admin/{exam.admin_token}",
    }


def _exam_by_admin_token(admin_token: str, session: Session) -> Exam:
    exam = session.execute(select(Exam).where(Exam.admin_token == admin_token)).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=404, detail="Unknown admin token")
    return exam


@router.get("/exams/{admin_token}")
def get_exam_results(admin_token: str, session: Session = Depends(get_session)):
    exam = _exam_by_admin_token(admin_token, session)
    submissions = session.execute(
        select(Submission).where(Submission.exam_id == exam.id).order_by(Submission.submitted_at)
    ).scalars().all()
    is_closed = rules.is_closed(exam.deadline)
    return {
        "student_path": f"/exam/{exam.student_token}",
        "deadline": exam.deadline.isoformat() if exam.deadline else None,
        "is_closed": is_closed,
        "time_limit_seconds": exam.time_limit_seconds,
        "problem": {"id": str(exam.problem.id), "statement": exam.problem.statement},
        "submissions": [rules.submission_row(s) for s in submissions],
    }


@router.get("/exams/{admin_token}/submissions/{submission_id}/audit")
def get_submission_audit(admin_token: str, submission_id: str, session: Session = Depends(get_session)):
    """The PR-E1 audit trail: every LLM call made while grading this one
    submission (exact prompt + raw response), so a score can be explained
    or defended later. Gated by the exam's admin_token, not the bare
    submission id, so guessing/enumerating submission ids alone can't leak
    another exam's prompts."""
    exam = _exam_by_admin_token(admin_token, session)
    submission = session.get(Submission, submission_id)
    if submission is None or submission.exam_id != exam.id:
        raise HTTPException(status_code=404, detail="Unknown submission for this exam")

    return [
        {
            "call_index": log.call_index,
            "kind": log.kind,
            "schema": log.schema_name,
            "model": log.model,
            "system_prompt": log.system_prompt,
            "user_prompt": log.user_prompt,
            "raw_response": log.raw_response,
            "created_at": log.created_at.isoformat(),
        }
        for log in submission.grading_logs
    ]


class UpdateExamRequest(BaseModel):
    deadline: Optional[datetime.datetime] = None


@router.patch("/exams/{admin_token}")
def update_exam(admin_token: str, req: UpdateExamRequest, session: Session = Depends(get_session)):
    exam = _exam_by_admin_token(admin_token, session)
    exam.deadline = req.deadline
    session.commit()
    return {"deadline": exam.deadline.isoformat() if exam.deadline else None}


@router.get("/exams/{admin_token}/export.xlsx")
def export_exam_results(admin_token: str, session: Session = Depends(get_session)):
    exam = _exam_by_admin_token(admin_token, session)
    submissions = session.execute(
        select(Submission).where(Submission.exam_id == exam.id).order_by(Submission.submitted_at)
    ).scalars().all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Results"
    ws.append([
        "student_name", "final_score", "correctness", "efficiency",
        "code_style", "edge_case_handling", "submitted_at",
    ])
    for sub in submissions:
        result = sub.result or {}
        sub_scores = result.get("sub_scores_0_to_1") or {}
        ws.append([
            sub.student_name,
            result.get("final_score_0_to_100"),
            sub_scores.get("correctness"),
            sub_scores.get("efficiency"),
            sub_scores.get("code_style"),
            sub_scores.get("edge_case_handling"),
            sub.submitted_at.isoformat(),
        ])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=exam_{admin_token}_results.xlsx"},
    )
