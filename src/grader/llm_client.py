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
from typing import Type, TypeVar

from openai import OpenAI
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMClient:
    def __init__(self, base_url: str, model: str, api_key: str = "not-needed", seed: int = 0):
        self.client = OpenAI(base_url=base_url, api_key=api_key)
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
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            seed=self.seed,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            },
        )
        raw = response.choices[0].message.content
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
