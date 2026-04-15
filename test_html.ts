import * as fs from 'fs';
const text = fs.readFileSync('src/extension.ts', 'utf-8');
const match = text.match(/_getHtml.*?\{([\s\S]*?)^\s*\}/m);
if (match) {
  let inner = match[1];
  // extract the returned string
  const strMatch = inner.match(/return\s+`(.*)`/ms);
  if (strMatch) {
    fs.writeFileSync('test.html', strMatch[1]);
    console.log("Wrote test.html length", strMatch[1].length);
  } else { console.log('no string'); }
} else { console.log('no func'); }
