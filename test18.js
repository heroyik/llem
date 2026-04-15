const templateHTML = `
<script>
  // what ts compiles for \\/\\/
  h=h.replace(/(\/\/[^\n]*)/g,'<span class=\"cm\">$1</span>');
</script>
`;
const {JSDOM} = require('jsdom');
try { new JSDOM(templateHTML, {runScripts:'dangerously'}); console.log('JSDOM OK'); } catch(e) { console.error('ERR:', e.message); }
