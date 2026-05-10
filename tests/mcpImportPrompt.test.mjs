import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findImportableMcpSources } = require('../out-test/mcpImportDiscovery.js');

test('findImportableMcpSources detects external MCP config files not already configured', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'llem-mcp-import-home-'));
  const workspace = path.join(home, 'repo');
  await mkdir(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(path.join(workspace, '.vscode'), { recursive: true });
  await writeFile(path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), JSON.stringify({
    mcpServers: { firebase: { command: 'npx' } }
  }));
  await writeFile(path.join(workspace, '.vscode', 'mcp.json'), JSON.stringify({
    mcpServers: { browser: { command: 'npx' } }
  }));
  await writeFile(path.join(home, '.codex', 'config.toml'), `
[mcp_servers.docs]
command = "node"
`);
  await writeFile(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    mcpServers: { files: { command: 'node' } }
  }));

  const found = findImportableMcpSources({
    configuredSources: ['workspace'],
    homeDir: home,
    workspaceRoot: workspace,
    env: {}
  });

  assert.deepEqual(found.map(source => source.id), ['antigravity', 'vscode', 'codex', 'claude-code']);
});

test('findImportableMcpSources skips configured and dismissed sources', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'llem-mcp-import-skip-'));
  await mkdir(path.join(home, '.gemini', 'antigravity'), { recursive: true });
  await writeFile(path.join(home, '.gemini', 'antigravity', 'mcp_config.json'), JSON.stringify({
    mcpServers: { firebase: { command: 'npx' } }
  }));

  assert.deepEqual(findImportableMcpSources({
    configuredSources: ['antigravity'],
    homeDir: home,
    env: {}
  }), []);

  assert.deepEqual(findImportableMcpSources({
    dismissedSources: ['antigravity'],
    homeDir: home,
    env: {}
  }), []);
});
