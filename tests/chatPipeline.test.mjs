import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContinuationSystemMessage } from '../out-test/chatPipelineHelpers.js';

test('buildContinuationSystemMessage merges internal and external action results', () => {
  const message = buildContinuationSystemMessage(
    '[SYSTEM: Internal lookup]\nFetched note content.',
    ['✅ Created: src/app.ts', '✏️ Edited: src/index.ts']
  );

  assert.match(message, /\[SYSTEM: Internal lookup\]/);
  assert.match(message, /\[SYSTEM: External action results\]/);
  assert.match(message, /Created: src\/app\.ts/);
  assert.match(message, /answer the user's original request/i);
});

test('buildContinuationSystemMessage omits empty sections cleanly', () => {
  assert.equal(buildContinuationSystemMessage('', []), '');
  assert.equal(
    buildContinuationSystemMessage('', ['🖥️ Ran: npm test']),
    "[SYSTEM: External action results]\n🖥️ Ran: npm test\n\nContinue from the updated workspace state and answer the user's original request."
  );
});
