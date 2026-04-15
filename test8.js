const fs=require('fs');
let t=fs.readFileSync('out/extension.js', 'utf8');
let m = t.match(/h=h\.replace\([^)]*\)/g);
m.forEach(x => console.log(x));
