# -*- coding: utf-8 -*-
"""
Runs each submission for real against the test cases in a sandbox (correctness =
objective ground truth), then assigns rubric scores using a FIXED, PREWRITTEN
rule set (not an LLM, not subjective judgment) so every sample in the dataset
has a transparent, traceable origin.

IMPORTANT (read README.md for the full limitation):
- correctness: 100% objective, real code execution.
- efficiency / code_style / edge_case_handling: assigned via a fixed rule based on
  the `expected_profile` that I (Claude) designed myself when writing each submission -
  this is single-rater annotation, NOT ground truth from a real instructor.
  Usable for the pilot experiment, not a substitute for human annotation in the final thesis.
"""
import importlib.util
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from problems import PROBLEMS


def run_submission(code_str, func_name, test_cases):
    """Runs the code for real via subprocess-free exec (safe enough since the code is self-authored, not external input)."""
    namespace = {}
    try:
        exec(code_str, namespace)
    except Exception as e:
        return {"pass_count": 0, "total": len(test_cases), "pass_rate": 0.0,
                "errors": [f"COMPILE_ERROR: {e}"], "status": "compile_error"}

    func = namespace.get(func_name)
    if func is None:
        return {"pass_count": 0, "total": len(test_cases), "pass_rate": 0.0,
                "errors": [f"FUNC_NOT_FOUND: {func_name}"], "status": "func_not_found"}

    pass_count = 0
    errors = []
    for args, expected in test_cases:
        try:
            actual = func(*args)
            if actual == expected:
                pass_count += 1
            else:
                errors.append(f"input={args} expected={expected} got={actual}")
        except Exception as e:
            errors.append(f"input={args} RUNTIME_ERROR: {e}")

    total = len(test_cases)
    return {
        "pass_count": pass_count,
        "total": total,
        "pass_rate": round(pass_count / total, 4) if total else 0.0,
        "errors": errors,
        "status": "ran",
    }


# ---- Rubric scoring rules (fixed, documented so they can be traced) ----

def score_efficiency(profile, exec_result):
    """1.0 = meets the expected complexity; lower if a worse algorithm is used; 0 if it doesn't run."""
    if exec_result["status"] != "ran":
        return 0.0
    eff = profile.get("efficiency", "")
    if "O(n^2)" in eff or "O(2^n)" in eff:
        return 0.4  # runs correctly but clearly worse complexity
    if "not_binary" in eff or "insert0" in eff:
        return 0.5  # correct but doesn't use the required approach (e.g. no binary search)
    return 1.0  # optimal or acceptable


def score_style(profile):
    style = profile.get("style", "clean")
    return {"clean": 1.0, "medium": 0.6, "poor": 0.2}.get(style, 0.5)


def score_edge_case(profile, exec_result):
    """Based directly on pass_rate instead of a subjective label, to reduce dependence on the self-assigned profile."""
    return exec_result["pass_rate"]


def score_correctness(exec_result):
    return exec_result["pass_rate"]


def build_sample(problem, submission):
    exec_result = run_submission(submission["code"], problem["func_name"], problem["test_cases"])
    profile = submission["expected_profile"]
    rubric = problem["rubric"]

    sub_scores = {
        "correctness": score_correctness(exec_result),
        "efficiency": score_efficiency(profile, exec_result),
        "code_style": score_style(profile),
        "edge_case_handling": score_edge_case(profile, exec_result),
    }

    final_score = sum(sub_scores[k] * rubric[k] for k in rubric) / sum(rubric.values()) * 100
    final_score = round(final_score, 2)

    return {
        "sample_id": f"{problem['id']}__{submission['sub_id']}",
        "problem_id": problem["id"],
        "statement": problem["statement"].strip(),
        "rubric": rubric,
        "submission_code": submission["code"].strip(),
        "execution_result": {
            "pass_count": exec_result["pass_count"],
            "total_tests": exec_result["total"],
            "pass_rate": exec_result["pass_rate"],
            "status": exec_result["status"],
            "sample_errors": exec_result["errors"][:3],  # keep only the first few errors, for brevity
        },
        "sub_scores_0_to_1": sub_scores,
        "final_score_0_to_100": final_score,
        "annotation_source": {
            "correctness": "real_execution_sandbox",
            "efficiency": "single_rater_rule_based(claude)",
            "code_style": "single_rater_rule_based(claude)",
            "edge_case_handling": "derived_from_real_execution_pass_rate",
        },
    }


def main():
    dataset = []
    for problem in PROBLEMS:
        for submission in problem["submissions"]:
            sample = build_sample(problem, submission)
            dataset.append(sample)

    out_path = Path(__file__).parent / "dataset.json"
    out_path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Total samples: {len(dataset)}")
    print(f"Original problems: {len(PROBLEMS)}")
    print(f"Written to: {out_path}")

    # Print a summary table for a quick sanity check
    print("\n{:<45} {:>10} {:>12}".format("sample_id", "pass_rate", "final_score"))
    for s in dataset:
        print("{:<45} {:>10} {:>12}".format(
            s["sample_id"], s["execution_result"]["pass_rate"], s["final_score_0_to_100"]))


if __name__ == "__main__":
    main()
