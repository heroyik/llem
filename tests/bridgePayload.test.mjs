import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BridgePayloadError,
  MAX_BRIDGE_MARKDOWN_CHARS,
  MAX_BRIDGE_PROMPT_CHARS,
  MAX_BRIDGE_TITLE_CHARS,
  readBridgePrompt,
  readBridgeVaultDrop
} from '../out-test/bridgePayload.js';

test('readBridgePrompt trims strings and falls back when missing', () => {
  assert.equal(readBridgePrompt({ prompt: '  hello  ' }, 'fallback'), 'hello');
  assert.equal(readBridgePrompt({}, 'fallback'), 'fallback');
});

test('readBridgePrompt rejects non-string or oversized prompts', () => {
  assert.throws(() => readBridgePrompt({ prompt: 1 }, 'fallback'), BridgePayloadError);
  assert.throws(() => readBridgePrompt({ prompt: 'x'.repeat(MAX_BRIDGE_PROMPT_CHARS + 1) }, ''), BridgePayloadError);
});

test('readBridgeVaultDrop validates title and markdown fields', () => {
  assert.deepEqual(readBridgeVaultDrop({ title: '  Notes  ', markdown: '  body  ' }), {
    title: 'Notes',
    markdown: 'body'
  });
  assert.equal(readBridgeVaultDrop({ markdown: 'body' }).title, 'vault_drop');
});

test('readBridgeVaultDrop rejects missing, non-string, or oversized fields', () => {
  assert.throws(() => readBridgeVaultDrop({ title: 'notes' }), BridgePayloadError);
  assert.throws(() => readBridgeVaultDrop({ title: 1, markdown: 'body' }), BridgePayloadError);
  assert.throws(() => readBridgeVaultDrop({ title: 'x'.repeat(MAX_BRIDGE_TITLE_CHARS + 1), markdown: 'body' }), BridgePayloadError);
  assert.throws(() => readBridgeVaultDrop({ title: 'notes', markdown: 'x'.repeat(MAX_BRIDGE_MARKDOWN_CHARS + 1) }), BridgePayloadError);
});
