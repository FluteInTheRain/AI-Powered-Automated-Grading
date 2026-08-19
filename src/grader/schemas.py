# -*- coding: utf-8 -*-
"""Structured-output schemas for the LLM rubric checks.

Each rubric dimension (other than correctness, which is computed by the
sandbox) is scored via ONE small, closed-form call that returns a JSON object
matching one of these schemas. Keeping each schema tiny is what makes
constrained decoding cheap and low-variance: the model is choosing between a
handful of enum values / a short bounded list, not composing free text.
"""
from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field


class OrdinalLevel(str, Enum):
    POOR = "poor"
    MEDIUM = "medium"
    CLEAN = "clean"


class EfficiencyCheck(BaseModel):
    """Atomic check: does the submission meet the expected complexity class?"""
    meets_expected_complexity: bool
    observed_pattern: str = Field(
        description="one short phrase, e.g. 'nested loop O(n^2)' or 'hash map O(n)'"
    )


class StyleCheck(BaseModel):
    """Atomic check: naming, structure, readability — ordinal, not free text."""
    level: OrdinalLevel


class EdgeCaseCheck(BaseModel):
    """Atomic check: does the code visibly handle the edge cases named in the rubric?"""
    handled: bool
    missing_cases: List[str] = Field(default_factory=list)


# One entry per non-correctness rubric dimension. Extend this, not the prompts,
# when the rubric grows a new dimension.
CHECK_SCHEMAS = {
    "efficiency": EfficiencyCheck,
    "code_style": StyleCheck,
    "edge_case_handling": EdgeCaseCheck,
}
