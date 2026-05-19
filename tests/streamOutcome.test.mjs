import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completedStreamOutcome,
  interruptedStreamOutcome,
  isLoopStopReason
} from '../out-test/streamOutcome.js';

test('completedStreamOutcome marks successful completion', () => {
  const result = completedStreamOutcome('done');
  assert.equal(result.stopReason, 'completed');
  assert.equal(result.repeated, false);
  assert.equal(result.aborted, false);
});

test('interruptedStreamOutcome marks repetition stop as repeated', () => {
  const result = interruptedStreamOutcome('partial stone stone', 'repetition_detected', {
    repeatedKind: 'token-spam',
    repeatedToken: ' stone',
    retryable: false,
    cleanText: 'partial'
  });
  assert.equal(result.repeated, true);
  assert.equal(isLoopStopReason(result.stopReason), true);
  assert.equal(result.repeatedKind, 'token-spam');
  assert.equal(result.repeatedToken, ' stone');
  assert.equal(result.retryable, false);
  assert.equal(result.cleanText, 'partial');
});
