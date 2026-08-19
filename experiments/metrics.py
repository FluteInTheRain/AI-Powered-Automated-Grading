# -*- coding: utf-8 -*-
"""Metrics for the two thesis claims: exact-match consistency, and agreement
with (rule-based, single-rater — see data/script.md caveat) labels."""
from __future__ import annotations

from collections import Counter
from typing import List, Sequence

from scipy.stats import spearmanr


def exact_match_consistency_rate(scores: Sequence[float]) -> dict:
    """Fraction of runs whose score equals the modal score. 100 identical
    runs -> rate = 1.0. This is the headline determinism metric."""
    counts = Counter(scores)
    modal_count = counts.most_common(1)[0][1]
    return {
        "n_runs": len(scores),
        "n_unique_scores": len(counts),
        "modal_score": counts.most_common(1)[0][0],
        "exact_match_rate": modal_count / len(scores),
        "distribution": dict(counts),
    }


def spearman_agreement(predicted: Sequence[float], reference: Sequence[float]) -> dict:
    rho, p_value = spearmanr(predicted, reference)
    return {"spearman_rho": rho, "p_value": p_value, "n": len(predicted)}
