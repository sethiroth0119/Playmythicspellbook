/* 🔎 THE BASELINE THIS PIECE IS MEASURED AGAINST — and why it is not `git HEAD`.
   ─────────────────────────────────────────────────────────────────────────
   git HEAD (bf8eb2d514) carries 110 effects in 9 groups with 2 ungrouped ids.
   The tree this piece was written on carries 118 in 10 with 6 ungrouped: other
   agents have landed uncommitted work in public/index.html during this run, and
   a worktree checked out at HEAD is therefore measuring a DIFFERENT registry.
   Anyone A/Bing this piece against HEAD will see eight effects and a whole group
   ("⛽🔵 Fuel & Counters") appear out of nowhere and blame it on this change.

   So the baseline is reconstructed instead: the current file with this piece's
   own substitutions run BACKWARDS. Every one of them was a pure string swap, so
   the inverse is exact — and it is PROVEN exact rather than asserted, by running
   the forward swaps back over the reconstruction and byte-comparing the result
   to the live file. If that comparison holds, the file this writes is the tree
   as it stood immediately before this piece touched it.

   Writes: .gauntlet/_fxfind-baseline.html   (gitignored scratch, ~15 MB)
   Run:    node .gauntlet/_fxfind-baseline.mjs */
import fs from 'node:fs';
import crypto from 'node:crypto';

const LIVE = 'public/index.html';
const OUT = '.gauntlet/_fxfind-baseline.html';

/* [before, after] for every substitution this piece made, in order. */
export const SWAPS = [
  ["'drainLife','fight'] },",
   "'drainLife','fight','mirrorWard','purityPact'] },"],
  ["'rewind','readyAllies'] },",
   "'rewind','readyAllies','buffPerCard','stillnessSeal'] },"],
  ["'transformAlly','cloneUnit'] },",
   "'transformAlly','cloneUnit','soulSwap'] },"],
  ["'tributeDraw','sendMatching'] },",
   "'tributeDraw','sendMatching','tributeRite'] },"],
];

const live = fs.readFileSync(LIVE, 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

/* Reverse only needs the id-list swaps: everything else this piece added is
   NEW text (comments, _fxLabelDesc, _fxChunkOptgroups, the filter runtime, the
   CSS) and none of it is read by the registry lifter or by _counterScopeOk,
   which is all the baseline is used for. The registry is what has to be exact. */
let base = live;
let bad = [];
SWAPS.forEach(([before, after], i) => {
  const n = base.split(after).length - 1;
  if (n !== 1) bad.push('swap ' + i + ': "' + after.slice(0, 40) + '…" appears ' + n + ' times, wanted 1');
  base = base.split(after).join(before);
});
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }

/* the proof: forward again, and it must be the live file to the byte */
let round = base;
SWAPS.forEach(([before, after]) => { round = round.split(before).join(after); });
const exact = round.length === live.length && round === live;
console.log('live     ' + live.length + ' bytes  sha ' + sha(live));
console.log('baseline ' + base.length + ' bytes  sha ' + sha(base));
console.log('re-forwarded ' + round.length + ' bytes  sha ' + sha(round));
console.log(exact ? 'PASS  the reconstruction round-trips to the live file byte for byte'
                  : 'FAIL  the reconstruction does NOT round-trip — do not trust it');
if (!exact) process.exit(1);
fs.writeFileSync(OUT, base);
console.log('wrote ' + OUT);
