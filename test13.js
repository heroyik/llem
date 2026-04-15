const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') return {};
  return originalRequire.apply(this, arguments);
};

const fs = require('fs');
const code = fs.readFileSync('out/extension.js', 'utf8');
const match = code.match(/_getHtml.*?(<!DOCTYPE html>[\s\S]*?)<\/html>.*?;/m);
if (match) {
  const html = match[1] + "</html>";
  const lines = html.split('\n');
  console.log("Total lines:", lines.length);
  // print from line 60 to end
}
