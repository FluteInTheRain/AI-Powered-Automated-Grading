"""Pure execution handler for the sandbox Worker (no FastAPI, testable on CPython).

Outputs-only: expected values never enter this process (R4), because exec'd
code could read them from the caller's frame.
"""
import json

from grader.sandbox import compute_reference_outputs


class BadPayload(ValueError):
    """The request payload does not match the documented shape."""


def validate(payload) -> tuple:
    if not isinstance(payload, dict):
        raise BadPayload("payload must be an object")
    code, func_name, args_list = (payload.get(k) for k in ("code", "func_name", "args_list"))
    if not isinstance(code, str):
        raise BadPayload("code must be a string")
    if not isinstance(func_name, str):
        raise BadPayload("func_name must be a string")
    if not isinstance(args_list, list) or not all(isinstance(a, list) for a in args_list):
        raise BadPayload("args_list must be a list of lists")
    return code, func_name, [tuple(a) for a in args_list]


def _safe_repr(value) -> str:
    try:
        return repr(value)[:200]
    except Exception:
        return "<unrepresentable>"


def _json_safe(case: dict) -> dict:
    # Student code controls the return value; make sure it can be JSON-encoded.
    try:
        json.dumps(case["output"], allow_nan=False)
    except Exception:
        return {**case, "output": None,
                "error": f"return value is not JSON-serializable: {_safe_repr(case['output'])}"}
    return case


def execute(payload) -> dict:
    code, func_name, args_list = validate(payload)
    result = compute_reference_outputs(code, func_name, args_list)
    return {**result, "cases": [_json_safe(c) for c in result["cases"]]}
