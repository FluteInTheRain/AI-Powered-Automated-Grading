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


class EfficiencyCheck(BaseModel):
    """Three independent, bounded sub-criteria instead of one coarse
    pass/fail — see docs/architecture.md's "Rubric-check granularity"
    section. Score = fraction true, computed in rubric_checks.py."""
    meets_time_complexity: bool = Field(
        description="does the algorithm meet the time complexity a competent solution would use for this problem?"
    )
    avoids_redundant_computation: bool = Field(
        description="does it avoid recomputing the same result repeatedly, e.g. inside a loop, when it could be computed once?"
    )
    uses_appropriate_data_structure: bool = Field(
        description="does it use a data structure suited to the operations performed (e.g. a set/dict for membership checks instead of scanning a list)?"
    )
    observed_pattern: str = Field(
        description="one short phrase, e.g. 'nested loop O(n^2)' or 'hash map O(n)' — explanatory only, not scored"
    )


class StyleCheck(BaseModel):
    """Four independent, bounded sub-criteria instead of one 3-level
    ordinal — see docs/architecture.md's "Rubric-check granularity"
    section. Score = fraction true, computed in rubric_checks.py."""
    descriptive_naming: bool = Field(
        description="are variable/function names meaningful, not single letters or misleading (conventional loop indices like i, j are fine)?"
    )
    single_responsibility: bool = Field(
        description="is the logic reasonably decomposed, without one block doing clearly unrelated things or excessive nesting?"
    )
    consistent_formatting: bool = Field(
        description="is indentation/spacing consistent and readable throughout?"
    )
    no_dead_or_redundant_code: bool = Field(
        description="no unused variables, unreachable code, or needlessly duplicated logic?"
    )


class EdgeCaseStatus(str, Enum):
    NOT_APPLICABLE = "not_applicable"
    NOT_HANDLED = "not_handled"
    HANDLED = "handled"


class EdgeCaseCheck(BaseModel):
    """Five fixed, problem-agnostic edge-case categories instead of one
    open-ended `missing_cases: List[str]` — the old list's *length* was an
    unbounded free-form signal in disguise (see docs/architecture.md).
    Each category is judged not_applicable/not_handled/handled per
    submission; score = handled / applicable, computed in rubric_checks.py.
    Chosen by scanning all 16 problems in data/problems.py for recurring
    edge-case themes — extend with a 6th if a new problem type needs one."""
    empty_or_minimal_input: EdgeCaseStatus = Field(
        description="empty or smallest-possible input, e.g. empty string/list, single element"
    )
    boundary_or_extreme_values: EdgeCaseStatus = Field(
        description="zero, negative numbers, very large values, or (for recursive solutions) the base case"
    )
    duplicate_or_repeated_elements: EdgeCaseStatus = Field(
        description="repeated/duplicate values or characters"
    )
    no_result_or_invalid_case: EdgeCaseStatus = Field(
        description="a 'not found' / 'no valid answer' / invalid-input branch"
    )
    case_or_format_insensitivity: EdgeCaseStatus = Field(
        description="ignoring letter case, whitespace, or irrelevant characters, if the problem requires it"
    )


# One entry per non-correctness rubric dimension. Extend this, not the prompts,
# when the rubric grows a new dimension.
CHECK_SCHEMAS = {
    "efficiency": EfficiencyCheck,
    "code_style": StyleCheck,
    "edge_case_handling": EdgeCaseCheck,
}


class FeedbackItem(BaseModel):
    """One specific issue, anchored to a line, in teacher-review style."""
    line: int = Field(description="1-indexed line number in the submitted code this issue is about")
    issue: str = Field(description="short label for what's wrong, e.g. 'off-by-one', 'wrong base case'")
    explanation: str = Field(description="why this is wrong, 1-2 sentences")
    suggested_fix: str = Field(description="concrete fix — a corrected line/snippet or precise instruction")


class CodeFeedback(BaseModel):
    """Explanatory feedback on a submission — separate from and does not
    affect scoring (see src/grader/feedback.py). Generated after grading,
    from the code plus the already-computed sandbox/rubric results."""
    summary: str = Field(description="1-2 sentence overall assessment")
    issues: List[FeedbackItem] = Field(default_factory=list)
