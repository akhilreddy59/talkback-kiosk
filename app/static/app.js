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
let activeController = null;

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
  const busy = activeController !== null;
  sendButton.disabled = busy || !input.value.trim() || !modelSelect.value;
  sendButton.hidden = busy;
  stopButton.hidden = !busy;
}

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
stopButton.addEventListener('click', () => activeController?.abort());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  const model = modelSelect.value;
  const language = languageSelect.value;
  if (!message || !model || activeController) return;

  addMessage('user', message);
  input.value = '';
  input.style.height = 'auto';
  const { article, body } = addMessage('assistant', '…');
  body.setAttribute('aria-live', 'off');
  const controller = new AbortController();
  activeController = controller;
  updateSendState();
  setStatus('Waiting for the first words…');
  let receivedText = false;

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
      receivedText = true;
      thread.scrollTop = thread.scrollHeight;
    });
    addMeta(article, formatMetrics(finalEvent.metrics, finalEvent.model || model));
    setStatus('Reply received from your local model.');
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
  } finally {
    if (activeController === controller) activeController = null;
    updateSendState();
    input.focus();
  }
});

loadModels();

