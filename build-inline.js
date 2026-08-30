/* Build step: inline style.css into index.html so the first paint needs
   zero extra round trips. Source files stay separate and maintainable. */
const fs = require('fs');
const path = process.argv[2] || 'public';

const cssPath = `${path}/css/style.css`;
const htmlPath = `${path}/index.html`;
let html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')      // strip comments
  .replace(/\s*\n\s*/g, '\n')            // trim indentation
  .replace(/\n{2,}/g, '\n')
  .trim();

const link = '<link rel="stylesheet" href="css/style.css">';
if (!html.includes(link)) { console.error('style.css link not found — left untouched'); process.exit(0); }
html = html.replace(link, `<style>${css}</style>`);
fs.writeFileSync(htmlPath, html);
console.log(`inlined ${(css.length / 1024).toFixed(1)}KB of CSS into index.html`);
