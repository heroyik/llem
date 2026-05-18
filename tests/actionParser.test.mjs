import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseCommandActions,
  parseCreateActions,
  parseDeleteActions,
  parseFallbackFileBlocks,
  parseCallMcpToolActions,
  parseListActions,
  parseListMcpToolsActions,
  parseMcpSlashCommandActions,
  parseReadFileActions,
  parseUrlActions,
  stripWrappingFence
} = require('../out-test/actionParser.js');

test('parseCreateActions extracts path and strips wrapping code fence', () => {
  const actions = parseCreateActions(`
<create_file path="src/app.ts">
\`\`\`ts
export const value = 1;
\`\`\`
</create_file>
`);

  assert.deepEqual(actions, [
    { path: 'src/app.ts', body: 'export const value = 1;' }
  ]);
});

test('path actions preserve nested paths for read, list, and delete', () => {
  assert.deepEqual(parseReadFileActions('<read_file path="src/nested/file.ts"/>'), [
    { path: 'src/nested/file.ts' }
  ]);
  assert.deepEqual(parseListActions('<list_files path="src/nested"/>'), [
    { path: 'src/nested' }
  ]);
  assert.deepEqual(parseDeleteActions('<delete_file path="src/nested/file.ts"/>'), [
    { path: 'src/nested/file.ts' }
  ]);
});

test('parseCommandActions strips fenced command bodies', () => {
  const actions = parseCommandActions(`
<run_command>
\`\`\`bash
npm test
\`\`\`
</run_command>
`);

  assert.deepEqual(actions, [{ text: 'npm test' }]);
});

test('parseUrlActions trims requested URLs', () => {
  assert.deepEqual(parseUrlActions('<read_url> https://example.com/a?q=1 </read_url>'), [
    { text: 'https://example.com/a?q=1' }
  ]);
});

test('parse MCP action tags', () => {
  assert.equal(parseListMcpToolsActions('<list_mcp_tools/>').length, 1);
  assert.equal(parseListMcpToolsActions('/list_mcp_tools').length, 1);
  assert.equal(parseListMcpToolsActions('/list-mcp-tools').length, 1);
  assert.deepEqual(parseCallMcpToolActions('<call_mcp_tool server="github" tool="list_issues">{"state":"open"}</call_mcp_tool>'), [
    { server: 'github', tool: 'list_issues', body: '{"state":"open"}' }
  ]);
});

test('parse MCP slash commands from line starts', () => {
  assert.deepEqual(parseMcpSlashCommandActions('/ctx_stats'), [
    { command: 'ctx_stats', body: '' }
  ]);
  assert.deepEqual(parseMcpSlashCommandActions('/ctx-stats'), [
    { command: 'ctx_stats', body: '' }
  ]);
  assert.deepEqual(parseMcpSlashCommandActions('/context-mode:ctx-doctor'), [
    { command: 'ctx_doctor', body: '' }
  ]);
  assert.deepEqual(parseMcpSlashCommandActions('ctx stats'), [
    { command: 'ctx_stats', body: '' }
  ]);
  assert.deepEqual(parseMcpSlashCommandActions('ctx purge {"confirm":true}'), [
    { command: 'ctx_purge', body: '{"confirm":true}' }
  ]);
  assert.deepEqual(parseMcpSlashCommandActions('before\n  /ctx_query {"q":"notes"}\nafter'), [
    { command: 'ctx_query', body: '{"q":"notes"}' }
  ]);
  assert.deepEqual(parseMcpSlashCommandActions('/list_mcp_tools'), []);
  assert.deepEqual(parseMcpSlashCommandActions('not a /ctx_stats command'), []);
});


test('parseFallbackFileBlocks extracts file comments from fenced code', () => {
  const actions = parseFallbackFileBlocks(`
\`\`\`ts
// file: src/generated.ts
export const generated = true;
\`\`\`
`);

  assert.deepEqual(actions, [
    { path: 'src/generated.ts', body: 'export const generated = true;' }
  ]);
});

test('parseFallbackFileBlocks extracts path attributes from fenced code', () => {
  const actions = parseFallbackFileBlocks(`
\`\`\`tsx path="src/components/Panel.tsx"
export function Panel() {
  return <section />;
}
\`\`\`
`);

  assert.deepEqual(actions, [
    { path: 'src/components/Panel.tsx', body: 'export function Panel() {\n  return <section />;\n}' }
  ]);
});

test('parseFallbackFileBlocks extracts file headings followed by fenced code', () => {
  const actions = parseFallbackFileBlocks(`
File: src/lib/util.ts
\`\`\`ts
export const sum = (a: number, b: number) => a + b;
\`\`\`
`);

  assert.deepEqual(actions, [
    { path: 'src/lib/util.ts', body: 'export const sum = (a: number, b: number) => a + b;' }
  ]);
});

test('stripWrappingFence leaves unfenced content alone', () => {
  assert.equal(stripWrappingFence('plain text'), 'plain text');
});
