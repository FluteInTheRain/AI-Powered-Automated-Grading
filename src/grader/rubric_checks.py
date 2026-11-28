# -*- coding: utf-8 -*-
"""Runs the small closed-form LLM checks, one per non-correctness rubric
dimension, and converts each into a 0..1 sub-score. This is the piece that
replaces a single free-form "give me a score 0-100" prompt.

Each check's schema is a small fixed set of independent bounded
sub-criteria (booleans / a 3-way enum) rather than one coarse field —
score is the fraction satisfied, computed here in code. See
docs/architecture.md's "Rubric-check granularity" section for why.
"""
from __future__ import annotations

from pathlib import Path

from .llm_client import LLMClient
from .schemas import CHECK_SCHEMAS, EdgeCaseCheck, EdgeCaseStatus, EfficiencyCheck, StyleCheck

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"


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
    criteria = [
        result.meets_time_complexity,
        result.avoids_redundant_computation,
        result.uses_appropriate_data_structure,
    ]
    return sum(criteria) / len(criteria), result


def check_code_style(client: LLMClient, submission_code: str) -> tuple[float, StyleCheck]:
    prompt = _load_prompt("code_style").format(submission_code=submission_code)
    result: StyleCheck = client.structured_call(
        system_prompt="You are a precise, terse grading assistant. Output only valid JSON.",
        user_prompt=prompt,
        schema=StyleCheck,
    )
    criteria = [
        result.descriptive_naming,
        result.single_responsibility,
        result.consistent_formatting,
        result.no_dead_or_redundant_code,
    ]
    return sum(criteria) / len(criteria), result


def check_edge_case_handling(client: LLMClient, statement: str, submission_code: str) -> tuple[float, EdgeCaseCheck]:
    prompt = _load_prompt("edge_case_handling").format(statement=statement, submission_code=submission_code)
    result: EdgeCaseCheck = client.structured_call(
        system_prompt="You are a precise, terse grading assistant. Output only valid JSON.",
        user_prompt=prompt,
        schema=EdgeCaseCheck,
    )
    statuses = [
        result.empty_or_minimal_input,
        result.boundary_or_extreme_values,
        result.duplicate_or_repeated_elements,
        result.no_result_or_invalid_case,
        result.case_or_format_insensitivity,
    ]
    applicable = [s for s in statuses if s != EdgeCaseStatus.NOT_APPLICABLE]
    if not applicable:
        # No category applies to this problem at all — nothing to penalize.
        return 1.0, result
    score = sum(s == EdgeCaseStatus.HANDLED for s in applicable) / len(applicable)
    return score, result
