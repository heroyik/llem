import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContinuationSystemMessage, mergeMessageContent, normalizeChatMessages } from '../out-test/chatPipelineHelpers.js';

test('buildContinuationSystemMessage merges internal and external action results', () => {
  const message = buildContinuationSystemMessage(
    '[SYSTEM: Internal lookup]\nFetched note content.',
    ['✅ Created: src/app.ts', '✏️ Edited: src/index.ts']
  );

  assert.match(message, /\[SYSTEM: Internal lookup\]/);
  assert.match(message, /\[Observation: Action Results\]/);
  assert.match(message, /Created: src\/app\.ts/);
  assert.match(message, /answer the user's request/i);
  assert.match(message, /DO NOT repeat your previous reasoning/i);
});

test('buildContinuationSystemMessage omits empty sections cleanly', () => {
  assert.equal(buildContinuationSystemMessage('', []), '');
  const message = buildContinuationSystemMessage('', ['🖥️ Ran: npm test']);
  assert.match(message, /^\[Observation: Action Results\]/);
  assert.match(message, /Ran: npm test/);
  assert.match(message, /IMPORTANT: Use the observation above/i);
});

test('mergeMessageContent merges text correctly', () => {
  assert.equal(mergeMessageContent('hello', 'world'), 'hello\n\nworld');
  assert.equal(mergeMessageContent('hello', ''), 'hello');
  assert.equal(mergeMessageContent('', 'world'), 'world');
});

test('mergeMessageContent handles multimodal array-based inputs', () => {
  const merged = mergeMessageContent(
    'hello',
    [{ type: 'image_url', image_url: 'data:image/png;base64,abc' }]
  );
  assert.deepEqual(merged, [
    { type: 'text', text: 'hello' },
    { type: 'image_url', image_url: 'data:image/png;base64,abc' }
  ]);
});

test('normalizeChatMessages combines multiple systems and ensures user first', () => {
  const messages = [
    { role: 'system', content: 'Sys 1' },
    { role: 'system', content: 'Sys 2' },
    { role: 'assistant', content: 'Asst 1' }
  ];
  const normalized = normalizeChatMessages(messages);
  assert.equal(normalized[0].role, 'system');
  assert.equal(normalized[0].content, 'Sys 1\n\nSys 2');
  assert.equal(normalized[1].role, 'user');
  assert.equal(normalized[1].content, 'Continue');
  assert.equal(normalized[2].role, 'assistant');
  assert.equal(normalized[2].content, 'Asst 1');
});

test('normalizeChatMessages merges consecutive same-role messages', () => {
  const messages = [
    { role: 'user', content: 'User 1' },
    { role: 'user', content: 'User 2' },
    { role: 'assistant', content: 'Asst 1' },
    { role: 'assistant', content: 'Asst 2' },
    { role: 'user', content: 'User 3' }
  ];
  const normalized = normalizeChatMessages(messages);
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].role, 'user');
  assert.equal(normalized[0].content, 'User 1\n\nUser 2');
  assert.equal(normalized[1].role, 'assistant');
  assert.equal(normalized[1].content, 'Asst 1\n\nAsst 2');
  assert.equal(normalized[2].role, 'user');
  assert.equal(normalized[2].content, 'User 3');
});
