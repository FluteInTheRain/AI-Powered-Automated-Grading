# -*- coding: utf-8 -*-
"""Runs one fixed sample through the grading pipeline N times and reports the
exact-match consistency rate.

With --concurrency 1 (default), requests are sequential — the server never
has more than one request in flight, so its --parallel setting is moot and
this measures the no-batching baseline regardless of how the server was
started. To actually exercise the server's dynamic batching, use
--concurrency > 1 so multiple requests genuinely overlap in time (fired via
a thread pool) against a server started with --parallel > 1.

Usage:
    python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100
    python3 experiments/consistency_test.py --sample_id ... --n 100 --concurrency 8 --tag batched
"""
from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M")
    parser.add_argument("--tag", default="", help="suffix for the output filename, e.g. 'batched'")
    parser.add_argument(
        "--concurrency", type=int, default=1,
        help="requests in flight at once; >1 actually exercises server-side batching",
    )
    args = parser.parse_args()

    sample = load_sample(args.sample_id)
    # One LLMClient (one underlying HTTP connection pool) shared across
    # threads is fine — each structured_call is a self-contained request.
    client = LLMClient(base_url=args.base_url, model=args.model, seed=0)

    scores = []
    sub_scores_log = []  # per-run sub_scores_0_to_1, so variance can be broken down by check (T1.3)
    if args.concurrency <= 1:
        for i in range(args.n):
            result = grade(sample, client)
            scores.append(result["final_score_0_to_100"])
            sub_scores_log.append(result["sub_scores_0_to_1"])
            print(f"run {i + 1}/{args.n}: {result['final_score_0_to_100']}")
    else:
        done = 0
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = [pool.submit(grade, sample, client) for _ in range(args.n)]
            for f in as_completed(futures):
                result = f.result()
                scores.append(result["final_score_0_to_100"])
                sub_scores_log.append(result["sub_scores_0_to_1"])
                done += 1
                print(f"run {done}/{args.n}: {result['final_score_0_to_100']}")

    report = exact_match_consistency_rate(scores)
    report["per_check_unique_values"] = {
        check: sorted({s[check] for s in sub_scores_log})
        for check in sub_scores_log[0]
    } if sub_scores_log else {}
    RESULTS_DIR.mkdir(exist_ok=True)
    suffix = f"_{args.tag}" if args.tag else ""
    out_path = RESULTS_DIR / f"consistency_{args.sample_id}{suffix}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Written to {out_path}")


if __name__ == "__main__":
    main()
