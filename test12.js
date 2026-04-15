const ext = require('./out/extension');
const fs = require('fs');
const code = fs.readFileSync('out/extension.js', 'utf8');
const match = code.match(/_getHtml.*?_getHtml\(\)\s*\{\s*return\s+(`(?:[^`]|\\`)*`);?/m);
if (match) {
  const html = eval(match[1]);
  const lines = html.split('\n');
  console.log("Total lines:", lines.length);
  console.log("Line 50:", lines[49]);
  console.log("Line 100:", lines[99]);
}
