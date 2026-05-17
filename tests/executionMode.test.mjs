import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutionModeDirective,
  normalizeExecutionMode,
  summarizeBlockedPlanActions
} from '../out-test/executionMode.js';

test('normalizeExecutionMode accepts known modes and falls back to default', () => {
  assert.equal(normalizeExecutionMode('plan'), 'plan');
  assert.equal(normalizeExecutionMode('agent'), 'agent');
  assert.equal(normalizeExecutionMode('wat'), 'default');
});

test('plan directive forbids mutating actions', () => {
  const directive = buildExecutionModeDirective('plan');
  assert.match(directive, /Plan Mode/);
  assert.match(directive, /Do not create, edit, delete files/);
});

test('summarizeBlockedPlanActions reports mutating actions', () => {
  assert.deepEqual(summarizeBlockedPlanActions({
    create: 1,
    edit: 2,
    delete: 0,
    command: 1,
    callMcpTool: 0,
    fallbackFileBlocks: 1
  }), [
    '1 create action(s)',
    '2 edit action(s)',
    '1 terminal command(s)',
    '1 inferred file block(s)'
  ]);
});
