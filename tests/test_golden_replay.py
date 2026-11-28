"""Replay: frozen submissions graded through the real pipeline (real sandbox, real
schemas, real scoring) with RECORDED LLM answers. The recorded answers are hand
authored, not model output (see tests/golden/replay_set.json), so this locks the
code around the model: parsing, formulas, weights, zero-credit rules. It cannot
tell how the model itself behaves. No token needed."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "golden"))
import golden_support as g  # noqa: E402

CASES = g.load_replay()["cases"]

HOW_TO_FIX = (
    "\n\nA graded number moved. If you changed a weight, a scoring formula, a schema or the "
    "zero-credit rule on purpose:\n"
    "  1. Check the new numbers by hand against the rubric (docs/golden-regression.md).\n"
    "  2. Regenerate:  python3 scripts/update_golden.py\n"
    "  3. Review  git diff tests/golden/replay_set.json  and commit it with the change.\n"
    "If you did not mean to change grading, this is a regression: fix the code, not the golden file.\n"
    "If a schema change made a recorded response invalid, edit that response by hand (it is hand authored)."
)


def test_golden_set_has_the_expected_spread():
    ids = {c["id"] for c in CASES}
    assert len(CASES) >= 12
    assert {"blank_submission", "wrong_completely_zero_credit", "correct_clean"} <= ids
    assert all(c["expected"] is not None for c in CASES), "expected is empty: run python3 scripts/update_golden.py"


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_replay_matches_golden(case):
    got = g.replay_one(case)
    exp = case["expected"]
    assert got["sub_scores_0_to_1"] == exp["sub_scores_0_to_1"], (
        f"{case['id']}: sub scores {got['sub_scores_0_to_1']} != golden {exp['sub_scores_0_to_1']}" + HOW_TO_FIX
    )
    assert got["final_score_0_to_100"] == exp["final_score_0_to_100"], (
        f"{case['id']}: final score {got['final_score_0_to_100']} != golden {exp['final_score_0_to_100']}" + HOW_TO_FIX
    )
    assert got == exp, f"{case['id']}: {got} != {exp}" + HOW_TO_FIX
