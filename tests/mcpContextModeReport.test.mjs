import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contextModeCallReport, contextModeListReport } = require('../out-test/mcpContextModeReport.js');

test('contextModeListReport reports available context-mode tools', () => {
  assert.equal(contextModeListReport([
    { server: 'github', name: 'search' },
    { server: 'context-mode', name: 'ctx_stats' }
  ]), '🧠 context-mode active: 1 tool available.');
  assert.equal(contextModeListReport([{ server: 'github', name: 'search' }]), undefined);
});

test('contextModeCallReport summarizes context and token savings from raw result', () => {
  const report = contextModeCallReport({
    ok: true,
    server: 'context-mode',
    tool: 'ctx_stats',
    text: '{}',
    raw: {
      content: [{
        type: 'text',
        text: JSON.stringify({
          savedContext: 12000,
          savedTokens: 3024,
          originalTokens: 10000,
          finalTokens: 6976,
          compressionRatio: 0.3024
        })
      }]
    }
  });

  assert.match(report, /context-mode ran: ctx_stats/);
  assert.match(report, /context saved 12,000 chars/);
  assert.match(report, /tokens saved 3,024/);
  assert.match(report, /tokens 10,000 → 6,976/);
  assert.match(report, /ratio 30.24%/);
});

test('contextModeCallReport reports execution even without metrics', () => {
  assert.equal(contextModeCallReport({
    ok: true,
    server: 'context-mode',
    tool: 'ctx_stats',
    text: 'ok'
  }), '🧠 context-mode ran: ctx_stats.');
});

test('contextModeCallReport ignores other MCP servers', () => {
  assert.equal(contextModeCallReport({
    ok: true,
    server: 'github',
    tool: 'search',
    text: 'ok'
  }), undefined);
});
