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

test('loadMcpServers reads Antigravity Gemini MCP config', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'llem-antigravity-home-'));
  const antigravityDir = path.join(home, '.gemini', 'antigravity');
  await mkdir(antigravityDir, { recursive: true });
  await writeFile(path.join(antigravityDir, 'mcp_config.json'), JSON.stringify({
    mcpServers: {
      firebase: {
        command: 'npx',
        args: ['-y', 'firebase-tools@latest', 'mcp'],
        env: {}
      }
    }
  }));

  const result = loadMcpServers({ sources: ['antigravity'], env: {}, homeDir: home });
  const server = result.servers.find(item => item.name === 'firebase');
  assert.equal(server.source, 'antigravity:user');
  assert.equal(server.transport, 'stdio');
  assert.deepEqual(server.config.args, ['-y', 'firebase-tools@latest', 'mcp']);
});

test('loadMcpServers reads VS Code workspace MCP config', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'llem-vscode-mcp-'));
  await mkdir(path.join(workspace, '.vscode'));
  await writeFile(path.join(workspace, '.vscode', 'mcp.json'), JSON.stringify({
    mcpServers: {
      browser: {
        command: 'npx',
        args: ['-y', '@playwright/mcp']
      }
    }
  }));

  const result = loadMcpServers({ workspaceRoot: workspace, sources: ['vscode'], env: {}, homeDir: workspace });
  const server = result.servers.find(item => item.name === 'browser');
  assert.equal(server.source, 'vscode:.vscode/mcp.json');
  assert.equal(server.transport, 'stdio');
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

test('loadMcpServers marks HTTP and SSE transports as supported', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llem-mcp-http-'));
  await writeFile(path.join(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      remoteHttp: { type: 'http', url: 'https://example.com/mcp' },
      remoteSse: { type: 'sse', url: 'https://example.com/sse' },
      mystery: { type: 'weird' }
    }
  }));

  const result = loadMcpServers({ workspaceRoot: root, sources: ['workspace'], env: {}, homeDir: root });
  const byName = new Map(result.servers.map(server => [server.name, server]));
  assert.equal(byName.get('remoteHttp').supported, true);
  assert.equal(byName.get('remoteSse').supported, true);
  assert.equal(byName.get('mystery').supported, false);
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

test('loadMcpServers reads user and workspace LLeM MCP config files', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'llem-user-config-'));
  const workspace = path.join(home, 'repo');
  await mkdir(workspace);
  await mkdir(path.join(home, '.llem'));
  await mkdir(path.join(workspace, '.llem'));
  await writeFile(path.join(home, '.llem', 'mcp.json'), JSON.stringify({
    mcpServers: {
      same: { command: 'node', args: ['user.js'] },
      userOnly: { command: 'node', args: ['user-only.js'] }
    }
  }));
  await writeFile(path.join(workspace, '.llem', 'mcp.json'), JSON.stringify({
    mcpServers: {
      same: { command: 'node', args: ['workspace.js'] }
    }
  }));

  const result = loadMcpServers({ workspaceRoot: workspace, sources: ['workspace'], env: {}, homeDir: home });
  assert.deepEqual(result.servers.find(server => server.name === 'same').config.args, ['workspace.js']);
  assert.equal(result.servers.find(server => server.name === 'same').source, 'workspace:.llem/mcp.json');
  assert.deepEqual(result.servers.find(server => server.name === 'userOnly').config.args, ['user-only.js']);
});
