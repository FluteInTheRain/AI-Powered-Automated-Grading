# -*- coding: utf-8 -*-
"""Shared by tests/test_golden_*.py and scripts/update_golden.py, so the test and
the regeneration script can never disagree about how a prompt is rendered or how
a replay is run. No LLM and no network anywhere in here."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for _p in (ROOT / "src", ROOT):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from grader.feedback import generate_feedback  # noqa: E402
from grader.pipeline import grade  # noqa: E402
from grader.rubric_checks import check_code_style, check_edge_case_handling, check_efficiency  # noqa: E402

GOLDEN_DIR = ROOT / "tests" / "golden"
PROMPTS_GOLDEN = GOLDEN_DIR / "prompts.json"
REPLAY_GOLDEN = GOLDEN_DIR / "replay_set.json"
PROMPTS_DIR = ROOT / "prompts"

# Fixed inputs the prompts are rendered with. The second one has braces, a
# non-ASCII character and a trailing blank line on purpose: those are what breaks
# str.format() or changes whitespace when someone edits a template.
PROMPT_INPUTS = {
    "plain": {
        "statement": "Write sum_even(nums) that returns the sum of the even numbers in nums.",
        "submission_code": "def sum_even(nums):\n    return sum(n for n in nums if n % 2 == 0)\n",
    },
    "awkward": {
        "statement": "Return {\"count\": k} for the string s (é counts as one letter).",
        "submission_code": "def f(s):\n    d = {}\n    for c in s:\n        d[c] = d.get(c, 0) + 1\n    return d\n\n",
    },
}
RUBRIC = {"correctness": 60, "efficiency": 15, "code_style": 15, "edge_case_handling": 10}
EDGE_WEIGHT = RUBRIC["edge_case_handling"]


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class CapturingClient:
    """Stands in for LLMClient. Records every prompt it is sent and answers from
    `responses` (schema name -> JSON-able dict). With no responses it returns the
    schema's minimal valid object, which is enough when only the prompt matters."""

    def __init__(self, responses: dict | None = None):
        self.responses = responses
        self.calls: list[dict] = []

    def structured_call(self, system_prompt, user_prompt, schema):
        name = schema.__name__
        self.calls.append({"schema": name, "system": system_prompt, "user": user_prompt})
        if self.responses is not None:
            if name not in self.responses:
                raise AssertionError(f"pipeline called {name} but the golden record has no response for it")
            payload = self.responses[name]
        else:
            payload = _MINIMAL[name]
        return schema.model_validate(payload)


_MINIMAL = {
    "EfficiencyCheck": {"expected_complexity": "O(n)", "observed_pattern": "O(n)", "meets_expected_complexity": True},
    "StyleCheck": {"level": "clean"},
    "EdgeCaseCheck": {"handled": True, "missing_cases": []},
    "CodeFeedback": {"summary": "ok", "issues": []},
}


def render_prompts() -> dict:
    """Every prompt file, rendered through the real code path where one exists."""
    out = {}
    for name in sorted(p.stem for p in PROMPTS_DIR.glob("*.txt")):
        template = (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")
        renders = {}
        for label, inp in PROMPT_INPUTS.items():
            st, code = inp["statement"], inp["submission_code"]
            c = CapturingClient()
            if name == "efficiency":
                check_efficiency(c, st, code)
            elif name == "code_style":
                check_code_style(c, code)
            elif name == "edge_case_handling":
                check_edge_case_handling(c, st, code, EDGE_WEIGHT)
            elif name == "feedback":
                generate_feedback(
                    c, st, code,
                    {"pass_count": 1, "total": 2, "pass_rate": 0.5, "errors": ["x"], "status": "ran"},
                    {"correctness": 0.5, "efficiency": 1.0, "code_style": 0.6, "edge_case_handling": 1.0},
                )
            elif name == "free_form_holistic":
                # same call shape as experiments/ablation.py
                text = template.format(statement=st, rubric=json.dumps(RUBRIC), submission_code=code)
                renders[label] = {"system": None, "user": text, "user_sha256": sha256(text)}
                continue
            elif name == "free_form_non_correctness":
                text = template.format(statement=st, submission_code=code)
                renders[label] = {"system": None, "user": text, "user_sha256": sha256(text)}
                continue
            else:
                raise AssertionError(
                    f"prompts/{name}.txt has no rendering recipe in tests/golden/golden_support.py "
                    "(render_prompts). Add one so the new prompt is covered by the snapshot."
                )
            call = c.calls[0]
            renders[label] = {"system": call["system"], "user": call["user"], "user_sha256": sha256(call["user"])}
        out[name] = {"template_sha256": sha256(template), "renders": renders}
    return out


def load_replay() -> dict:
    return json.loads(REPLAY_GOLDEN.read_text(encoding="utf-8"))


def replay_one(case: dict) -> dict:
    """Grades one frozen submission through the real pipeline with a client that
    answers from the recorded JSON. Returns what the pipeline produced."""
    inp = case["input"]
    client = CapturingClient(case["recorded_responses"])
    sample = {
        "statement": inp["statement"],
        "submission_code": inp["submission_code"],
        "func_name": inp["func_name"],
        "test_cases": [(tuple(args), expected) for args, expected in inp["test_cases"]],
        "rubric": inp["rubric"],
    }
    result = grade(sample, client)
    return {
        "sub_scores_0_to_1": result["sub_scores_0_to_1"],
        "final_score_0_to_100": result["final_score_0_to_100"],
        "sandbox_status": result["execution_result"]["status"],
        "sandbox_pass_count": result["execution_result"]["pass_count"],
        "llm_calls": [c["schema"] for c in client.calls],
    }
