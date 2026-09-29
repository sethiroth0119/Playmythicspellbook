/* procedural-ruins r2 — THE ROOM LINE ABLATION, and its revert.
   =========================================================================
   WHY IT EXISTS. bakeLand's room line is a gradient into the LAND bake, and
   paintTerrain()'s apron fills the whole ground quad opaquely OVER that bake.
   So "how far down the frame can this gradient still be seen" is NOT a
   question the source answers — the honest answer is a picture. This forces
   the four stops to opaque black over the same span, so a diff against the
   unmodified frame shows, per row, exactly where the land bake still reaches.

   HOW TO USE IT (it edits the product file in place — revert before you stop):
     node .gauntlet/tabletop/_pr-ablate-roomline.mjs on
     node .gauntlet/tabletop/shot.mjs .gauntlet/tabletop/_pr-probe-max.png --scene mixed
     node .gauntlet/tabletop/_pr-ablate-roomline.mjs off
     node .gauntlet/tabletop/_pr-reach2.mjs <unmodified.png> _pr-probe-max.png 130 330

   ⚠ IT IS AN ABLATION, NOT A TUNING KNOB. `off` restores the shipped stops
   verbatim; if the shipped stops have since changed, `off` refuses rather than
   writing a stale line back over someone else's edit.
   ⚠ THE NEGATIVE CONTROL IS IN _pr-reach2.mjs, not here: run it with the SAME
   png twice and every row must read `moved 0/1600  meanDL 0.00`. Verified
   2026-09-15 — it does, and the probe pair reads 1600/1600 at the same rows.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const F = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/src/battle/stage/vista.js');

/* the shipped stops, verbatim. Kept as one string so a drift is a loud refusal
   rather than a silent revert to last week's numbers. */
const SHIPPED = `    rl.addColorStop(0, api.rgba(roomCol, 0));
    rl.addColorStop(0.442, api.rgba(roomCol, 0.94));
    rl.addColorStop(0.596, api.rgba(roomCol, 0.94));
    rl.addColorStop(0.827, api.rgba(roomCol, 0.52));
    rl.addColorStop(1, api.rgba(roomCol, 0));`;

const ABLATED = `    rl.addColorStop(0, api.rgba('#000000', 1)); /* _pr-ablate-roomline ON */
    rl.addColorStop(0.442, api.rgba('#000000', 1));
    rl.addColorStop(0.596, api.rgba('#000000', 1));
    rl.addColorStop(0.827, api.rgba('#000000', 1));
    rl.addColorStop(1, api.rgba('#000000', 1));`;

const mode = (process.argv[2] || '').toLowerCase();
let s = fs.readFileSync(F, 'utf8');

if (mode === 'on') {
  if (s.includes(ABLATED)) { console.log('already ON'); process.exit(0); }
  if (!s.includes(SHIPPED)) { console.error('REFUSED: the shipped stops are not where this script expects them. Do not force it — re-read bakeLand.'); process.exit(1); }
  fs.writeFileSync(F, s.replace(SHIPPED, ABLATED), 'utf8');
  console.log('ablation ON  — vista.js is MODIFIED. Run `off` when you are done.');
} else if (mode === 'off') {
  if (s.includes(SHIPPED) && !s.includes(ABLATED)) { console.log('already OFF'); process.exit(0); }
  if (!s.includes(ABLATED)) { console.error('REFUSED: the ablation marker is not present, so there is nothing of MINE to revert.'); process.exit(1); }
  fs.writeFileSync(F, s.replace(ABLATED, SHIPPED), 'utf8');
  console.log('ablation OFF — shipped stops restored.');
} else {
  console.error('usage: node _pr-ablate-roomline.mjs on|off');
  process.exit(1);
}
