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
from .schemas import CodeFeedback

PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "feedback.txt"


def _numbered(code: str) -> str:
    lines = code.strip("\n").split("\n")
    return "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))


def generate_feedback(
    client: LLMClient,
    statement: str,
    submission_code: str,
    execution_result: dict,
    sub_scores_0_to_1: dict,
) -> CodeFeedback:
    prompt = PROMPT_PATH.read_text(encoding="utf-8").format(
        statement=statement,
        numbered_code=_numbered(submission_code),
        execution_summary=json.dumps(execution_result, ensure_ascii=False),
        rubric_summary=json.dumps(sub_scores_0_to_1, ensure_ascii=False),
    )
    return client.structured_call(
        system_prompt="You are a precise, constructive programming instructor. Output only valid JSON.",
        user_prompt=prompt,
        schema=CodeFeedback,
    )
