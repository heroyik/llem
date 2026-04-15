const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') return { window: {}, workspace: {}, Uri: {}, EventEmitter: class {} };
  return originalRequire.apply(this, arguments);
};
const ext = require('./out/extension');

// Try calling _getHtml
let html;
try {
  html = ext.ConnectAIPanel.prototype._getHtml.call({_getHtml: ext.ConnectAIPanel.prototype._getHtml});
} catch(e) {
  console.log("Could not call _getHtml directly:", e.message);
  // Alternative: match from the original code and eval it
  const fs = require('fs');
  const code = fs.readFileSync('out/extension.js', 'utf8');
  const match = code.match(/_getHtml.*?_getHtml\(\)\s*\{\s*return\s+(`(?:[^`]|\\`)*`);?/m);
  if (match) {
    html = eval(match[1]);
  }
}

if (!html) {
  console.log("Failed to get html");
  process.exit(1);
}

const fs = require('fs');
fs.writeFileSync('test_eval2.html', html);
const {JSDOM} = require('jsdom');
try {
  new JSDOM(html, {runScripts:'dangerously'});
  console.log("JSDOM OK");
} catch(e) {
  console.log("JSDOM FATAL ERROR:", e.message);
}
