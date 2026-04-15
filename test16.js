const fs = require('fs');
let html = fs.readFileSync('test.html', 'utf8');
const lines = html.split('\n');
console.log("Line 92:", lines[91]);
console.log("Line 93:", lines[92]);
console.log("Line 94:", lines[93]);
console.log("Line 95:", lines[94]);
console.log("Line 96:", lines[95]);
