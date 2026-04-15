const html = `  h=h.replace(/([=!&lt;&gt;+\\\\-*/%|&amp;^~?:]+)/g,'<span class=\"op\">$1</span>');`;
console.log(html);
try {
  eval(html);
  console.log("OK");
} catch(e) {
  console.log("ERROR:", e.message);
}
