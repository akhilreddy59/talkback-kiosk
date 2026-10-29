"""HTTP client for the user's existing local Ollama service."""

import json

import httpx


class OllamaError(Exception):
    """A safe, user-displayable error returned while talking to Ollama."""


class OllamaTimeoutError(OllamaError):
    """Ollama did not answer before the configured deadline."""


class OllamaClient:
    def __init__(
        self,
        host: str,
        timeout_seconds: float = 120,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.host = host.rstrip("/")
        self.timeout = httpx.Timeout(timeout_seconds, connect=3)
        self.transport = transport

    async def models(self) -> list[dict]:
        data = await self._get("/api/tags")
        return data.get("models", [])

    async def stream_chat(
        self,
        model: str,
        message: str,
        language: str,
        max_output_tokens: int,
    ):
        instructions = {
            "en": "Answer directly and naturally in English. Keep replies concise unless the user asks for detail.",
            "hi": "स्वाभाविक और सीधी हिन्दी में उत्तर दें। जब तक उपयोगकर्ता विस्तार न माँगे, संक्षिप्त रहें।",
            "te": "సహజమైన తెలుగులో నేరుగా సమాధానం ఇవ్వండి. వివరాలు అడగనంతవరకు సంక్షిప్తంగా ఉంచండి.",
        }
        if language not in instructions:
            raise OllamaError("Choose English, Hindi, or Telugu before sending a message.")

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions[language]},
                {"role": "user", "content": message},
            ],
            "options": {"num_predict": max_output_tokens},
            "stream": True,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                async with client.stream("POST", f"{self.host}/api/chat", json=payload) as response:
                    response.raise_for_status()
                    completed = False
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError as exc:
                            raise OllamaError("Ollama sent an invalid chat stream. Please try again.") from exc
                        if data.get("error"):
                            raise OllamaError("Ollama could not complete the response. Please try again.")
                        content = data.get("message", {}).get("content")
                        if isinstance(content, str) and content:
                            yield {"type": "delta", "text": content}
                        if data.get("done"):
                            completed = True
                            yield {
                                "type": "done",
                                "metrics": {
                                    name: data.get(name)
                                    for name in (
                                        "total_duration",
                                        "load_duration",
                                        "prompt_eval_count",
                                        "prompt_eval_duration",
                                        "eval_count",
                                        "eval_duration",
                                    )
                                },
                            }
                            return
                    if not completed:
                        raise OllamaError("Ollama ended the response before it was complete. Please try again.")
        except httpx.ConnectError as exc:
            raise OllamaError("Ollama is not responding. Start Ollama and try again.") from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError("Ollama took too long to answer. Try again in a moment.") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise OllamaError("That model is not available in Ollama. Refresh the model list.") from exc
            raise OllamaError("Ollama could not complete the chat request.") from exc
        except httpx.HTTPError as exc:
            raise OllamaError("TalkBack lost its connection to Ollama. Please try again.") from exc

    async def _get(self, path: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(f"{self.host}{path}")
                response.raise_for_status()
                return response.json()
        except httpx.ConnectError as exc:
            raise OllamaError("Ollama is not responding. Start Ollama and try again.") from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError("Ollama took too long to respond. Try again in a moment.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise OllamaError("TalkBack could not read the model list from Ollama.") from exc

    async def _post(self, path: str, payload: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.host}{path}", json=payload)
                response.raise_for_status()
                return response.json()
        except httpx.ConnectError as exc:
            raise OllamaError("Ollama is not responding. Start Ollama and try again.") from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError("Ollama took too long to answer. Try again in a moment.") from exc
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise OllamaError("That model is not available in Ollama. Refresh the model list.") from exc
            raise OllamaError("Ollama could not complete the chat request.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise OllamaError("TalkBack could not read Ollama's response.") from exc

