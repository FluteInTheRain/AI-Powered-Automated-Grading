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

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from grader.pipeline import grade
from metrics import spearman_agreement

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "dataset.json"


def run_hybrid_decomposed(dataset: list, client) -> list:
    return [grade(sample, client)["final_score_0_to_100"] for sample in dataset]


def main():
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    reference = [s["final_score_0_to_100"] for s in dataset]

    # TODO: wire up an LLMClient and the free-form baseline arm, then compare.
    # predicted = run_hybrid_decomposed(dataset, client)
    # print(spearman_agreement(predicted, reference))
    print(f"Loaded {len(dataset)} samples. Reference scores ready; wire up model arms to compare.")


if __name__ == "__main__":
    main()
