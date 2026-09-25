// Babel-transform validation for the base-builder JSX — mirrors what
// @babel/standalone does in base/index.html. Catches JSX/syntax errors
// before they reach the browser (where they'd silently blank the iframe).
const fs = require('fs');
const Babel = require('@babel/standalone');

const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node _jsxcheck.js <file.jsx> ...'); process.exit(1); }

let fail = 0;
for (const f of files) {
  try {
    const code = fs.readFileSync(f, 'utf8');
    Babel.transform(code, { presets: ['react'], filename: f });
    console.log('OK   ' + f);
  } catch (e) {
    fail++;
    console.log('FAIL ' + f + ' — ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
}
process.exit(fail ? 2 : 0);
