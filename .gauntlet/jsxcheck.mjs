/* JSX parse gate. _synckcheck only reads inline <script> in .html and modcheck
   only walks public/src — neither one has ever looked at a .jsx file, so an
   edit to ethos/app.jsx ships with NO syntax gate at all. esbuild is already a
   dependency; transform() with the jsx loader is a full parse. */
import { transform } from 'esbuild';
import { readFileSync } from 'fs';

const files = process.argv.slice(2);
let fails = 0;
for (const f of files) {
  try {
    const src = readFileSync(f, 'utf8');
    await transform(src, { loader: 'jsx', sourcefile: f });
    console.log('ok    ' + f + '  (' + src.length + ' chars)');
  } catch (e) {
    fails++;
    console.log('FAIL  ' + f);
    for (const err of (e.errors || [{ text: String(e) }])) {
      const l = err.location;
      console.log('      ' + (l ? l.file + ':' + l.line + ':' + l.column + '  ' : '') + err.text);
      if (l && l.lineText) console.log('      | ' + l.lineText);
    }
  }
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nall parse');
process.exit(fails ? 1 : 0);
