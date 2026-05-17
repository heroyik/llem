import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEditableFilePath,
  resolveEditableWorkspacePath
} from '../out-test/editableFiles.js';

test('isEditableFilePath accepts common code files and absolute paths', () => {
  assert.equal(isEditableFilePath('src/app/page.tsx'), true);
  assert.equal(isEditableFilePath('/Users/nick/proj/llem/src/app/page.tsx'), true);
});

test('resolveEditableWorkspacePath matches nested relative paths and basenames', () => {
  const workspaceFiles = [
    'src/app/page.tsx',
    'src/components/Hero.tsx',
    'README.md'
  ];

  assert.equal(resolveEditableWorkspacePath('src/components/Hero.tsx', workspaceFiles), 'src/components/Hero.tsx');
  assert.equal(resolveEditableWorkspacePath('Hero.tsx', workspaceFiles), 'src/components/Hero.tsx');
  assert.equal(resolveEditableWorkspacePath('page.tsx', workspaceFiles), 'src/app/page.tsx');
});

test('resolveEditableWorkspacePath does not expand partial directory paths', () => {
  const workspaceFiles = [
    'src/mcp/mcpConfig.ts',
    'src/config.ts'
  ];

  assert.equal(resolveEditableWorkspacePath('mcp/mcpConfig.ts', workspaceFiles), undefined);
  assert.equal(resolveEditableWorkspacePath('src/mcpConfig.ts', workspaceFiles), undefined);
  assert.equal(resolveEditableWorkspacePath('src/mcp/mcpConfig.ts', workspaceFiles), 'src/mcp/mcpConfig.ts');
});
