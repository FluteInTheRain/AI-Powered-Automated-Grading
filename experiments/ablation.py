# -*- coding: utf-8 -*-
"""Ablation scaffold: free-form LLM scoring vs. hybrid (sandbox + LLM) vs.
hybrid + decomposed rubric. Fill in `free_form_grade` with a single
holistic-score prompt as the baseline arm; `grade` from grader.pipeline is
the fully decomposed arm.

Run consistency_test.py against each arm's implementation to compare
exact-match rates; run this script to compare aggregate agreement with the
dataset's rule-based labels (subject to the single-rater caveat in
data/script.md — do not report this as human-agreement in the thesis).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))

from grader.aggregator import aggregate
from grader.llm_client import LLMClient
from grader.pipeline import grade
from grader.sandbox import run_submission, score_correctness
from metrics import spearman_agreement
from problems import PROBLEMS

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "dataset.json"
RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"
PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"
PROMPT_PATH = PROMPTS_DIR / "free_form_holistic.txt"
NON_CORRECTNESS_PROMPT_PATH = PROMPTS_DIR / "free_form_non_correctness.txt"

SCORE_RE = re.compile(r"FINAL_SCORE:\s*(\d+(?:\.\d+)?)")
NON_CORRECTNESS_SCORE_RE = re.compile(r"NON_CORRECTNESS_SCORE:\s*(\d+(?:\.\d+)?)")


def free_form_grade(sample: dict, client: LLMClient) -> float | None:
    """Arm 1 (naive baseline): one prompt, one holistic 0-100 score, no
    sandbox, no structured output — the model must both judge correctness by
    reading the code and produce a parseable number on its own. Returns None
    if the response didn't contain a parseable score (a real failure mode of
    this arm, not something to paper over)."""
    prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    user_prompt = prompt_template.format(
        statement=sample["statement"],
        rubric=json.dumps(sample["rubric"]),
        submission_code=sample["submission_code"],
    )
    raw = client.free_form_call(
        system_prompt="You are a fair, consistent programming assignment grader.",
        user_prompt=user_prompt,
    )
    match = SCORE_RE.search(raw)
    return float(match.group(1)) if match else None


def run_free_form(dataset: list, client: LLMClient) -> list:
    return [free_form_grade(sample, client) for sample in dataset]


def _with_sandbox_fields(sample: dict) -> dict:
    """dataset.json only carries labels (see data/script.md); func_name and
    test_cases needed to run the sandbox live in data/problems.py."""
    problem = next(p for p in PROBLEMS if p["id"] == sample["problem_id"])
    return {**sample, "func_name": problem["func_name"], "test_cases": problem["test_cases"]}


def run_hybrid_decomposed(dataset: list, client: LLMClient) -> list:
    return [grade(_with_sandbox_fields(sample), client)["final_score_0_to_100"] for sample in dataset]


def hybrid_freeform_grade(sample: dict, client: LLMClient) -> float | None:
    """Arm 2 (middle ground): real sandbox correctness + ONE free-form LLM
    call covering efficiency + code_style + edge_case_handling combined
    (not decomposed into separate checks). The single non-correctness score
    is applied uniformly across those three rubric criteria."""
    sample = _with_sandbox_fields(sample)
    exec_result = run_submission(sample["submission_code"], sample["func_name"], sample["test_cases"])
    correctness = score_correctness(exec_result)

    user_prompt = NON_CORRECTNESS_PROMPT_PATH.read_text(encoding="utf-8").format(
        statement=sample["statement"], submission_code=sample["submission_code"],
    )
    raw = client.free_form_call(
        system_prompt="You are a fair, consistent programming assignment grader.",
        user_prompt=user_prompt,
    )
    match = NON_CORRECTNESS_SCORE_RE.search(raw)
    if match is None:
        return None
    non_correctness = float(match.group(1)) / 100

    rubric = sample["rubric"]
    sub_scores = {k: (correctness if k == "correctness" else non_correctness) for k in rubric}
    return aggregate(sub_scores, rubric)


def run_hybrid_freeform(dataset: list, client: LLMClient) -> list:
    return [hybrid_freeform_grade(sample, client) for sample in dataset]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base_url", default="http://localhost:8080/v1")
    parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M")
    parser.add_argument(
        "--arm", choices=["free_form", "hybrid_freeform", "hybrid_decomposed", "all"], default="all",
    )
    args = parser.parse_args()

    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    reference = [s["final_score_0_to_100"] for s in dataset]
    client = LLMClient(base_url=args.base_url, model=args.model, seed=0)

    report = {"n_samples": len(dataset)}

    if args.arm in ("free_form", "all"):
        predicted = run_free_form(dataset, client)
        n_failed_parse = sum(1 for p in predicted if p is None)
        paired = [(p, r) for p, r in zip(predicted, reference) if p is not None]
        report["free_form"] = {
            "n_failed_to_parse": n_failed_parse,
            "spearman_agreement": spearman_agreement([p for p, _ in paired], [r for _, r in paired]) if paired else None,
        }
        print(f"free_form: {n_failed_parse}/{len(dataset)} failed to parse a score; "
              f"agreement={report['free_form']['spearman_agreement']}")

    if args.arm in ("hybrid_freeform", "all"):
        predicted = run_hybrid_freeform(dataset, client)
        n_failed_parse = sum(1 for p in predicted if p is None)
        paired = [(p, r) for p, r in zip(predicted, reference) if p is not None]
        report["hybrid_freeform"] = {
            "n_failed_to_parse": n_failed_parse,
            "spearman_agreement": spearman_agreement([p for p, _ in paired], [r for _, r in paired]) if paired else None,
        }
        print(f"hybrid_freeform: {n_failed_parse}/{len(dataset)} failed to parse a score; "
              f"agreement={report['hybrid_freeform']['spearman_agreement']}")

    if args.arm in ("hybrid_decomposed", "all"):
        predicted = run_hybrid_decomposed(dataset, client)
        report["hybrid_decomposed"] = {
            "spearman_agreement": spearman_agreement(predicted, reference),
        }
        print(f"hybrid_decomposed: agreement={report['hybrid_decomposed']['spearman_agreement']}")

    RESULTS_DIR.mkdir(exist_ok=True)
    out_path = RESULTS_DIR / "ablation.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Written to {out_path}")


if __name__ == "__main__":
    main()
