import { ChatStreamError, readChatStream } from './chat-stream.mjs';

const modelSelect = document.querySelector('#model-select');
const languageSelect = document.querySelector('#language-select');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const stopButton = document.querySelector('#stop-button');
const thread = document.querySelector('#thread');
const statusLine = document.querySelector('#request-status');
const connectionLabel = document.querySelector('#connection-label');
const connectionDot = document.querySelector('#connection-dot');
const welcome = document.querySelector('#welcome');
const voiceStart = document.querySelector('#voice-start');
const voiceEnd = document.querySelector('#voice-end');
const voiceMute = document.querySelector('#voice-mute');
const voiceStatus = document.querySelector('#voice-status');
const voiceIndicator = document.querySelector('#voice-indicator');
let activeController = null;
let recognition = null;
let voiceConversationActive = false;
let voiceProcessing = false;
let assistantMuted = false;
let speechUtterance = null;
let speechObjectUrl = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle('error', isError);
}

function showConnection(connected, message) {
  connectionLabel.textContent = message;
  connectionDot.classList.toggle('connected', connected);
  connectionDot.classList.toggle('failed', !connected);
}

function addMessage(role, text) {
  welcome?.remove();
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const label = document.createElement('p');
  label.className = 'message-label';
  label.textContent = role === 'user' ? 'YOU' : 'TALKBACK';
  const body = document.createElement('p');
  body.className = 'message-body';
  body.textContent = text;
  article.append(label, body);
  thread.append(article);
  thread.scrollTop = thread.scrollHeight;
  return { article, body };
}

function addMeta(article, text, warning = false) {
  const meta = document.createElement('div');
  meta.className = warning ? 'message-meta warning' : 'message-meta';
  meta.textContent = text;
  article.append(meta);
}

function updateSendState() {
  const busy = activeController !== null || speechUtterance !== null;
  sendButton.disabled = busy || !input.value.trim() || !modelSelect.value;
  sendButton.hidden = busy;
  stopButton.hidden = !busy;
  updateVoiceControls();
}

function setVoiceStatus(message, state = 'paused') {
  voiceStatus.textContent = message;
  voiceStatus.dataset.state = state;
  voiceIndicator.dataset.state = state;
}

function updateVoiceControls() {
  voiceStart.disabled = !SpeechRecognition || voiceConversationActive
    || activeController !== null || speechUtterance !== null;
  voiceEnd.disabled = !voiceConversationActive;
  voiceMute.disabled = !voiceConversationActive;
  voiceMute.textContent = assistantMuted ? 'Unmute assistant' : 'Mute assistant';
  voiceMute.setAttribute('aria-pressed', String(assistantMuted));
}

function stopSpeech() {
  if (speechUtterance && speechUtterance.tagName === "AUDIO") {
    speechUtterance.pause();
    speechUtterance.removeAttribute("src");
    speechUtterance.load();
  }

  if (speechObjectUrl) {
    URL.revokeObjectURL(speechObjectUrl);
    speechObjectUrl = null;
  }

  window.speechSynthesis.cancel();
  speechUtterance = null;
}


function stopRecognition() {
  if (!recognition) return;

  try {
    recognition.stop();
  } catch (error) {
    if (error.name !== 'InvalidStateError') throw error;
  }
}



function finishVoiceConversation() {
  voiceConversationActive = false;
  voiceProcessing = false;

  if (recognition) {
    recognition.onend = null;
    stopRecognition();
    recognition = null;
  }

  stopSpeech();
  setVoiceStatus('Paused');
  updateVoiceControls();
}


function listenForVoiceMessage() {
  if (!voiceConversationActive || voiceProcessing || !recognition) return;
  setVoiceStatus('Listening', 'listening');
  try {
    recognition.start();
  } catch (error) {
    if (error.name !== 'InvalidStateError') {
      finishVoiceConversation();
      setStatus('Could not start the microphone. Check browser permissions and try again.', true);
    }
  }
}

