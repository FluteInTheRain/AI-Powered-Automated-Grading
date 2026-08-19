# -*- coding: utf-8 -*-
"""Line-by-line explanatory feedback ("teacher review"), generated AFTER
grading is done. Deliberately separate from src/grader/pipeline.py: this
module never feeds into sub_scores or the final score, so it can't
introduce nondeterminism or drift into the aggregation logic — it only
explains a result that's already fixed.
"""
from __future__ import annotations

import json
from pathlib import Path

from .llm_client import LLMClient
from .schemas import CodeFeedback, FeedbackItem

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "feedback.txt"

_MAX_SCORE = {"efficiency": 1.0, "code_style": 1.0, "edge_case_handling": 1.0}


def _numbered(code: str) -> str:
    lines = code.strip("\n").split("\n")
    return "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))


def _fill_missing_issues(
    feedback: CodeFeedback, sub_scores_0_to_1: dict, check_details: dict | None
) -> CodeFeedback:
    """The 1.5B model sometimes acknowledges a non-max score in `summary`
    (free text) but leaves `issues` empty anyway — it doesn't reliably
    enforce its own "issues empty only if every score is maxed" instruction.
    Don't rely on the model to self-police that; check it here instead, and
    synthesize a line-1-anchored placeholder issue (from check_details, if
    available) for any non-max check the model didn't already cover."""
    if not check_details:
        return feedback
    mentioned = {item.issue.lower() for item in feedback.issues}
    for check, max_score in _MAX_SCORE.items():
        score = sub_scores_0_to_1.get(check)
        if score is None or score >= max_score:
            continue
        if any(check.replace("_", " ") in m or check in m for m in mentioned):
            continue  # model already raised something naming this check
        detail = check_details.get(check, {})
        feedback.issues.append(FeedbackItem(
            line=1,
            issue=f"{check} scored {score:.2f} (not maximum)",
            explanation=f"The {check} check flagged this submission "
                        f"(detail: {json.dumps(detail, ensure_ascii=False)}), but the feedback "
                        f"model didn't surface a specific line for it.",
            suggested_fix=f"Review the submission for {check.replace('_', ' ')} issues manually.",
        ))
    return feedback


def generate_feedback(
    client: LLMClient,
    statement: str,
    submission_code: str,
    execution_result: dict,
    sub_scores_0_to_1: dict,
    check_details: dict | None = None,
) -> CodeFeedback:
    """`check_details` (from pipeline.grade()'s output) carries *why* each
    non-correctness score is what it is (e.g. code_style's actual "medium"
    level, not just 0.6) — passing the bare scores alone leaves this call
    with no way to explain a score it didn't itself produce, and it can end
    up disagreeing with it (a second, independent LLM judgment naturally can)."""
    rubric_summary = {"scores_0_to_1": sub_scores_0_to_1}
    if check_details:
        rubric_summary["reasoning_behind_scores"] = check_details
    prompt = PROMPT_PATH.read_text(encoding="utf-8").format(
        statement=statement,
        numbered_code=_numbered(submission_code),
        execution_summary=json.dumps(execution_result, ensure_ascii=False),
        rubric_summary=json.dumps(rubric_summary, ensure_ascii=False),
    )
    feedback = client.structured_call(
        system_prompt="You are a precise, constructive programming instructor. Output only valid JSON.",
        user_prompt=prompt,
        schema=CodeFeedback,
    )
    return _fill_missing_issues(feedback, sub_scores_0_to_1, check_details)
