import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RepetitionWatchdog,
  detectImportantSentenceLoop,
  detectRecentBlockLoop
} = require('../out-test/repetitionWatchdog.js');

test('detectRecentBlockLoop catches non-consecutive repeated message blocks', () => {
  const repeated = 'Refactor the stream parser to avoid duplicate flushes, preserve partial chunk handling, and stop replaying the same recovery paragraph during long outputs. ';
  const text = [
    'Intro: investigating generation stability. ',
    repeated,
    'Noise: token spacing changed slightly but the core loop continued elsewhere. ',
    repeated,
    'More noise between copies to simulate real model drift. ',
    repeated
  ].join('');

  const result = detectRecentBlockLoop(text, { blockSize: 100, minSignificantChars: 30, threshold: 3 });
  assert.equal(result.detected, true);
  assert.equal(result.count, 3);
});

test('detectRecentBlockLoop ignores low-signal symbol spam', () => {
  const symbols = '</div></div>\n\n'.repeat(30);
  const result = detectRecentBlockLoop(symbols, { blockSize: 100, minSignificantChars: 30, threshold: 3 });
  assert.equal(result.detected, false);
});

test('detectImportantSentenceLoop catches repeated important sentences with spacing differences', () => {
  const text = [
    'We are inspecting the agent output. ',
    'The migration must preserve user history and avoid resetting active sessions. ',
    'A short aside appears here. ',
    'The   migration must preserve user history and avoid resetting active sessions. ',
    'Another filler sentence shows up in between. ',
    'The migration must preserve user history and avoid resetting active sessions.'
  ].join('');

  const result = detectImportantSentenceLoop(text, {
    minSentenceLength: 40,
    minSignificantChars: 30,
    threshold: 3
  });

  assert.equal(result.detected, true);
  assert.equal(result.count, 3);
});

test('detectImportantSentenceLoop ignores short generic sentences', () => {
  const text = 'Okay. Okay. Okay. Done. Done. Done.';
  const result = detectImportantSentenceLoop(text, {
    minSentenceLength: 10,
    minSignificantChars: 8,
    threshold: 3
  });

  assert.equal(result.detected, false);
});

test('detectRecentBlockLoop ignores action-tag code generation blocks', () => {
  const text = [
    'Phase 2 implementation plan follows.\n\n',
    '<edit_file path="src/components/BentoCard.tsx">\n<find>\n',
    'interface BentoCardProps {\n  title: string;\n  description?: string;\n  state?: BentoState;\n}\n',
    '</find>\n<replace>\n',
    'interface BentoCardProps {\n  title: string;\n  description?: string;\n  state?: BentoState;\n  className?: string;\n}\n',
    '</replace>\n</edit_file>\n'
  ].join('');

  const result = detectRecentBlockLoop(text, {
    blockSize: 100,
    minSignificantChars: 30,
    threshold: 3
  });

  assert.equal(result.detected, false);
});

test('detectImportantSentenceLoop ignores code-like lines near action tags', () => {
  const text = [
    'We are starting the edit.\n',
    '<edit_file path="src/components/BentoCard.tsx">\n',
    'interface BentoCardProps {\n',
    '  title: string;\n',
    '  description?: string;\n',
    '  state?: BentoState;\n',
    '}\n'
  ].join('');

  const result = detectImportantSentenceLoop(text, {
    minSentenceLength: 20,
    minSignificantChars: 10,
    threshold: 2
  });

  assert.equal(result.detected, false);
});

test('RepetitionWatchdog aborts when a long block repeats across the stream', () => {
  const watchdog = new RepetitionWatchdog();
  const repeated = 'Important status update: the agent keeps reopening the same file, rewriting the same summary, and re-emitting the same corrective paragraph instead of finishing the task.\n';
  const chunks = [
    'Starting analysis.\n',
    repeated,
    'Different filler content between repeats.\n',
    repeated,
    'Another unrelated sentence to break adjacency.\n',
    repeated
  ];

  let detected = false;
  for (const chunk of chunks) {
    if (watchdog.addToken(chunk)) {
      detected = true;
      break;
    }
  }

  assert.equal(detected, true);
  assert.match(watchdog.getAbortedReason(), /recent block loop/);
});

test('RepetitionWatchdog aborts when an important sentence keeps returning', () => {
  const watchdog = new RepetitionWatchdog();
  const repeatedSentence = 'The deployment should not restart the background worker until the database migration is fully complete.';
  const chunks = [
    'Initial analysis begins.\n',
    `${repeatedSentence} \n`,
    'Interleaved detail about logs and retries.\n',
    `${repeatedSentence}\n`,
    'Another unrelated observation.\n',
    `${repeatedSentence}\n`
  ];

  let detected = false;
  for (const chunk of chunks) {
    if (watchdog.addToken(chunk)) {
      detected = true;
      break;
    }
  }

  assert.equal(detected, true);
  assert.match(watchdog.getAbortedReason(), /important sentence loop/);
});

test('RepetitionWatchdog ignores markdown table separator patterns', () => {
  const watchdog = new RepetitionWatchdog();
  const chunks = [
    '| Phase | Focus | Status | Progress | Key Deliverables |\n',
    '|', ' :---', ' |', ' :---', ' |', ' :---', ' |', ' :---', ' |', ' :---', ' |\n',
    '|', ' :---', ' |', ' :---', ' |', ' :---', ' |', ' :---', ' |', ' :---', ' |\n'
  ];

  let detected = false;
  for (const chunk of chunks) {
    if (watchdog.addToken(chunk)) {
      detected = true;
      break;
    }
  }

  assert.equal(detected, false);
});

test('RepetitionWatchdog ignores markdown fence and list scaffolding', () => {
  const watchdog = new RepetitionWatchdog();
  const chunks = [
    '###\n', '###\n',
    '```ts\n', '```ts\n',
    '-\n', '-\n', '-\n',
    '>\n', '>\n'
  ];

  let detected = false;
  for (const chunk of chunks) {
    if (watchdog.addToken(chunk)) {
      detected = true;
      break;
    }
  }

  assert.equal(detected, false);
});

test('RepetitionWatchdog ignores action-tag code scaffolding while editing files', () => {
  const watchdog = new RepetitionWatchdog();
  const chunks = [
    'Phase 2의 핵심인 "The Motion"을 구현하겠습니다.\n\n',
    '<edit_file path="src/components/BentoCard.tsx">\n',
    '<find>\n',
    'interface BentoCardProps {\n',
    '  title: string;\n',
    '  description?: string;\n',
    '  state?: BentoState;\n',
    '  className?: string;\n',
    '}\n',
    '</find>\n',
    '<replace>\n',
    'interface BentoCardProps {\n',
    '  title: string;\n',
    '  description?: string;\n',
    '  state?: BentoState;\n',
    '  className?: string;\n',
    '  isExpanded?: boolean;\n',
    '}\n'
  ];

  let detected = false;
  for (const chunk of chunks) {
    if (watchdog.addToken(chunk)) {
      detected = true;
      break;
    }
  }

  assert.equal(detected, false);
});
