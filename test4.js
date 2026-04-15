const ext = require('./out/extension');
const html = ext.ConnectAIPanel.prototype._getHtml.call({_getHtml: ext.ConnectAIPanel.prototype._getHtml});
require('fs').writeFileSync('test4.html', html);
const {JSDOM} = require('jsdom');
try {
  new JSDOM(html, {runScripts:'dangerously'});
  console.log("JSDOM OK");
} catch(e) {
  console.log("JSDOM FATAL ERROR:", e.message);
}
