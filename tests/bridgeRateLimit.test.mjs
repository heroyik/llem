import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedWindowRateLimiter } from '../out-test/bridgeRateLimit.js';

test('FixedWindowRateLimiter allows requests within the configured window budget', () => {
  let now = 1000;
  const limiter = new FixedWindowRateLimiter(2, 1000, () => now);

  assert.deepEqual(limiter.check('client'), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.check('client'), { allowed: true, retryAfterMs: 0 });
});

test('FixedWindowRateLimiter rejects requests over budget until the window resets', () => {
  let now = 1000;
  const limiter = new FixedWindowRateLimiter(2, 1000, () => now);

  limiter.check('client');
  limiter.check('client');

  assert.deepEqual(limiter.check('client'), { allowed: false, retryAfterMs: 1000 });

  now = 1999;
  assert.deepEqual(limiter.check('client'), { allowed: false, retryAfterMs: 1 });

  now = 2000;
  assert.deepEqual(limiter.check('client'), { allowed: true, retryAfterMs: 0 });
});

test('FixedWindowRateLimiter tracks independent keys and prunes expired buckets', () => {
  let now = 1000;
  const limiter = new FixedWindowRateLimiter(1, 500, () => now);

  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('b').allowed, true);
  assert.equal(limiter.check('a').allowed, false);

  now = 1500;
  limiter.prune();

  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('b').allowed, true);
});
