const templateHTML = `
<script>
let code = "foo";
let h = code.replace(/(\\/\\/[^\\n]*)/g, "");
</script>
`;
console.log(templateHTML);
const {JSDOM} = require('jsdom');
try { new JSDOM(templateHTML, {runScripts:'dangerously'}); console.log('JSDOM OK'); } catch(e) { console.error('ERR:', e.message); }
