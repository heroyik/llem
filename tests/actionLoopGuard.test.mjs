import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionLoopGuard, buildActionFingerprint } from '../out-test/actionLoopGuard.js';

test('buildActionFingerprint normalizes repeated create actions', () => {
  const first = buildActionFingerprint({
    kind: 'create',
    path: 'src/app/page.tsx',
    body: 'export default function Page() { return <main />; }'
  });
  const second = buildActionFingerprint({
    kind: 'create',
    path: '  SRC/app/page.tsx  ',
    body: 'export   default function Page() { return <main />; }'
  });

  assert.equal(first, second);
});

test('ActionLoopGuard blocks recently repeated actions', () => {
  const guard = new ActionLoopGuard(10_000);
  const action = {
    kind: 'edit',
    path: 'src/components/Hero.tsx',
    body: '<find>old</find><replace>new</replace>'
  };

  assert.equal(guard.shouldBlock(action), false);
  guard.remember(action);
  assert.equal(guard.shouldBlock(action), true);
});
