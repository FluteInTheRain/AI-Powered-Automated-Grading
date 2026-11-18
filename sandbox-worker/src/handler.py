"""Pure execution handler for the sandbox Worker (no FastAPI, testable on CPython)."""
from grader.sandbox import compute_reference_outputs, run_submission, run_submission_cases


def execute(payload: dict) -> dict:
    mode = payload["mode"]
    code = payload["code"]
    func_name = payload["func_name"]
    cases = payload["cases"]
    if mode == "run":
        return run_submission(code, func_name, [(tuple(a), e) for a, e in cases])
    if mode == "cases":
        return run_submission_cases(code, func_name, [(tuple(a), e) for a, e in cases])
    if mode == "reference":
        return compute_reference_outputs(code, func_name, [tuple(a) for a in cases])
    raise ValueError(f"unknown mode: {mode!r}")
