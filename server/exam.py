# -*- coding: utf-8 -*-
"""Public, token-scoped student-facing exam API. Mirrors server/main.py's
`/api/problems/{id}`, `/api/run`, `/api/submit` but keyed by an exam's
unguessable `student_token` (from server/teacher.py's exam creation) instead
of a free `problem_id`, and enforces the exam's deadline.

Every problem's `test_cases` here carries an explicit `is_public` flag per
case (server/models.py) — no positional convention like server/main.py's
`PUBLIC_TEST_CASE_COUNT`.
"""
from __future__ import annotations

import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from grader.llm_client import LLMClient
from grader.pipeline import grade
from grader.sandbox import run_submission_cases

from .config import BASE_URL, MODEL
from .db import get_session
from .models import Exam, Submission

router = APIRouter(prefix="/api/exam", tags=["exam"])


def _exam_by_student_token(student_token: str, session: Session) -> Exam:
    exam = session.execute(select(Exam).where(Exam.student_token == student_token)).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=404, detail="Unknown exam link")
    return exam


def _is_closed(exam: Exam) -> bool:
    return exam.deadline is not None and exam.deadline <= datetime.datetime.now(datetime.timezone.utc)


def _split_cases(test_cases: list) -> tuple[list, list]:
    public = [tc for tc in test_cases if tc["is_public"]]
    hidden = [tc for tc in test_cases if not tc["is_public"]]
    return public, hidden


@router.get("/{student_token}")
def get_exam(student_token: str, session: Session = Depends(get_session)):
    exam = _exam_by_student_token(student_token, session)
    problem = exam.problem
    public_cases, hidden_cases = _split_cases(problem.test_cases)
    return {
        "statement": problem.statement,
        "rubric": problem.rubric,
        "starter_code": problem.starter_code,
        "time_limit_seconds": exam.time_limit_seconds,
        "deadline": exam.deadline.isoformat() if exam.deadline else None,
        "is_closed": _is_closed(exam),
        "public_test_case_count": len(public_cases),
        "hidden_test_case_count": len(hidden_cases),
    }


class ExamRunRequest(BaseModel):
    code: str


@router.post("/{student_token}/run")
def run_exam_public_tests(student_token: str, req: ExamRunRequest, session: Session = Depends(get_session)):
    exam = _exam_by_student_token(student_token, session)
    if _is_closed(exam):
        raise HTTPException(status_code=403, detail="This exam is closed")

    public_cases, _ = _split_cases(exam.problem.test_cases)
    cases_for_sandbox = [(tuple(tc["args"]), tc["expected"]) for tc in public_cases]
    detailed = run_submission_cases(req.code, exam.problem.func_name, cases_for_sandbox)
    if detailed["status"] != "ran":
        return {"status": detailed["status"], "message": detailed["message"], "cases": []}
    return {
        "status": "ran",
        "message": None,
        "cases": [{"passed": c["passed"], "error": c["error"]} for c in detailed["cases"]],
    }


class ExamSubmitRequest(BaseModel):
    student_name: str
    code: str


@router.post("/{student_token}/submit")
def submit_exam(student_token: str, req: ExamSubmitRequest, session: Session = Depends(get_session)):
    exam = _exam_by_student_token(student_token, session)
    if _is_closed(exam):
        raise HTTPException(status_code=403, detail="This exam is closed")

    problem = exam.problem
    _, hidden_cases = _split_cases(problem.test_cases)
    sample = {
        "statement": problem.statement,
        "func_name": problem.func_name,
        "test_cases": [(tuple(tc["args"]), tc["expected"]) for tc in hidden_cases],
        "rubric": problem.rubric,
        "submission_code": req.code,
    }
    client = LLMClient(base_url=BASE_URL, model=MODEL, seed=0)
    try:
        result = grade(sample, client)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Grading failed: {e}")

    submission = Submission(
        exam_id=exam.id,
        student_name=req.student_name,
        code=req.code,
        result=result,
    )
    session.add(submission)
    session.commit()
    return result
