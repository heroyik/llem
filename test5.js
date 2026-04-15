const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') return { window: {}, workspace: {}, Uri: {}, EventEmitter: class {} };
  return originalRequire.apply(this, arguments);
};

const fs = require('fs');
let html = fs.readFileSync('test.html', 'utf8');

const {JSDOM} = require('jsdom');
try {
  new JSDOM(html, {runScripts:'dangerously'});
  console.log("JSDOM OK");
} catch(e) {
  console.log("JSDOM FATAL ERROR:", e.message);
}
