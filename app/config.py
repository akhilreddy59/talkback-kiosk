"""Small environment-based configuration for TalkBack."""

from dataclasses import dataclass
import ipaddress
import os
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    ollama_host: str = "http://127.0.0.1:11434"
    default_model: str = "qwen2.5-coder:7b"
    timeout_seconds: float = 120
    max_output_tokens: int = 128

    @classmethod
    def from_environment(cls) -> "Settings":
        host = os.getenv("OLLAMA_HOST", cls.ollama_host).rstrip("/")
        model = os.getenv("TALKBACK_DEFAULT_MODEL", cls.default_model).strip()
        try:
            timeout = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
        except ValueError as exc:
            raise ValueError("OLLAMA_TIMEOUT_SECONDS must be a number.") from exc
        if not 1 <= timeout <= 600:
            raise ValueError("OLLAMA_TIMEOUT_SECONDS must be between 1 and 600.")
        try:
            max_output_tokens = int(os.getenv("TALKBACK_MAX_OUTPUT_TOKENS", "128"))
        except ValueError as exc:
            raise ValueError("TALKBACK_MAX_OUTPUT_TOKENS must be a whole number.") from exc
        if not 1 <= max_output_tokens <= 8192:
            raise ValueError("TALKBACK_MAX_OUTPUT_TOKENS must be between 1 and 8192.")
        _require_local_host(host)
        return cls(host, model, timeout, max_output_tokens)


def _require_local_host(host: str) -> None:
    """Keep Local Only mode from forwarding chat to a non-local host."""
    parsed = urlsplit(host)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("OLLAMA_HOST must be a valid local HTTP URL.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
        is_local = address.is_loopback
    except ValueError:
        is_local = parsed.hostname.lower() == "localhost"
    if not is_local:
        raise ValueError("Local Only mode requires OLLAMA_HOST to use localhost or a loopback IP.")

