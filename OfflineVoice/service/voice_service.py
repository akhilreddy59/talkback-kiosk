
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import subprocess
import uuid

BASE = Path(r"D:\OfflineVoice")
MODELS = BASE / "models"
OUTPUT = BASE / "tests"
PYTHON = BASE / "service" / ".venv" / "Scripts" / "python.exe"

app = FastAPI(title="Offline Multilingual Voice Service")

VOICES = {
    "en": "en_US-amy-medium",
    "hi": "hi_IN-priyamvada-medium",
    "te": "te_IN-maya-medium",
}

class SpeechRequest(BaseModel):
    text: str
    language: str = "auto"

def detect_language(text: str) -> str:
    for char in text:
        code = ord(char)
        if 0x0C00 <= code <= 0x0C7F:
            return "te"
        if 0x0900 <= code <= 0x097F:
            return "hi"
    return "en"

@app.get("/health")
def health():
    return {"status": "running", "voices": list(VOICES.keys())}

@app.post("/speak")
def speak(request: SpeechRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(400, "Text cannot be empty")

    language = request.language.lower()
    if language == "auto":
        language = detect_language(text)

    if language not in VOICES:
        raise HTTPException(400, "Supported languages: en, hi, te")

    voice = VOICES[language]
    model = MODELS / f"{voice}.onnx"

    if not model.exists():
        raise HTTPException(500, f"Voice model not found: {voice}")

    output_file = OUTPUT / f"{uuid.uuid4().hex}.wav"

    try:
        subprocess.run(
            [
                str(PYTHON), "-m", "piper",
                "-m", voice,
                "--data-dir", str(MODELS),
                "-f", str(output_file),
            ],
            input=text,
            text=True,
            capture_output=True,
            check=True,
            timeout=120,
        )
    except subprocess.CalledProcessError as error:
        raise HTTPException(500, error.stderr[-1000:])
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Speech generation timed out")

    return FileResponse(
        output_file,
        media_type="audio/wav",
        filename=f"{language}.wav",
        background=None,
    )
