import test from 'node:test';
import assert from 'node:assert/strict';
import { FileMutationGuard } from '../out-test/fileMutationGuard.js';

test('FileMutationGuard allows only one active mutation per path', () => {
  const guard = new FileMutationGuard();

  assert.equal(guard.tryAcquire('/tmp/demo.tsx'), true);
  assert.equal(guard.tryAcquire('/tmp/demo.tsx'), false);

  guard.release('/tmp/demo.tsx');
  assert.equal(guard.tryAcquire('/tmp/demo.tsx'), true);
});
