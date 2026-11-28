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

import signal
import sys
import threading
import time
from contextlib import contextmanager
from typing import Any, List, Tuple

# Wall time budget for one _execute call (exec of the module plus every case).
# Best effort, see _alarm: it stops an honest infinite loop, not an adversarial one.
TIME_LIMIT_S = 10.0
# Longest error text kept from student code (an exception message is student-controlled).
ERROR_CAP = 1000
# Longest repr of a returned value echoed back in an error line.
GOT_CAP = 2000


class _TimeLimit(BaseException):
    """Raised by the SIGALRM handler. A BaseException so a plain `except Exception`
    in student code does not swallow it (a bare `except:` still can)."""


def _clip(text: str, cap: int = ERROR_CAP) -> str:
    return text if len(text) <= cap else text[:cap] + f"... [{len(text) - cap} more characters]"


def _clip_str(e: BaseException, cap: int = ERROR_CAP) -> str:
    try:
        return _clip(str(e), cap)
    except Exception:
        return "<unprintable>"


def _clip_repr(value: Any) -> str:
    # Same text as f"{value}" for anything short; only an enormous value is cut.
    try:
        return _clip(f"{value}", GOT_CAP)
    except Exception:
        return "<unprintable>"


@contextmanager
def _alarm(deadline: float):
    """Raise _TimeLimit in this thread at `deadline` (a time.monotonic() value).

    Needs SIGALRM, so it only works on Unix in the main thread; elsewhere (a
    server worker thread, Windows, Pyodide) it does nothing and the platform
    limit is the only protection. Student code can defeat it with a bare
    `except:` in a loop; a hard limit needs a subprocess (docs/sandbox-threat-model.md).
    """
    usable = (hasattr(signal, "setitimer") and sys.platform != "emscripten"
              and threading.current_thread() is threading.main_thread())
    if not usable:
        yield
        return
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _TimeLimit()

    def on_alarm(signum, frame):
        raise _TimeLimit()

    previous = signal.signal(signal.SIGALRM, on_alarm)
    signal.setitimer(signal.ITIMER_REAL, remaining)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _exited(e: BaseException) -> dict:
    # Same text the sandbox Worker handler produced for exit(), so both paths agree.
    return {"status": "compile_error", "compile_error": f"program exited (SystemExit: {_clip_str(e, 200)})",
            "cases": []}


def _execute(code_str: str, func_name: str, test_cases: List[Tuple[tuple, Any]]) -> dict:
    """Shared exec + per-test-case run, used by both public functions below
    so there's exactly one place that actually runs submitted code."""
    deadline = time.monotonic() + TIME_LIMIT_S
    try:
        return _execute_until(code_str, func_name, test_cases, deadline)
    except _TimeLimit:  # the alarm fired in a gap between phases
        return {"status": "compile_error", "compile_error": f"time limit exceeded ({TIME_LIMIT_S:g}s)", "cases": []}


def _execute_until(code_str: str, func_name: str, test_cases: List[Tuple[tuple, Any]], deadline: float) -> dict:
    namespace: dict = {}
    try:
        with _alarm(deadline):
            exec(code_str, namespace)
    except _TimeLimit:
        return {"status": "compile_error", "compile_error": f"time limit exceeded ({TIME_LIMIT_S:g}s)", "cases": []}
    except SystemExit as e:
        return _exited(e)
    except Exception as e:
        return {"status": "compile_error", "compile_error": _clip_str(e), "cases": []}

    func = namespace.get(func_name)
    if func is None:
        return {"status": "func_not_found", "compile_error": None, "cases": []}

    cases = []
    for args, expected in test_cases:
        try:
            with _alarm(deadline):
                actual = func(*args)
                passed = actual == expected
            cases.append({
                "passed": passed,
                "args": args,
                "expected": expected,
                "actual": actual,
                "error": None,
            })
        except SystemExit as e:
            return _exited(e)
        except _TimeLimit:
            cases.append({
                "passed": False,
                "args": args,
                "expected": expected,
                "actual": None,
                "error": f"time limit exceeded ({TIME_LIMIT_S:g}s)",
            })
        except Exception as e:
            cases.append({
                "passed": False,
                "args": args,
                "expected": expected,
                "actual": None,
                "error": _clip_str(e),
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
            errors.append(f"input={c['args']} expected={c['expected']} got={_clip_repr(c['actual'])}")

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
