"""Pure execution handler for the sandbox Worker (no FastAPI, testable on CPython).

Outputs-only: expected values never enter this process (R4), because exec'd
code could read them from the caller's frame.
"""
import json

from grader.sandbox import compute_reference_outputs

# Largest JSON-encoded return value sent back per case (64 KB).
MAX_OUTPUT_BYTES = 64 * 1024


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


def _safe_str(value) -> str:
    try:
        return str(value)[:200]
    except Exception:
        return "<unprintable>"


def _json_safe(case: dict) -> dict:
    # Student code controls the return value; make sure it can be JSON-encoded
    # and is not big enough to bloat the response.
    try:
        encoded = json.dumps(case["output"], allow_nan=False)
    except Exception:
        return {**case, "output": None,
                "error": f"return value is not JSON-serializable: {_safe_repr(case['output'])}"}
    size = len(encoded.encode("utf-8"))
    if size > MAX_OUTPUT_BYTES:
        return {**case, "output": None, "error": f"return value too large ({size} bytes)"}
    return case


def _is_runtime_signal(e: BaseException) -> bool:
    """True for exceptions the Workers runtime raises into running code to stop it.

    Live, the CPU-limit kill arrives as `_cloudflare.introspection...CpuLimitExceeded`
    raised inside student code. Swallowing it would turn a killed request into a
    normal answer, so it must propagate. KeyboardInterrupt and GeneratorExit are
    not re-raised: the runtime does not use them here, and student code could
    raise them to crash the sandbox.
    """
    return any(cls.__module__.startswith("_cloudflare") or cls.__name__ == "CpuLimitExceeded"
               for cls in type(e).__mro__)


def execute(payload) -> dict:
    code, func_name, args_list = validate(payload)
    try:
        result = compute_reference_outputs(code, func_name, args_list)
    except BaseException as e:
        # grader.sandbox catches Exception only; exit(), sys.exit() and any other
        # BaseException from student code would otherwise crash this Worker.
        if _is_runtime_signal(e):
            raise
        return {"status": "compile_error", "cases": [],
                "message": f"COMPILE_ERROR: program exited ({type(e).__name__}: {_safe_str(e)})"}
    return {**result, "cases": [_json_safe(c) for c in result["cases"]]}
