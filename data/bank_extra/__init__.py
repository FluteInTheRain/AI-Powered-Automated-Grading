# -*- coding: utf-8 -*-
"""Extra bank problems (P17 onward) for the teacher app's question bank.

Kept apart from data/problems.py on purpose: problems.py also feeds data/dataset.json and the
ablation experiment, so adding problems there would change the thesis numbers. Problems here
only reach the bank seed (scripts/export_bank_seed.py) and the coverage checker.

Each problem is a dict with the same keys as data/problems.py minus "submissions", plus
"reference_solution" (a correct, clean solution as a code string):

    {
        "id": "P17_snake_name",            # P<NN>_<snake_case>, unique, NN from your assigned range
        "title": "...",                    # 1..80 chars
        "category": "...",                 # 1..40 chars
        "difficulty": "easy" | "medium" | "hard",
        "statement": "...",                # English, original wording, names func_name and its parameters
        "func_name": "...",
        "rubric": {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10},
        "reference_solution": "def ...",
        "test_cases": [((arg1, arg2), expected), ...],   # 8 or more
    }
"""
from . import arrays, basics, math_dp, strings, structures

BANK_EXTRA = [*strings.PROBLEMS, *arrays.PROBLEMS, *math_dp.PROBLEMS, *structures.PROBLEMS, *basics.PROBLEMS]
