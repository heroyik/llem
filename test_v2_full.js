const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') return { window: {}, workspace: {}, Uri: {}, EventEmitter: class {} };
  return originalRequire.apply(this, arguments);
};
const fs = require('fs');
const connectAI = require('./out/extension');
const htmlSource = connectAI.ConnectAIPanel.prototype._getHtml.toString();
const htmlBodyMatch = htmlSource.match(/return\s+`([\s\S]*?)`/);
if (htmlBodyMatch) {
  const evaluateTemplateString = new Function('return `' + htmlBodyMatch[1] + '`');
  const evaluatedHtml = evaluateTemplateString();
  const {JSDOM} = require('jsdom');
  try { new JSDOM(evaluatedHtml, {runScripts:'dangerously'}); console.log('JSDOM FULL HTML OK'); } catch(e) { console.error('EVAL ERR:', e.stack); }
} else {
  console.log('no match');
}
