# Sandbox threat model

This page says what actually stops student Python code from doing harm today, which attacks are covered, and which are not. Every claim cites a file or a test. Live behaviour comes from `worker/README.md` (measured 2026-11-18); nothing here was run against the Cloudflare account.

## Where student code runs

There are two places, and they are not equally safe.

**Production: the `grading-sandbox` Worker.** The teacher app (`app-worker`) calls the `grading` Python Worker through the `GRADER` service binding (`app-worker/wrangler.jsonc`, `app-worker/src/grader.ts:36`). `grading` calls `grading-sandbox` through its `SANDBOX` binding (`worker/wrangler.jsonc`, `worker/src/app/bridges.py:18,121`). The sandbox Worker has no bindings, no secrets and no public URL (`sandbox-worker/wrangler.jsonc`: `workers_dev: false`, `preview_urls: false`). It runs `exec()` inside its own Python process (`src/grader/sandbox.py:107` and `:123`, reached from `sandbox-worker/src/handler.py:94`).

**Local: `server/` and `experiments/`.** `server/exam.py`, `server/main.py`, `server/teacher.py` and `src/grader/pipeline.py` import `grader.sandbox` directly, so student code runs with `exec()` inside the server or experiment process, with all of its privileges. This path has no isolation at all. It is fine for the author's own pilot data and must not see real student code.

## What the sandbox Worker has and enforces

| Item | Value | Enforced by | Source |
|---|---|---|---|
| Bindings | none | Cloudflare config | `sandbox-worker/wrangler.jsonc` |
| Secrets, D1, R2 | none reachable. A live frame walk found an empty `env` | config, checked live | `worker/README.md`, "What the live checks showed" |
| Expected values | never sent. Only args go in, outputs come back, `grading` compares | our code | `handler.py` docstring, `bridges.py:136` |
| Network | open (outbound fetch works) | nobody | `worker/README.md`, accepted risk 2 |
| CPU time | about 2 s, then `CpuLimitExceeded` kills the request. Measured at 1864 and 1951 ms | platform | `worker/README.md` |
| Memory | 128 MB per isolate | platform | Cloudflare docs, not measured here |
| Wall time | nothing in our code on the Worker. The new alarm (below) is off on Pyodide | nobody | `src/grader/sandbox.py:58` |
| Return value size | 64 KB per case, 1 MB per response | our code | `handler.py:12,14,59` |
| Printed output | discarded through `redirect_stdout` and `redirect_stderr` | our code | `handler.py:93` |
| Error text | clipped to 1000 characters, 2000 for a returned value | our code | `src/grader/sandbox.py:28,30` |
| Code size | 20,000 characters | our code | `app-worker/src/routes/student.ts:18` |
| Exit, `SystemExit`, `BaseException` | caught, reported as a compile error | our code | `sandbox.py`, `handler.py:95` |

The Worker reuses a warm isolate between requests, so module state that student code changes can outlive the request (accepted risk 4 in the README).

The `grading` Worker only calls `compile()` on code for syntax checks (`worker/src/app/routes.py:131`). It never runs it.

## Assets

1. Hidden test cases and expected values (they decide every grade).
2. Grade integrity: no student gets credit they did not earn, and none loses credit to another student's code.
3. Teacher data: problems, rubrics, D1 rows, R2 audit logs, the `INTERNAL_TOKEN`.
4. Availability of grading, and the daily Workers AI allowance of 10,000 Neurons (about 100 graded submits).
5. The author's machine or server on the local path.

## Attackers

- **A student** submits code to an exam link. Likely motive: a better grade, learning the hidden cases, or sabotaging a classmate. Most of the real danger is accidents: an infinite loop or a huge list by a student who means no harm.
- **A teacher who authors a problem** controls the reference solution and the wrong solution that the preview endpoint runs (`worker/src/app/routes.py:404`, `server/teacher.py`). That code runs in the same sandbox with the same limits, so the student table below covers it. A teacher also writes the test cases and can make them expensive.

There is no login on teacher pages in the Worker deployment (accepted risk 3), so "teacher" in practice means anyone with the URL.

