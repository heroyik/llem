import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDesignPlanningDirective,
  shouldUseDesignPlanningMode
} from '../out-test/designPlanningMode.js';

test('shouldUseDesignPlanningMode detects implementation request with design guideline attachment', () => {
  const result = shouldUseDesignPlanningMode(
    '로그인 화면을 Next.js로 구현해줘',
    []
  );

  assert.equal(result, true);
});

test('shouldUseDesignPlanningMode detects code modification requests without special files', () => {
  const result = shouldUseDesignPlanningMode(
    'src/app/page.tsx 수정해줘',
    []
  );

  assert.equal(result, true);
});

test('shouldUseDesignPlanningMode ignores non-implementation requests', () => {
  const result = shouldUseDesignPlanningMode(
    '이 문서를 요약해줘',
    ['notes.md']
  );

  assert.equal(result, false);
});

test('buildDesignPlanningDirective requires plan-only first response for initial phase', () => {
  const directive = buildDesignPlanningDirective('initial');
  assert.match(directive, /DO NOT emit file actions yet/);
  assert.match(directive, /small file split plan/);
  assert.match(directive, /IMPLEMENTATION PLANNING MODE/);
});
