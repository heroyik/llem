"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var text = fs.readFileSync('src/extension.ts', 'utf-8');
var match = text.match(/_getHtml.*?\{([\s\S]*?)^\s*\}/m);
if (match) {
    var inner = match[1];
    // extract the returned string
    var strMatch = inner.match(/return\s+`(.*)`/ms);
    if (strMatch) {
        fs.writeFileSync('test.html', strMatch[1]);
        console.log("Wrote test.html length", strMatch[1].length);
    }
    else {
        console.log('no string');
    }
}
else {
    console.log('no func');
}
