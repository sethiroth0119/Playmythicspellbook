/* ══════════════════════════════════════════════════════════════════════════
   🧩 JSXCHECK — the gate the .jsx files never had

   _synckcheck.mjs reads index.html and modcheck.mjs reads public/src. Neither
   looks at public/corp/*.jsx, which is a real React app compiled by Babel in
   the BROWSER — so a syntax error there ships silently and shows up as a blank
   panel at runtime, indistinguishable from the feature being switched off.

   ⚠ IT USES THE BROWSER'S OWN COMPILER. corp/index.html loads
     @babel/standalone, and that exact package is in node_modules, so this gate
     accepts precisely what the page will accept — no second parser to disagree
     with the real one.

   ⚠ A BRACKET-BALANCE FALLBACK WAS TRIED AND THROWN OUT. It reported two
     untouched files as broken (JSX text and regex literals defeat it), which
     is worse than no gate: a check that cries wolf gets ignored the day it is
     right.

   Run:  node .gauntlet/jsxcheck.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const DIRS = ['public/corp'];
const files = [];
for (const d of DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).sort()) if (f.endsWith('.jsx')) files.push(path.join(d, f));
}
if (!files.length) { console.log('no .jsx files found'); process.exit(0); }

let Babel = null;
try { Babel = (await import('@babel/standalone')).default; } catch (e) {}
if (!Babel) {
  console.log('\n❌ @babel/standalone is not installed — this gate cannot run.');
  console.log('   The page loads it from unpkg; run `npm i -D @babel/standalone` to check offline.');
  process.exit(2);
}

let fails = 0;
console.log('\n\u{1F9E9} JSX CHECK  (@babel/standalone — the browser\'s own compiler)\n');
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    Babel.transform(src, { presets: ['react'], filename: f });
    console.log('  OK   ' + f.padEnd(30) + src.length.toLocaleString().padStart(9) + ' chars');
  } catch (e) {
    fails++;
    console.log('  FAIL ' + f + '\n       ' + String(e.message).split('\n')[0]);
  }
}
console.log('');
if (fails) { console.log('❌ ' + fails + ' FILE(S) FAILED — the panel would render blank'); process.exit(1); }
console.log('✅ ALL JSX COMPILES');
