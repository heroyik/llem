import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadMcpServers, readCodexTomlServers } = require('../out-test/mcpConfig.js');

test('loadMcpServers reads workspace .mcp.json and expands env defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llem-mcp-config-'));
  await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      docs: {
        command: '${MCP_BIN:-node}',
        args: ['server.js'],
        env: { TOKEN: '${TOKEN:-dev}' }
      }
    }
  }));

  const result = loadMcpServers({ workspaceRoot: root, sources: ['workspace'], env: {}, homeDir: root });
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].name, 'docs');
  assert.equal(result.servers[0].config.command, 'node');
  assert.equal(result.servers[0].config.env.TOKEN, 'dev');
  assert.equal(result.servers[0].transport, 'stdio');
});

test('loadMcpServers reads Claude Code project servers', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'llem-claude-home-'));
  const workspace = path.join(home, 'repo');
  await mkdir(workspace);
  await writeFile(path.join(home, '.claude.json'), JSON.stringify({
    projects: {
      [workspace]: {
        mcpServers: {
          claudeDb: { command: 'node', args: ['db.js'] }
        }
      }
    }
  }));

  const result = loadMcpServers({ workspaceRoot: workspace, sources: ['claude-code'], env: {}, homeDir: home });
  assert.equal(result.servers[0].name, 'claudeDb');
  assert.equal(result.servers[0].source, 'claude-code:local-project');
});

test('readCodexTomlServers normalizes Codex config fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'llem-codex-'));
  const file = path.join(dir, 'config.toml');
  await writeFile(file, `
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp"]
enabled = false
startup_timeout_sec = 7
tool_timeout_sec = 9
enabled_tools = ["open"]
disabled_tools = ["close"]
`);

  const servers = readCodexTomlServers(file);
  assert.equal(servers.playwright.command, 'npx');
  assert.equal(servers.playwright.disabled, true);
  assert.equal(servers.playwright.startupTimeoutSeconds, 7);
  assert.equal(servers.playwright.toolTimeoutSeconds, 9);
  assert.deepEqual(servers.playwright.enabledTools, ['open']);
  assert.deepEqual(servers.playwright.disabledTools, ['close']);
});

test('LLeM settings override imported servers with the same name', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llem-mcp-priority-'));
  await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
    mcpServers: { same: { command: 'node', args: ['old.js'] } }
  }));

  const result = loadMcpServers({
    workspaceRoot: root,
    sources: ['workspace'],
    llemServers: { same: { command: 'node', args: ['new.js'] } },
    env: {},
    homeDir: root
  });

  assert.deepEqual(result.servers.find(server => server.name === 'same').config.args, ['new.js']);
  assert.equal(result.servers.find(server => server.name === 'same').source, 'llem:settings');
});
