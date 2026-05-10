import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('package.json exposes the performance preset setting with auto default', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const performancePreset = packageJson.contributes.configuration.properties['llem.performancePreset'];

  assert.ok(performancePreset);
  assert.equal(performancePreset.default, 'auto');
  assert.deepEqual(performancePreset.enum, ['auto', 'balanced', 'large-local-26b']);
});

test('package.json exposes MCP settings with expected defaults', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const props = packageJson.contributes.configuration.properties;

  assert.equal(props['llem.mcpEnabled'].default, true);
  assert.deepEqual(props['llem.mcpServers'].default, {
    'context-mode': {
      command: 'npx',
      args: ['-y', 'context-mode'],
      timeoutSeconds: 30
    }
  });
  assert.deepEqual(props['llem.mcpConfigSources'].items.enum, ['workspace', 'vscode', 'claude-code', 'codex', 'antigravity']);
  assert.deepEqual(props['llem.mcpConfigSources'].default, ['workspace']);
  assert.deepEqual(props['llem.mcpConfigPaths'].default, []);
});
