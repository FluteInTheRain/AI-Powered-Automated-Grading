# Golden regression tests (T7.5)

Goal: notice that grading drifted before a deploy, in CI, without a Workers AI token.

CI has no token and cannot call a model, so the checks split into two layers. Only the first is built.

## Layer 1: deterministic, runs on every pull request

Two test files, `tests/test_golden_prompts.py` and `tests/test_golden_replay.py`. They run as a named step of the existing "Python tests" job in `.github/workflows/ci.yml`, because that job already installs the dependencies and runs in about four seconds for the whole suite. A separate job would only add a second install.

### Prompt snapshot

`tests/golden/prompts.json` holds, for every file in `prompts/`, the SHA-256 of the template and the exact system and user text rendered for two fixed inputs (a plain one, and one with braces, a non-ASCII letter and a trailing blank line). The three checks and the feedback prompt are rendered through the real functions in `src/grader/`, so a change to the system prompt string or to the `.format` arguments is caught too.

It catches: any edit to a prompt file, including one character; a changed system prompt; a changed placeholder or rendering argument; a new prompt file nobody added to the snapshot.

### Replay

`tests/golden/replay_set.json` has 13 frozen submissions: correct, brute force with poor style, off-by-one logic bug, wrong completely, correct but slow, edge case bug, binary search correct and linear, a self-contradicting efficiency verdict, medium style with a crash on empty input, a constraint violation nobody scores, `handled=false` with no named cases, and a blank submission. Each stores the problem, the code, the rubric weights and the recorded JSON answer for each check. The test grades each one through the real `grade()` (real sandbox, real schemas, real aggregation) with a fake client that returns the recorded JSON, then compares sub scores, final score, sandbox status, pass count and which LLM calls were made.

It catches: a changed weight or rounding rule, a changed scoring formula (0.4 for missed efficiency, the edge case penalty, style levels), a schema change that stops a recorded answer from parsing, the zero credit rule on a failed or blank submission (the LLM must not even be called), the self-contradiction correction in `check_efficiency`, and any change in what the sandbox reports.

### Recorded responses are hand authored

No model produced them. There was no Workers AI token, and the local llama-server was not running. A person wrote each answer to be valid against `src/grader/schemas.py` and to fit that submission's known profile in `data/problems.py`. The file says so in its `_README`. They are test fixtures for the code around the model. They are not measurements of the model and must never be cited as such. Two submissions in `data/problems.py` labeled as bugs (`P01 S3`, `P06 S1`) pass every test in the sandbox, so the replay set uses other submissions for the bug cases.

## What layer 1 cannot catch

- The model changing. A model update, a different quantization or a provider change moves real answers while every prompt and recorded answer stays the same. The daily canary (ADR 0002) sees this for one input only, and only after deploy.
- Whether a prompt change is good. The snapshot proves the text changed, not that the model now grades better or worse. Judging that needs the live layer.
- Nondeterminism in the real serving stack.
- Anything about agreement with human graders (the efficiency and style labels in the dataset are single rater; see `data/script.md`).

## Layer 2: live, documented only, not built

A manual (`workflow_dispatch`) or weekly scheduled job that runs the same 13 submissions against the real model and compares to a stored baseline.

- What it does: for each case, call the three checks through `LLMClient` at temperature 0 with the fixed seed, via AI Gateway, with the cache off (ADR 0003). Compare the raw JSON of each response and the resulting sub scores with a baseline file committed from an earlier accepted run (for example `tests/golden/live_baseline.json`). Fail on any difference and upload a diff as an artifact. Run each case twice and fail if the two runs differ, which doubles as a determinism check on more inputs than the canary.
- Secrets: `CLOUDFLARE_API_TOKEN` with Workers AI permission, plus the account id and the AI Gateway name as variables. Only `workflow_dispatch` and schedule triggers get the secret; pull requests from forks must never see it.
- Cost, estimated from the code, not measured: 11 of the 13 cases reach the LLM (two are zero credit), 3 calls each, so 33 calls. The rendered prompts total about 8,600 input tokens (characters divided by four) and the answers are tiny JSON, about 45 output tokens each. At the published rate for the model in `worker/README.md` (60,000 Neurons per million input tokens, 90,909 per million output) that is roughly 520 plus 135, so about 650 to 700 Neurons per run, near 7 percent of the 10,000 daily free allowance, about $0.007 on Workers Paid. Running every case twice doubles it. The feedback call is not part of the set.
- Not built because there is no token here and baselines recorded now would be worthless. First step when a token exists: run it once, review the answers by hand, commit the baseline.

## Updating the golden files

When: only after a deliberate change to a prompt, a rendering function, a weight, a formula or a schema.

1. Run `python3 -m pytest -q tests/test_golden_prompts.py tests/test_golden_replay.py` and read the failure. It names the prompt or case that moved.
2. Decide whether the move was meant. If not, fix the code.
3. If it was, run `python3 scripts/update_golden.py`. It rewrites `prompts.json` and the `expected` block of every replay case. It never edits inputs or recorded responses.
4. Read `git diff tests/golden/`. For score changes, recompute at least one case by hand from the rubric weights (for example 60/15/15/10 with sub scores 1.0, 0.4, 0.2, 0.75 gives 60 + 6 + 3 + 7.5 = 76.5).
5. Commit the golden files in the same commit as the change. For a prompt or rubric change also bump `CANARY_INPUT_VERSION` in `app-worker/src/canary.ts`, so the daily canary starts a new baseline.
6. If a schema change makes a recorded answer invalid, edit that answer in `replay_set.json` by hand, then regenerate.

A new file in `prompts/` fails the snapshot until `render_prompts` in `tests/golden/golden_support.py` gets a rendering recipe for it.
