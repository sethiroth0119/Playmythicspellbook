/* 🔎 FIND-THE-EFFECT, part 4 — the placeholder has to fit the box it is in.
   Measured on the real editor at 1500 px: the on-play picker is 358 px wide and
   the spell/trap one 276 px, so the first placeholder ("… — try "discard",
   "grave", "summon"") was photographed cut off mid-word. */
import fs from 'node:fs';
const F = 'public/index.html';
let S = fs.readFileSync(F, 'utf8');
const n0 = S.length;
const find = "    input.placeholder = '\u{1F50E} filter ' + total + ' effects — try \"discard\", \"grave\", \"summon\"';";
const repl = [
  "    // ⚠ SHORT ON PURPOSE. The picker measures 276-358 px in the real editor",
  "    // (measured, 1500 px viewport), so a placeholder carrying its own examples",
  "    // was cut off mid-word. The examples moved to the tooltip.",
  "    input.placeholder = '\u{1F50E} filter ' + total + ' effects…';",
  "    input.title = 'Type to narrow the list — try \"discard\", \"grave\", \"summon\". Esc or ✕ clears it.';",
].join('\n');
const got = S.split(find).length - 1;
if (got !== 1) throw new Error('anchor matched ' + got + ', wanted 1');
S = S.split(find).join(repl);
fs.writeFileSync(F, S);
console.log('ok  bytes ' + n0 + ' -> ' + S.length);
