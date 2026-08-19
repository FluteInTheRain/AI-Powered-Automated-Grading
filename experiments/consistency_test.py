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

from grader.llm_client import LLMClient
from grader.pipeline import grade
from metrics import exact_match_consistency_rate

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "dataset.json"
RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


def load_sample(sample_id: str) -> dict:
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    for s in dataset:
        if s["sample_id"] == sample_id:
            return s
    raise KeyError(f"sample_id not found: {sample_id}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample_id", required=True)
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--base_url", default="http://localhost:8000/v1")
    parser.add_argument("--model", default="Qwen2.5-Coder-3B-Instruct")
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
