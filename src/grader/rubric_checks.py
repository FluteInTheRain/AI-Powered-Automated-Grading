# -*- coding: utf-8 -*-
"""Runs the small closed-form LLM checks, one per non-correctness rubric
dimension, and converts each into a 0..1 sub-score. This is the piece that
replaces a single free-form "give me a score 0-100" prompt.
"""
from __future__ import annotations

from pathlib import Path

from .llm_client import LLMClient
from .schemas import CHECK_SCHEMAS, EdgeCaseCheck, EfficiencyCheck, OrdinalLevel, StyleCheck

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"

_STYLE_LEVEL_TO_SCORE = {
    OrdinalLevel.CLEAN: 1.0,
    OrdinalLevel.MEDIUM: 0.6,
    OrdinalLevel.POOR: 0.2,
}


def _load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")


def check_efficiency(client: LLMClient, statement: str, submission_code: str) -> tuple[float, EfficiencyCheck]:
    """Returns (score, raw_result). The raw result carries the *reason* behind
    the score (e.g. observed_pattern) — callers that only need the number can
    ignore it, but discarding it entirely (as an earlier version of this
    function did) means nothing downstream can explain the score."""
    prompt = _load_prompt("efficiency").format(statement=statement, submission_code=submission_code)
    result: EfficiencyCheck = client.structured_call(
        system_prompt="You are a precise, terse grading assistant. Output only valid JSON.",
        user_prompt=prompt,
        schema=EfficiencyCheck,
    )
    score = 1.0 if result.meets_expected_complexity else 0.4
    return score, result


def check_code_style(client: LLMClient, submission_code: str) -> tuple[float, StyleCheck]:
    prompt = _load_prompt("code_style").format(submission_code=submission_code)
    result: StyleCheck = client.structured_call(
        system_prompt="You are a precise, terse grading assistant. Output only valid JSON.",
        user_prompt=prompt,
        schema=StyleCheck,
    )
    return _STYLE_LEVEL_TO_SCORE[result.level], result


def check_edge_case_handling(
    client: LLMClient, statement: str, submission_code: str, rubric_weight: float
) -> tuple[float, EdgeCaseCheck]:
    prompt = _load_prompt("edge_case_handling").format(
        statement=statement, submission_code=submission_code, rubric_edge_case_weight=rubric_weight
    )
    result: EdgeCaseCheck = client.structured_call(
        system_prompt="You are a precise, terse grading assistant. Output only valid JSON.",
        user_prompt=prompt,
        schema=EdgeCaseCheck,
    )
    if result.handled:
        score = 1.0
    else:
        # handled=False must never score 1.0, even if the model didn't (or
        # couldn't) name any specific missing_cases — an empty list here
        # means "unspecified", not "zero penalty". Previously this formula
        # gave 1.0 - 0.25*0 == 1.0 in that situation, silently overriding
        # the model's own "not handled" verdict.
        score = max(0.25, 1.0 - 0.25 * max(1, len(result.missing_cases)))
    return score, result
