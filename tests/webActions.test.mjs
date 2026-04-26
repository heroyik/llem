import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanHtmlText } = require('../out-test/webActions.js');

test('cleanHtmlText removes script, style, tags, and extra whitespace', () => {
  const cleaned = cleanHtmlText(`
    <html>
      <style>body { color: red; }</style>
      <script>alert("x")</script>
      <body><h1>Hello</h1><p>world</p></body>
    </html>
  `);

  assert.equal(cleaned, 'Hello world');
});

test('cleanHtmlText handles empty-ish input', () => {
  assert.equal(cleanHtmlText(''), '');
  assert.equal(cleanHtmlText(null), '');
});
