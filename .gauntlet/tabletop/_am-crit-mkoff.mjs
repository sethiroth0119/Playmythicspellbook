/* arena-markings CRITIC round 1 — build a MARKS-OFF twin of the frozen fixture
   WITHOUT touching shot.mjs.

   shot.mjs is the frozen fixture (§8.1 treatment: "if the fixture changes, the
   whole A/B history is invalidated"), so it must not grow a --marks flag for my
   convenience. Instead this writes a throwaway COPY of it with exactly one
   statement appended to its --eval string: `window.__bbMarks.on=false`, the
   negative-control hook the board page itself advertises. Same tiles, same
   ladder, same camera, same wait — the only difference in the two runs is the
   flag, which is the whole point of an A/B.

   🔴 NEGATIVE CONTROL ON THE COPY ITSELF. If the substitution silently failed
   to match, the copy would be byte-identical to shot.mjs and would render the
   marks ON while being labelled OFF — a same-state pair reported as an A/B, and
   the exact "check that answers a question one degree away" failure this pass
   keeps re-learning. So the replace is asserted, and the copy is grepped for
   the injected text before it is allowed to run. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('./shot.mjs', import.meta.url));
const DST = fileURLToPath(new URL('./_am-crit-shot-off.mjs', import.meta.url));
const src = readFileSync(SRC, 'utf8');

const NEEDLE = "const evalJs  = `window.postMessage({type:'board:map',map:${payload}},location.origin)`;";
if (!src.includes(NEEDLE)) { console.error('FAIL: evalJs line not found — shot.mjs changed, fix this probe'); process.exit(1); }
const INJECT = "const evalJs  = `window.postMessage({type:'board:map',map:${payload}},location.origin);try{window.__bbMarks.on=false;}catch(e){}`;";
const out = src.replace(NEEDLE, INJECT);
if (out === src) { console.error('FAIL: replace was a no-op'); process.exit(1); }
if (!out.includes('__bbMarks.on=false')) { console.error('FAIL: injection missing from copy'); process.exit(1); }
writeFileSync(DST, out);
console.log('PASS wrote', DST, '— injected __bbMarks.on=false, verified present');