async function speakAssistantResponse(text) {
  if (!voiceConversationActive || assistantMuted || !text.trim()) {
    listenForVoiceMessage();
    return;
  }

  setVoiceStatus("Generating offline speech...", "speaking");

  const audio = new Audio();
  speechUtterance = audio;
  updateSendState();

  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: text,
        language: languageSelect.value
      })
    });

    if (!response.ok) {
      let detail = "Offline speech failed.";
      try {
        detail = (await response.json()).detail || detail;
      } catch {}
      throw new Error(detail);
    }

    const blob = await response.blob();

    if (
      speechUtterance !== audio ||
      !voiceConversationActive ||
      assistantMuted
    ) {
      return;
    }

    speechObjectUrl = URL.createObjectURL(blob);
    audio.src = speechObjectUrl;

    audio.onended = () => {
      if (speechObjectUrl) {
        URL.revokeObjectURL(speechObjectUrl);
        speechObjectUrl = null;
      }

      if (speechUtterance === audio) {
        speechUtterance = null;
      }

      updateSendState();
      listenForVoiceMessage();
    };

    audio.onerror = () => {
      if (speechObjectUrl) {
        URL.revokeObjectURL(speechObjectUrl);
        speechObjectUrl = null;
      }

      if (speechUtterance === audio) {
        speechUtterance = null;
      }

      updateSendState();

      if (voiceConversationActive) {
        setStatus("Offline audio could not be played.", true);
        listenForVoiceMessage();
      }
    };

    await audio.play();

  } catch (error) {
    if (speechUtterance === audio) {
      speechUtterance = null;
    }

    if (speechObjectUrl) {
      URL.revokeObjectURL(speechObjectUrl);
      speechObjectUrl = null;
    }

    updateSendState();

    if (voiceConversationActive) {
      setStatus(error.message || "Offline speech failed.", true);
      listenForVoiceMessage();
    }
  }
}

function startVoiceConversation() {
  if (!SpeechRecognition) {
    setStatus('Voice input is not supported in this browser. Typed chat is still available.', true);
    return;
  }
  if (activeController || speechUtterance) return;
  voiceConversationActive = true;
  voiceProcessing = false;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    if (!voiceConversationActive || voiceProcessing) return;
    const transcript = Array.from(event.results)
      .slice(event.resultIndex)
      .map((result) => result[0]?.transcript || '')
      .join(' ')
      .trim();
    if (!transcript) {
      setStatus('I did not catch that. Listening again.');
      return;
    }
    voiceProcessing = true;
    stopRecognition();
    submitMessage(transcript, { fromVoice: true });
  };
  recognition.onerror = (event) => {
    if (!voiceConversationActive) return;
    voiceProcessing = false;
    const message = event.error === 'not-allowed'
      ? 'Microphone permission was denied. Allow microphone access to use voice conversation.'
      : event.error === 'no-speech'
        ? 'No speech detected. Listening again.'
        : 'Voice recognition encountered an error. Listening again.';
    setStatus(message, event.error !== 'no-speech');
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      finishVoiceConversation();
      return;
    }
  };
  recognition.onend = () => {
    if (voiceConversationActive && !voiceProcessing) listenForVoiceMessage();
  };
  updateVoiceControls();
  setStatus('Choose Allow when Chrome asks for microphone access.');
  listenForVoiceMessage();
}

voiceStart.addEventListener('click', startVoiceConversation);
voiceEnd.addEventListener('click', finishVoiceConversation);
voiceMute.addEventListener('click', () => {
  assistantMuted = !assistantMuted;
  if (assistantMuted && speechUtterance) {
    stopSpeech();
    updateSendState();
    if (voiceConversationActive) listenForVoiceMessage();
  }
  updateVoiceControls();
  if (voiceConversationActive && assistantMuted && voiceProcessing) {
    setStatus('Assistant speech muted. Waiting for the current response to finish.');
  }
});

function formatMetrics(metrics, model) {
  const parts = [model];
  if (Number.isFinite(metrics.duration_ms)) parts.push(`${(metrics.duration_ms / 1000).toFixed(1)} sec`);
  if (Number.isFinite(metrics.time_to_first_token_ms)) parts.push(`first text ${(metrics.time_to_first_token_ms / 1000).toFixed(1)} sec`);
  if (Number.isFinite(metrics.ollama_total_ms)) parts.push(`Ollama ${(metrics.ollama_total_ms / 1000).toFixed(1)} sec`);
  if (Number.isFinite(metrics.load_ms)) parts.push(`load ${(metrics.load_ms / 1000).toFixed(1)} sec`);
  if (Number.isFinite(metrics.prompt_eval_ms)) parts.push(`prompt ${(metrics.prompt_eval_ms / 1000).toFixed(1)} sec`);
  if (Number.isFinite(metrics.generation_ms)) parts.push(`generation ${(metrics.generation_ms / 1000).toFixed(1)} sec`);
  if (Number.isFinite(metrics.output_tokens)) {
    const input = Number.isFinite(metrics.prompt_tokens) ? ` / ${metrics.prompt_tokens} in` : '';
    parts.push(`${metrics.output_tokens} out${input}`);
  }
  if (Number.isFinite(metrics.tokens_per_second)) parts.push(`${metrics.tokens_per_second.toFixed(1)} tok/s`);
  return parts.join(' · ');
}

