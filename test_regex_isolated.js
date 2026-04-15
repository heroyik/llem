// Test just the create_file regex pattern in isolation
const t = '<create_file path="test.js">console.log("hi")</create_file>';
const result = t.replace(/<create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/g, 'MATCH:$1:$2');
console.log(result);
