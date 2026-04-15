import * as fs from 'fs';
const base = fs.readFileSync('src/extension.ts', 'utf-8');
const match = base.match(/_getHtml.*?\{\s*return\s+(`(?:[^`]|\\`)*`);/m);
if (match) {
  let templateBody = match[1];
  // make it a valid JS file
  fs.writeFileSync('test_html2.js', `const html = ${templateBody};\nfs.writeFileSync('test_eval3.html', html);\nconsole.log(html.length);`);
}
