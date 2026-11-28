"""Hostile submission suite (T7.1). See docs/sandbox-threat-model.md.

Every attack runs in a throw-away `python3 -I` process (tests/sandbox_hostile/
harness.py) through the real entry points; this module never executes student
code itself. An attack that currently works is an `xfail(strict=True)` so the
gap stays visible; fixing the gap turns the test into a failure until the mark
is removed.
"""
import socket
import threading

import pytest

from tests.sandbox_hostile.harness import CASES, HONEST_WRONG, SECRET, run_hostile
from tests.sandbox_hostile.submissions import ATTACKS


def _params():
    for name, spec in ATTACKS.items():
        for mode in spec["modes"]:
            marks = []
            reason = spec.get("xfail", {}).get(mode)
            if reason:
                marks.append(pytest.mark.xfail(strict=True, reason=reason))
            yield pytest.param(name, mode, marks=marks, id=f"{name}-{mode}")


class Listener:
    """Loopback-only server that records whether student code connected."""

    def __init__(self):
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(5)
        self.srv.settimeout(0.2)
        self.port = self.srv.getsockname()[1]
        self.got = []
        self._stop = False
        self._t = threading.Thread(target=self._loop, daemon=True)
        self._t.start()

    def _loop(self):
        while not self._stop:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                continue
            conn.settimeout(1)
            try:
                self.got.append(conn.recv(100))
            except OSError:
                self.got.append(b"")
            conn.close()

    def close(self):
        self._stop = True
        self._t.join()
        self.srv.close()


def _no_crash(o):
    assert o.report is not None, f"grader process died (exit {o.returncode}, timeout {o.timed_out})"
    assert o.crash is None, f"grader crashed: {o.crash}"


CHECKS = {}


def check(fn):
    CHECKS[fn.__name__] = fn
    return fn


@check
def bounded_no_credit(o, ctx):
    _no_crash(o)
    assert o.pass_count == 0
    assert o.elapsed < 15


@check
def no_credit(o, ctx):
    _no_crash(o)
    assert o.pass_count == 0, f"awarded {o.pass_count} of {len(CASES)} cases"


@check
def reports_in_process(o, ctx):
    _no_crash(o)
    assert o.pass_count == 0


@check
def allocation_refused(o, ctx):
    _no_crash(o)
    assert "MemoryError" in o.text or "limit" in o.text


@check
def small_output(o, ctx):
    _no_crash(o)
    assert o.pass_count == 0
    assert len(o.text) < 20_000, f"{len(o.text)} bytes came back"


@check
def quiet(o, ctx):
    _no_crash(o)
    assert o.stdout_bytes + o.stderr_bytes < 10_000, f"{o.stdout_bytes + o.stderr_bytes} bytes printed"


@check
def no_thread_left(o, ctx):
    _no_crash(o)
    assert o.report["threads"] == 1


@check
def no_secret_leak(o, ctx):
    assert SECRET not in o.text and "CANARY-CONTENT" not in o.text


@check
def no_marker(o, ctx):
    assert not ctx["marker"].exists(), "student code ran a command or wrote outside its sandbox"


@check
def no_connection(o, ctx):
    assert ctx["listener"].got == [], "student code opened a network connection"


@check
def no_crash_no_credit(o, ctx):
    _no_crash(o)
    assert o.pass_count == 0


@check
def reports_or_platform_stop(o, ctx):
    assert (o.report is not None and o.pass_count == 0) or o.stopped_by_platform
    assert o.pass_count == 0


@check
def no_credit_after_poison(o, ctx):
    _no_crash(o)
    assert o.pass_count == 0, "a later honest wrong submission was given credit"


@pytest.mark.parametrize("name,mode", list(_params()))
def test_hostile_submission(name, mode, tmp_path):
    spec = ATTACKS[name]
    canary = tmp_path / "canary.txt"
    canary.write_text("CANARY-CONTENT")
    marker = tmp_path / "marker.txt"
    listener = Listener()
    try:
        fill = lambda s: s.replace("@CANARY@", str(canary)).replace("@MARKER@", str(marker)).replace("@PORT@", str(listener.port))
        code = fill(spec["code"])
        prelude = [fill(spec["prelude"])] if "prelude" in spec else []
        if prelude:  # the attacker goes first, then an honest but wrong student is graded
            code = HONEST_WRONG
        out = run_hostile(tmp_path / "run", mode, code, prelude=prelude,
                          cpu_s=spec.get("cpu_s", 20), wall_s=spec.get("wall_s", 40))
        CHECKS[spec["check"]](out, {"marker": marker, "listener": listener})
    finally:
        listener.close()


# ---- the hardening, proven directly (these are not xfail) ----

def test_time_limit_turns_an_honest_infinite_loop_into_a_failed_case(tmp_path):
    out = run_hostile(tmp_path, "local_run", "def solve(n):\n    while True:\n        pass\n", time_limit=1.0)
    assert out.crash is None and out.pass_count == 0 and not out.stopped_by_platform
    assert any("time limit exceeded" in e for e in out.result["errors"])
    assert out.elapsed < 8


def test_system_exit_is_a_compile_error_on_both_paths(tmp_path):
    code = "import sys\nsys.exit(3)\ndef solve(n):\n    return 1\n"
    local = run_hostile(tmp_path / "a", "local_run", code)
    assert local.result["status"] == "compile_error"
    assert local.result["errors"] == ["COMPILE_ERROR: program exited (SystemExit: 3)"]
    worker = run_hostile(tmp_path / "b", "handler", code)
    assert worker.result["message"] == "COMPILE_ERROR: program exited (SystemExit: 3)"


def test_normal_submission_still_gets_full_credit_on_every_path(tmp_path):
    good = "def solve(n):\n    return {1: 7391, 2: 80123, 3: 40517}[n]\n"
    for mode in ("local_run", "handler", "remote"):
        out = run_hostile(tmp_path / mode, mode, good)
        assert out.crash is None and out.pass_count == len(CASES), mode


def test_long_exception_message_is_clipped_in_the_result(tmp_path):
    out = run_hostile(tmp_path, "local_run", "def solve(n):\n    raise ValueError('A' * 100000)\n")
    assert max(len(e) for e in out.result["errors"]) < 1200
