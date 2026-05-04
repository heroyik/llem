import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSubmitOnEnter } from '../out-test/inputComposition.js';

test('shouldSubmitOnEnter allows plain Enter', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 }), true);
});

test('shouldSubmitOnEnter blocks Shift+Enter', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 }), false);
});

test('shouldSubmitOnEnter blocks Enter during composition', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 }), false);
});

test('shouldSubmitOnEnter blocks IME confirm keyCode 229', () => {
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 }), false);
});