## Attacks

Verdicts describe the production path (the sandbox Worker). "Local" means `grader.sandbox` called in process. The test column names the cases in `tests/test_sandbox_hostile.py`.

| # | Attack | Likelihood | Impact | Mitigation today | Verdict |
|---|---|---|---|---|---|
| 1 | Infinite loop | high (accident) | one request stuck | Platform CPU kill after about 2 s; locally a 10 s alarm turns it into a failed case. A loop that catches `BaseException` defeats the alarm (xfail) | Partial |
| 2 | Sleep forever or wait without CPU | low | request hangs | Alarm locally. On the Worker, the CPU limit does not count waiting, and wall time was not measured | Partial |
| 3 | Huge memory allocation | medium | isolate killed or slow | Only the platform's 128 MB. No cap in our code (xfail). A request for an impossible size gives `MemoryError`, scored as a failed case | Partial |
| 4 | Huge return value | medium | response bloat | 64 KB per case, 1 MB total, 1000 or 2000 characters in error lines | Mitigated |
| 5 | Huge printed output | medium | log flood | `print` is discarded on the Worker. `sys.__stdout__.write` and `os.write(1, ...)` bypass it (xfail). Local path prints freely (xfail) | Partial |
| 6 | Huge exception message | low | response bloat | Clipped to 1000 characters | Mitigated |
| 7 | Deep recursion | high (accident) | crash | `RecursionError` is an `Exception`, scored as a failed case. Raising the recursion limit then overflowing the C stack was not tested because it can exhaust memory on the test machine | Mitigated |
| 8 | Deeply nested return value | low | crash in JSON or repr | Caught, reported as not serializable | Mitigated |
| 9 | Read environment or secrets | medium | secret leak | Worker env is empty (live check). `os.environ` itself was not checked live. Local process leaks it (xfail on all three entry points because the test process holds a secret) | Partial |
| 10 | Filesystem read or write | medium | leak or tamper | Pyodide has a virtual file system with nothing of ours in it, but nothing blocks `open()` (xfail). Local path reads the real disk | Partial |
| 11 | Network access | medium | exfiltration, abuse of our IP | None. The Free plan has no egress control. The sandbox holds nothing worth sending except what the student already knows | Open |
| 12 | `import os / sys / subprocess / socket` | high | command execution | No import restrictions (xfail). On the Worker there is no real shell to reach, but this was not proven. Local path runs real commands | Open |
| 13 | `__import__` and builtins tricks | medium | same as 12 | Nothing; a name blocklist would be bypassed (xfail) | Open |
| 14 | Reach the Worker's bindings | medium | data theft | The sandbox has no bindings (config, live frame walk) | Mitigated |
| 15 | Read hidden cases from the harness (frames, `gc`) | medium | learn answers, fake a pass | Expected values never enter the sandbox process. Test `frame_walk_reads_expected` and `gc_walk_reads_expected` pass on the Worker path and xfail locally | Mitigated |
| 16 | Tamper with the comparison (`__eq__` always true) | medium | unearned credit | The Worker compares JSON values in `grading`, so a custom object cannot reach the comparison. Local `actual == expected` is fooled (xfail) | Mitigated |
| 17 | `sys.exit(0)`, `exit()`, `KeyboardInterrupt`, `os._exit` | high | grader crash or fake success | `SystemExit` is now a compile error on both paths; the Worker catches every `BaseException`; a dead sandbox becomes `SandboxKilled` and a zero score. Locally `KeyboardInterrupt` and `os._exit` still end the process (xfail) | Mitigated |
| 18 | Overwrite the reporting function or poison a warm isolate | medium | wrong grades for later students | None (xfail). A student who knows the cases can rebind `grader.sandbox._execute` and every later submission on that isolate gets the poisoned answers | Open |
| 19 | Background thread that outlives the call | low | persistent load | None (xfail) | Open |
| 20 | Denial of service by many submissions | medium | grading stops | Per attempt rate limit of 30 per minute, Turnstile on attempt start, 20,000 character cap, one submit at a time per attempt, 3 queue retries (`app-worker/src/routes/student.ts:107,114,162`). Free plan Neuron cap of about 100 graded submits a day still stops grading, with no cost | Partial |
| 21 | Learn hidden cases from the submit result | high | answer leak | The result lists failed hidden cases with expected values. Not a sandbox bug, but it defeats the split above (`worker/README.md`, "Known limitations") | Open |
| 22 | Prompt injection in code comments, aimed at the LLM checks | medium | inflated style or efficiency score | Correctness never uses the LLM, checks are one prompt per dimension with JSON schema output. Not tested here | Partial |

