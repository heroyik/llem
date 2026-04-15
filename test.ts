const code = `
function highlight(code,lang){
  let h=esc(code);
  h=h.replace(/(\\/\\/[^\\n]*)/g,'<span class="cm">$1</span>');
  h=h.replace(/(#[^\\n]*)/g,'<span class="cm">$1</span>');
  h=h.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g,'<span class="cm">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class="str">$1</span>');
  h=h.replace(/\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\b/g,'<span class="kw">$1</span>');
  h=h.replace(/\\b(\\d+\\.?\\d*)\\b/g,'<span class="num">$1</span>');
  h=h.replace(/\\b(True|False|None|true|false|null|undefined|NaN)\\b/g,'<span class="num">$1</span>');
  h=h.replace(/\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\b/g,'<span class="type">$1</span>');
  h=h.replace(/([=!&lt;&gt;+\\-*/%|&amp;^~?:]+)/g,'<span class="op">$1</span>');
}
`;
console.log(code);
