import test from 'node:test';
import assert from 'node:assert/strict';
import { containsActionTags } from '../out-test/actionTagGuard.js';

test('containsActionTags detects create_file tags', () => {
  assert.equal(containsActionTags('<create_file path="src/app.ts">x</create_file>'), true);
});

test('containsActionTags detects call-style tags', () => {
  assert.equal(containsActionTags('<call:edit_file path="src/app.ts">x</call:edit_file>'), true);
});

test('containsActionTags ignores plain planning text', () => {
  assert.equal(containsActionTags('1. Split into Hero.tsx and Features.tsx\n2. Update page.tsx'), false);
});
