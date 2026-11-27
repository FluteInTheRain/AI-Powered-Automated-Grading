from pathlib import Path

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


def _text(name: str) -> str:
    return (PROMPTS / f"{name}.txt").read_text(encoding="utf-8")


def test_code_style_prompt_says_comments_are_optional():
    t = _text("code_style").lower()
    assert "comments" in t and "optional" in t
    assert "{submission_code}" in t


def test_code_style_prompt_still_formats():
    # No stray braces: str.format must work with just the one placeholder.
    assert "x = 1" in _text("code_style").format(submission_code="x = 1")


def test_feedback_prompt_does_not_ask_for_comments():
    t = _text("feedback").lower()
    assert "comment" in t and ("do not" in t or "don't" in t)


def test_efficiency_prompt_asks_for_expected_complexity_and_ignores_bugs():
    t = _text("efficiency").lower()
    assert "expected_complexity" in t and "observed_pattern" in t
    # A buggy but logarithmic search must not lose efficiency credit for its bug.
    assert "bug" in t and "correctness" in t


def test_efficiency_prompt_still_formats():
    out = _text("efficiency").format(statement="ST", submission_code="x = 1")
    assert "ST" in out and "x = 1" in out
