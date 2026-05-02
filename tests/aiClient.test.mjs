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
  const messageToken = extractStreamToken(
    'data: {"choices":[{"message":{"content":"Done"}}]}',
    true
  );

  assert.equal(deltaToken, 'Hello!');
  assert.equal(messageToken, 'Done');
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
