const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') return {};
  return originalRequire.apply(this, arguments);
};
const fs = require('fs');
const code = fs.readFileSync('out/extension.js', 'utf8');
const match = code.match(/_getHtml.*?_getHtml\(\)\s*\{\s*return\s+(`(?:[^`]|\\`)*`);?/m);
if (match) {
  const html = eval(match[1]);
  const lines = html.split('\n');
  console.log("Line 92:", lines[91]);
  console.log("Line 93:", lines[92]);
  console.log("Line 94:", lines[93]);
  console.log("Line 95:", lines[94]);
  console.log("Line 96:", lines[95]);
}