async function loadModels() {
  try {
    const response = await fetch('/api/models');
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Could not load Ollama models.');
    modelSelect.replaceChildren();
    if (!data.models.length) {
      modelSelect.add(new Option('No models installed', ''));
      modelSelect.disabled = true;
      showConnection(false, 'Ollama is running; no models found');
      setStatus('Install or select an Ollama model before chatting.', true);
      return;
    }
    data.models.forEach((model) => modelSelect.add(new Option(model.name || model.model, model.name || model.model)));
    const preferred = data.models.find((model) => (model.name || model.model) === data.default_model);
    if (preferred) modelSelect.value = data.default_model;
    modelSelect.disabled = false;
    showConnection(true, 'Ollama connected');
    setStatus('Messages are processed locally.');
  } catch (error) {
    modelSelect.replaceChildren(new Option('Ollama unavailable', ''));
    modelSelect.disabled = true;
    showConnection(false, 'Ollama unavailable');
    setStatus(error.message || 'Start Ollama, then refresh this page.', true);
  }
  updateSendState();
}

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  updateSendState();
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

modelSelect.addEventListener('change', updateSendState);
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
  input.value = button.dataset.prompt;
  input.dispatchEvent(new Event('input'));
  input.focus();
}));
stopButton.addEventListener('click', () => {
  if (activeController) {
    activeController.abort();
    return;
  }
  if (speechUtterance) {
    stopSpeech();
    setStatus('Assistant speech stopped.');
    if (voiceConversationActive) listenForVoiceMessage();
    updateSendState();
  }
});

async function submitMessage(message, { fromVoice = false } = {}) {
  const model = modelSelect.value;
  const language = languageSelect.value;
  if (!message || !model || activeController) return '';

  addMessage('user', message);
  input.value = '';
  input.style.height = 'auto';
  const { article, body } = addMessage('assistant', '…');
  body.setAttribute('aria-live', 'off');
  const controller = new AbortController();
  activeController = controller;
  updateSendState();
  setStatus(fromVoice ? 'Processing your voice message…' : 'Waiting for the first words…');
  let receivedText = false;
  let assistantText = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model, language }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = 'TalkBack could not start the chat request.';
      try {
        const data = await response.json();
        if (typeof data.detail === 'string') detail = data.detail;
      } catch {
        // Keep the readable fallback for an unexpected backend error response.
      }
      throw new ChatStreamError(detail);
    }

    setStatus('TalkBack is replying…');
    const finalEvent = await readChatStream(response, (chunk) => {
      body.textContent = (receivedText ? body.textContent : '') + chunk;
      assistantText += chunk;
      receivedText = true;
      thread.scrollTop = thread.scrollHeight;
    });
    addMeta(article, formatMetrics(finalEvent.metrics, finalEvent.model || model));
    setStatus('Reply received from your local model.');
    return assistantText;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (!receivedText) body.textContent = 'Response stopped before any text arrived.';
      addMeta(article, 'Stopped by you · partial text kept', true);
      if (!input.value.trim()) input.value = message;
      setStatus('Response stopped. You can edit the message and try again.');
    } else {
      const messageText = error instanceof ChatStreamError
        ? error.message
        : 'TalkBack could not reach the local service. Check Ollama and try again.';
      if (receivedText) {
        addMeta(article, `Stream interrupted · ${messageText}`, true);
        setStatus('The response was interrupted; partial text is still shown.', true);
      } else {
        article.classList.add('error');
        body.textContent = messageText;
        if (!input.value.trim()) input.value = message;
        setStatus('Your message could not be answered. You can edit it and try again.', true);
      }
    }
    return '';
  } finally {
    if (activeController === controller) activeController = null;
    updateSendState();
    input.focus();
    if (fromVoice || voiceConversationActive) {
      voiceProcessing = false;
      if (voiceConversationActive) speakAssistantResponse(assistantText);
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || activeController) return;
  if (voiceConversationActive) {
    stopRecognition();
    voiceProcessing = false;
  }
  await submitMessage(message);
});

loadModels();
if (!SpeechRecognition) {
  setVoiceStatus('Unavailable in this browser');
  voiceStart.disabled = true;
} else {
  updateVoiceControls();
}
