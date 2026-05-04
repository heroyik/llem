import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeAssistantOutput } from '../out-test/assistantOutputSanitizer.js';

test('sanitizeAssistantOutput removes leaked action tags and scratchpad lines', () => {
  const input = [
    '지금부터 Phase 2 작업을 실행합니다.',
    '<edit_file path="src/app/page.tsx">',
    '<find>',
    'old',
    '</find>',
    '<replace>',
    'new',
    '</replace>',
    '</edit_file>',
    '',
    '(Wait, the page.tsx replace block was a bit complex because of the dynamic mapping. Let’s refine it to be more robust for the user’s environment.)',
    '',
    '이제 페이지에서 확장 상태를 관리합니다.',
    '</edit_file>'
  ].join('\n');

  const output = sanitizeAssistantOutput(input);

  assert.match(output, /지금부터 Phase 2 작업을 실행합니다\./);
  assert.match(output, /이제 페이지에서 확장 상태를 관리합니다\./);
  assert.doesNotMatch(output, /edit_file|<find>|<replace>|dynamic mapping|Let’s refine|Let's refine/i);
});
