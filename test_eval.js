const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') {
    return {
      window: { createWebviewPanel: () => {} },
      workspace: {},
      Uri: {},
      EventEmitter: class {},
      ExtensionContext: class {},
      WebviewPanel: class {}
    };
  }
  return originalRequire.apply(this, arguments);
};

const ext = require('./out/extension');
const html = ext.ConnectAIPanel.prototype._getHtml.call({_getHtml: ext.ConnectAIPanel.prototype._getHtml});
require('fs').writeFileSync('test_eval.html', html);
console.log('Evaluated length:', html.length);
