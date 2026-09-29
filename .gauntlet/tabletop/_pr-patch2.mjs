/* procedural-ruins round 1, follow-up: note the three locals that only the
   dormant branch reads, so nobody deletes them and quietly breaks the flip-back.
   Run: node .gauntlet/tabletop/_pr-patch2.mjs */
import fs from 'fs';
const P = 'public/src/battle/stage/vista.js';
let s = fs.readFileSync(P, 'utf8');
if (s.includes('ONLY THE DORMANT SKYLINE READS')) { console.error('FAIL: already patched'); process.exit(1); }

const A = "    const lightX = Math.sign(b.x - api.VIEW.cx) || 1;\n" +
  "    const rand = mulberry32(strHash((api.MAP.id || 'map') + '|ridge'));\n";
if (s.indexOf(A) < 0 || s.indexOf(A) !== s.lastIndexOf(A)) { console.error('FAIL: anchor'); process.exit(1); }

const NOTE = "    /* ⚠ lightX AND rand ARE READ BY ONLY THE DORMANT SKYLINE (RIDGES_ON,\n" +
  "       above). They are deliberately left live rather than moved inside the\n" +
  "       branch: `rand` is a SEEDED stream and the far range's else-arm burns 24\n" +
  "       draws off it on purpose so the mid and near ranges land identically\n" +
  "       whether or not a location card is in play. Move the seeding inside the\n" +
  "       branch and that invariant still holds; delete either line and flipping\n" +
  "       the switch back is a ReferenceError inside a try-less bake, which is the\n" +
  "       failure mode this file is worst at reporting. `band` below is NOT in this\n" +
  "       category — the haze band still uses it. */\n";

s = s.replace(A, NOTE + A);
fs.writeFileSync(P, s);
console.log('patched', P);
