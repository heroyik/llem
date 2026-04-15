const templateHTML = `
<script>
  let h = "foo // bar";
  h=h.replace(/(\\/{2}[^\\n]*)/g,'<span class=\"cm\">$1</span>');
</script>
`;
const {JSDOM} = require('jsdom');
try { new JSDOM(templateHTML, {runScripts:'dangerously'}); console.log('JSDOM OK'); } catch(e) { console.error('ERR:', e.message); }
