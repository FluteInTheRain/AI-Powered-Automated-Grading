# -*- coding: utf-8 -*-
"""Deterministic, LLM-free correctness scoring via real test execution.

This is intentionally the same logic as data/build_dataset.py's
`run_submission`, factored out so the live grading pipeline and the dataset
builder share one code path instead of drifting apart.
"""
from __future__ import annotations

from typing import Any, Callable, List, Tuple


def run_submission(code_str: str, func_name: str, test_cases: List[Tuple[tuple, Any]]) -> dict:
    namespace: dict = {}
    try:
        exec(code_str, namespace)
    except Exception as e:
        return {"pass_count": 0, "total": len(test_cases), "pass_rate": 0.0,
                "errors": [f"COMPILE_ERROR: {e}"], "status": "compile_error"}

    func = namespace.get(func_name)
    if func is None:
        return {"pass_count": 0, "total": len(test_cases), "pass_rate": 0.0,
                "errors": [f"FUNC_NOT_FOUND: {func_name}"], "status": "func_not_found"}

    pass_count = 0
    errors = []
    for args, expected in test_cases:
        try:
            actual = func(*args)
            if actual == expected:
                pass_count += 1
            else:
                errors.append(f"input={args} expected={expected} got={actual}")
        except Exception as e:
            errors.append(f"input={args} RUNTIME_ERROR: {e}")

    total = len(test_cases)
    return {
        "pass_count": pass_count,
        "total": total,
        "pass_rate": round(pass_count / total, 4) if total else 0.0,
        "errors": errors,
        "status": "ran",
    }


def score_correctness(exec_result: dict) -> float:
    return exec_result["pass_rate"]
