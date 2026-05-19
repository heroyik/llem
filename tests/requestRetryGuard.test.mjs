import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestRetryGuard } from '../out-test/requestRetryGuard.js';
import { buildRequestFingerprint } from '../out-test/requestFingerprint.js';

function makeRequest(overrides = {}) {
  return {
    id: 'req_1',
    kind: 'prompt',
    prompt: 'Use design-guideline.md to build the page',
    modelName: 'gemma',
    files: [{ name: 'design-guideline.md', type: 'text/markdown', data: 'abc', originalSize: 3 }],
    internetEnabled: false,
    createdAt: 1,
    ...overrides
  };
}

test('RequestRetryGuard blocks the same request after repetition stop', () => {
  const guard = new RequestRetryGuard(10_000);
  const request = makeRequest();

  assert.equal(guard.shouldBlock(request).blocked, false);
  guard.markRepeated(request, 'watchdog_loop');

  const blocked = guard.shouldBlock(makeRequest({ id: 'req_2' }));
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.reason, 'watchdog_loop');
});

test('RequestRetryGuard allows distinct requests', () => {
  const guard = new RequestRetryGuard(10_000);
  guard.markRepeated(makeRequest(), 'repetition_detected');

  const other = makeRequest({ prompt: 'Build a different dashboard', id: 'req_3' });
  assert.equal(guard.shouldBlock(other).blocked, false);
});

test('RequestRetryGuard keeps non-retryable repetition blocked for the TTL', () => {
  const guard = new RequestRetryGuard(10_000);
  const request = makeRequest();

  const result = guard.markRepeated(request, 'watchdog_loop', { retryable: false });

  assert.equal(result.retryAllowed, false);
  assert.equal(result.nextDelayMs, 0);
  assert.equal(guard.shouldBlock(makeRequest({ id: 'req_2' })).blocked, true);
});

test('request fingerprints ignore internal system hints', () => {
  const base = buildRequestFingerprint(makeRequest());
  const hinted = buildRequestFingerprint(makeRequest({
    prompt: 'Use design-guideline.md to build the page\n\n[SYSTEM HINT] A repetition loop was detected. Avoid repeating the same logic.'
  }));

  assert.equal(hinted, base);
});
