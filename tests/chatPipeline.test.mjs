import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContinuationSystemMessage } from '../out-test/chatPipelineHelpers.js';

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
