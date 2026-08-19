---
description: Run the free-form vs hybrid vs hybrid+decomposed ablation and report agreement
---

Run `python3 experiments/ablation.py` (wiring up any TODO arms first if the
user has specified which arms to compare, e.g. "$ARGUMENTS").

Report only: Spearman rho per arm vs. the dataset's rule-based labels, and
which arm had the best exact-match consistency (cross-reference prior
`results/consistency_*.json` files if present). Remind the reader, briefly,
that agreement is against single-rater labels for efficiency/code_style —
not a human-agreement claim (see CLAUDE.md).
