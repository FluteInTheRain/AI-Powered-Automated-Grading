"""Hostile and abusive student submissions (test data).

Each entry: code (with @CANARY@, @MARKER@, @PORT@ placeholders filled by the
test), the check that defines the secure outcome, and which entry points to run.
Entry points: local_run = grader.sandbox.run_submission in one process (what
server/ and experiments/ use); handler = sandbox-worker/src/handler.py; remote =
RemoteSandbox against the handler in a separate process (the production shape).
`xfail` maps an entry point to the reason the attack currently succeeds.
"""
ALL = ("local_run", "handler", "remote")
IN_PROCESS = ("local_run", "handler")

NO_ENV = "os.environ is readable; the process holds the secret"

ATTACKS = {
    # ---- resource abuse ----
    "infinite_loop_toplevel": dict(
        code="while True:\n    pass\ndef solve(n):\n    return 1\n",
        check="bounded_no_credit", modes=ALL),
    "infinite_loop_in_function": dict(
        code="def solve(n):\n    while True:\n        pass\n",
        check="bounded_no_credit", modes=ALL),
    "sleep_forever": dict(
        code="import time\ndef solve(n):\n    time.sleep(10**6)\n",
        check="bounded_no_credit", modes=ALL),
    "infinite_loop_swallows_timeout": dict(
        code="def solve(n):\n    while True:\n        try:\n            while True:\n                pass\n"
             "        except BaseException:\n            pass\n",
        check="reports_in_process", modes=IN_PROCESS, cpu_s=4, wall_s=15,
        xfail={m: "a bare 'except BaseException' in a loop swallows the SIGALRM limit; only the platform CPU kill "
                  "(or a subprocess) can stop it" for m in IN_PROCESS}),
    "huge_allocation_rejected": dict(
        code="def solve(n):\n    return len(bytes(2 ** 62))\n",
        check="bounded_no_credit", modes=ALL),
    "large_allocation_allowed": dict(
        code="def solve(n):\n    return len(bytearray(300 * 1024 * 1024))\n",
        check="allocation_refused", modes=IN_PROCESS,
        xfail={m: "no memory cap in code; live, the Workers 128 MB isolate limit is the only guard" for m in IN_PROCESS}),
    "huge_return_value": dict(
        code="def solve(n):\n    return 'x' * (100 * 1024 * 1024)\n",
        check="small_output", modes=ALL),
    "deeply_nested_return_value": dict(
        code="def solve(n):\n    a = []\n    for _ in range(100000):\n        a = [a]\n    return a\n",
        check="bounded_no_credit", modes=ALL),
    "huge_exception_message": dict(
        code="def solve(n):\n    raise ValueError('A' * (20 * 1024 * 1024))\n",
        check="small_output", modes=ALL),
    "stdout_flood": dict(
        code="def solve(n):\n    for _ in range(5000):\n        print('A' * 1000)\n    return 0\n",
        check="quiet", modes=ALL,
        xfail={"local_run": "run_submission does not capture print(); only the sandbox handler does"}),
    "stdout_flood_bypasses_redirect": dict(
        code="import sys\ndef solve(n):\n    for _ in range(5000):\n        sys.__stdout__.write('A' * 1000)\n    return 0\n",
        check="quiet", modes=("handler",),
        xfail={"handler": "sys.__stdout__ and os.write(1, ...) bypass the redirect; no fix in-process"}),
    "deep_recursion": dict(
        code="def solve(n):\n    return solve(n + 1)\n",
        check="bounded_no_credit", modes=ALL),
    "background_thread": dict(
        code="import threading, time\ndef solve(n):\n    threading.Thread(target=time.sleep, args=(10**6,), daemon=True).start()\n"
             "    return 0\n",
        check="no_thread_left", modes=IN_PROCESS,
        xfail={m: "a thread started by student code outlives the call and the warm isolate keeps it" for m in IN_PROCESS}),
    # ---- reading the environment, files, network, processes ----
    "read_env_secret": dict(
        code="import os\ndef solve(n):\n    return os.environ.get('FAKE_SECRET')\n",
        check="no_secret_leak", modes=ALL, xfail={m: NO_ENV for m in ALL}),
    "read_file_outside": dict(
        code="def solve(n):\n    return open('@CANARY@').read()\n",
        check="no_secret_leak", modes=ALL, xfail={m: "open() is unrestricted" for m in ALL}),
    "write_file_outside": dict(
        code="def solve(n):\n    open('@MARKER@', 'w').write('x')\n    return 0\n",
        check="no_marker", modes=ALL, xfail={m: "open() is unrestricted" for m in ALL}),
    "network_connect": dict(
        code="import socket\ndef solve(n):\n    s = socket.create_connection(('127.0.0.1', @PORT@), 3)\n"
             "    s.sendall(b'exfil')\n    s.close()\n    return 0\n",
        check="no_connection", modes=ALL,
        xfail={m: "sockets are open; the Free plan has no egress control (accepted risk 2)" for m in ALL}),
    "import_subprocess": dict(
        code="import subprocess\ndef solve(n):\n    subprocess.run(['touch', '@MARKER@'])\n    return 0\n",
        check="no_marker", modes=ALL, xfail={m: "subprocess can be imported and run" for m in ALL}),
    "import_os_system": dict(
        code="import os\ndef solve(n):\n    os.system('touch @MARKER@')\n    return 0\n",
        check="no_marker", modes=ALL, xfail={m: "os.system can be imported and run" for m in ALL}),
    "dunder_import_builtins": dict(
        code="def solve(n):\n    (__builtins__['__import__'] if isinstance(__builtins__, dict) else __builtins__.__import__)('o' + 's').system('touch @MARKER@')\n    return 0\n",
        check="no_marker", modes=ALL, xfail={m: "__import__ and builtins are reachable by name" for m in ALL}),
    # ---- tampering with the harness or the expected values ----
    "frame_walk_reads_expected": dict(
        code="import sys\ndef solve(n):\n    f = sys._getframe(1)\n    while f:\n        tc = f.f_locals.get('test_cases')\n"
             "        if tc:\n            for args, exp in tc:\n                if args == (n,):\n                    return exp\n"
             "        f = f.f_back\n    return -1\n",
        check="no_credit", modes=ALL,
        xfail={"local_run": "expected values are in the caller's frame; only the remote split removes them"}),
    "gc_walk_reads_expected": dict(
        code="import gc\ndef solve(n):\n    for o in gc.get_objects():\n        if isinstance(o, list) and o and "
             "all(isinstance(t, tuple) and len(t) == 2 for t in o):\n            for args, exp in o:\n"
             "                if args == (n,) and exp is not None:\n                    return exp\n    return -1\n",
        check="no_credit", modes=ALL,
        xfail={"local_run": "gc.get_objects() finds the test case list in the same process"}),
    "always_equal_result": dict(
        code="class Eq:\n    def __eq__(self, other):\n        return True\n    __hash__ = None\ndef solve(n):\n    return Eq()\n",
        check="no_credit", modes=ALL,
        xfail={"local_run": "actual == expected calls the student's __eq__; the remote path compares JSON values"}),
    "sys_exit_toplevel": dict(
        code="import sys\nsys.exit(0)\ndef solve(n):\n    return 1\n",
        check="no_crash_no_credit", modes=ALL),
    "sys_exit_in_function": dict(
        code="import sys\ndef solve(n):\n    sys.exit(0)\n",
        check="no_crash_no_credit", modes=ALL),
    "builtin_exit_in_function": dict(
        code="def solve(n):\n    exit()\n",
        check="no_crash_no_credit", modes=ALL),
    "keyboard_interrupt": dict(
        code="def solve(n):\n    raise KeyboardInterrupt\n",
        check="no_crash_no_credit", modes=ALL,
        xfail={"local_run": "run_submission only catches Exception; KeyboardInterrupt reaches the caller"}),
    "os_exit_kills_grader": dict(
        code="import os\ndef solve(n):\n    os._exit(0)\n",
        check="reports_or_platform_stop", modes=ALL,
        xfail={m: "os._exit ends the whole process; no report is produced" for m in IN_PROCESS}),
    # ---- state shared between submissions (warm isolate / long lived server) ----
    "poison_executor_for_next_student": dict(
        code="def solve(n):\n    return 0\n",
        prelude="import grader.sandbox as s\nKNOWN = {1: 7391, 2: 80123, 3: 40517}\n"
                "def _evil(code, func, tc):\n    return {'status': 'ran', 'compile_error': None, 'cases': [\n"
                "        {'passed': True, 'args': a, 'expected': e, 'actual': KNOWN[a[0]], 'error': None} for a, e in tc]}\n"
                "s._execute = _evil\ndef solve(n):\n    return 0\n",
        check="no_credit_after_poison", modes=IN_PROCESS,
        xfail={m: "student code can rebind grader.sandbox._execute; the isolate is reused (accepted risk 4)"
               for m in IN_PROCESS}),
}
