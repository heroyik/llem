const templateHTML = `
<script>
let code = "foo";
let h = code.replace(/(\\/\\/[^\\\\n]*)/g, "");
</script>
`;
console.log(templateHTML);
