import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMcpSyncDiff, renderMcpSyncDiffMarkdown, summarizeMcpSyncDiff } = require('../out-test/mcpSyncDiff.js');

function server(name, overrides = {}) {
  return {
    name,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', name],
    env: {},
    enabled: true,
    sourceKind: 'codex',
    sourceServerName: name,
    ...overrides
  };
}

test('buildMcpSyncDiff detects added removed and changed servers', () => {
  const diff = buildMcpSyncDiff(
    {
      old: server('old'),
      changed: server('changed', { env: { TOKEN: 'a' } }),
      same: server('same')
    },
    {
      added: server('added'),
      changed: server('changed', { env: { TOKEN: 'b', NEXT: '1' } }),
      same: server('same')
    }
  );

  assert.deepEqual(diff.added.map(item => item.name), ['added']);
  assert.deepEqual(diff.removed.map(item => item.name), ['old']);
  assert.deepEqual(diff.changed.map(item => item.name), ['changed']);
  assert.deepEqual(diff.changed[0].envDiff, {
    addedKeys: ['NEXT'],
    removedKeys: [],
    changedKeys: ['TOKEN']
  });
  assert.equal(summarizeMcpSyncDiff(diff), '+1 added, -1 removed, ~1 changed');
});

test('renderMcpSyncDiffMarkdown masks env values and marks local shadows', () => {
  const diff = buildMcpSyncDiff(
    {},
    { github: server('github', { env: { SECRET: 'new-value' } }) },
    { github: server('github', { sourceKind: 'llem' }) }
  );
  const markdown = renderMcpSyncDiffMarkdown(diff);

  assert.match(markdown, /shadowed by local config/);
  assert.match(markdown, /github/);
  assert.doesNotMatch(markdown, /new-value/);
});