Totals: 8 mitigated, 8 partial, 6 open.

## What the tests show

`tests/test_sandbox_hostile.py` runs each submission in a throw away `python3 -I` process with a temp working directory, a CPU limit, a file size limit and a wall timeout (`tests/sandbox_hostile/harness.py`). It goes through three entry points: `grader.sandbox.run_submission`, `sandbox-worker/src/handler.py`, and `RemoteSandbox` talking to the handler in a separate process, which has the same split as production. The attack catalogue is `tests/sandbox_hostile/submissions.py`.

An attack that works is an `xfail(strict=True)` with the reason, so the suite stays green and the gap stays visible. If someone fixes a hole, the test fails until the mark is removed.

Limits of the suite:

- It cannot run a real Workers isolate. CPU kill, the 128 MB memory limit and Pyodide's virtual file system are not exercised, so the infinite loop and memory rows lean on the README measurements and on Cloudflare documentation.
- macOS does not let a process lower its memory limit, so the allocation tests do not enforce a ceiling. They show only that the code has none.
- The remote mode starts a fresh process for each call, so it cannot reproduce warm isolate reuse. Poisoning is tested on the in process handler instead.

## What the Free plan makes impossible

- No egress control, so network access cannot be closed.
- No Dynamic Workers, Containers or Sandbox SDK, which would give a fresh isolate or container per submission. Without that, state shared between submissions cannot be removed.
- The documented 10 ms CPU limit is not enforced today, and grading depends on that. If Cloudflare starts enforcing it, every grading request fails until the plan moves to Paid (accepted risk 1).
- No control over the 128 MB memory limit or the CPU ceiling.

## Fixes made in this task

Each is small and covered by tests; normal submissions score the same (all existing tests pass).

1. **Wall time alarm** in `src/grader/sandbox.py` (`TIME_LIMIT_S = 10`). Stops an honest infinite loop and turns it into a failed case. It works only on Unix in the main thread, so it does nothing inside `server/` request threads and is switched off on Pyodide.
2. **`SystemExit` handled in the shared executor**, with the same message the sandbox handler used, so both paths agree.
3. **Error clipping**: exception text to 1000 characters, a returned value in an error line to 2000.
4. **Sandbox handler** discards `print` output and caps the total response at 1 MB.

## Recommendations (not done)

| Fix | What it buys | Cost |
|---|---|---|
| Run the local path in a subprocess with `resource` limits and a hard timeout (the original PR-A1 idea) | Real CPU, memory and wall limits; no shared state; closes rows 1, 3, 17, 18, 19 locally | 1 to 2 days, plus a process start of about 50 ms per submission |
| Strip `os`, `subprocess`, `socket` from the Worker's import path and block `open()` | Raises the bar for rows 10, 12, 13 only; a determined student gets around it | half a day, small value |
| Show the student only pass or fail for hidden cases, never the expected value | Closes row 21 | half a day on the Worker and the UI; changes what students see |
| Add a canary case with a random input to every sandbox call and check its output in `grading` | Detects a poisoned isolate (row 18) | 1 day |
| Move the sandbox to Workers Paid with Dynamic Workers or Containers | Fresh isolate per submission, egress rules, enforced limits; closes rows 11, 18, 19 | Paid plan (from 5 USD a month) plus 2 to 3 days |
| Drop local `exec` entirely and make `server/` call a sandbox | Removes the unprotected path | 1 day, depends on the rows above |
| Test `sys.setrecursionlimit` plus C stack overflow, and `os.environ` on a live isolate | Turns two unknowns into facts | 1 hour, needs a live run |
