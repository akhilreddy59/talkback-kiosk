# TalkBack

TalkBack is a local text-chat kiosk prototype. The browser talks to a small FastAPI server on this computer, and that server sends messages to your local Ollama service. There are no cloud AI calls, speech features, camera features, or conversation logs in this milestone.

## Requirements

- Windows 10, 64-bit
- Python 3.13.4 (tested)
- Ollama running at `http://127.0.0.1:11434`
- The installed model `qwen2.5-coder:7b` (or another local Ollama model)

The backend uses FastAPI, Uvicorn, and HTTPX. The backend tests use pytest. The browser stream parser test uses Node's built-in test runner; Node is only needed to run that test, not to run TalkBack. These project dependencies were tested under Python 3.13.4:

| Package | Version |
| --- | ---: |
| FastAPI | 0.115.12 |
| Uvicorn | 0.34.0 |
| HTTPX | 0.28.1 |
| pytest | 9.1.1 |

## Set up on Windows 10

Open PowerShell in the TalkBack project folder. Create a virtual environment, then install the listed Python packages into it:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Dependencies are installed in `.venv`; no system-wide Python packages are changed.

## Start TalkBack

1. Start Ollama from the Windows Start menu and confirm your model is installed with `ollama list`.
2. In PowerShell at the project folder, start the web application:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.
4. Choose `qwen2.5-coder:7b` and a reply language (English, Hindi, or Telugu), type a message, and press Enter or select the arrow button. Shift+Enter inserts a new line.
5. TalkBack shows text as Ollama generates it. Select **Stop** to cancel generation; any partial answer stays visible.
6. The finished answer shows duration and the Ollama load, token, and generation-rate metrics when Ollama provides them.
7. To stop TalkBack, focus the PowerShell window and press Ctrl+C.

## Test the running application from PowerShell

Keep TalkBack running in the first PowerShell window. Open a second PowerShell window in the project folder and run these commands to check backend health and installed models:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' | ConvertTo-Json
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/models' | ConvertTo-Json -Depth 5
```

Send a real test prompt through TalkBack to the installed model:

```powershell
$body = @{
    message = 'Reply exactly with: TalkBack local chat works.'
    model = 'qwen2.5-coder:7b'
    language = 'en'
} | ConvertTo-Json

$stream = Invoke-WebRequest `
    -Uri 'http://127.0.0.1:8000/api/chat' `
    -Method Post `
    -ContentType 'application/json' `
    -Body $body `
    -TimeoutSec 180 `
    -UseBasicParsing

$stream.Content -split "`n" | ForEach-Object {
    if ($_.Trim()) { $_ | ConvertFrom-Json }
}
```

The PowerShell command prints parsed events after the request finishes. The browser displays text as each event arrives and shows readable metrics at completion; it never displays raw protocol data.

The application binds only to the local computer. It refuses an `OLLAMA_HOST` value that points to a non-loopback network address. The settings can be supplied as environment variables in the same PowerShell window before starting the app:

```powershell
$env:OLLAMA_HOST = 'http://127.0.0.1:11434'
$env:TALKBACK_DEFAULT_MODEL = 'qwen2.5-coder:7b'
$env:OLLAMA_TIMEOUT_SECONDS = '120'
$env:TALKBACK_MAX_OUTPUT_TOKENS = '128'
```

`TALKBACK_MAX_OUTPUT_TOKENS` sets Ollama's maximum generated-token count (`num_predict`). It defaults to `128` and accepts values from `1` to `8192`. Raising it allows longer answers but may take longer to generate; a low limit can stop a reply mid-sentence. `.env.example` lists the settings, while the app reads environment variables directly and does not read a `.env` file.

TalkBack leaves Ollama's `keep_alive` behavior unchanged and does not set a context size. The model stays in memory according to Ollama's own settings.

## Run automated tests

From the project folder:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
node --test tests/frontend-stream.test.mjs
```

Python tests use a fake Ollama client and check the health/model endpoints, chat streaming, output configuration, and stream failures without depending on a running model. The Node test checks fragmented Unicode chunks, error frames, incomplete streams, and that protocol JSON is not returned as displayed text. A live chat check is separate and needs Ollama running.

## Local network and privacy

- Browser to TalkBack: `127.0.0.1:8000` (same computer only).
- TalkBack to Ollama: `127.0.0.1:11434` (same computer only).
- TalkBack sends the selected model, language instruction, message text, and output-token limit to Ollama.
- TalkBack does not save messages, recordings, or images. This milestone has no recording or image features.
- The model selector is populated from Ollama's installed-model list; TalkBack does not download models.

## Current scope

This prototype implements text chat, model selection, an Ollama health indicator, and useful request errors. Hindi/Telugu prompting, speech recognition, text-to-speech, camera, face recognition, diagnostics, and Raspberry Pi deployment remain later milestones.

