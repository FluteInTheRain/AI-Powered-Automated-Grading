# AI-Powered Automated Grading

**English** | [Tiếng Việt](README.vi.md)

**Reproducible, auditable grading of programming assignments with small LLMs, and a Cloudflare-native teacher app built on top of it.**

[![CI](https://github.com/FluteInTheRain/AI-Powered-Automated-Grading/actions/workflows/ci.yml/badge.svg)](https://github.com/FluteInTheRain/AI-Powered-Automated-Grading/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-grading.khangnguyen.workers.dev-f38020?logo=cloudflare&logoColor=white)](https://grading.khangnguyen.workers.dev)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776ab?logo=python&logoColor=white)](requirements.txt)
[![TypeScript](https://img.shields.io/badge/typescript-Hono%20on%20Workers-3178c6?logo=typescript&logoColor=white)](app-worker)
[![React 18](https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=black)](app-ui/package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A personal project with two parts that share one grader:

- **A research question.** Can a model with **at most 7B parameters** grade code so that the **same
  submission always gets the same score**, and can a teacher see exactly why?
- **A product built on the answer.** A small teacher app that runs entirely on Cloudflare's **Free plan**:
  teachers build multi-question exams, students submit once, and the AI grades every question in the
  background, with a full audit trail.

Most "LLM grader" demos ask one model for one holistic score. That score drifts from run to run, and nobody can
audit it. This project takes a different design:

- **Correctness comes from running the code.** The student's function is executed against test cases in a
  sandbox. No LLM is involved, so this part is deterministic by construction.
- **Every other rubric dimension is a small, closed question.** Efficiency, code style and edge-case handling
  each get one narrow prompt whose answer is constrained by a JSON schema (a boolean or a short ordinal level),
  never free text.
- **The final score is plain Python.** It is a fixed weighted sum of the parts. The LLM never produces or
  adjusts a number.

## Try it

| What | Link | Notes |
|---|---|---|
| Public demo | https://grading.khangnguyen.workers.dev | No login. Create a problem, share the exam link, submit as a student, then review scores and the full LLM audit trail. One question per exam. |
| Teacher app | https://teacher-app.khangnguyen.workers.dev | Teacher pages sit behind Cloudflare Access and are limited to the author's email, so a visitor cannot sign in. Student exam links open without a login. The architecture, tests and CI are in this repo. |

## Contents

- [Results](#results)
- [How grading works](#how-grading-works)
- [The teacher app](#the-teacher-app)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Running the experiments](#running-the-experiments)
- [Testing and CI/CD](#testing-and-cicd)
- [Deployment](#deployment)
- [Limitations](#limitations)
- [Status and roadmap](#status-and-roadmap)
- [Documentation](#documentation)
- [License](#license)

## Results

All numbers below come from `experiments/` runs unless stated otherwise. The full tables, method and caveats are
in [`docs/report/results.md`](docs/report/results.md).

**Consistency.** Model: Qwen2.5-Coder-7B-Instruct (Q4_K_M) served by llama.cpp; temp=0; fixed seed. Each sample
was graded 100 times.

| Condition | Samples | Exact-match rate |
|---|---|---|
| Sequential requests, no batching | 4 clean-correct submissions | 1.0 on all 4 |
| Batched serving (`--parallel 4`, 8 concurrent clients) | same 4 | 1.0 on all 4 |
| Both conditions | 4 submissions with subtle bugs or exponential time | 1.0 on all 4 |

Each individual rubric check also produced exactly one distinct value across all 100 runs.

**Ablation.** Does decomposing the rubric help? The table shows Spearman ρ against the dataset's reference
labels, over 65 samples (16 problems).

| Arm | What the LLM does | ρ |
|---|---|---|
| `free_form` | One prompt, one holistic score | 0.60 |
| `hybrid_freeform` | Sandbox scores correctness; one free-form prompt scores everything else | 0.85 |
| `hybrid_decomposed` (this design) | Sandbox scores correctness; one schema-constrained prompt per dimension | **0.88** |

Every decomposition step improved agreement. Because prompting plus structured decoding already met the targets
(>98% exact-match, good agreement), the planned LoRA fine-tuning phase was **not needed**, and it was skipped by
a recorded go/no-go check.

**Code style does not penalise missing comments.** The first style prompt never mentioned comments, and on a
32B model every correct but uncommented sample scored `medium` (0 of 16 `clean`). After stating that comments,
docstrings and type hints are optional, 13 of 16 score `clean`. This was a one-call-per-sample measurement on
Workers AI, not a consistency test: see the caveats in [`docs/report/results.md`](docs/report/results.md).

> **Read these numbers with their caveats.**
> - The reference labels for efficiency and code style were annotated by one person, the author, so the ρ values
>   are a pipeline sanity check. They are not agreement with human graders. See [`data/script.md`](data/script.md).
> - "1.0 at n=100" means no inconsistency was detected at that sample size. It does not prove the grader is
>   deterministic: one manual test session did see a check flip between two identical calls.
> - The ablation ran before the current zero-credit rule (code that does not run, or passes no test, scores 0 on
>   every dimension) and before the style-prompt change. It has not been rerun since, so the numbers describe the
>   earlier prompts.

## How grading works

![Grading pipeline: a sandbox run for correctness, three independent LLM checks, a fixed weighted sum, then feedback text](docs/img/pipeline.svg)

| Step | Code | Notes |
|---|---|---|
| Run tests | [`src/grader/sandbox.py`](src/grader/sandbox.py) | The only source of correctness. If the code fails to compile or passes 0 tests, every dimension scores 0, so the LLM cannot give partial credit to a stub. |
| LLM checks | [`src/grader/rubric_checks.py`](src/grader/rubric_checks.py), [`prompts/`](prompts/) | One independent call per dimension. The output is validated against the pydantic models in [`src/grader/schemas.py`](src/grader/schemas.py). |
| Determinism knobs | [`src/grader/llm_client.py`](src/grader/llm_client.py) | temperature=0, a fixed seed and JSON-schema-constrained decoding, set in one place. Every call is appended to a `call_log` for the audit trail. |
| Score | [`src/grader/aggregator.py`](src/grader/aggregator.py) | A weighted sum with the rubric weights (for example 60/15/15/10). |
| Orchestration | [`src/grader/pipeline.py`](src/grader/pipeline.py) | `grade()` is a single sequential function. It uses no agent framework, so there is no extra layer where non-determinism could leak in. |

The design rationale and the literature behind it are in [`docs/architecture.md`](docs/architecture.md).

## The teacher app

A teacher logs in, builds an exam from a question bank (or their own questions), and shares a link. A student
opens the link, works through all the questions, and submits **once**. Every question is graded in parallel and
the student sees one result for the whole exam.

![Teacher app architecture on Cloudflare: Access and Turnstile in front of a Worker, Queues, D1, Durable Objects, R2 and the Python grading Worker](docs/img/teacher-app.svg)

**What it does**
- **Exams.** A question bank of 16 problems plus teacher-authored problems (API), exams of up to 20 weighted
  questions, a deadline and a time limit.
- **Student flow.** Name and Turnstile check, then the questions appear with a server-side clock. "Run Tests"
  checks the public cases per question; one confirmed "Nộp bài" submits everything. A reload resumes the attempt,
  and a receipt code lets the student look the score up later.
- **Background grading.** Submit stores one submission and one job per question in a single D1 batch and
  answers at once. A queue consumer grades each question through the Python Worker, writes the score and stores the
  full LLM prompts and raw responses in R2. Jobs are retried safely, a stuck job can be re-queued, and a blank
  answer is scored 0 without a sandbox run or an LLM call.
- **Scores are append-only.** Score revisions and submissions cannot be updated or deleted (SQL triggers), so a
  later manual regrade adds a revision with a reason instead of overwriting the AI score.
- **Abuse limits.** Rate limiting per IP and per attempt, and a Turnstile check when an attempt starts.
- **Teacher view.** Exams, a results table per student and question with the grading state, deadline control.

**Why each Cloudflare product is there**

| Product | Job in the app |
|---|---|
| Workers (TypeScript, Hono) | The API, the queue consumer and the static React UI |
| Access | Teacher login, verified again inside the Worker (fails closed) |
| D1 | Teachers, problems, exams, attempts, submissions, append-only score revisions |
| Queues | Grading runs in the background; at-least-once delivery handled by idempotent jobs |
| Durable Objects | The authoritative clock of an attempt and a one-submit-at-a-time claim |
| R2 | The full LLM audit trail of every graded submission |
| Rate Limiting, Turnstile | Per-IP and per-attempt limits; a bot check when an attempt starts |
| Workers AI + service binding | The Python grading Worker calls the model; the TypeScript app calls the grader |

The design is in [`docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md`](docs/superpowers/specs/2026-11-25-teacher-app-cloudflare-design.md);
the runbook and API are in [`app-worker/README.md`](app-worker/README.md).

## Tech stack

| Area | Technology |
|---|---|
| Grading pipeline | Python 3.12, pydantic, OpenAI-compatible client, llama.cpp (Qwen2.5-Coder-7B) or Workers AI |
| Teacher app backend | TypeScript, Hono on Cloudflare Workers, D1, Queues, Durable Objects, R2, Rate Limiting, Turnstile, Access |
| Grading Workers | Python Workers (FastAPI on Pyodide) and an isolated sandbox Worker |
| Front end | React 18 + Vite (`app-ui/`), Monaco editor; static assets served by the Worker |
| Original product app | FastAPI, SQLAlchemy, Postgres, React (`server/`, `frontend/`) |
| Tests | pytest, vitest with the Workers runtime, Testing Library |
| CI/CD | GitHub Actions, wrangler |

## Repository layout

```
src/grader/        Grading pipeline: sandbox, LLM checks, schemas, aggregation, feedback
prompts/           One narrowly scoped prompt per rubric dimension (+ ablation baselines)
experiments/       Consistency test, ablation, metrics
data/              Pilot dataset source (problems.py) and generator (build_dataset.py)
configs/           Model and serving settings that affect determinism
app-worker/        Teacher app: TypeScript Worker (Hono, D1, Queues, Durable Objects, R2)
app-ui/            Teacher app UI: React + Vite, built to static files
worker/            Python grading Worker (+ the original single-question demo API)
sandbox-worker/    Isolated Cloudflare Worker that runs student code
server/, frontend/ Original product app: FastAPI + Postgres, React UI
deploy/            Single-VM deployment (Docker Compose + nginx + llama-server)
scripts/           Model server helper, question-bank seed generator
tests/             pytest suite (grader, rules, Workers, prompts, migrations)
docs/              Architecture, roadmap, results, design specs and plans
.github/workflows/ CI and deploy workflows
```

## Getting started

Prerequisites:
- Python 3.12
- Node.js 24 (the CI version) or any recent LTS
- An OpenAI-compatible LLM endpoint for the experiments. The default is llama.cpp's `llama-server`, but any
  endpoint that supports JSON-schema output works.
- For the original product app only: Docker, for the local Postgres.

### The grading pipeline and its tests

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python3 data/build_dataset.py      # generates data/dataset.json (not committed)
pytest                             # needs no LLM or database
```

### Start a model server

```bash
brew install llama.cpp
scripts/model_server.sh start      # serves Qwen2.5-Coder-7B-Instruct on :8080
```

`scripts/model_server.sh start --parallel 4` turns on batched serving, the setup used for the batched-consistency
experiment.

To use a hosted endpoint instead, set `LLM_API_KEY` and pass `--base_url` and `--model`. Example for Cloudflare
Workers AI:

```bash
export LLM_API_KEY=...             # read from the environment, never from CLI args
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 5 \
  --base_url https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1 \
  --model @cf/qwen/qwen2.5-coder-32b-instruct --seed 1   # Workers AI rejects seed 0
```

### The teacher app (Cloudflare)

```bash
cd app-worker && npm install
npm test && npm run typecheck      # vitest inside the Workers runtime, no Cloudflare login needed
cd ../app-ui && npm install
npm test && npm run build          # the Worker serves app-ui/dist as static assets
```

Running it against real Cloudflare resources (D1, queue, R2 bucket, Access, Turnstile) is described step by step in
[`app-worker/README.md`](app-worker/README.md).

### The original product app (Postgres)

```bash
docker compose up -d                          # Postgres 16 on :5433
alembic upgrade head                          # create the tables
uvicorn server.main:app --reload --port 8001  # API
cd frontend && npm install && npm run dev     # UI; proxies /api to :8001
```

`DATABASE_URL` defaults to `postgresql+psycopg://grading:grading@localhost:5433/grading`. This database is
separate from the research dataset; the pipeline itself has no database. `streamlit run app.py` starts a small
single-page demo of the pipeline alone.

## Running the experiments

```bash
# Grade one sample N times and report how many distinct scores appear
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100

# Same, with overlapping requests to exercise server-side batching
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100 \
  --concurrency 8 --tag batched

# Compare the three arms on the whole dataset
python3 experiments/ablation.py --arm all
```

Results are written to `results/` as JSON. That folder is gitignored. Sample ids follow the pattern
`P<nn>_<problem>__S<n>_<variant>`; see `data/problems.py`.

The dataset has 16 problems and 65 submissions. Each problem has a correct solution plus variants with injected
bugs, inefficiency or style issues. To add a problem, edit `data/problems.py` and rerun
`python3 data/build_dataset.py`; never edit the JSON by hand. The teacher app's question bank is generated from the
same file with `python3 scripts/export_bank_seed.py`.

## Testing and CI/CD

- **Tests.** `pytest` covers the grader, shared rules, the Python Workers, the prompts and the D1 migrations.
  `vitest` runs the TypeScript Worker inside the Workers runtime (real D1, Durable Objects and R2 bindings) and the
  React UI with Testing Library. Features were built test-first.
- **CI** ([`ci.yml`](.github/workflows/ci.yml)). Every pull request and push to `main` runs three parallel jobs:
  Python tests, Worker tests plus typecheck, UI tests plus build.
- **Deploy** ([`deploy.yml`](.github/workflows/deploy.yml)). Every push to `main`, after the same checks, deploys
  the sandbox Worker, the Python grading Worker, applies D1 migrations, builds the UI and deploys the teacher app,
  then smoke-tests the live URLs. Deploys never overlap.

## Deployment

| Target | Stack | Cost | Runbook |
|---|---|---|---|
| **Teacher app on Cloudflare** | TypeScript Worker + D1 + Queues + Durable Objects + R2 + Access + Turnstile, calling the Python grading Worker | $0 (Workers Free) | [`app-worker/README.md`](app-worker/README.md) |
| Public demo on Cloudflare | Python Worker (FastAPI on Pyodide) + D1 + Workers AI + a separate sandbox Worker | $0 (Workers Free) | [`worker/README.md`](worker/README.md) |
| Single VM | Docker Compose: FastAPI, Postgres, nginx, a llama-server systemd unit | One GPU VM | [`deploy/README.md`](deploy/README.md) |

On Cloudflare, student code never runs next to the database. The sandbox Worker has no bindings and no public URL;
it receives only the code and the test inputs and returns only outputs. The grading Worker compares those outputs
with the expected answers, so hidden expected answers never enter the environment where student code runs. The
design and the risks accepted for the Free plan are in
[`docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`](docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md).

## Limitations

- **Labels.** The efficiency and code-style labels come from a single rater, as described under
  [Results](#results). Validating against independent instructor grading is still open.
- **Consistency scope.** The consistency results were measured with llama.cpp at concurrency 8. The clean samples
  were run on both 7B and 1.5B models; the harder samples on 7B only. The results may not carry over to vLLM,
  larger batches or other models. The deployed apps use a 32B model on shared Cloudflare infrastructure, which is
  outside the sub-7B scope, and its determinism has only been spot-checked. The style-prompt change was measured on
  that 32B model with one call per sample.
- **Names are not identities.** A student is a name plus a link. A name can be used once per exam, so a classmate
  can take it first, and a different name always starts a fresh clock. Real per-student limits would need a
  teacher-issued roster or invitations.
- **Drafts and devices.** Typed code is kept as a draft in the student's browser only. Clearing storage or changing
  device loses it, and an attempt cannot be continued from another device.
- **Sandbox.** On Cloudflare the sandbox isolate is reused between requests and student code can make outbound
  requests; the VM path runs code in-process. Neither setup is hardened for untrusted, high-stakes exams.
- **Not built yet.** Student appeals, manual regrading and the audit view for teachers (the data model already
  supports them), an Excel export for the new app, and authoring your own question in the UI.

## Status and roadmap

The research phases are finished. The teacher app has its foundation (login, bank, exams, grading) and its
background grading, rate limiting and audit log deployed. Next is the appeal flow: a student disputes a score, the
teacher reviews exactly how the AI graded it and regrades by hand if needed. The task-by-task history is in
[`docs/roadmap.md`](docs/roadmap.md).

## Documentation

| Doc | Read it for |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Why the design is hybrid and decomposed, with citations |
| [`docs/report/results.md`](docs/report/results.md) | Full experiment tables and caveats |
| [`docs/roadmap.md`](docs/roadmap.md) | Task-by-task history of the project |
| [`app-worker/README.md`](app-worker/README.md) | Teacher app runbook, API and known limits |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) and [`plans/`](docs/superpowers/plans/) | Design documents and implementation plans |
| [`docs/TECHNICAL_OVERVIEW.md`](docs/TECHNICAL_OVERVIEW.md) | Engineering deep dive written for portfolio readers (also as PDF) |
| [`docs/productionization.md`](docs/productionization.md) | Ideas and backlog for turning the pipeline into a real product |
| [`data/script.md`](data/script.md) | Dataset schema, how labels were made, known limitations |
| [`worker/README.md`](worker/README.md) | Deploying and operating the Python grading Worker and the demo |

The repo also has a [`CLAUDE.md`](CLAUDE.md) and project slash commands in `.claude/commands/` (`/run-consistency`,
`/run-ablation`, `/add-problem`, `/report-section`) for working on it with Claude Code.

## License

[MIT](LICENSE) © 2026 Khang Nguyen
