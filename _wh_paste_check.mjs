// Guards WAREHOUSE_PASTE_index-module.js against silently drifting away from the
// module that actually lives in public/index.html.
//
// This exists because it already happened: the paste file was generated once and
// then the module grew retrieval, bay expansion and the "My storage" view. The
// paste file kept its old contents and stayed plausible — 180 lines behind, with
// no outward sign. Anyone following the handoff would have pasted back the
// version where resources sent to a warehouse could never be withdrawn.
//
// Run: node _wh_paste_check.mjs      (exit 0 = match, 1 = drift)

import { readFileSync } from 'node:fs';

const START = '// 🚚 STORAGE WAREHOUSE — player-owned';
const END   = '} catch (e) {}';
const PASTE = 'WAREHOUSE_PASTE_index-module.js';

/* ⚠ NORMALISE CRLF FIRST. index.html is \r\n in a Windows checkout, so every
   line from split('\n') keeps a trailing \r — and the END test below is an
   EXACT string comparison, so it could never match. The check reported "found
   the module start but not its closing" against a module that was perfectly
   intact, which reads as corruption and is really line endings. The START test
   survived only because it uses startsWith(). */
const lines = readFileSync('public/index.html', 'utf8').replace(/\r\n/g, '\n').split('\n');

// The module opens with a box-rule comment line, one line above the title.
const titleAt = lines.findIndex((l) => l.startsWith(START));
if (titleAt < 0) {
  console.error(`✖ Could not find the module in public/index.html (looked for "${START}").`);
  process.exit(1);
}
const endAt = lines.findIndex((l, i) => i > titleAt && l === END);
if (endAt < 0) {
  console.error('✖ Found the module start but not its closing "} catch (e) {}".');
  process.exit(1);
}

const live = lines.slice(titleAt - 1, endAt + 1).join('\n').trimEnd();

// The paste file carries an explanatory header; the module itself starts at the
// same box-rule line, so drop everything above the LAST rule before the title.
const pasteRaw = readFileSync(PASTE, 'utf8').replace(/\r\n/g, '\n');
const pTitle = pasteRaw.split('\n').findIndex((l) => l.startsWith(START));
if (pTitle < 0) {
  console.error(`✖ ${PASTE} does not contain the module at all.`);
  process.exit(1);
}
const paste = pasteRaw.split('\n').slice(pTitle - 1).join('\n').trimEnd();

if (paste === live) {
  console.log(`✔ WAREHOUSE PASTE FILE MATCHES — ${live.split('\n').length} lines, byte-identical.`);
  process.exit(0);
}

const a = live.split('\n');
const b = paste.split('\n');
const firstDiff = a.findIndex((l, i) => l !== b[i]);
console.error('✖ WAREHOUSE PASTE FILE HAS DRIFTED from public/index.html.');
console.error(`  live module: ${a.length} lines · paste file: ${b.length} lines`);
if (firstDiff >= 0) {
  console.error(`  first difference at module line ${firstDiff + 1}:`);
  console.error(`    live:  ${JSON.stringify((a[firstDiff] || '').slice(0, 100))}`);
  console.error(`    paste: ${JSON.stringify((b[firstDiff] || '').slice(0, 100))}`);
}
console.error('  Regenerate it, keeping the header, then re-run this check.');
process.exit(1);
