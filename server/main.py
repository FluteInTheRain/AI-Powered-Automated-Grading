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
from problems import PROBLEMS

# Matches configs/model.yaml — kept as inline defaults here the same way
# app.py's Streamlit sidebar does, rather than adding a yaml dependency.
BASE_URL = "http://localhost:8080/v1"
MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"

# Hardcoded per current product requirement — every problem gets the same
# fixed time limit for now. Move this to a per-problem field (data/problems.py)
# once problems need different limits (see docs/productionization.md PR-B1).
TIME_LIMIT_SECONDS = 600

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


def _problem_by_id(problem_id: str) -> dict:
    for p in PROBLEMS:
        if p["id"] == problem_id:
            return p
    raise HTTPException(status_code=404, detail=f"Unknown problem_id: {problem_id}")


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
    return {
        "id": p["id"],
        "statement": p["statement"],
        "rubric": p["rubric"],
        "starter_code": _starter_code(p),
        "time_limit_seconds": TIME_LIMIT_SECONDS,
    }


class SubmitRequest(BaseModel):
    problem_id: str
    code: str


@app.post("/api/submit")
def submit(req: SubmitRequest):
    problem = _problem_by_id(req.problem_id)
    sample = {
        "statement": problem["statement"],
        "func_name": problem["func_name"],
        "test_cases": problem["test_cases"],
        "rubric": problem["rubric"],
        "submission_code": req.code,
    }
    client = LLMClient(base_url=BASE_URL, model=MODEL, seed=0)
    try:
        result = grade(sample, client)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Grading failed: {e}")
    return result
