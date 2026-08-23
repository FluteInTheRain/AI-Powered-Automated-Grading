# -*- coding: utf-8 -*-
"""Provider switch for LLMClient: local llama-server vs. OpenAI's real API.

Both are OpenAI-API-compatible endpoints — LLMClient (llm_client.py) never
changes, only which base_url/model/api_key it's built with. This is the one
place that decision gets made, so every caller (server/, app.py,
experiments/) can switch providers by changing env vars instead of code.
See configs/model.yaml for the full provider reference.

Env vars:
    LLM_PROVIDER    "local" (default) or "openai"
    LLM_BASE_URL    local only — default http://localhost:8080/v1
    LLM_MODEL       local only — default Qwen2.5-Coder-7B-Instruct GGUF
    OPENAI_API_KEY  openai only — required, no default (never hardcode this)
    OPENAI_MODEL    openai only — default gpt-4o-mini

IMPORTANT (determinism): this project's hard requirement — exact-match score
consistency across repeated runs — was only empirically validated for the
local llama-server path (temp=0, fixed seed, --parallel 1). OpenAI's `seed`
parameter is documented as best-effort only, not a bit-exact guarantee, and
its serving stack is opaque to us. The "openai" provider is fine for the
product server (server/, app.py) or exploratory use, but do NOT use it for
experiments/consistency_test.py results without re-validating that
assumption first — see docs/architecture.md.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

from .llm_client import LLMClient

# Loads a repo-root .env if one exists (searches upward from the caller's
# cwd), so OPENAI_API_KEY etc. can live in a gitignored file instead of the
# shell environment. No-op, not an error, if no .env is found — env vars set
# directly in the shell/CI/Docker still take priority (load_dotenv doesn't
# overwrite variables that are already set).
load_dotenv()

_LOCAL_DEFAULT_BASE_URL = "http://localhost:8080/v1"
_LOCAL_DEFAULT_MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M"
_OPENAI_DEFAULT_MODEL = "gpt-4o-mini"


def build_llm_client(provider: str | None = None, seed: int = 0) -> LLMClient:
    """Build an LLMClient for `provider` ("local" or "openai"), falling back
    to the LLM_PROVIDER env var, then "local"."""
    provider = (provider or os.environ.get("LLM_PROVIDER", "local")).lower()

    if provider == "local":
        base_url = os.environ.get("LLM_BASE_URL", _LOCAL_DEFAULT_BASE_URL)
        model = os.environ.get("LLM_MODEL", _LOCAL_DEFAULT_MODEL)
        return LLMClient(base_url=base_url, model=model, seed=seed)

    if provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "LLM_PROVIDER=openai requires OPENAI_API_KEY to be set in the environment."
            )
        model = os.environ.get("OPENAI_MODEL", _OPENAI_DEFAULT_MODEL)
        return LLMClient(base_url=None, model=model, api_key=api_key, seed=seed)

    raise ValueError(f"Unknown LLM_PROVIDER: {provider!r} (expected 'local' or 'openai')")
