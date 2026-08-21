# -*- coding: utf-8 -*-
"""Shared model/serving constants for server/*.py routers, kept in one place
so server/main.py and server/exam.py can't drift out of sync. Matches
configs/model.yaml (the source of truth for grading-pipeline determinism
settings).

Both are overridable via env vars so the same image/checkout can point at a
llama-server on a different host (e.g. deploy/ — backend and GPU box are the
same VM there, so the localhost default still works, but this keeps that an
assumption, not a hardcoded fact).
"""
import os

BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8080/v1")
MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M")
