import asyncio
import json

import httpx
import pytest

from app.ollama import OllamaClient, OllamaError


def test_ollama_request_streams_and_sends_language_and_output_limit():
    requests = []
    body = "\n".join(
        [
            json.dumps({"message": {"content": "సూటి సమాధానం"}, "done": False}),
            json.dumps(
                {
                    "message": {"content": ""},
                    "done": True,
                    "total_duration": 900_000_000,
                    "load_duration": 100_000_000,
                    "prompt_eval_count": 12,
                    "prompt_eval_duration": 200_000_000,
                    "eval_count": 6,
                    "eval_duration": 600_000_000,
                }
            ),
        ]
    ) + "\n"

    async def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, content=body)

    client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(handler))

    async def collect():
        return [event async for event in client.stream_chat("qwen2.5-coder:7b", "హాయ్", "te", 128)]

    events = asyncio.run(collect())
    payload = requests[0]
    assert payload["stream"] is True
    assert payload["options"]["num_predict"] == 128
    assert "keep_alive" not in payload
    assert payload["messages"][0]["role"] == "system"
    assert "తెలుగులో" in payload["messages"][0]["content"]
    assert payload["messages"][1] == {"role": "user", "content": "హాయ్"}
    assert events[0] == {"type": "delta", "text": "సూటి సమాధానం"}
    assert events[-1]["metrics"]["eval_count"] == 6


def test_ollama_error_frame_is_sanitized():
    async def handler(_request):
        return httpx.Response(200, content=b'{"error":"internal detail"}\n')

    client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(handler))

    async def collect():
        return [event async for event in client.stream_chat("qwen2.5-coder:7b", "Hi", "en", 128)]

    with pytest.raises(OllamaError, match="could not complete the response"):
        asyncio.run(collect())


def test_ollama_invalid_ndjson_is_reported_clearly():
    async def handler(_request):
        return httpx.Response(200, content=b"not json\n")

    client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(handler))

    async def collect():
        return [event async for event in client.stream_chat("qwen2.5-coder:7b", "Hi", "en", 128)]

    with pytest.raises(OllamaError, match="invalid chat stream"):
        asyncio.run(collect())


def test_canceling_stream_closes_ollama_response():
    async def exercise():
        class WaitingStream(httpx.AsyncByteStream):
            def __init__(self):
                self.waiting = asyncio.Event()
                self.closed = False

            async def __aiter__(self):
                yield b'{"message":{"content":"first"},"done":false}\n'
                self.waiting.set()
                await asyncio.Event().wait()

            async def aclose(self):
                self.closed = True

        upstream = WaitingStream()

        async def handler(_request):
            return httpx.Response(200, stream=upstream)

        client = OllamaClient("http://127.0.0.1:11434", transport=httpx.MockTransport(handler))

        async def consume():
            async for _event in client.stream_chat("qwen2.5-coder:7b", "Hi", "en", 128):
                pass

        task = asyncio.create_task(consume())
        await asyncio.wait_for(upstream.waiting.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert upstream.closed

    asyncio.run(exercise())
