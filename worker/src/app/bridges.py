"""Adapters that let the synchronous grader run inside a Cloudflare Python Worker.

`env.AI` and `env.SANDBOX` are async; `pyodide.ffi.run_sync` turns their
awaitables into plain values. The Workers SDK wraps both bindings (workers.rpc):
results already arrive as Python objects, and the service binding's fetch takes
keyword arguments. Tests inject fakes and `run_sync=lambda x: x`.
"""
from __future__ import annotations

import json
import sys
from typing import Any, List, Tuple, Type, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

SANDBOX_URL = "https://sandbox/execute"
# Workers AI caps output at 256 tokens unless max_tokens is set, which cuts the
# feedback JSON mid-string. 2048 leaves room for long feedback on 300-line code.
MAX_TOKENS = 2048


def _default_run_sync():
    from pyodide.ffi import run_sync  # lazy: only exists under Pyodide
    return run_sync


def _to_js(obj):
    """Convert a dict for the JS side; a no-op outside Pyodide."""
    if "pyodide" not in sys.modules:
        return obj
    import js
    from pyodide.ffi import to_js
    return to_js(obj, dict_converter=js.Object.fromEntries)


def _to_py(value):
    """Convert a JS-backed proxy to Python; plain values pass through."""
    to_py = getattr(value, "to_py", None)
    return to_py() if callable(to_py) else value


class WorkersAIClient:
    """Same interface and call_log keys as grader.llm_client.LLMClient."""

    def __init__(self, ai_binding, model: str, seed: int = 1, run_sync=None):
        self.ai = ai_binding
        self.model = model
        self.seed = seed
        self._run_sync = run_sync or _default_run_sync()
        self.call_log: list[dict] = []

    def structured_call(self, system_prompt: str, user_prompt: str, schema: Type[T]) -> T:
        payload = {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
            "seed": self.seed,
            "max_tokens": MAX_TOKENS,
            # Workers AI reads json_schema as the bare schema itself.
            "response_format": {"type": "json_schema", "json_schema": schema.model_json_schema()},
        }
        result = _to_py(self._run_sync(self.ai.run(self.model, _to_js(payload))))
        content = result.get("response") if isinstance(result, dict) else getattr(result, "response", None)
        content = _to_py(content)
        if content is None or content == "":
            raise RuntimeError(f"{self.model}: empty response from Workers AI")
        raw = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
        self.call_log.append({
            "kind": "structured",
            "schema": schema.__name__,
            "model": self.model,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "raw_response": raw,
        })
        return schema.model_validate(json.loads(raw))


def _post_json(binding, url: str, payload: dict, run_sync) -> Tuple[int, str]:
    """The only JS-facing call of the sandbox bridge.

    The Python Workers SDK wraps service bindings in env (workers.rpc._FetcherWrapper):
    fetch(url, **init) takes the init fields as keyword arguments and returns a
    pyodide FetchResponse (.status, async .text()).
    """
    resp = run_sync(binding.fetch(url, method="POST",
                                  headers={"content-type": "application/json"},
                                  body=json.dumps(payload)))
    text = run_sync(resp.text())
    return resp.status, text


class RemoteSandbox:
    """Drop-in for grader.sandbox, backed by the sandbox Worker (outputs only)."""

    def __init__(self, sandbox_binding, run_sync=None):
        self.binding = sandbox_binding
        self._run_sync = run_sync or _default_run_sync()

    def _execute(self, code: str, func_name: str, args_list: List[tuple]) -> dict:
        payload = {"code": code, "func_name": func_name, "args_list": [list(a) for a in args_list]}
        status, text = _post_json(self.binding, SANDBOX_URL, payload, self._run_sync)
        if status != 200:
            raise RuntimeError(f"sandbox failed: {status}")
        return json.loads(text)

    @staticmethod
    def _check_len(res: dict, inputs) -> None:
        if len(res["cases"]) != len(inputs):
            raise RuntimeError(f"sandbox returned {len(res['cases'])} cases for {len(inputs)} inputs")

    def _run_compared(self, code: str, func_name: str, test_cases: List[Tuple[tuple, Any]]) -> dict:
        # Expected values stay here (R4); only args go to the sandbox.
        res = self._execute(code, func_name, [args for args, _ in test_cases])
        if res["status"] != "ran":
            return {"status": res["status"], "message": res["message"], "cases": []}
        self._check_len(res, test_cases)
        cases = []
        for (args, expected), c in zip(test_cases, res["cases"]):
            # JSON round trip on expected is intended (R4): a tuple expected equals a list output.
            passed = c["error"] is None and c["output"] == json.loads(json.dumps(expected))
            cases.append({"passed": passed, "args": args, "expected": expected,
                          "actual": c["output"], "error": c["error"]})
        return {"status": "ran", "message": None, "cases": cases}

    def run_submission_cases(self, code_str: str, func_name: str, test_cases) -> dict:
        return self._run_compared(code_str, func_name, test_cases)

    def run_submission(self, code_str: str, func_name: str, test_cases) -> dict:
        total = len(test_cases)
        res = self._run_compared(code_str, func_name, test_cases)
        if res["status"] != "ran":
            return {"pass_count": 0, "total": total, "pass_rate": 0.0,
                    "errors": [res["message"]], "status": res["status"]}
        pass_count = 0
        errors = []
        for c in res["cases"]:
            if c["passed"]:
                pass_count += 1
            elif c["error"] is not None:
                errors.append(f"input={c['args']} RUNTIME_ERROR: {c['error']}")
            else:
                errors.append(f"input={c['args']} expected={c['expected']} got={c['actual']}")
        return {"pass_count": pass_count, "total": total,
                "pass_rate": round(pass_count / total, 4) if total else 0.0,
                "errors": errors, "status": "ran"}

    def compute_reference_outputs(self, code_str: str, func_name: str, args_list) -> dict:
        res = self._execute(code_str, func_name, args_list)
        if res["status"] != "ran":
            return {"status": res["status"], "message": res["message"], "cases": []}
        self._check_len(res, args_list)
        return {"status": "ran", "message": None,
                "cases": [{"args": a, "output": c["output"], "error": c["error"]}
                          for a, c in zip(args_list, res["cases"])]}
