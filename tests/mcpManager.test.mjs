import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { McpManager } = require('../out-test/mcpManager.js');

function server(name, config = {}) {
  const transport = config.type || (config.url ? 'http' : 'stdio');
  return {
    name,
    source: 'test',
    transport,
    supported: ['stdio', 'http', 'sse'].includes(transport),
    disabled: config.disabled === true,
    config
  };
}

test('McpManager skips disabled and unknown-transport servers when listing tools', async () => {
  const manager = new McpManager({
    servers: [
      server('off', { command: 'node', disabled: true }),
      server('mystery', { type: 'unknown' })
    ],
    clientFactory: () => {
      throw new Error('should not connect');
    }
  });

  const result = await manager.listTools();
  assert.equal(result.tools.length, 0);
  assert.match(result.report.join('\n'), /off is disabled/);
  assert.match(result.report.join('\n'), /unsupported unknown/);
});

test('McpManager filters tools using Codex allow and deny lists', async () => {
  const manager = new McpManager({
    servers: [server('tools', {
      command: 'node',
      enabledTools: ['open', 'close'],
      disabledTools: ['close']
    })],
    transportFactory: () => ({}),
    clientFactory: () => ({
      connect: async () => undefined,
      listTools: async () => ({
        tools: [
          { name: 'open', inputSchema: { type: 'object' } },
          { name: 'close', inputSchema: { type: 'object' } },
          { name: 'hidden', inputSchema: { type: 'object' } }
        ]
      }),
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
  });

  const result = await manager.listTools();
  assert.deepEqual(result.tools.map(tool => tool.name), ['open']);
  assert.equal((await manager.callTool('tools', 'close', {})).ok, false);
});

test('McpManager lists tools for one server without touching others', async () => {
  let connected = '';
  const manager = new McpManager({
    servers: [
      server('docs', { command: 'node' }),
      server('other', { command: 'node' })
    ],
    transportFactory: (target) => ({ name: target.name }),
    clientFactory: () => ({
      connect: async (transport) => {
        connected = transport.name;
      },
      listTools: async () => ({
        tools: [{ name: connected === 'docs' ? 'search_docs' : 'other_tool' }]
      }),
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
  });

  const result = await manager.listServerTools('docs');
  assert.deepEqual(result.tools.map(tool => tool.name), ['search_docs']);
  assert.equal(connected, 'docs');
});

test('McpManager calls tools through the client', async () => {
  const manager = new McpManager({
    servers: [server('local', { command: 'node' })],
    transportFactory: () => ({}),
    clientFactory: () => ({
      connect: async () => undefined,
      listTools: async () => ({ tools: [] }),
      callTool: async ({ name, arguments: args }) => ({
        content: [{ type: 'text', text: `${name}:${args.value}` }]
      })
    })
  });

  const result = await manager.callTool('local', 'echo', { value: 42 });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'echo:42');
});

test('McpManager treats HTTP servers as callable', async () => {
  const manager = new McpManager({
    servers: [server('remote', { type: 'http', url: 'https://example.com/mcp' })],
    transportFactory: (target) => ({ url: target.config.url }),
    clientFactory: () => ({
      connect: async (transport) => {
        assert.equal(transport.url, 'https://example.com/mcp');
      },
      listTools: async () => ({ tools: [{ name: 'search' }] }),
      callTool: async ({ name }) => ({ content: [{ type: 'text', text: `${name}:ok` }] })
    })
  });

  assert.deepEqual((await manager.listTools()).tools.map(tool => tool.name), ['search']);
  const result = await manager.callTool('remote', 'search', {});
  assert.equal(result.ok, true);
  assert.equal(result.text, 'search:ok');
});

test('McpManager reports unknown and unsupported tool calls safely', async () => {
  const manager = new McpManager({
    servers: [server('mystery', { type: 'unknown' })],
    clientFactory: () => {
      throw new Error('should not connect');
    }
  });

  assert.equal((await manager.callTool('missing', 'x', {})).ok, false);
  assert.equal((await manager.callTool('mystery', 'x', {})).ok, false);
});
