import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  allocateAttachmentPreview,
  collectRelevantTerms,
  getAttachmentBudgetLimits,
  pruneHistoryMessages,
  truncateText
} = require('../out-test/promptBudgeting.js');

test('truncateText appends a truncation note when content is clipped', () => {
  const value = truncateText('a'.repeat(500), 120);
  assert.match(value, /\[truncated \d+ chars\]/);
  assert.ok(value.length <= 120);
});

test('attachment budget applies per-file and total caps', () => {
  const limits = getAttachmentBudgetLimits({
    totalPromptChars: 28000,
    activeEditorChars: 6000,
    workspaceChars: 4000,
    vaultChars: 4000,
    attachmentFileChars: 8000,
    attachmentTotalChars: 16000
  });

  const first = allocateAttachmentPreview('x'.repeat(12000), limits.totalChars, limits.perFileChars);
  const second = allocateAttachmentPreview('y'.repeat(12000), first.remainingChars, limits.perFileChars);
  const third = allocateAttachmentPreview('z'.repeat(12000), second.remainingChars, limits.perFileChars);

  assert.equal(first.included.length, 8000);
  assert.equal(second.included.length, 8000);
  assert.equal(third.included.length, 0);
});

test('pruneHistoryMessages keeps the latest user prompt even when budget is near zero', () => {
  const result = pruneHistoryMessages([
    { role: 'assistant', content: 'older answer' },
    { role: 'user', content: 'latest question about src/app.ts' }
  ], 0, collectRelevantTerms('src/app.ts'));

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, 'user');
  assert.match(String(result.messages[0].content), /latest question/);
});

test('pruneHistoryMessages prefers relevant file context over unrelated older chat', () => {
  const messages = [
    { role: 'user', content: 'Tell me about the weather in another project and keep rambling '.repeat(20) },
    { role: 'assistant', content: 'A long unrelated answer '.repeat(20) },
    { role: 'user', content: '[SYSTEM: read_file result]\nFile: src/app.ts\n```\nconst important = true;\n```' },
    { role: 'assistant', content: 'I checked src/app.ts and found the important flag.' },
    { role: 'user', content: 'Please optimize src/app.ts for the 26B profile.' }
  ];

  const result = pruneHistoryMessages(messages, 320, collectRelevantTerms('src/app.ts'));
  const joined = result.messages.map(message => String(message.content)).join('\n');

  assert.ok(result.keptChars <= 320);
  assert.match(joined, /src\/app\.ts/);
  assert.match(joined, /26B profile/);
});
