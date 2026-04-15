const templateHTML = `
<script>
function highlight(code,lang){
  let h=code;
  h=h.replace(/(\\/{2}[^\\n]*)/g,'<span class=\"cm\">$1</span>');
  h=h.replace(/(#[^\\n]*)/g,'<span class=\"cm\">$1</span>');
  h=h.replace(/(\\/{1}\\*[\\s\\S]*?\\*\\/{1})/g,'<span class=\"cm\">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class=\"str\">$1</span>');
  h=h.replace(/\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\b/g,'<span class=\"kw\">$1</span>');
  h=h.replace(/\\b(\\d+\\.?\\d*)\\b/g,'<span class=\"num\">$1</span>');
  h=h.replace(/\\b(True|False|None|true|false|null|undefined|NaN)\\b/g,'<span class=\"num\">$1</span>');
  h=h.replace(/\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\b/g,'<span class=\"type\">$1</span>');
  h=h.replace(/([=!<>+\\-*/%|&^~?:]+)/g,'<span class=\"op\">$1</span>');
  return h;
}
  const displayText='foo'+(true?'\\n\\u{1F4CE} ':'');
</script>
`;
const {JSDOM} = require('jsdom');
try { new JSDOM(templateHTML, {runScripts:'dangerously'}); console.log('JSDOM OK'); } catch(e) { console.error('ERR:', e.message); }
