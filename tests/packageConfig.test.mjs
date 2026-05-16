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

test('package.json exposes MCP settings and commands', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const properties = packageJson.contributes.configuration.properties;
  const commands = packageJson.contributes.commands.map(command => command.command);

  for (const key of ['llem.mcpEnabled', 'llem.mcpServers', 'llem.mcpSyncedServers', 'llem.mcpConfigSources', 'llem.mcpConfigPaths', 'llem.mcpToolTimeoutSeconds']) {
    assert.ok(properties[key], `${key} should be exposed`);
  }
  for (const command of ['llem.reloadMcpServers', 'llem.listMcpServers', 'llem.syncCodexMcpServers', 'llem.importMcpFromGitHub']) {
    assert.ok(commands.includes(command), `${command} should be contributed`);
  }
});
