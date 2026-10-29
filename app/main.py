"""TalkBack's local-only FastAPI application."""

from contextlib import asynccontextmanager
import json
from pathlib import Path
import time
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import Settings
from app.ollama import OllamaClient, OllamaError, OllamaTimeoutError

STATIC_DIR = Path(__file__).parent / "static"


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    model: str = Field(min_length=1, max_length=200)
    language: Literal["en", "hi", "te"] = "en"


def _ndjson(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"


def _milliseconds(nanoseconds: object) -> float | None:
    if isinstance(nanoseconds, (int, float)) and nanoseconds >= 0:
        return round(nanoseconds / 1_000_000, 2)
    return None


def create_app(client: OllamaClient | None = None) -> FastAPI:
    settings = Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.ollama = client or OllamaClient(settings.ollama_host, settings.timeout_seconds)
        yield

    app = FastAPI(title="TalkBack", version="0.1.0", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/")
    async def home():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/health")
    async def health(request: Request):
        try:
            models = await request.app.state.ollama.models()
            return {"backend": "ok", "ollama": "connected", "model_count": len(models)}
        except OllamaError as exc:
            return {"backend": "ok", "ollama": "unavailable", "error": str(exc)}

    @app.get("/api/models")
    async def models(request: Request):
        try:
            installed = await request.app.state.ollama.models()
        except OllamaError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return {"models": installed, "default_model": settings.default_model}

    @app.post("/api/chat")
    async def chat(payload: ChatRequest, request: Request):
        try:
            installed = await request.app.state.ollama.models()
        except OllamaError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        names = {item.get("name") or item.get("model") for item in installed}
        if payload.model not in names:
            raise HTTPException(status_code=400, detail="Choose a model from the installed model list.")

        async def events():
            started = time.perf_counter()
            first_token_ms = None
            received_text = False
            ollama_stream = request.app.state.ollama.stream_chat(
                payload.model,
                payload.message.strip(),
                payload.language,
                settings.max_output_tokens,
            )
            try:
                async for event in ollama_stream:
                    if event.get("type") == "delta":
                        chunk = event.get("text")
                        if not isinstance(chunk, str) or not chunk:
                            continue
                        received_text = True
                        if first_token_ms is None:
                            first_token_ms = round((time.perf_counter() - started) * 1000, 2)
                        yield _ndjson({"type": "delta", "text": chunk})
                    elif event.get("type") == "done":
                        if not received_text:
                            yield _ndjson({"type": "error", "message": "Ollama returned an empty answer. Please try again."})
                            return
                        stats = event.get("metrics") or {}
                        eval_count = stats.get("eval_count")
                        eval_duration = stats.get("eval_duration")
                        tokens_per_second = None
                        if isinstance(eval_count, (int, float)) and isinstance(eval_duration, (int, float)) and eval_duration > 0:
                            tokens_per_second = round(eval_count / (eval_duration / 1_000_000_000), 2)
                        metrics = {
                            "duration_ms": round((time.perf_counter() - started) * 1000),
                            "time_to_first_token_ms": first_token_ms,
                            "ollama_total_ms": _milliseconds(stats.get("total_duration")),
                            "load_ms": _milliseconds(stats.get("load_duration")),
                            "prompt_eval_ms": _milliseconds(stats.get("prompt_eval_duration")),
                            "generation_ms": _milliseconds(eval_duration),
                            "prompt_tokens": stats.get("prompt_eval_count"),
                            "output_tokens": eval_count,
                            "tokens_per_second": tokens_per_second,
                        }
                        yield _ndjson({"type": "done", "model": payload.model, "metrics": metrics})
                        return
                    else:
                        raise OllamaError("TalkBack received an unexpected event from Ollama.")
                yield _ndjson({"type": "error", "message": "The response ended before it was complete. Please try again."})
            except OllamaTimeoutError as exc:
                yield _ndjson({"type": "error", "message": str(exc)})
            except OllamaError as exc:
                yield _ndjson({"type": "error", "message": str(exc)})
            except Exception:
                yield _ndjson({"type": "error", "message": "The local model stream failed. Please try again."})
            finally:
                close = getattr(ollama_stream, "aclose", None)
                if close is not None:
                    await close()

        return StreamingResponse(
            events(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()

