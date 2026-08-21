# -*- coding: utf-8 -*-
"""REST API for the grading pipeline — a thin transport layer over
src/grader/pipeline.py so the React frontend (frontend/) can call it over
HTTP. Not a reimplementation of grading logic; every rule in CLAUDE.md
still applies to the underlying grading — this file only adds routing and
request/response shaping.

Run: uvicorn server.main:app --reload --port 8001
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from grader.llm_client import LLMClient
from grader.pipeline import grade
from grader.sandbox import run_submission_cases
from problems import PROBLEMS

from .config import BASE_URL, MODEL
from .exam import router as exam_router
from .teacher import router as teacher_router

# Hardcoded per current product requirement — every problem gets the same
# fixed time limit for now. Move this to a per-problem field (data/problems.py)
# once problems need different limits (see docs/productionization.md PR-B1).
TIME_LIMIT_SECONDS = 600

# The first N test cases of each problem are "public" — students can run
# against them freely before submitting (PR-C2 in docs/productionization.md)
# and see the actual input/expected/actual values, purely to check their
# understanding of the expected input/output format.
#
# The real grade (submit(), below) is computed on the REMAINING (hidden)
# test cases ONLY — public ones are excluded entirely from scoring, not
# just from the displayed detail. Otherwise a submission that special-cases
# or memorizes the exact public examples (and generalizes to nothing else)
# would still collect partial correctness credit for reproducing answers it
# could just read off the problem statement, despite not having solved
# anything. Scoring only on held-out cases means a submission that passes
# zero hidden tests scores 0 correctness regardless of how many public
# examples it happens to match — which also naturally re-triggers
# pipeline.grade()'s existing "pass_rate == 0.0 -> skip the LLM checks too"
# rule (src/grader/pipeline.py), so a public-only submission gets 0 across
# every rubric dimension, not just correctness.
#
# data/problems.py doesn't tag test cases as public/hidden itself, so this
# is a positional convention, not per-problem authoring — revisit once
# problems carry an explicit split (docs/productionization.md PR-B1). Kept
# small (1) so memorizing the visible example(s) can't cover a meaningful
# share of the hidden set.
PUBLIC_TEST_CASE_COUNT = 1

app = FastAPI(title="Automated Grading API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(teacher_router)
app.include_router(exam_router)


def _problem_by_id(problem_id: str) -> dict:
    for p in PROBLEMS:
        if p["id"] == problem_id:
            return p
    raise HTTPException(status_code=404, detail=f"Unknown problem_id: {problem_id}")


def _public_count(problem: dict) -> int:
    return min(PUBLIC_TEST_CASE_COUNT, len(problem["test_cases"]))


def _starter_code(problem: dict) -> str:
    """Generic stub from func_name + arg count of the first test case.
    data/problems.py doesn't store parameter names, only positional test
    args, so this can't recover real names — good enough as a placeholder
    until problems carry authored starter code (docs/productionization.md
    PR-B1)."""
    n_args = len(problem["test_cases"][0][0]) if problem["test_cases"] else 0
    args = ", ".join(f"arg{i + 1}" for i in range(n_args))
    return f"def {problem['func_name']}({args}):\n    # TODO: your solution here\n    pass\n"


@app.get("/api/problems")
def list_problems():
    return [
        {
            "id": p["id"],
            "title": p["id"].split("_", 1)[1].replace("_", " ").title(),
            "time_limit_seconds": TIME_LIMIT_SECONDS,
        }
        for p in PROBLEMS
    ]


@app.get("/api/problems/{problem_id}")
def get_problem(problem_id: str):
    p = _problem_by_id(problem_id)
    n_public = _public_count(p)
    return {
        "id": p["id"],
        "func_name": p["func_name"],
        "statement": p["statement"],
        "rubric": p["rubric"],
        "starter_code": _starter_code(p),
        "time_limit_seconds": TIME_LIMIT_SECONDS,
        # Deliberately no input/expected values here — only a count. Showing
        # the actual public test data (see run_public_tests() below for the
        # same reasoning) would hand students the exact expected output to
        # copy instead of solving the problem, even though doing so earns 0
        # score (see PUBLIC_TEST_CASE_COUNT note below) — it's still not
        # something worth putting in front of a student mid-exam.
        "public_test_case_count": n_public,
        "hidden_test_case_count": len(p["test_cases"]) - n_public,
    }


class SyntaxCheckRequest(BaseModel):
    code: str


@app.post("/api/syntax-check")
def syntax_check(req: SyntaxCheckRequest):
    """Fast, deterministic, LLM-free syntax check for live editor feedback
    (frontend/src/components/CodeEditor.jsx). `compile()` only parses/
    compiles to bytecode — it never runs the submitted code, so this is
    safe to call on arbitrary untrusted input unlike sandbox.run_submission.
    Catches syntax errors only (e.g. a stray unclosed quote), not semantic
    ones (undefined names, wrong logic) — those still require real
    execution and are out of scope here on purpose."""
    try:
        compile(req.code, "<submission>", "exec")
    except SyntaxError as e:
        return {"ok": False, "message": e.msg, "line": e.lineno or 1}
    return {"ok": True}


class SubmitRequest(BaseModel):
    problem_id: str
    code: str


@app.post("/api/run")
def run_public_tests(req: SubmitRequest):
    """Free, LLM-free test run against only the public test cases — the
    'Run Tests' button, callable as many times as the student wants before
    Submit. Never touches the LLM checks or the sandbox's full (public +
    hidden) test suite, so it can't be used to probe hidden test cases.

    Reports pass/fail per case only — never the actual input/expected/
    actual values, even for the public cases. Otherwise a student could
    just read the expected output off the response and hardcode it instead
    of solving the problem; that wouldn't earn any score (grading is
    hidden-cases-only, see submit() below), but there's no reason to dangle
    the exact answer in front of them either."""
    problem = _problem_by_id(req.problem_id)
    public_cases = problem["test_cases"][: _public_count(problem)]
    detailed = run_submission_cases(req.code, problem["func_name"], public_cases)
    if detailed["status"] != "ran":
        return {"status": detailed["status"], "message": detailed["message"], "cases": []}
    return {
        "status": "ran",
        "message": None,
        "cases": [
            {"passed": c["passed"], "error": c["error"]}
            for c in detailed["cases"]
        ],
    }


@app.post("/api/submit")
def submit(req: SubmitRequest):
    problem = _problem_by_id(req.problem_id)
    hidden_cases = problem["test_cases"][_public_count(problem):]
    sample = {
        "statement": problem["statement"],
        "func_name": problem["func_name"],
        "test_cases": hidden_cases,  # scoring uses hidden cases only — see PUBLIC_TEST_CASE_COUNT above
        "rubric": problem["rubric"],
        "submission_code": req.code,
    }
    client = LLMClient(base_url=BASE_URL, model=MODEL, seed=0)
    try:
        result = grade(sample, client)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Grading failed: {e}")

    # Unlike run_public_tests() above, the submit response shows full detail
    # (input/expected/actual) for every failed case — this is the one-shot
    # final grade, not a probe the student can use to iterate toward hidden
    # test values, so the learning value of a clear explanation outweighs
    # the secrecy concern that applies to /api/run. NOTE: this assumes one
    # attempt per problem; there is currently no server-side enforcement
    # stopping a student from reloading and resubmitting to learn the
    # hidden cases incrementally across attempts (docs/productionization.md
    # — worth a PR-C3-adjacent follow-up if repeat attempts turn out to be
    # possible in practice).
    return result
