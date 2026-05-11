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
