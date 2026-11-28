"""Prompt snapshot: any change to a prompt file or to how it is rendered must show
up as a reviewed diff in tests/golden/prompts.json. Needs no model and no token."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "golden"))
import golden_support as g  # noqa: E402

HOW_TO_FIX = (
    "\n\nA prompt (or how it is rendered) changed. Prompts decide the scores, so a change "
    "must be deliberate:\n"
    "  1. Read the diff:  git diff prompts/ src/grader/\n"
    "  2. If the change is intended, regenerate:  python3 scripts/update_golden.py\n"
    "  3. Review  git diff tests/golden/prompts.json  and commit it with the prompt change.\n"
    "  4. Bump CANARY_INPUT_VERSION in app-worker/src/canary.ts so the daily determinism "
    "canary starts a new baseline.\n"
    "See docs/golden-regression.md."
)

_GOLDEN = json.loads(g.PROMPTS_GOLDEN.read_text(encoding="utf-8"))["prompts"]
_NOW = g.render_prompts()


def test_golden_covers_exactly_the_prompt_files():
    assert sorted(_NOW) == sorted(_GOLDEN), (
        f"prompts/*.txt files differ from the golden set: now {sorted(_NOW)}, golden {sorted(_GOLDEN)}." + HOW_TO_FIX
    )


def test_every_prompt_template_hash_matches():
    for name, now in _NOW.items():
        gold = _GOLDEN.get(name)
        assert gold and now["template_sha256"] == gold["template_sha256"], (
            f"prompts/{name}.txt changed (sha256 {now['template_sha256'][:12]} != golden "
            f"{(gold or {}).get('template_sha256', 'missing')[:12]})." + HOW_TO_FIX
        )


def test_every_rendered_prompt_matches():
    for name, now in _NOW.items():
        for label, render in now["renders"].items():
            gold = _GOLDEN[name]["renders"][label]
            assert render["system"] == gold["system"], (
                f"System prompt for {name} [{label}] changed:\n  now:    {render['system']!r}\n"
                f"  golden: {gold['system']!r}" + HOW_TO_FIX
            )
            assert render["user"] == gold["user"], (
                f"Rendered text of {name} [{label}] changed (rendering code or template).\n"
                f"--- golden\n{gold['user']}\n--- now\n{render['user']}" + HOW_TO_FIX
            )
            assert render["user_sha256"] == gold["user_sha256"]
