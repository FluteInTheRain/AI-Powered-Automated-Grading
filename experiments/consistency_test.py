# -*- coding: utf-8 -*-
"""Runs one fixed sample through the grading pipeline N times, sequentially
(never batched — batching is the known source of non-determinism we're trying
to isolate), and reports the exact-match consistency rate.

Usage:
    python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))

from grader.llm_client import LLMClient
from grader.pipeline import grade
from metrics import exact_match_consistency_rate
from problems import PROBLEMS

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


def load_sample(sample_id: str) -> dict:
    """dataset.json only carries labels (see data/script.md); func_name and
    test_cases needed to re-run the live pipeline live in data/problems.py,
    so build the sample from there instead."""
    problem_id, sub_id = sample_id.rsplit("__", 1)
    problem = next((p for p in PROBLEMS if p["id"] == problem_id), None)
    if problem is None:
        raise KeyError(f"problem_id not found: {problem_id}")
    submission = next((s for s in problem["submissions"] if s["sub_id"] == sub_id), None)
    if submission is None:
        raise KeyError(f"sub_id not found: {sub_id}")
    return {
        "sample_id": sample_id,
        "statement": problem["statement"],
        "func_name": problem["func_name"],
        "test_cases": problem["test_cases"],
        "rubric": problem["rubric"],
        "submission_code": submission["code"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample_id", required=True)
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--base_url", default="http://localhost:8080/v1")
    parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q8_0")
    args = parser.parse_args()

    sample = load_sample(args.sample_id)
    client = LLMClient(base_url=args.base_url, model=args.model, seed=0)

    scores = []
    for i in range(args.n):
        result = grade(sample, client)
        scores.append(result["final_score_0_to_100"])
        print(f"run {i + 1}/{args.n}: {result['final_score_0_to_100']}")

    report = exact_match_consistency_rate(scores)
    RESULTS_DIR.mkdir(exist_ok=True)
    out_path = RESULTS_DIR / f"consistency_{args.sample_id}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Written to {out_path}")


if __name__ == "__main__":
    main()
