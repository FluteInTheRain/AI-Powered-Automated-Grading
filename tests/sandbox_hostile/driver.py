"""Runs ONE hostile submission in a throw-away process (started by harness.py).

Usage: python3 -I driver.py JOB.json OUT.json
Never import this module from the pytest process: it executes untrusted code.
"""
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for p in (ROOT / "worker" / "src", ROOT / "sandbox-worker" / "src", ROOT / "src"):
    sys.path.insert(0, str(p))

job = json.loads(Path(sys.argv[1]).read_text())
out_path = sys.argv[2]
mode = job["mode"]

import grader.sandbox as gs  # noqa: E402

if job.get("time_limit"):
    gs.TIME_LIMIT_S = float(job["time_limit"])

WORKER_MAIN = str(Path(__file__).with_name("worker_main.py"))


class _Resp:
    def __init__(self, status, text):
        self.status, self._text = status, text

    def text(self):
        return self._text


class SubprocessBinding:
    """Stand-in for the SANDBOX service binding: every fetch runs the sandbox
    handler in a fresh process, so the caller's memory (expected values) is not
    reachable from the student code, as with two Workers."""

    def fetch(self, url, method="POST", headers=None, body=""):
        res_path = out_path + ".worker"
        env = dict(os.environ)
        env["HOSTILE_TIME_LIMIT"] = str(job.get("time_limit") or "")
        try:
            proc = subprocess.run([sys.executable, "-I", WORKER_MAIN, res_path], input=body, text=True,
                                  timeout=60, env=env)
        except subprocess.TimeoutExpired as e:
            raise RuntimeError("worker cancelled (wall timeout)") from e
        if proc.returncode != 0 or not os.path.exists(res_path):
            raise RuntimeError(f"worker cancelled (exit {proc.returncode})")
        return _Resp(*json.loads(Path(res_path).read_text()))


def run(code):
    cases = job["cases"]
    func = job["func_name"]
    if mode == "local_run":
        return gs.run_submission(code, func, [(tuple(a), e) for a, e in cases])
    if mode == "handler":
        import handler
        return handler.execute({"code": code, "func_name": func, "args_list": [a for a, _ in cases]})
    if mode == "remote":
        from app.bridges import RemoteSandbox
        box = RemoteSandbox(SubprocessBinding(), run_sync=lambda x: x)
        return box.run_submission(code, func, [(tuple(a), e) for a, e in cases])
    raise SystemExit(f"unknown mode {mode}")


report = {"result": None, "crash": None, "threads": None}
try:
    for pre in job.get("prelude", []):
        run(pre)
    report["result"] = run(job["code"])
except BaseException as e:  # a crash of the grader: record it, never hide it
    report["crash"] = f"{type(e).__name__}: {str(e)[:200]}"
report["threads"] = threading.active_count()
Path(out_path).write_text(json.dumps(report, default=repr))
sys.stdout.flush()
sys.stderr.flush()
os._exit(0)
