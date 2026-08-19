# -*- coding: utf-8 -*-
"""Final score = fixed weighted aggregation, computed by code — never by the LLM."""
from __future__ import annotations


def aggregate(sub_scores_0_to_1: dict, rubric_weights: dict) -> float:
    total_weight = sum(rubric_weights.values())
    weighted = sum(sub_scores_0_to_1[k] * rubric_weights[k] for k in rubric_weights)
    return round(weighted / total_weight * 100, 2)
