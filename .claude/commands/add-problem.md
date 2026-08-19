---
description: Scaffold a new problem entry in data/problems.py from a short spec
---

The user's spec: $ARGUMENTS

Add one new entry to the `PROBLEMS` list in `data/problems.py`, following the
exact shape of the existing entries (id, statement, func_name, rubric summing
to 100, test_cases with at least 5-6 cases covering edge cases, submissions:
1 clean-correct, 1 correct-but-poor-efficiency/style, 2-3 with distinct
injected bugs, each with an `expected_profile`). Everything in English.

Then run `python3 data/build_dataset.py` to regenerate `data/dataset.json`
and confirm the new samples appear in its summary table output. Do not
hand-edit dataset.json.
