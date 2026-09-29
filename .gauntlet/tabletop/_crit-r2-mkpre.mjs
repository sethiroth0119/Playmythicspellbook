/* Build a THROWAWAY copy of the board page with TIME_PRESETS.day.az back at the
   value this round replaced (0.28), so the az swing's SIDE EFFECTS — the sun
   body's screen position, §7's "staged, not natural" — can be A/B'd without
   reverting a file other sessions are reading. Deleted by the caller.
   The substitution is asserted: exactly one hit, or it exits non-zero rather
   than silently rendering the shipped page and calling it the control. */
import { readFileSync, writeFileSync } from 'node:fs';
const SRC = 'public/battle-board/index.html';
const OUT = process.argv[2];
const AZ  = process.argv[3] || '0.28';
const s = readFileSync(SRC, 'utf8');
const NEEDLE = "  day:{ az: 0.95, elev: 0.78,";
const n = s.split(NEEDLE).length - 1;
if (n !== 1) { console.error('EXPECTED EXACTLY 1 HIT, GOT ' + n + ' — refusing'); process.exit(2); }
writeFileSync(OUT, s.replace(NEEDLE, "  day:{ az: " + AZ + ", elev: 0.78,"), 'utf8');
console.log('wrote', OUT, 'with day.az =', AZ);
