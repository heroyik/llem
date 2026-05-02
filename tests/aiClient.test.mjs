import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractStreamToken, parseStreamBuffer } = require('../out-test/streamParsing.js');

test('extractStreamToken reads LM Studio delta arrays and message fallback', () => {
  const deltaToken = extractStreamToken(
    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Hello"},{"type":"text","text":"!"}]}}]}',
    true
  );
  const objectDeltaToken = extractStreamToken(
    'data: {"choices":[{"delta":{"content":{"type":"output_text_delta","delta":"Object token"}}}]}',
    true
  );
  const messageToken = extractStreamToken(
    'data: {"choices":[{"message":{"content":"Done"}}]}',
    true
  );
  const reasoningToken = extractStreamToken(
    'data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}',
    true
  );

  assert.equal(deltaToken, 'Hello!');
  assert.equal(objectDeltaToken, 'Object token');
  assert.equal(messageToken, 'Done');
  assert.equal(reasoningToken, 'Thinking...');
});

test('extractStreamToken reads non-LM Studio array content and tool-call fallbacks', () => {
  const arrayContent = extractStreamToken(
    '{"message":{"content":[{"type":"text","text":"Hi"},{"text":" there"}]}}',
    false
  );
  const topLevelContent = extractStreamToken(
    '{"content":[{"type":"text","text":"Top"},{"type":"text","text":" level"}]}',
    false
  );
  const choiceDeltaFallback = extractStreamToken(
    '{"choices":[{"delta":{"content":{"type":"output_text_delta","delta":"Fallback token"}}}]}',
    false
  );
  const toolCall = extractStreamToken(
    '{"choices":[{"message":{"tool_calls":[{"function":{"name":"read_file","arguments":"{\\"path\\":\\"src/index.ts\\"}"}}]}}]}',
    true
  );

  assert.equal(arrayContent, 'Hi there');
  assert.equal(topLevelContent, 'Top level');
  assert.equal(choiceDeltaFallback, 'Fallback token');
  assert.match(toolCall, /<read_file/);
});

test('parseStreamBuffer preserves partial chunks and flushes trailing content on end', () => {
  const partial = parseStreamBuffer(
    '{"message":{"role":"assistant","content":"Hel"}}\n{"message":{"role":"assistant","content":"lo"}}',
    false
  );
  const flushed = parseStreamBuffer(partial.remainder, false, true);

  assert.deepEqual(partial.tokens, ['Hel']);
  assert.equal(partial.remainder, '{"message":{"role":"assistant","content":"lo"}}');
  assert.deepEqual(flushed.tokens, ['lo']);
  assert.equal(flushed.remainder, '');
});
