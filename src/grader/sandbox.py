# -*- coding: utf-8 -*-
"""Deterministic, LLM-free correctness scoring via real test execution.

`run_submission` is used by the live grading pipeline
(src/grader/pipeline.py) and experiments/ablation.py.
`run_submission_cases` returns the same execution broken out per test case
(input/expected/actual/passed) instead of an aggregate pass_count + string
error list — used by server/main.py for the public test-run endpoint and
for redacting hidden-test detail from the final grading response.
`compute_reference_outputs` runs code against raw inputs with no expected
value to compare against — used by server/teacher.py's problem-authoring
preview to derive `expected` from a reference solution instead of having a
teacher type it by hand.
"""
from __future__ import annotations

from typing import Any, List, Tuple


def _execute(code_str: str, func_name: str, test_cases: List[Tuple[tuple, Any]]) -> dict:
    """Shared exec + per-test-case run, used by both public functions below
    so there's exactly one place that actually runs submitted code."""
    namespace: dict = {}
    try:
        exec(code_str, namespace)
    except Exception as e:
        return {"status": "compile_error", "compile_error": str(e), "cases": []}

    func = namespace.get(func_name)
    if func is None:
        return {"status": "func_not_found", "compile_error": None, "cases": []}

    cases = []
    for args, expected in test_cases:
        try:
            actual = func(*args)
            cases.append({
                "passed": actual == expected,
                "args": args,
                "expected": expected,
                "actual": actual,
                "error": None,
            })
        except Exception as e:
            cases.append({
                "passed": False,
                "args": args,
                "expected": expected,
                "actual": None,
                "error": str(e),
            })
    return {"status": "ran", "compile_error": None, "cases": cases}


def run_submission(code_str: str, func_name: str, test_cases: List[Tuple[tuple, Any]]) -> dict:
    result = _execute(code_str, func_name, test_cases)
    total = len(test_cases)

    if result["status"] == "compile_error":
        return {"pass_count": 0, "total": total, "pass_rate": 0.0,
                "errors": [f"COMPILE_ERROR: {result['compile_error']}"], "status": "compile_error"}
    if result["status"] == "func_not_found":
        return {"pass_count": 0, "total": total, "pass_rate": 0.0,
                "errors": [f"FUNC_NOT_FOUND: {func_name}"], "status": "func_not_found"}

    pass_count = 0
    errors = []
    for c in result["cases"]:
        if c["passed"]:
            pass_count += 1
        elif c["error"] is not None:
            errors.append(f"input={c['args']} RUNTIME_ERROR: {c['error']}")
        else:
            errors.append(f"input={c['args']} expected={c['expected']} got={c['actual']}")

    return {
        "pass_count": pass_count,
        "total": total,
        "pass_rate": round(pass_count / total, 4) if total else 0.0,
        "errors": errors,
        "status": "ran",
    }


def run_submission_cases(code_str: str, func_name: str, test_cases: List[Tuple[tuple, Any]]) -> dict:
    """Per-test-case detail (args/expected/actual/passed), for callers that
    need to know *which* case(s) failed rather than just an aggregate pass
    rate — e.g. showing public test results, or redacting hidden-test
    detail while still reporting pass/fail per case."""
    result = _execute(code_str, func_name, test_cases)
    if result["status"] != "ran":
        message = (f"COMPILE_ERROR: {result['compile_error']}" if result["status"] == "compile_error"
                    else f"FUNC_NOT_FOUND: {func_name}")
        return {"status": result["status"], "message": message, "cases": []}
    return {"status": "ran", "message": None, "cases": result["cases"]}


def score_correctness(exec_result: dict) -> float:
    return exec_result["pass_rate"]


def compute_reference_outputs(code_str: str, func_name: str, args_list: List[tuple]) -> dict:
    """Run `code_str` against each entry in `args_list`, no expected value
    involved — used to derive `expected` from a reference solution rather
    than have a teacher type it by hand. Reuses `_execute` with a dummy
    `expected=None` per case so there's still exactly one place that
    actually runs code."""
    result = _execute(code_str, func_name, [(args, None) for args in args_list])
    if result["status"] != "ran":
        message = (f"COMPILE_ERROR: {result['compile_error']}" if result["status"] == "compile_error"
                    else f"FUNC_NOT_FOUND: {func_name}")
        return {"status": result["status"], "message": message, "cases": []}
    return {
        "status": "ran",
        "message": None,
        "cases": [
            {"args": c["args"], "output": c["actual"], "error": c["error"]}
            for c in result["cases"]
        ],
    }
