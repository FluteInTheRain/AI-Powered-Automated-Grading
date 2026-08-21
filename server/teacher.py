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

from .db import get_session
from .models import Exam, Problem, Submission

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

# Matches server/main.py's TIME_LIMIT_SECONDS default — used when an exam
# is created without an explicit time_limit_seconds override.
DEFAULT_TIME_LIMIT_SECONDS = 600


def _json_normalize(value: Any) -> Any:
    """Round-trip a Python value (e.g. a tuple returned by a reference
    solution) through JSON so what gets stored/compared is always a plain
    JSON value (list, not tuple) — matches how test_cases are persisted and
    later re-loaded from the DB."""
    return json.loads(json.dumps(value))


def _starter_code(func_name: str, param_names: List[str]) -> str:
    args = ", ".join(param_names)
    return f"def {func_name}({args}):\n    # TODO: your solution here\n    pass\n"


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
    result = compute_reference_outputs(req.reference_solution, req.func_name, args_list)
    if result["status"] != "ran":
        return {"status": result["status"], "message": result["message"], "cases": [], "wrong_solution_check": None}

    cases = []
    normalized_expected: List[Any] = []
    for c in result["cases"]:
        expected = _json_normalize(c["output"]) if c["error"] is None else None
        normalized_expected.append(expected)
        cases.append({"args": c["args"], "expected": expected, "error": c["error"]})

    wrong_solution_check = None
    if req.wrong_solution:
        checkable = [
            (tuple(c["args"]), normalized_expected[i])
            for i, c in enumerate(result["cases"])
            if c["error"] is None
        ]
        wrong_result = run_submission(req.wrong_solution, req.func_name, checkable)
        wrong_solution_check = {
            "status": wrong_result["status"],
            "pass_count": wrong_result["pass_count"],
            "total": wrong_result["total"],
            "pass_rate": wrong_result["pass_rate"],
            "still_passes_all": wrong_result["status"] == "ran" and wrong_result["pass_rate"] == 1.0,
        }

    return {"status": "ok", "message": None, "cases": cases, "wrong_solution_check": wrong_solution_check}


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
    total_weight = sum(rubric.values())
    if total_weight != 100:
        raise HTTPException(status_code=400, detail=f"Rubric weights must sum to 100, got {total_weight}")
    if not req.test_cases:
        raise HTTPException(status_code=400, detail="At least one test case is required")
    if all(tc.is_public for tc in req.test_cases):
        # pipeline.grade() scores every submission 0 when there are no
        # hidden test cases to run (pass_rate == 0.0 on an empty list reads
        # as "no verified correct behavior") — caught via manual browser
        # testing of this exact form. Block it here instead of letting a
        # teacher silently zero every submission.
        raise HTTPException(
            status_code=400,
            detail="At least one test case must be hidden (not public) — grading requires a hidden case to run.",
        )

    # Authoritative re-check — the frontend already ran preview-test-cases,
    # but this is the one check that actually gates persistence.
    test_cases_for_check = [(tuple(tc.args), tc.expected) for tc in req.test_cases]
    check = run_submission(req.reference_solution, req.func_name, test_cases_for_check)
    if check["status"] != "ran" or check["pass_rate"] != 1.0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Reference solution does not pass all test cases "
                f"(status={check['status']}, pass_rate={check.get('pass_rate')}). "
                f"Fix the reference solution or test cases before saving."
            ),
        )

    problem = Problem(
        statement=req.statement,
        func_name=req.func_name,
        param_names=req.param_names,
        rubric=rubric,
        reference_solution=req.reference_solution,
        test_cases=[tc.model_dump() for tc in req.test_cases],
        starter_code=_starter_code(req.func_name, req.param_names),
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


def _submission_row(sub: Submission) -> dict:
    result = sub.result or {}
    return {
        "student_name": sub.student_name,
        "final_score_0_to_100": result.get("final_score_0_to_100"),
        "sub_scores_0_to_1": result.get("sub_scores_0_to_1"),
        "submitted_at": sub.submitted_at.isoformat(),
    }


@router.get("/exams/{admin_token}")
def get_exam_results(admin_token: str, session: Session = Depends(get_session)):
    exam = _exam_by_admin_token(admin_token, session)
    submissions = session.execute(
        select(Submission).where(Submission.exam_id == exam.id).order_by(Submission.submitted_at)
    ).scalars().all()
    is_closed = exam.deadline is not None and exam.deadline <= datetime.datetime.now(datetime.timezone.utc)
    return {
        "student_path": f"/exam/{exam.student_token}",
        "deadline": exam.deadline.isoformat() if exam.deadline else None,
        "is_closed": is_closed,
        "time_limit_seconds": exam.time_limit_seconds,
        "problem": {"id": str(exam.problem.id), "statement": exam.problem.statement},
        "submissions": [_submission_row(s) for s in submissions],
    }


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
