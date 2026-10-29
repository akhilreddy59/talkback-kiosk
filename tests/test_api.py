import asyncio
import json

import httpx

from app.config import Settings
from app.main import create_app
from app.ollama import OllamaError


def request(app, method, path, json_body=None):
    async def send():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as client:
            return await client.request(method, path, json=json_body)

    return asyncio.run(send())


def events(response):
    return [json.loads(line) for line in response.text.splitlines() if line]


class FakeOllama:
    def __init__(self):
        self.available = True
        self.fail_after_text = False
        self.calls = []

    async def models(self):
        if not self.available:
            raise OllamaError("Ollama is not responding. Start Ollama and try again.")
        return [{"name": "qwen2.5-coder:7b", "size": 4_700_000_000}]

    async def stream_chat(self, model, message, language, max_output_tokens):
        self.calls.append((model, message, language, max_output_tokens))
        yield {"type": "delta", "text": "Hello "}
        if self.fail_after_text:
            raise OllamaError("Ollama ended the response unexpectedly.")
        yield {"type": "delta", "text": "from the local model."}
        yield {
            "type": "done",
            "metrics": {
                "total_duration": 3_000_000_000,
                "load_duration": 400_000_000,
                "prompt_eval_count": 10,
                "prompt_eval_duration": 600_000_000,
                "eval_count": 5,
                "eval_duration": 2_000_000_000,
            },
        }


def app_with(client):
    app = create_app(client)
    app.state.ollama = client
    return app


def test_health_and_installed_models():
    client = FakeOllama()
    app = app_with(client)
    assert request(app, "GET", "/api/health").json() == {"backend": "ok", "ollama": "connected", "model_count": 1}
    response = request(app, "GET", "/api/models")
    assert response.status_code == 200
    assert response.json()["models"][0]["name"] == "qwen2.5-coder:7b"
    assert response.json()["default_model"] == "qwen2.5-coder:7b"


def test_chat_streams_text_and_final_metrics():
    client = FakeOllama()
    response = request(
        app_with(client),
        "POST",
        "/api/chat",
        {"message": "Hello", "model": "qwen2.5-coder:7b", "language": "te"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    stream_events = events(response)
    assert [event["type"] for event in stream_events] == ["delta", "delta", "done"]
    assert "".join(event["text"] for event in stream_events if event["type"] == "delta") == "Hello from the local model."
    metrics = stream_events[-1]["metrics"]
    assert metrics["duration_ms"] >= 0
    assert metrics["load_ms"] == 400
    assert metrics["prompt_tokens"] == 10
    assert metrics["output_tokens"] == 5
    assert metrics["tokens_per_second"] == 2.5
    assert client.calls == [("qwen2.5-coder:7b", "Hello", "te", 128)]


def test_stream_error_is_a_readable_event_after_partial_text():
    client = FakeOllama()
    client.fail_after_text = True
    response = request(
        app_with(client),
        "POST",
        "/api/chat",
        {"message": "Hello", "model": "qwen2.5-coder:7b"},
    )
    stream_events = events(response)
    assert stream_events[0] == {"type": "delta", "text": "Hello "}
    assert stream_events[1] == {"type": "error", "message": "Ollama ended the response unexpectedly."}


def test_chat_rejects_uninstalled_model():
    client = FakeOllama()
    response = request(
        app_with(client), "POST", "/api/chat", {"message": "Hello", "model": "not-installed"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Choose a model from the installed model list."
    assert not client.calls


def test_ollama_unavailable_keeps_health_and_model_errors_clear():
    ollama = FakeOllama()
    ollama.available = False
    app = app_with(ollama)
    assert request(app, "GET", "/api/health").json()["ollama"] == "unavailable"
    response = request(app, "GET", "/api/models")
    assert response.status_code == 503
    assert "Start Ollama" in response.json()["detail"]


def test_empty_message_and_invalid_language_are_rejected():
    client = FakeOllama()
    app = app_with(client)
    empty = request(app, "POST", "/api/chat", {"message": "", "model": "qwen2.5-coder:7b"})
    invalid_language = request(
        app, "POST", "/api/chat", {"message": "Hi", "model": "qwen2.5-coder:7b", "language": "fr"}
    )
    assert empty.status_code == 422
    assert invalid_language.status_code == 422


def test_output_limit_is_configurable(monkeypatch):
    monkeypatch.setenv("TALKBACK_MAX_OUTPUT_TOKENS", "64")
    assert Settings.from_environment().max_output_tokens == 64

