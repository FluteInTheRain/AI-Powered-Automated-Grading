"""grader.llm_client: the Cloudflare Workers AI deviations (bare schema, dict
content) and the LLM_API_KEY handling. No network: the OpenAI SDK's create is faked."""
import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from grader.llm_client import LLMClient

CF_URL = "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1"
LOCAL_URL = "http://localhost:8080/v1"


class Out(BaseModel):
    score: int


def _fake(client, content, finish_reason="stop"):
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        message = SimpleNamespace(content=content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish_reason)])

    client.client.chat.completions.create = create
    return calls


def test_cloudflare_sends_bare_schema_and_accepts_dict_content():
    c = LLMClient(CF_URL, "m", api_key="k")
    calls = _fake(c, {"score": 3})
    assert c.structured_call("sys", "usr", Out).score == 3
    kw = calls[0]
    assert kw["response_format"] == {"type": "json_schema", "json_schema": Out.model_json_schema()}
    assert kw["temperature"] == 0 and kw["seed"] == 0 and kw["model"] == "m"
    raw = c.call_log[0]["raw_response"]
    assert isinstance(raw, str) and json.loads(raw) == {"score": 3}


def test_other_url_sends_name_schema_wrapper():
    c = LLMClient(LOCAL_URL, "m", api_key="k")
    calls = _fake(c, '{"score": 4}')
    assert c.structured_call("sys", "usr", Out).score == 4
    assert calls[0]["response_format"] == {
        "type": "json_schema", "json_schema": {"name": "Out", "schema": Out.model_json_schema()}}
    assert c.call_log[0]["raw_response"] == '{"score": 4}'


def test_dict_content_from_non_cloudflare_url_raises():
    c = LLMClient(LOCAL_URL, "m", api_key="k")
    _fake(c, {"score": 3})
    with pytest.raises(RuntimeError, match="non-string"):
        c.structured_call("sys", "usr", Out)
    assert c.call_log == []


@pytest.mark.parametrize("url", [CF_URL, LOCAL_URL])
def test_none_content_raises_with_finish_reason(url):
    c = LLMClient(url, "m", api_key="k")
    _fake(c, None, finish_reason="length")
    with pytest.raises(RuntimeError, match="finish_reason=length"):
        c.structured_call("sys", "usr", Out)
    assert c.call_log == []


def test_api_key_from_env_when_not_given(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "from-env")
    assert LLMClient(CF_URL, "m").client.api_key == "from-env"
    assert LLMClient(CF_URL, "m", api_key="explicit").client.api_key == "explicit"


def test_api_key_placeholder_without_env(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert LLMClient(LOCAL_URL, "m").client.api_key == "not-needed"
