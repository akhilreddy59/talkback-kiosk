
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import subprocess
import uuid

# --------------------------------------------------
# PATH CONFIGURATION
# --------------------------------------------------

BASE = Path(r"D:\OfflineVoice")
MODELS = BASE / "models"
OUTPUT = BASE / "tests"

PYTHON = BASE / "service" / ".venv" / "Scripts" / "python.exe"

MODELS.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------
# FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(title="Offline Multilingual Voice Service")

# --------------------------------------------------
# VOICE MODELS
# --------------------------------------------------

VOICES = {
    "en": "en_US-amy-medium",
    "hi": "hi_IN-priyamvada-medium",
    "te": "te_IN-maya-medium",
}

# --------------------------------------------------
# REQUEST MODEL
# --------------------------------------------------

class SpeechRequest(BaseModel):
    text: str
    language: str = "auto"


# --------------------------------------------------
# LANGUAGE DETECTION
# --------------------------------------------------

def detect_language(text: str) -> str:

    for char in text:

        code = ord(char)

        # Telugu
        if 0x0C00 <= code <= 0x0C7F:
            return "te"

        # Hindi
        if 0x0900 <= code <= 0x097F:
            return "hi"

    return "en"


# --------------------------------------------------
# HEALTH CHECK
# --------------------------------------------------

@app.get("/health")
def health():

    return {
        "status": "running",
        "voices": list(VOICES.keys()),
        "models_directory": str(MODELS),
    }


# --------------------------------------------------
# SPEECH GENERATION
# --------------------------------------------------

@app.post("/speak")
def speak(request: SpeechRequest):

    text = request.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty"
        )

    # Debug: inspect incoming Unicode text
    print("INPUT:", repr(text), flush=True)

    print(
        "UNICODE:",
        [hex(ord(char)) for char in text],
        flush=True
    )

    # Detect language
    language = request.language.lower().strip()

    if language == "auto":
        language = detect_language(text)

    if language not in VOICES:
        raise HTTPException(
            status_code=400,
            detail="Supported languages: en, hi, te"
        )

    voice = VOICES[language]

    model = MODELS / f"{voice}.onnx"

    if not model.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Voice model not found: {model}"
        )

    # Unique output file
    output_file = OUTPUT / f"{uuid.uuid4().hex}.wav"

    command = [
        str(PYTHON),
        "-m",
        "piper",
        "-m",
        voice,
        "--data-dir",
        str(MODELS),
        "-f",
        str(output_file),
    ]

    try:

        print("Selected language:", language, flush=True)
        print("Selected voice:", voice, flush=True)

        subprocess.run(
            command,
            input=text.encode("utf-8"),
            capture_output=True,
            check=True,
            timeout=120,
        )

        # Validate generated WAV
        if not output_file.exists() or output_file.stat().st_size == 0:
            raise HTTPException(
                status_code=500,
                detail="Piper did not generate a valid WAV file"
            )

        print("Speech generated:", output_file, flush=True)

        return FileResponse(
            output_file,
            media_type="audio/wav",
            filename=f"{language}.wav",
        )

    except subprocess.CalledProcessError as error:

        details = (
            error.stderr.decode("utf-8", errors="replace")
            if error.stderr
            else "Unknown Piper error"
        )

        print("PIPER ERROR:", details, flush=True)

        raise HTTPException(
            status_code=500,
            detail=details[-1000:]
        )

    except subprocess.TimeoutExpired:

        raise HTTPException(
            status_code=504,
            detail="Speech generation timed out"
        )

    except HTTPException:
        raise

    except Exception as error:

        print("GENERAL ERROR:", repr(error), flush=True)

        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
