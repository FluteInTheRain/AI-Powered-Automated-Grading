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
