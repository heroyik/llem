const ext = require('./out/extension');
const fs = require('fs');
const code = fs.readFileSync('out/extension.js', 'utf8');
const match = code.match(/_getHtml.*?\{\s*return\s+(`(?:[^`]|\\`)*`);/m);
if (match) {
  let templateBody = match[1];
  const html = eval(templateBody);
  const lines = html.split('\n');
  console.log("Line 92:", lines[91]);
  console.log("Line 93:", lines[92]);
  console.log("Line 94:", lines[93]);
  console.log("Line 95:", lines[94]);
  console.log("Line 96:", lines[95]);
}
