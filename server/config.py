# -*- coding: utf-8 -*-
"""Shared model/serving constants for server/*.py routers, kept in one place
so server/main.py and server/exam.py can't drift out of sync. Matches
configs/model.yaml (the source of truth for grading-pipeline determinism
settings)."""

BASE_URL = "http://localhost:8080/v1"
MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"
