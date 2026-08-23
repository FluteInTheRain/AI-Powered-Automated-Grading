# AI-Powered Automated Grading

A master's thesis project: a **sub-7B-parameter LLM system for automated
grading of programming assignments**, built around one hard, testable
requirement — **run-to-run score consistency**. Given the exact same
problem statement, rubric, and submission, the system must return the exact
same score every time it's run (temperature=0, greedy decoding, fixed seed,
non-batched inference).

This is a determinism requirement, not a semantic-robustness one:
paraphrased-but-equivalent submissions scoring differently is a separate,
out-of-scope question. What's in scope is that dynamic batching in serving
engines can break *bit-exact* determinism even at temp=0, due to
floating-point non-associativity — so this project treats consistency as
something to measure empirically, not something a config flag guarantees.

## Why hybrid, not "just ask an LLM to grade it"

A single LLM call producing one free-form holistic score has high
run-to-run variance — the model reasons differently each time even at
temp=0 under real serving conditions. Instead, this system:

1. **Scores correctness by running the code for real**, in a sandbox,
   against test cases — deterministic by construction, no LLM involved.
2. **Scores every other rubric dimension** (efficiency, code style,
   edge-case handling) via **small, independent, structured-output LLM
   calls** — one narrow prompt per dimension, each returning a
   JSON-schema-constrained answer (a boolean or a short enum, not free
   text) instead of one long reasoning trace toward a number.
3. **Aggregates the final score in plain code** — a fixed weighted sum,
   never computed or adjusted by the LLM.

Decomposing the rubric into small, closed-form, independently-answerable
checks — instead of one holistic judgment — is itself one of this thesis's
candidate contributions, alongside the empirical consistency measurements.
See [`docs/architecture.md`](docs/architecture.md) for the full design
rationale and the literature it's grounded in.

## Project status

See [`docs/roadmap.md`](docs/roadmap.md) for the phase-by-phase task plan
and current progress (infrastructure → consistency experiments → ablation
→ dataset validation → optional fine-tuning → writing).

## Layout

```
src/grader/       grading pipeline (sandbox, LLM checks, aggregation)
prompts/          one prompt per rubric dimension, scoped narrowly
experiments/      consistency test, ablation, metrics
configs/          model/serving config (determinism-relevant settings)
data/             pilot dataset + generator (problems.py, build_dataset.py)
docs/             architecture notes, roadmap, literature references
results/          experiment outputs (gitignored, dir kept)
server/, frontend/ product API + React app (see "Product server" below)
deploy/           single-VM deployment for an internal demo (deploy/README.md)
.claude/commands/ project-specific slash commands (see below)
```

## Running locally

### Prerequisites

- Python 3.10+ and Node.js 18+
- [`llama.cpp`](https://github.com/ggml-org/llama.cpp) for local model serving
  (`brew install llama.cpp` on macOS) — the project targets Apple Silicon
  (Metal) by default, see `configs/model.yaml` for why (no vLLM/CUDA path
  here)
- Docker, only if you're running the product server (Postgres)

No API keys are needed for the default (local) setup — `src/grader/llm_client.py`
talks to the local llama-server over its OpenAI-compatible API with a dummy
key. An `OPENAI_API_KEY` is only needed if you switch providers — see
"Switching to the OpenAI API" below.

### 1. Install dependencies

```
pip install -r requirements.txt
python3 data/build_dataset.py     # regenerates data/dataset.json locally (never committed)
```

### 2. Start the local model server

```
scripts/model_server.sh start     # pulls/serves Qwen2.5-Coder-7B-Instruct (Q4_K_M) on :8080
scripts/model_server.sh status    # check it's healthy
scripts/model_server.sh stop
```

This wraps `llama-server` with the settings `configs/model.yaml` assumes
(`--seed 0`, port 8080). Add `--parallel N` for batched serving; see
`configs/model.yaml` for why that matters for the consistency experiment.

### 3. Run the thesis pipeline

With the model server up, either run an experiment directly:

```
python3 experiments/consistency_test.py --sample_id P01_two_sum__S1_correct_clean --n 100
```

or explore the pipeline interactively via the Streamlit demo:

```
streamlit run app.py              # http://localhost:8501
```

### 4. Product server (exam links) — optional

Separate from the thesis pipeline above: `server/` + `frontend/` are a
product slice that lets a teacher author a problem and share an exam link
with students (see `docs/productionization.md`). This needs a Postgres DB
and the model server from step 2:

```
docker compose up -d              # starts local Postgres (postgres:16) on :5433
alembic upgrade head              # creates the problems/exams/submissions tables
uvicorn server.main:app --reload --port 8001
cd frontend && npm install && npm run dev    # http://localhost:5173
```

`DATABASE_URL` defaults to `postgresql+psycopg://grading:grading@localhost:5433/grading`
(matching `docker-compose.yml`); override it in the environment to point at
a different Postgres instance. This DB is entirely separate from
`data/problems.py`/`data/dataset.json` — the thesis pipeline has no
database dependency. `server/config.py` builds its LLM client via the
provider switch described next.

To put this in front of other people instead of running it locally, see
[`deploy/README.md`](deploy/README.md) — a single-GPU-VM setup for an
internal/trusted demo (**not** hardened for public, unknown-student use —
that runbook says exactly what's still missing before it would be).

### Switching to the OpenAI API

Every LLM call in this project goes through `src/grader/llm_client.py`, a
thin wrapper around any OpenAI-API-compatible endpoint. `src/grader/llm_config.py`
is a small adapter on top of it that picks the endpoint/model/key from env
vars, so you can swap the local llama-server for the real OpenAI API without
touching code:

```
export LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o-mini      # optional, this is the default
```

Leave `LLM_PROVIDER` unset (or `local`) to keep using the local model server
(`LLM_BASE_URL`/`LLM_MODEL` env vars, as before). This switch is used by
`server/` (product server), `app.py` (Streamlit demo has a Provider toggle
in the sidebar), and optionally by `experiments/consistency_test.py`/
`ablation.py` via `--provider openai`.

**Determinism caveat:** this project's core thesis claim — exact-match score
consistency — is only empirically validated for the local llama-server path
(`--parallel 1`, fixed seed). OpenAI's `seed` parameter is documented as
best-effort, not a bit-exact guarantee, so don't use the `openai` provider
to produce `experiments/consistency_test.py` results without re-validating
that assumption first. It's fine for the product server or exploratory use.

## Working with Claude Code on this project

This repo has a `CLAUDE.md` (project rules and conventions) and a few
project-specific slash commands for the repetitive parts of running this
project:

| Command | Does |
|---|---|
| `/run-consistency <sample_id> [n]` | Runs the consistency experiment, reports a terse summary |
| `/run-ablation` | Runs the free-form vs. hybrid vs. decomposed comparison |
| `/add-problem <spec>` | Scaffolds a new problem into `data/problems.py`, regenerates the dataset |
| `/thesis-section <name>` | Drafts a report section from what's actually in `docs/` and `results/` |

## Known dataset limitation

The 65-sample pilot dataset (16 problems) has real, sandbox-executed labels for
correctness and edge-case handling, but efficiency/style labels are
single-rater (self-annotated by the author), not independent human ground
truth. Full detail and what's needed to fix it before making a
correlation-with-humans claim: [`data/script.md`](data/script.md).
