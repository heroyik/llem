var esc = function (s) { return s; };
function getHtml() {
    var pendingFiles = [{ name: 'foo' }];
    var text = 'bar';
    var t = '';
    if ((t.match(/\`\`\`/g) || []).length % 2 !== 0)
        t += '\\\\n\`\`\`';
    var h = "var x = 1; // test";
    h = h.replace(/(\\/, { 2:  }[ ^ ], n,  * ) / g, '<span class=\"cm\">$1</span>';
    ;
    h = h.replace(/(#[^\\\\n]*)/g, '<span class=\"cm\">$1</span>');
    h = h.replace(/(\\/, { 1:  },  * [s, S] *  ?  : ,  * , /{1})/g, '<span class=\"cm\">$1</span>');
    h = h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g, '<span class=\"str\">$1</span>');
    h = h.replace(/\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\b/g, '<span class=\"kw\">$1</span>');
    h = h.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class=\"num\">$1</span>');
    h = h.replace(/\\b(True|False|None|true|false|null|undefined|NaN)\\b/g, '<span class=\"num\">$1</span>');
    h = h.replace(/\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\b/g, '<span class=\"type\">$1</span>');
    h = h.replace(/([=!+\\-*/%|&^~?:]+)/g, '<span class=\"op\">$1</span>');
    var displayText = text + (pendingFiles.length > 0 ? '\\\\n\\ud83d\\udcce ' + pendingFiles.map(function (f) { return f.name; }).join(', ') : '');
    return "\n    <script>\n      ".concat(h, "\n      ").concat(displayText, "\n      ").concat(t, "\n    </script>\n  ");
}
console.log(getHtml());
