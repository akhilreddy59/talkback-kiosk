export class ChatStreamError extends Error {}

export async function readChatStream(response, onDelta) {
  if (!response.body) throw new ChatStreamError('TalkBack returned no response stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalEvent = null;
  let streamEnded = false;

  function readLine(line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new ChatStreamError('TalkBack sent an invalid stream event.');
    }

    if (event?.type === 'error') {
      throw new ChatStreamError(typeof event.message === 'string' ? event.message : 'The local model stream failed.');
    }
    if (event?.type === 'delta' && typeof event.text === 'string') {
      if (finalEvent) throw new ChatStreamError('TalkBack sent text after the response was complete.');
      if (event.text) onDelta(event.text);
      return;
    }
    if (event?.type === 'done' && event.metrics && !finalEvent) {
      finalEvent = event;
      return;
    }
    throw new ChatStreamError('TalkBack sent an unexpected stream event.');
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        readLine(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (done) {
        if (buffer.trim()) readLine(buffer);
        streamEnded = true;
        break;
      }
    }
  } finally {
    if (!streamEnded) {
      try {
        await reader.cancel();
      } catch {
        // The browser may already have canceled the fetch request.
      }
    }
    reader.releaseLock();
  }

  if (!finalEvent) throw new ChatStreamError('The response ended before it was complete.');
  return finalEvent;
}
