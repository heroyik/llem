import assert from 'node:assert/strict';
import test from 'node:test';
import { attachImagesToChatMessages } from '../out-test/imageRequestPayload.js';

const image = {
  name: 'clipboard-image.png',
  type: 'image/png',
  data: 'abc123',
  originalSize: 12
};

test('Ollama image attachments use native messages[].images', () => {
  const endpoint = { apiUrl: 'http://127.0.0.1:11434/api/chat', isLMStudio: false, engineKind: 'ollama' };
  const messages = [{ role: 'user', content: 'Describe this image.' }];

  attachImagesToChatMessages(endpoint, messages, [image]);

  assert.equal(messages[0].content, 'Describe this image.');
  assert.deepEqual(messages[0].images, ['abc123']);
});

test('LM Studio image attachments use OpenAI image_url content parts', () => {
  const endpoint = { apiUrl: 'http://127.0.0.1:1234/v1/chat/completions', isLMStudio: true, engineKind: 'lm-studio' };
  const messages = [{ role: 'user', content: 'Describe this image.' }];

  attachImagesToChatMessages(endpoint, messages, [image]);

  assert.equal(endpoint.engineKind, 'lm-studio');
  assert.deepEqual(messages[0].content, [
    { type: 'text', text: 'Describe this image.' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }
  ]);
});

test('Rapid-MLX image attachments use MLX-VLM input_image content parts', () => {
  const endpoint = { apiUrl: 'http://127.0.0.1:8000/v1/chat/completions', isLMStudio: true, engineKind: 'rapid-mlx' };
  const messages = [{ role: 'user', content: 'Describe this image.' }];

  attachImagesToChatMessages(endpoint, messages, [image]);

  assert.equal(endpoint.engineKind, 'rapid-mlx');
  assert.deepEqual(messages[0].content, [
    { type: 'text', text: 'Describe this image.' },
    { type: 'input_image', image_url: 'data:image/png;base64,abc123' }
  ]);
});
