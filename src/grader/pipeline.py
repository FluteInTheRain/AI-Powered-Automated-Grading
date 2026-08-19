# -*- coding: utf-8 -*-
"""Orchestrates one grading pass: sandbox correctness (deterministic) +
decomposed LLM checks (structured, temp=0) + code-side aggregation.

This is deliberately a single sequential function, not a multi-agent
framework — the whole point of the design (see docs/architecture.md) is that
grading is decomposed into small, independent, cheap calls rather than one
long free-form reasoning trace, so there is nothing here for an agent
orchestrator to buy you.
"""
from __future__ import annotations

from .aggregator import aggregate
from .llm_client import LLMClient
from .rubric_checks import check_code_style, check_edge_case_handling, check_efficiency
from .sandbox import run_submission, score_correctness


def grade(sample: dict, client: LLMClient) -> dict:
    """`sample` follows the schema documented in data/README (script.md)."""
    exec_result = run_submission(
        sample["submission_code"], sample["func_name"], sample["test_cases"]
    )
    rubric = sample["rubric"]

    sub_scores = {
        "correctness": score_correctness(exec_result),
        "efficiency": check_efficiency(client, sample["statement"], sample["submission_code"]),
        "code_style": check_code_style(client, sample["submission_code"]),
        "edge_case_handling": check_edge_case_handling(
            client, sample["statement"], sample["submission_code"], rubric["edge_case_handling"]
        ),
    }

    final_score = aggregate(sub_scores, rubric)

    return {
        "sub_scores_0_to_1": sub_scores,
        "final_score_0_to_100": final_score,
        "execution_result": exec_result,
    }
