import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isPrivateOrLocalIp,
  parsePublicHttpUrl,
  safeResolveActionPath
} = require('../out-test/security.js');

test('safeResolveActionPath allows workspace-relative paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-workspace-'));
  try {
    const result = await safeResolveActionPath(root, 'src/index.ts');
    assert.equal(result.absPath, path.resolve(root, 'src/index.ts'));
    assert.equal(result.isVaultPath, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('safeResolveActionPath blocks path traversal outside allowed roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-workspace-'));
  try {
    await assert.rejects(
      () => safeResolveActionPath(root, '../outside.txt'),
      /escapes the workspace/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('safeResolveActionPath allows configured vault roots and marks them', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'llem-roots-'));
  const workspace = path.join(base, 'workspace');
  const vault = path.join(base, 'vault');
  await mkdir(workspace);
  await mkdir(vault);

  try {
    const target = path.join(vault, 'notes', 'memo.md');
    const result = await safeResolveActionPath(workspace, target, {
      extraAllowedRoots: [vault],
      vaultRoot: vault
    });

    assert.equal(result.absPath, path.resolve(target));
    assert.equal(result.isVaultPath, true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('parsePublicHttpUrl only accepts public http schemes without credentials', () => {
  assert.equal(parsePublicHttpUrl('https://example.com/path').hostname, 'example.com');
  assert.throws(() => parsePublicHttpUrl('file:///tmp/data.txt'), /only http and https/);
  assert.throws(() => parsePublicHttpUrl('https://user:pass@example.com'), /embedded credentials/);
});

test('isPrivateOrLocalIp catches local and private network ranges', () => {
  assert.equal(isPrivateOrLocalIp('127.0.0.1'), true);
  assert.equal(isPrivateOrLocalIp('10.0.0.2'), true);
  assert.equal(isPrivateOrLocalIp('172.16.5.4'), true);
  assert.equal(isPrivateOrLocalIp('192.168.1.1'), true);
  assert.equal(isPrivateOrLocalIp('169.254.1.1'), true);
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
  assert.equal(isPrivateOrLocalIp('::1'), true);
  assert.equal(isPrivateOrLocalIp('fd00::1'), true);
});
