# -*- coding: utf-8 -*-
"""Shared LLM client factory for server/*.py routers, kept in one place so
server/main.py and server/exam.py can't drift out of sync. Delegates to
grader.llm_config, which switches between the local llama-server and OpenAI's
API based on the LLM_PROVIDER env var (default "local") — see that module's
docstring and configs/model.yaml for the full provider reference and the
determinism caveat on the "openai" path.
"""
from grader.llm_config import build_llm_client


def get_llm_client(seed: int = 0):
    return build_llm_client(seed=seed)
