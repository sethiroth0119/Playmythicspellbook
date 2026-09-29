/* arena-markings — the A/B, and the §11 negative control in one run.
   Renders the SAME fixture scene twice, once with MARKS.on true and once with
   it false, by flipping the literal in the source between the two renders and
   putting it back. That is deliberately not a runtime toggle poked through the
   harness: flipping the source proves the `mk` term in terrainKeyParts() is
   carrying the markings into the bake cache, because the two renders differ on
   a PARKED camera and that is the only way they can (§10.7).
   Writes an amplified difference image so the contribution can be looked at
   rather than guessed: anything the markings did is white, everything else is
   black. A control of exactly 0 changed pixels inside the board would mean the
   pass never ran. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const SRC = 'E:/game-deploy/public/battle-board/index.html';
const dir = 'E:/game-deploy/.gauntlet/tabletop/';
const scene = process.argv[2] || 'mixed';
const ON = dir + '_marks-ab-on-' + scene + '.png';
const OFF = dir + '_marks-ab-off-' + scene + '.png';

function shot(out){
  const r = spawnSync(process.execPath, [dir + 'shot.mjs', out, '--scene', scene],
                      { encoding:'utf8', maxBuffer: 1 << 26 });
  const j = (() => { try { return JSON.parse(r.stdout); } catch { return null; } })();
  const d = j && j.boardshot && j.boardshot.diag;
  console.log(out.split('/').pop() + '  canvas=' + (d && d.canvas) + ' size=' + (d && d.size) + ' build=' + (d && d.build));
  if (!d || !d.size) { console.error(r.stdout, r.stderr); process.exit(1); }
}

function flip(to){
  let s = fs.readFileSync(SRC, 'utf8');
  const a = 'const MARKS = {\n  on: ' + (to ? 'false' : 'true') + ',';
  const b = 'const MARKS = {\n  on: ' + (to ? 'true' : 'false') + ',';
  if (s.split(a).length !== 2) { console.error('MARKS.on literal not found for flip'); process.exit(1); }
  fs.writeFileSync(SRC, s.replace(a, b), 'utf8');
}

shot(ON);
flip(false);
try { shot(OFF); } finally { flip(true); }

async function raw(f){ const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject:true }); return { data, info }; }
const a = await raw(ON), b = await raw(OFF);
const { width:W, height:H, channels:C } = a.info;
const out = Buffer.alloc(W*H*3);
/* the board's own rect in the 1600x900 shot, so rain and sky noise are excluded
   from the count (they animate and would otherwise dominate it) */
const BX0=380, BX1=1320, BY0=200, BY1=600;
let moved = 0, inBoard = 0;
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const i=(y*W+x)*C, o=(y*W+x)*3;
  const d = Math.abs(a.data[i]-b.data[i]) + Math.abs(a.data[i+1]-b.data[i+1]) + Math.abs(a.data[i+2]-b.data[i+2]);
  const v = Math.min(255, d*6);
  out[o]=out[o+1]=out[o+2]=v;
  if (d>8){ moved++; if (x>=BX0&&x<BX1&&y>=BY0&&y<BY1) inBoard++; }
}
await sharp(out, { raw:{ width:W, height:H, channels:3 } }).toFile(dir + '_marks-ab-diff-' + scene + '.png');
console.log('changed px total ' + moved + ', inside the board rect ' + inBoard +
            ' (' + (100*inBoard/((BX1-BX0)*(BY1-BY0))).toFixed(1) + '% of it)');

/* Per-mark contrast, so 'the far line is weaker' is a number and not an
   impression. Rects are read off the probe's screenY for a flat board; the
   mixed scene's elevation moves individual tiles a few px, which is why these
   are BANDS and not rows. */
const ZONES = {
  farZone:[520,205,1080,258], farLine:[520,248,1080,268],
  midLine:[440,344,1260,376],
  nearLine:[420,478,1240,504], nearZone:[420,495,1240,560]
};
for (const k in ZONES){
  const [x0,y0,x1,y1] = ZONES[k];
  let sum=0, n=0, hit=0;
  for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++){
    const i=(y*W+x)*C;
    const la=0.299*a.data[i]+0.587*a.data[i+1]+0.114*a.data[i+2];
    const lb=0.299*b.data[i]+0.587*b.data[i+1]+0.114*b.data[i+2];
    sum+=Math.abs(la-lb); n++; if (Math.abs(la-lb)>8) hit++;
  }
  console.log('  ' + k.padEnd(9) + ' mean |dL| ' + (sum/n).toFixed(2) + '   px over 8: ' + (100*hit/n).toFixed(1) + '%');
}
