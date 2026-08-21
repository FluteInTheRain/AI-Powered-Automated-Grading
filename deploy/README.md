# Deploying the internal demo

This is a single-VM deployment for a **trusted, internal demo** (a handful
of known people — teacher + a few students trying it out), not a public
rollout. Before scoping this out wider:

> **Do not share this deployment's link with unknown/real students at
> scale before addressing `docs/productionization.md` PR-A1** — the
> sandbox (`src/grader/sandbox.py`) runs submitted code via `exec()`
> directly in the backend's own process, with no CPU/memory limit or
> filesystem/network isolation. For a small trusted group this is an
> accepted, known risk (per the decision recorded when this was set up);
> it stops being acceptable the moment the link reaches people you don't
> know and trust.

## What this deploys

One VM with a GPU, running:
- `llama-server` (Qwen2.5-Coder-7B-Instruct, CUDA build) — **native**
  systemd service, for direct GPU access (no nvidia-docker toolkit needed).
- Postgres, the FastAPI backend, and nginx (serving the built frontend +
  reverse-proxying `/api/*` to the backend) — all three via Docker Compose
  (`deploy/docker-compose.prod.yml`).

## 1. Rent a GPU VM

Qwen2.5-Coder-7B-Instruct at Q4_K_M needs roughly 5-6GB of VRAM, so any
8GB+ card is enough (RTX 3090/4090, A10, L4, ...) — no need for anything
exotic. Options: RunPod, Lambda Labs, Vast.ai, or a mainstream cloud
provider's GPU instance. Pick **Ubuntu 22.04**, and prefer a provider/image
that already has the NVIDIA driver installed (most GPU-rental images do —
confirm with `nvidia-smi` right after first boot).

SSH in, then:

```
sudo apt update && sudo apt install -y build-essential cmake git curl ufw
```

## 2. Build llama-server with CUDA support

```
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j"$(nproc)"
sudo cp build/bin/llama-server /usr/local/bin/llama-server
llama-server --version   # sanity check
```

(A CUDA-prebuilt release binary from llama.cpp's GitHub releases can work
too, but the CUDA version has to line up with the driver on the VM —
building from source sidesteps that mismatch entirely, and it's what these
instructions assume from here on.)

## 3. Run llama-server as a systemd service

```
sudo useradd --system --no-create-home llama
sudo cp deploy/llama-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now llama-server
sudo systemctl status llama-server   # wait for it to report active
curl http://localhost:8080/health    # should return {"status":"ok"} once the model finishes loading
```

First start downloads the GGUF from Hugging Face (`-hf` flag) — that can
take a few minutes depending on the VM's network. Watch progress with
`journalctl -u llama-server -f`.

## 4. Lock down the firewall

`llama-server` binds `0.0.0.0` (see the comment in
`deploy/llama-server.service` for why — the backend reaches it from inside
a Docker container, not via loopback), so it's important this port isn't
reachable from outside the VM. Only 22, 80, and 443 should be:

```
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

## 5. Install Docker

```
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

## 6. Deploy the app

```
git clone <this repo's URL>
cd AI-Powered-Automated-Grading
cp deploy/.env.example deploy/.env
# edit deploy/.env — set a real POSTGRES_PASSWORD at minimum
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

This builds and starts three containers (`db`, `backend`, `frontend`);
`backend`'s entrypoint (`deploy/backend-entrypoint.sh`) runs `alembic
upgrade head` automatically before starting the API, so the schema is
created on first boot with no manual migration step.

Verify:

```
curl http://localhost/api/teacher/problems   # -> []
docker compose -f deploy/docker-compose.prod.yml logs -f backend
```

Then open `http://<the VM's public IP>/` in a browser — that's the
teacher's problem-authoring page (`TeacherHomePage`).

## 7. (Recommended) put a domain + HTTPS in front of it

Even for a small trusted group, plain HTTP means submission code and
student names travel unencrypted. If you have a domain, point an A record
at the VM, then:

```
sudo apt install -y certbot python3-certbot-nginx
```

— note `deploy/nginx.conf` runs *inside* the `frontend` container, not on
the host, so `certbot --nginx` won't work as-is against it. The simplest
path: run a host-level nginx (or Caddy, which does this in one line) in
front of the `frontend` container's port 80, terminating TLS there and
proxying to `localhost:80`. Not scripted here since it depends on whether
you're using nginx or Caddy and what your DNS setup looks like — flag it
if you want this wired up concretely once a domain is picked.

## Redeploying after a code change

```
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

`llama-server` doesn't need restarting for app-code changes — only if
`deploy/llama-server.service` itself changes
(`sudo systemctl restart llama-server`).

## Before widening access beyond the initial trusted group

Checklist, cross-referenced to `docs/productionization.md`:

- [ ] **PR-A1 — sandbox isolation.** The real blocker. Do this first.
- [ ] **PR-A2** if any submission needs a language other than Python.
- [ ] **PR-D1** (queueing) if concurrent submissions start piling up —
  right now every `/submit` call is a synchronous ~4-LLM-call round trip
  against a single `llama-server`; a burst of simultaneous submissions
  will just queue up behind each other, not fail, but will get slow.
- [ ] **PR-E3** (plagiarism/similarity check) before any score here counts
  toward a real grade.
