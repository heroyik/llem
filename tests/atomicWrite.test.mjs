import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeUtf8FileAtomic } from '../out-test/atomicWrite.js';

test('writeUtf8FileAtomic creates and replaces utf8 files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-atomic-write-'));
  const filePath = path.join(root, 'note.txt');

  try {
    await writeUtf8FileAtomic(filePath, 'first');
    assert.equal(await readFile(filePath, 'utf8'), 'first');

    await writeUtf8FileAtomic(filePath, 'second');
    assert.equal(await readFile(filePath, 'utf8'), 'second');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeUtf8FileAtomic removes temp files when the write cannot be completed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-atomic-write-'));
  const dirPath = path.join(root, 'target-dir');

  try {
    await mkdir(dirPath);

    await assert.rejects(() => writeUtf8FileAtomic(dirPath, 'content'));
    const leftovers = await readdir(root);
    assert.deepEqual(leftovers, ['target-dir']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
