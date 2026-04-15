const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') return { window: {}, workspace: {}, Uri: {}, EventEmitter: class {} };
  return originalRequire.apply(this, arguments);
};
const fs = require('fs');
const code = fs.readFileSync('out/extension.js', 'utf8');
const match = code.match(/_getHtml.*?(<!DOCTYPE html>[\s\S]*?)<\/html>.*?;/m);
if (!match) {
  const match2 = code.match(/_getHtml.*?\{\s*return\s+(`(?:[^`]|\\`)*`);?/m);
  if (match2) {
    const html = eval(match2[1]);
    const {JSDOM} = require('jsdom');
    try { new JSDOM(html, {runScripts:'dangerously'}); console.log('JSDOM EVAL OK'); } catch(e) { console.error('EVAL ERR:', e.message); }
  } else { console.log('no match2 either'); }
}
