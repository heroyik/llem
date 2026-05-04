import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  applyFindReplacePairs,
  executeCreateFileAction,
  executeDeleteFileAction,
  executeEditFileAction,
  executeListFilesAction
} = require('../out-test/fileActions.js');

test('applyFindReplacePairs applies multiple exact replacements', () => {
  const result = applyFindReplacePairs('hello old\nold again', `
<find>old</find><replace>new</replace>
<find>again</find><replace>twice</replace>
`);

  assert.equal(result.content, 'hello new\nold twice');
  assert.equal(result.editCount, 2);
  assert.equal(result.missingTargets, 0);
});

test('applyFindReplacePairs reports missing targets without changing content', () => {
  const result = applyFindReplacePairs('hello world', '<find>nope</find><replace>yes</replace>');

  assert.equal(result.content, 'hello world');
  assert.equal(result.editCount, 0);
  assert.equal(result.missingTargets, 1);
});

test('applyFindReplacePairs rejects incomplete edit bodies', () => {
  const result = applyFindReplacePairs('hello world', '<find>hello</find><replace>goodbye');

  assert.equal(result.editCount, 0);
  assert.equal(result.invalid, 'incomplete <replace> block.');
});

test('executeCreateFileAction writes nested files and reports the opened path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-file-actions-'));
  const resolvePath = async (relPath) => ({
    absPath: path.join(root, relPath),
    isVaultPath: false
  });

  try {
    const result = await executeCreateFileAction('nested/created.txt', 'hello', resolvePath);
    const createdPath = path.join(root, 'nested', 'created.txt');

    assert.equal(result.workspaceModified, true);
    assert.equal(result.openFile, createdPath);
    assert.equal(await readFile(createdPath, 'utf8'), 'hello');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('executeCreateFileAction rejects unbalanced fenced content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-file-actions-'));
  const resolvePath = async (relPath) => ({
    absPath: path.join(root, relPath),
    isVaultPath: false
  });

  try {
    const result = await executeCreateFileAction('broken.ts', '```ts\nexport const broken = true;\n', resolvePath);

    assert.equal(result.workspaceModified, false);
    assert.match(result.report[0], /unbalanced code fence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('executeEditFileAction applies replacements atomically and blocks directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-file-actions-'));
  const filePath = path.join(root, 'edit-me.txt');
  const dirPath = path.join(root, 'edit-dir');
  await writeFile(filePath, 'hello old world', 'utf8');
  await mkdir(dirPath);

  const resolvePath = async (relPath) => ({
    absPath: path.join(root, relPath),
    isVaultPath: false
  });

  try {
    const edited = await executeEditFileAction(
      'edit-me.txt',
      '<find>old</find><replace>new</replace>',
      resolvePath
    );

    assert.equal(edited.workspaceModified, true);
    assert.equal(edited.openFile, filePath);
    assert.equal(await readFile(filePath, 'utf8'), 'hello new world');

    const blocked = await executeEditFileAction(
      'edit-dir',
      '<find>x</find><replace>y</replace>',
      resolvePath
    );

    assert.equal(blocked.workspaceModified, false);
    assert.match(blocked.report[0], /target is not a file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('executeDeleteFileAction deletes files but blocks directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-file-actions-'));
  const filePath = path.join(root, 'delete-me.txt');
  const dirPath = path.join(root, 'keep-dir');
  await writeFile(filePath, 'bye', 'utf8');
  await mkdir(dirPath);

  const resolvePath = async (relPath) => ({
    absPath: path.join(root, relPath),
    isVaultPath: false
  });

  try {
    const deleted = await executeDeleteFileAction('delete-me.txt', resolvePath);
    assert.equal(deleted.workspaceModified, true);
    await assert.rejects(() => readFile(filePath, 'utf8'));

    const blocked = await executeDeleteFileAction('keep-dir', resolvePath);
    assert.equal(blocked.workspaceModified, false);
    assert.match(blocked.report[0], /directory deletion is not allowed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('executeListFilesAction filters hidden and excluded entries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'llem-file-actions-'));
  await writeFile(path.join(root, 'visible.txt'), 'ok', 'utf8');
  await writeFile(path.join(root, '.hidden'), 'skip', 'utf8');
  await mkdir(path.join(root, 'node_modules'));

  const resolvePath = async (relPath) => ({
    absPath: relPath === '.' ? root : path.join(root, relPath),
    isVaultPath: false
  });

  try {
    const result = await executeListFilesAction('.', resolvePath);
    assert.match(result.report[0], /visible\.txt/);
    assert.doesNotMatch(result.report[0], /\.hidden/);
    assert.doesNotMatch(result.report[0], /node_modules/);
    assert.ok(result.chatMessage);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
