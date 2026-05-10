import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RepetitionWatchdog } = require('../out-test/repetitionWatchdog.js');

test('RepetitionWatchdog allows multiple <edit_file> action-tag repetitions', () => {
    const watchdog = new RepetitionWatchdog();
    const chunks = [
        '코드를 수정하겠습니다.\n',
        '<edit_file path="src/app.ts">\n',
        '<find>\nold code\n</find>\n',
        '<replace>\nnew code\n</replace>\n',
        '</edit_file>\n',
        '다음을 수정합니다.\n',
        '<edit_file path="src/index.ts">\n',  // 다른 파일
        '<find>\nold\n</find>\n',
        '<replace>\nnew\n</replace>\n',
        '</edit_file>\n'
    ];

    let detected = false;
    for (const chunk of chunks) {
        if (watchdog.addToken(chunk)) {
            detected = true;
            break;
        }
    }

    assert.equal(detected, false, 'Should not detect loop for legitimate multiple file edits');
});

test('RepetitionWatchdog respects high action-tag density in recent blocks', () => {
    const watchdog = new RepetitionWatchdog();
    const denselyTaggedOutput = [
        'Starting edits.\n',
        '<edit_file>\n<find>code</find>\n<replace>new</replace>\n</edit_file>\n',
        '<edit_file>\n<find>code2</find>\n<replace>new2</replace>\n</edit_file>\n',
        '<edit_file>\n<find>code3</find>\n<replace>new3</replace>\n</edit_file>\n'
    ];

    let detected = false;
    for (const chunk of denselyTaggedOutput) {
        if (watchdog.addToken(chunk)) {
            detected = true;
            break;
        }
    }

    assert.equal(detected, false, 'Should not detect loop when action-tags are dense');
});

test('RepetitionWatchdog allows legitimate repeated edits with code blocks', () => {
    const watchdog = new RepetitionWatchdog();
    const chunks = [
        'I will refactor the component now.\n\n',
        '<edit_file path="src/components/Hero.tsx">\n',
        '<find>\nexport const Hero = () => {\n  return <div>Old</div>;\n}\n</find>\n',
        '<replace>\nexport const Hero = ({ title }: HeroProps) => {\n  return <div>{title}</div>;\n}\n</replace>\n',
        '</edit_file>\n\n',
        'Now updating the types.\n\n',
        '<edit_file path="src/types/Hero.ts">\n',
        '<find>\ninterface HeroProps {}\n</find>\n',
        '<replace>\ninterface HeroProps {\n  title: string;\n}\n</replace>\n',
        '</edit_file>\n'
    ];

    let detected = false;
    for (const chunk of chunks) {
        if (watchdog.addToken(chunk)) {
            detected = true;
            break;
        }
    }

    assert.equal(detected, false, 'Should allow multiple legitimate file edits with code blocks');
});

test('RepetitionWatchdog still detects genuinely repeated important statements', () => {
    const watchdog = new RepetitionWatchdog();
    const repeatedStatement = 'The component must be refactored to support server-side rendering.';
    const chunks = [
        'Starting implementation.\n',
        `${repeatedStatement}\n`,
        'First version of changes.\n',
        `${repeatedStatement}\n`,
        'Attempt to improve.\n',
        `${repeatedStatement}\n`
    ];

    let detected = false;
    for (const chunk of chunks) {
        if (watchdog.addToken(chunk)) {
            detected = true;
            break;
        }
    }

    assert.equal(detected, true, 'Should still detect genuinely repeated important statements');
});

test('RepetitionWatchdog detects identical completed edit_file blocks repeated three times', () => {
    const watchdog = new RepetitionWatchdog();
    const block = '<edit_file path="src/a.ts">\n<find>old value</find>\n<replace>new value</replace>\n</edit_file>\n';

    let detected = false;
    for (const chunk of ['Starting edit.\n', block, block, block]) {
        if (watchdog.addToken(chunk)) {
            detected = true;
            break;
        }
    }

    assert.equal(detected, true, 'Should detect identical completed action blocks repeated three times');
    assert.match(watchdog.getAbortedReason(), /repeated action block loop/);
});

test('RepetitionWatchdog allows similar edit_file structure across different files', () => {
    const watchdog = new RepetitionWatchdog();
    const chunks = [
        '<edit_file path="src/a.ts">\n<find>old value</find>\n<replace>new value</replace>\n</edit_file>\n',
        '<edit_file path="src/b.ts">\n<find>old value</find>\n<replace>new value</replace>\n</edit_file>\n',
        '<edit_file path="src/c.ts">\n<find>old value</find>\n<replace>new value</replace>\n</edit_file>\n'
    ];

    let detected = false;
    for (const chunk of chunks) {
        if (watchdog.addToken(chunk)) {
            detected = true;
            break;
        }
    }

    assert.equal(detected, false, 'Should not detect loop for same edit shape applied to different files');
});
