# AI-Powered Automated Grading

**Reproducible, auditable grading of programming assignments with small LLMs.**

[![Live demo](https://img.shields.io/badge/demo-grading.khangnguyen.workers.dev-f38020?logo=cloudflare&logoColor=white)](https://grading.khangnguyen.workers.dev)
[![Python 3.12](https://img.shields.io/badge/python-3.12-3776ab?logo=python&logoColor=white)](requirements.txt)
[![React 18](https://img.shields.io/badge/react-18-61dafb?logo=react&logoColor=black)](frontend/package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A personal research project. The question it answers: can a model with **at most
7B parameters** grade code so that the **same submission always gets the same
score**, and can a teacher see exactly why?

Most "LLM grader" demos ask one model for one holistic score. That score drifts from run
to run, and nobody can audit it. This project takes a different design:

- **Correctness comes from running the code.** The student's function is executed against
  test cases in a sandbox. No LLM is involved, so this part is deterministic by construction.
- **Every other rubric dimension is a small, closed question.** Efficiency, code style and
  edge-case handling each get one narrow prompt whose answer is constrained by a JSON
  schema (a boolean or a short ordinal level), never free text.
- **The final score is plain Python.** It is a fixed weighted sum of the parts. The LLM never
  produces or adjusts a number.

Try it: **https://grading.khangnguyen.workers.dev**. Create a problem, share the exam
link, submit as a student, then review scores and the full LLM audit trail.

## Contents

- [Results](#results)
- [How grading works](#how-grading-works)
- [What is in the repo](#what-is-in-the-repo)
- [Getting started](#getting-started)
- [Running the experiments](#running-the-experiments)
- [Deployment](#deployment)
- [Limitations](#limitations)
- [Documentation](#documentation)
- [License](#license)

## Results

All numbers below come from `experiments/` runs. The full tables, method and caveats are
in [`docs/report/results.md`](docs/report/results.md).

**Consistency.** Model: Qwen2.5-Coder-7B-Instruct (Q4_K_M) served by llama.cpp; temp=0;
fixed seed. Each sample was graded 100 times.

| Condition | Samples | Exact-match rate |
|---|---|---|
| Sequential requests, no batching | 4 clean-correct submissions | 1.0 on all 4 |
| Batched serving (`--parallel 4`, 8 concurrent clients) | same 4 | 1.0 on all 4 |
| Both conditions | 4 submissions with subtle bugs or exponential time | 1.0 on all 4 |

Each individual rubric check also produced exactly one distinct value across all 100 runs.

**Ablation.** Does decomposing the rubric help? The table shows Spearman ρ against the
dataset's reference labels, over 65 samples (16 problems).

| Arm | What the LLM does | ρ |
|---|---|---|
| `free_form` | One prompt, one holistic score | 0.60 |
| `hybrid_freeform` | Sandbox scores correctness; one free-form prompt scores everything else | 0.85 |
| `hybrid_decomposed` (this design) | Sandbox scores correctness; one schema-constrained prompt per dimension | **0.88** |

Every decomposition step improved agreement. Because prompting plus structured decoding
already met the targets (>98% exact-match, good agreement), the planned LoRA fine-tuning
phase was **not needed**, and it was skipped by a recorded go/no-go check.

> **Read these numbers with their caveats.**
> - The reference labels for efficiency and code style were annotated by one person, the
>   author, so the ρ values are a pipeline sanity check. They are not agreement with
>   human graders. See [`data/script.md`](data/script.md).
> - "1.0 at n=100" means no inconsistency was detected at that sample size. It does not
>   prove the grader is deterministic: one manual test session did see a check flip
>   between two identical calls.

## How grading works

```mermaid
flowchart LR
    S[Student submission] --> X[Sandbox: run test cases]
    X -->|pass rate| C[correctness]
    X -->|"0 tests passed or compile error"| Z[All dimensions = 0]
    S --> E[LLM check: efficiency]
    S --> T[LLM check: code style]
    S --> H[LLM check: edge cases]
    C --> A["aggregate()<br/>fixed weighted sum in Python"]
    E --> A
    T --> A
    H --> A
    A --> F[Final score 0-100]
    F -.-> FB[LLM feedback text<br/>generated after scoring,<br/>never changes the score]
```

| Step | Code | Notes |
|---|---|---|
| Run tests | [`src/grader/sandbox.py`](src/grader/sandbox.py) | The only source of correctness. If the code fails to compile or passes 0 tests, every dimension scores 0, so the LLM cannot give partial credit to a stub. |
| LLM checks | [`src/grader/rubric_checks.py`](src/grader/rubric_checks.py), [`prompts/`](prompts/) | One independent call per dimension. The output is validated against the pydantic models in [`src/grader/schemas.py`](src/grader/schemas.py). |
| Determinism knobs | [`src/grader/llm_client.py`](src/grader/llm_client.py) | temperature=0, a fixed seed and JSON-schema-constrained decoding, set in one place. Every call is appended to a `call_log` for the audit trail. |
| Score | [`src/grader/aggregator.py`](src/grader/aggregator.py) | A weighted sum with the rubric weights (for example 60/15/15/10). |
| Orchestration | [`src/grader/pipeline.py`](src/grader/pipeline.py) | `grade()` is a single sequential function. It uses no agent framework, so there is no extra layer where non-determinism could leak in. |

The design rationale and the literature behind it are in
[`docs/architecture.md`](docs/architecture.md).

## What is in the repo

The repo has two layers: a **research pipeline** that measures the grader, and a
**product app** that teachers and students use.

```
src/grader/        Grading pipeline: sandbox, LLM checks, schemas, aggregation, feedback
prompts/           One narrowly scoped prompt per rubric dimension (+ ablation baselines)
experiments/       Consistency test, ablation, metrics
data/              Pilot dataset source (problems.py) and generator (build_dataset.py)
configs/           Model and serving settings that affect determinism
server/            Product API: FastAPI + SQLAlchemy + Postgres
frontend/          Product UI: React + Vite (teacher authoring, exam page, results)
worker/            The same product API as a Cloudflare Python Worker (D1 + Workers AI)
sandbox-worker/    Isolated Cloudflare Worker that runs student code
deploy/            Single-VM deployment (Docker Compose + nginx + llama-server)
tests/             pytest suite (grader, rules, both Workers)
docs/              Architecture, roadmap, results, deployment design
```

**Product flow:**
1. A teacher writes a problem, a reference solution and test inputs. The expected outputs
   are computed by running the reference solution.
2. The teacher creates an exam and gets two links: one for students and a private one for
   results.
3. Students submit code and receive a score with feedback.
4. The teacher reviews every submission, including the exact prompts and raw LLM
   responses, and can export the results to Excel.

## Getting started

Prerequisites:
- Python 3.12
- Node.js 18+
- Docker, for the local Postgres
- An OpenAI-compatible LLM endpoint. The default is llama.cpp's `llama-server`, but any
  endpoint that supports JSON-schema output works.

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

`scripts/model_server.sh start --parallel 4` turns on batched serving, the setup used for
the batched-consistency experiment.

To use a hosted endpoint instead, set `LLM_API_KEY` and pass `--base_url` and `--model`.
Example for Cloudflare Workers AI:

```bash
export LLM_API_KEY=...             # read from the environment, never from CLI args
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 5 \
  --base_url https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1 \
  --model @cf/qwen/qwen2.5-coder-32b-instruct --seed 1   # Workers AI rejects seed 0
```

### Run the product app locally

```bash
docker compose up -d                          # Postgres 16 on :5433
alembic upgrade head                          # create the tables
uvicorn server.main:app --reload --port 8001  # API
cd frontend && npm install && npm run dev     # UI; proxies /api to :8001
```

`DATABASE_URL` defaults to `postgresql+psycopg://grading:grading@localhost:5433/grading`.
This database is separate from the research dataset; the pipeline itself has no database.

`streamlit run app.py` starts a small single-page demo of the pipeline alone.

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

Results are written to `results/` as JSON. That folder is gitignored. Sample ids follow the
pattern `P<nn>_<problem>__S<n>_<variant>`; see `data/problems.py`.

The dataset has 16 problems and 65 submissions. Each problem has a correct solution plus
variants with injected bugs, inefficiency or style issues. To add a problem, edit
`data/problems.py` and rerun `python3 data/build_dataset.py`; never edit the JSON by hand.

## Deployment

Two deployment targets exist. Each has its own runbook.

| Target | Stack | Cost | Runbook |
|---|---|---|---|
| **Cloudflare (live demo)** | Python Worker (FastAPI on Pyodide) + D1 + Workers AI + a separate sandbox Worker | $0 (Workers Free) | [`worker/README.md`](worker/README.md) |
| Single VM | Docker Compose: FastAPI, Postgres, nginx, a llama-server systemd unit | One GPU VM | [`deploy/README.md`](deploy/README.md) |

On Cloudflare, student code never runs next to the database:

```mermaid
flowchart LR
    U[Browser] --> G["grading Worker<br/>UI + API"]
    G --> D[(D1)]
    G --> AI[Workers AI]
    G -- "service binding<br/>code + inputs only" --> SB["grading-sandbox Worker<br/>no bindings, no public URL"]
```

The sandbox Worker receives only the code and the test inputs, and it returns only outputs.
The main Worker compares those outputs with the expected answers, so hidden expected
answers never enter the environment where student code runs. The design and the risks
accepted for the Free plan are in
[`docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md`](docs/superpowers/specs/2026-11-17-cloudflare-deploy-design.md).

## Limitations

- **Labels:** the efficiency and code-style labels come from a single rater, as described
  under [Results](#results). Validating against independent instructor grading is still
  open.
- **Consistency scope:**
  - The consistency results were measured with llama.cpp on 7B and 1.5B models at
    concurrency 8. They may not carry over to vLLM, larger batches or other models.
  - The live demo runs a 32B model on shared Cloudflare infrastructure. That is outside
    the sub-7B scope, and its determinism has only been spot-checked.
- **Product hardening:**
  - The demo has no login or rate limiting.
  - After a submission, the student can see which hidden test cases failed, including
    their inputs.
  - Resubmission is not blocked.
- **Sandbox:**
  - On Cloudflare, the sandbox isolate is reused between requests, and student code can
    make outbound requests.
  - The VM path runs code in-process.
  - Neither setup is hardened for untrusted, high-stakes exams.

## Documentation

| Doc | Read it for |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Why the design is hybrid and decomposed, with citations |
| [`docs/report/results.md`](docs/report/results.md) | Full experiment tables and caveats |
| [`docs/roadmap.md`](docs/roadmap.md) | Task-by-task history of the project |
| [`docs/TECHNICAL_OVERVIEW.md`](docs/TECHNICAL_OVERVIEW.md) | Engineering deep dive written for portfolio readers (also as PDF) |
| [`docs/productionization.md`](docs/productionization.md) | Ideas and backlog for turning the pipeline into a real product |
| [`data/script.md`](data/script.md) | Dataset schema, how labels were made, known limitations |
| [`worker/README.md`](worker/README.md) | Deploying and operating the Cloudflare version |

The repo also has a [`CLAUDE.md`](CLAUDE.md) and project slash commands in
`.claude/commands/` (`/run-consistency`, `/run-ablation`, `/add-problem`) for working on it
with Claude Code.

## License

[MIT](LICENSE) © 2026 Khang Nguyen
