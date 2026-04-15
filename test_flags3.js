const lines = [
  `h=h.replace(/(\\/\\/[^\\n]*)/g,'');`,
  `h=h.replace(/(#[^\\n]*)/g,'');`,
  `h=h.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g,'');`,
];
for(let line of lines) {
  try {
    eval(line);
    console.log("OK:", line);
  } catch(e) {
    console.log("ERROR:", e.message, "ON:", line);
  }
}
