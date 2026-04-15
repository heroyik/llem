const orig = `
<script>
  function pushB() {} function esc() {}
  let t = "";
  t=t.replace(/<create_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/create_file>/g,(_,p,c)=>pushB('<div class="file-badge">\\ud83d\\udcc1 '+esc(p)+' \\u2014 \\uc790\\ub3d9 \\uc0dd\\uc131\\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
</script>
`;
const {JSDOM} = require('jsdom');
try { new JSDOM(orig, {runScripts:'dangerously'}); console.log('JSDOM OK'); } catch(e) { console.error('ERR:', e.message); }
