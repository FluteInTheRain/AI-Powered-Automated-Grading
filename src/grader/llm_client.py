# -*- coding: utf-8 -*-
"""Thin wrapper around an OpenAI-compatible endpoint (llama.cpp's llama-server
by default; anything OpenAI-compatible works).

Determinism knobs live here, in one place, so every caller gets them for free:
temperature=0, a fixed seed, and guided/structured decoding against a pydantic
schema. NOTE: the serving engine's dynamic batching can still break bit-exact
determinism even with these settings — that must be measured empirically (see
experiments/consistency_test.py), not assumed away by config.
"""
from __future__ import annotations

import json
import os
import warnings
from typing import Type, TypeVar
from urllib.parse import urlparse

from openai import OpenAI
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMClient:
    def __init__(self, base_url: str, model: str, api_key: str | None = None, seed: int = 0):
        # A local llama-server ignores the key. Hosted OpenAI-compatible
        # endpoints (e.g. Cloudflare Workers AI) need a real one, read from
        # LLM_API_KEY so it never sits in code, CLI args or shell history.
        if api_key is None:
            api_key = os.environ.get("LLM_API_KEY", "not-needed")
        self.client = OpenAI(base_url=base_url, api_key=api_key)
        # Cloudflare Workers AI's OpenAI-compatible endpoint deviates in two
        # ways: it reads response_format.json_schema as the schema itself
        # (the standard {"name", "schema"} wrapper is accepted but leaves
        # the output unconstrained), and it returns message.content as an
        # already-parsed JSON object instead of a string.
        self._cloudflare = "api.cloudflare.com" in base_url
        if urlparse(base_url).hostname == "gateway.ai.cloudflare.com":
            # Not treated as Cloudflare above: how Workers AI behind AI
            # Gateway handles response_format.json_schema is unverified, so
            # the request shape is left as for any other OpenAI-compatible
            # endpoint. A warning (not logging) so it shows once at the
            # construction site even with no logging configured.
            warnings.warn(
                "base_url is Cloudflare AI Gateway: json_schema shape handling for "
                "Workers AI behind AI Gateway is unverified; structured_call may fail "
                "(non-string content) or return unconstrained output.",
                UserWarning, stacklevel=2,
            )
        self.model = model
        self.seed = seed
        # Every call this instance makes, in order — purely additive
        # bookkeeping for the audit trail (server/teacher.py's
        # submission-audit endpoint persists this to GradingLog rows after
        # grading finishes). Never read by grading logic itself, so it can't
        # affect a score; callers that don't care just never look at it.
        self.call_log: list[dict] = []

    def structured_call(self, system_prompt: str, user_prompt: str, schema: Type[T]) -> T:
        """One request, no batching side effects on this end (the server may
        still batch across concurrent requests — call sequentially for
        consistency experiments)."""
        json_schema = schema.model_json_schema()
        if not self._cloudflare:
            json_schema = {"name": schema.__name__, "schema": json_schema}
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            seed=self.seed,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_schema", "json_schema": json_schema},
        )
        content = response.choices[0].message.content
        if content is None:
            raise RuntimeError(
                f"{self.model}: empty message.content, finish_reason={response.choices[0].finish_reason}"
            )
        if not isinstance(content, str):
            # Only Workers AI returns a parsed object. Seeing one from any
            # other base_url (e.g. Workers AI behind AI Gateway or a proxy)
            # means json_schema went out in the wrong shape and the output
            # was NOT schema-constrained, so fail instead of grading on it.
            if not self._cloudflare:
                raise RuntimeError(
                    f"{self.model}: non-string message.content from a non-Cloudflare base_url; "
                    "json_schema was likely sent in the wrong shape (output unconstrained)"
                )
            content = json.dumps(content, ensure_ascii=False)
        raw = content
        self.call_log.append({
            "kind": "structured",
            "schema": schema.__name__,
            "model": self.model,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "raw_response": raw,
        })
        return schema.model_validate(json.loads(raw))

    def free_form_call(self, system_prompt: str, user_prompt: str) -> str:
        """No schema, no constrained decoding — this is deliberately the
        'naive' arm for the ablation (see experiments/ablation.py): a single
        free-text response the caller must parse itself."""
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            seed=self.seed,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = response.choices[0].message.content
        self.call_log.append({
            "kind": "free_form",
            "schema": None,
            "model": self.model,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "raw_response": content,
        })
        return content
