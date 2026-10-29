import assert from 'node:assert/strict';
import test from 'node:test';
import { readChatStream, ChatStreamError } from '../app/static/chat-stream.mjs';

function responseFromBytes(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }));
}

function encodeParts(text, splitAt) {
  const bytes = new TextEncoder().encode(text);
  return [bytes.slice(0, splitAt), bytes.slice(splitAt)];
}

test('decodes fragmented Unicode deltas and returns final metrics without protocol text', async () => {
  const data = [
    JSON.stringify({ type: 'delta', text: 'నమస్తే ' }),
    JSON.stringify({ type: 'delta', text: 'there' }),
    JSON.stringify({ type: 'done', model: 'qwen2.5-coder:7b', metrics: { duration_ms: 1234, output_tokens: 5 } }),
  ].join('\n') + '\n';
  const firstTeluguByte = new TextEncoder().encode(data.slice(0, data.indexOf('న'))).length;
  const chunks = encodeParts(data, firstTeluguByte + 1);
  const received = [];
  const result = await readChatStream(responseFromBytes(chunks), (text) => received.push(text));

  assert.equal(received.join(''), 'నమస్తే there');
  assert.deepEqual(result.metrics, { duration_ms: 1234, output_tokens: 5 });
  assert.equal(received.join('').includes('"type"'), false);
});

test('surfaces an in-stream error while retaining already received text', async () => {
  const data = [
    JSON.stringify({ type: 'delta', text: 'partial answer' }),
    JSON.stringify({ type: 'error', message: 'Ollama timed out.' }),
  ].join('\n') + '\n';
  const received = [];

  await assert.rejects(
    readChatStream(responseFromBytes([new TextEncoder().encode(data)]), (text) => received.push(text)),
    (error) => error instanceof ChatStreamError && error.message === 'Ollama timed out.',
  );
  assert.equal(received.join(''), 'partial answer');
});

test('rejects malformed protocol without exposing the raw line', async () => {
  const raw = '{"type":"delta","text":"ok"}\nthis is not json\n';
  const received = [];
  await assert.rejects(
    readChatStream(responseFromBytes([new TextEncoder().encode(raw)]), (text) => received.push(text)),
    (error) => error instanceof ChatStreamError && error.message === 'TalkBack sent an invalid stream event.' && !error.message.includes('this is not json'),
  );
  assert.equal(received.join(''), 'ok');
});

test('reports a stream that closes without a final metrics event', async () => {
  const incomplete = JSON.stringify({ type: 'delta', text: 'unfinished' }) + '\n';
  await assert.rejects(
    readChatStream(responseFromBytes([new TextEncoder().encode(incomplete)]), () => {}),
    (error) => error instanceof ChatStreamError && error.message === 'The response ended before it was complete.',
  );
});
