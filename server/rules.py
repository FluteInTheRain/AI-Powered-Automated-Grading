# -*- coding: utf-8 -*-
"""Pure business rules shared by the FastAPI server (server/teacher.py,
server/exam.py) and the Cloudflare Worker (worker/src/app/routes.py).

No DB, FastAPI or SQLAlchemy imports here, so this module loads in Pyodide.
Code execution is injected: callers pass the sandbox functions in.
"""
from __future__ import annotations

import datetime
import json
from typing import Any, List, Optional

from pydantic import BaseModel


def json_normalize(value: Any) -> Any:
    """Round-trip a Python value (e.g. a tuple returned by a reference
    solution) through JSON so what gets stored/compared is always a plain
    JSON value (list, not tuple) — matches how test_cases are persisted and
    later re-loaded from the DB."""
    return json.loads(json.dumps(value))


def starter_code(func_name: str, param_names: List[str]) -> str:
    args = ", ".join(param_names)
    return f"def {func_name}({args}):\n    # TODO: your solution here\n    pass\n"


def split_cases(test_cases: list) -> tuple[list, list]:
    public = [tc for tc in test_cases if tc["is_public"]]
    hidden = [tc for tc in test_cases if not tc["is_public"]]
    return public, hidden


def is_closed(deadline: datetime.datetime | None) -> bool:
    return deadline is not None and deadline <= datetime.datetime.now(datetime.timezone.utc)


def validate_new_problem(rubric: dict, test_cases: list, run_submission, reference_solution: str, func_name: str) -> None:
    """Raise ValueError (message = the HTTP 400 detail) if the problem can't
    be saved. `test_cases` is a list of {"args", "expected", "is_public"}
    dicts; `run_submission` is the sandbox runner to check the reference with."""
    total_weight = sum(rubric.values())
    if total_weight != 100:
        raise ValueError(f"Rubric weights must sum to 100, got {total_weight}")
    if not test_cases:
        raise ValueError("At least one test case is required")
    if all(tc["is_public"] for tc in test_cases):
        # pipeline.grade() scores every submission 0 when there are no
        # hidden test cases to run (pass_rate == 0.0 on an empty list reads
        # as "no verified correct behavior") — caught via manual browser
        # testing of this exact form. Block it here instead of letting a
        # teacher silently zero every submission.
        raise ValueError("At least one test case must be hidden (not public) — grading requires a hidden case to run.")

    # Authoritative re-check — the frontend already ran preview-test-cases,
    # but this is the one check that actually gates persistence.
    test_cases_for_check = [(tuple(tc["args"]), tc["expected"]) for tc in test_cases]
    check = run_submission(reference_solution, func_name, test_cases_for_check)
    if check["status"] != "ran" or check["pass_rate"] != 1.0:
        raise ValueError(
            f"Reference solution does not pass all test cases "
            f"(status={check['status']}, pass_rate={check.get('pass_rate')}). "
            f"Fix the reference solution or test cases before saving."
        )


def preview(reference_solution, func_name, args_list, wrong_solution, *, compute_reference_outputs, run_submission) -> dict:
    result = compute_reference_outputs(reference_solution, func_name, args_list)
    if result["status"] != "ran":
        return {"status": result["status"], "message": result["message"], "cases": [], "wrong_solution_check": None}

    cases = []
    normalized_expected: List[Any] = []
    for c in result["cases"]:
        expected = json_normalize(c["output"]) if c["error"] is None else None
        normalized_expected.append(expected)
        cases.append({"args": c["args"], "expected": expected, "error": c["error"]})

    wrong_solution_check = None
    if wrong_solution:
        checkable = [
            (tuple(c["args"]), normalized_expected[i])
            for i, c in enumerate(result["cases"])
            if c["error"] is None
        ]
        wrong_result = run_submission(wrong_solution, func_name, checkable)
        wrong_solution_check = {
            "status": wrong_result["status"],
            "pass_count": wrong_result["pass_count"],
            "total": wrong_result["total"],
            "pass_rate": wrong_result["pass_rate"],
            "still_passes_all": wrong_result["status"] == "ran" and wrong_result["pass_rate"] == 1.0,
        }

    return {"status": "ok", "message": None, "cases": cases, "wrong_solution_check": wrong_solution_check}


def submission_row(sub) -> dict:
    """`sub` needs .id, .student_name, .result (dict or None), .submitted_at (datetime)."""
    result = sub.result or {}
    return {
        "id": str(sub.id),
        "student_name": sub.student_name,
        "final_score_0_to_100": result.get("final_score_0_to_100"),
        "sub_scores_0_to_1": result.get("sub_scores_0_to_1"),
        "submitted_at": sub.submitted_at.isoformat(),
    }


# --- request models shared by server/ and worker/ (one API contract) ---

class SyntaxCheckRequest(BaseModel):
    code: str


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


class CreateExamRequest(BaseModel):
    problem_id: str
    deadline: Optional[datetime.datetime] = None
    time_limit_seconds: Optional[int] = None


class UpdateExamRequest(BaseModel):
    deadline: Optional[datetime.datetime] = None


class ExamRunRequest(BaseModel):
    code: str


class ExamSubmitRequest(BaseModel):
    student_name: str
    code: str


# --- pure response/sample helpers ---

def statement_excerpt(statement: str) -> str:
    return statement if len(statement) <= 120 else statement[:120] + "…"


def run_response(detailed: dict) -> dict:
    """Shape a sandbox run_submission_cases result for the public-run endpoint
    (pass/fail per case only, never the values)."""
    if detailed["status"] != "ran":
        return {"status": detailed["status"], "message": detailed["message"], "cases": []}
    return {
        "status": "ran",
        "message": None,
        "cases": [{"passed": c["passed"], "error": c["error"]} for c in detailed["cases"]],
    }


def build_submit_sample(statement: str, func_name: str, rubric: dict, hidden_cases: list, code: str) -> dict:
    return {
        "statement": statement,
        "func_name": func_name,
        "test_cases": [(tuple(tc["args"]), tc["expected"]) for tc in hidden_cases],
        "rubric": rubric,
        "submission_code": code,
    }


EXPORT_HEADER = [
    "student_name", "final_score", "correctness", "efficiency",
    "code_style", "edge_case_handling", "submitted_at",
]


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _safe_cell(value):
    """Neutralise spreadsheet formula injection: a string cell starting with a
    formula trigger gets an apostrophe prefix so it is stored as text."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def export_row(student_name: str, result: dict | None, submitted_at_iso: str) -> list:
    result = result or {}
    sub_scores = result.get("sub_scores_0_to_1") or {}
    return [
        _safe_cell(student_name),
        result.get("final_score_0_to_100"),
        sub_scores.get("correctness"),
        sub_scores.get("efficiency"),
        sub_scores.get("code_style"),
        sub_scores.get("edge_case_handling"),
        submitted_at_iso,
    ]
