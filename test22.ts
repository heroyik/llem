const esc = (s:string)=>s;
function getHtml() {
  let pendingFiles = [{name: 'foo'}];
  let text = 'bar';
  let t = '';
  if((t.match(/\`\`\`/g)||[]).length % 2 !== 0) t += '\\\\n\`\`\`';
  
  const displayText=text+(pendingFiles.length>0?'\\\\n\\ud83d\\udcce '+pendingFiles.map(f=>f.name).join(', '):'');
  
  return `
    <script>
function highlight(code,lang){
  let h=esc(code);
  h=h.replace(new RegExp("(\\\\/\\\\/[^\\\\n]*)", "g"),'<span class=\"cm\">$1</span>');
  h=h.replace(new RegExp("(#[^\\\\n]*)", "g"),'<span class=\"cm\">$1</span>');
  h=h.replace(new RegExp("(\\\\/\\\\*[\\\\s\\\\S]*?\\\\*\\\\/)", "g"),'<span class=\"cm\">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class=\"str\">$1</span>');
  h=h.replace(new RegExp("\\\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\\\b", "g"),'<span class=\"kw\">$1</span>');
  h=h.replace(new RegExp("\\\\b(\\\\d+\\\\.?\\\\d*)\\\\b", "g"),'<span class=\"num\">$1</span>');
  h=h.replace(new RegExp("\\\\b(True|False|None|true|false|null|undefined|NaN)\\\\b", "g"),'<span class=\"num\">$1</span>');
  h=h.replace(new RegExp("\\\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\\\b", "g"),'<span class=\"type\">$1</span>');
  h=h.replace(/([=!+*/%|&^~?:-]+)/g,'<span class=\"op\">$1</span>');
  return h;
}
  const displayText = "${displayText}";
    </script>
  `;
}
const html = getHtml();
const {JSDOM} = require('jsdom');
try { new JSDOM(html, {runScripts:'dangerously'}); console.log('JSDOM OK'); } catch(e) { console.error('ERR:', e.message); }
