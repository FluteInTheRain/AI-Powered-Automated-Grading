"""Parent side: run one hostile submission in a throw-away `python3 -I` process
with a temp working directory, CPU / file-size limits and a wall timeout."""
import json
import os
import resource
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DRIVER = Path(__file__).with_name("driver.py")
SECRET = "SECRET-ENV-4f9c1e"

# A small problem whose expected values cannot be guessed.
FUNC = "solve"
CASES = [[[1], 7391], [[2], 80123], [[3], 40517]]
HONEST_WRONG = "def solve(n):\n    return 0\n"


@dataclass
class Outcome:
    mode: str
    returncode: Optional[int]
    timed_out: bool
    report: Optional[dict]      # what the driver wrote; None if the process died first
    stdout_bytes: int
    stderr_bytes: int
    elapsed: float

    @property
    def result(self):
        return (self.report or {}).get("result")

    @property
    def crash(self):
        return (self.report or {}).get("crash")

    @property
    def text(self) -> str:
        return json.dumps(self.report, default=repr) if self.report else ""

    @property
    def pass_count(self) -> int:
        """Credit given. The handler mode returns outputs only, so compare here (as the main Worker does)."""
        res = self.result
        if not isinstance(res, dict):
            return 0
        if self.mode == "handler":
            if res.get("status") != "ran":
                return 0
            return sum(1 for c, (_, exp) in zip(res["cases"], CASES) if c["error"] is None and c["output"] == exp)
        return res.get("pass_count", 0)

    @property
    def stopped_by_platform(self) -> bool:
        """The process was killed by a limit, or the remote call reported a killed sandbox."""
        killed_remote = bool(self.crash) and self.crash.startswith(("RuntimeError", "SandboxKilled", "SandboxError"))
        return self.timed_out or (self.returncode is not None and self.returncode < 0) or killed_remote


def _limits(cpu_s: int):
    def apply():
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return apply


def run_hostile(tmp: Path, mode: str, code: str, *, prelude=(), time_limit: float = 1.0,
                cpu_s: int = 20, wall_s: int = 40) -> Outcome:
    tmp.mkdir(parents=True, exist_ok=True)
    cwd = tmp / "cwd"
    cwd.mkdir(exist_ok=True)
    cases = [[a, None if mode == "handler" else e] for a, e in CASES]  # the handler never sees expected
    job = {"mode": mode, "code": code, "func_name": FUNC, "cases": cases,
           "prelude": list(prelude), "time_limit": time_limit}
    job_path, out_path = tmp / "job.json", tmp / "out.json"
    job_path.write_text(json.dumps(job))
    out_f, err_f = open(tmp / "stdout.txt", "wb"), open(tmp / "stderr.txt", "wb")
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "FAKE_SECRET": SECRET}
    start = time.monotonic()
    proc = subprocess.Popen([sys.executable, "-I", str(DRIVER), str(job_path), str(out_path)], cwd=cwd, env=env,
                            stdin=subprocess.DEVNULL, stdout=out_f, stderr=err_f, preexec_fn=_limits(cpu_s),
                            start_new_session=True)
    timed_out = False
    try:
        proc.wait(timeout=wall_s)
    except subprocess.TimeoutExpired:
        timed_out = True
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # also reaps any child the student started
        except ProcessLookupError:
            pass
        proc.wait()
        out_f.close()
        err_f.close()
    report = None
    if out_path.exists():
        try:
            report = json.loads(out_path.read_text())
        except ValueError:
            report = None
    return Outcome(mode, proc.returncode, timed_out, report, (tmp / "stdout.txt").stat().st_size,
                   (tmp / "stderr.txt").stat().st_size, time.monotonic() - start)
