var esc = function (s) { return s; };
function getHtml() {
    var pendingFiles = [{ name: 'foo' }];
    var text = 'bar';
    var t = '';
    if ((t.match(/\`\`\`/g) || []).length % 2 !== 0)
        t += '\\\\n\`\`\`';
    var displayText = text + (pendingFiles.length > 0 ? '\\\\n\\ud83d\\udcce ' + pendingFiles.map(function (f) { return f.name; }).join(', ') : '');
    return "\n    <script>\nfunction highlight(code,lang){\n  let h=esc(code);\n  h=h.replace(new RegExp(\"(\\\\/\\\\/[^\\\\n]*)\", \"g\"),'<span class=\"cm\">$1</span>');\n  h=h.replace(new RegExp(\"(#[^\\\\n]*)\", \"g\"),'<span class=\"cm\">$1</span>');\n  h=h.replace(new RegExp(\"(\\\\/\\\\*[\\\\s\\\\S]*?\\\\*\\\\/)\", \"g\"),'<span class=\"cm\">$1</span>');\n  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class=\"str\">$1</span>');\n  h=h.replace(new RegExp(\"\\\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\\\b\", \"g\"),'<span class=\"kw\">$1</span>');\n  h=h.replace(new RegExp(\"\\\\b(\\\\d+\\\\.?\\\\d*)\\\\b\", \"g\"),'<span class=\"num\">$1</span>');\n  h=h.replace(new RegExp(\"\\\\b(True|False|None|true|false|null|undefined|NaN)\\\\b\", \"g\"),'<span class=\"num\">$1</span>');\n  h=h.replace(new RegExp(\"\\\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\\\b\", \"g\"),'<span class=\"type\">$1</span>');\n  h=h.replace(/([=!+*/%|&^~?:-]+)/g,'<span class=\"op\">$1</span>');\n  return h;\n}\n  const displayText = \"".concat(displayText, "\";\n    </script>\n  ");
}
var html = getHtml();
var JSDOM = require('jsdom').JSDOM;
try {
    new JSDOM(html, { runScripts: 'dangerously' });
    console.log('JSDOM OK');
}
catch (e) {
    console.error('ERR:', e.message);
}
