/* ══════════════════════════════════════════════════════════════════════════
   NEGATIVE CONTROL for assertCrowd() in shot.mjs.

   WHY IT EXISTS. shot.mjs's `crowd` scene carries a gate that claims the scene
   still contains a crowd: a tight cluster, a front-to-back stack, both sides,
   and a body sitting on a hole INSIDE the move region. A gate nobody has seen
   fail is not evidence (TABLETOP-BAR §11) — and a fixture that has quietly
   stopped containing a crowd is the WORST possible state, because it renders,
   exits 0, and answers a question one degree away from §12's.

   So this mutates a THROWAWAY COPY of the real shot.mjs, one requirement at a
   time, and proves the gate goes red for each. It touches nothing in the repo
   beyond a temp file it deletes, and it never boots Chromium: --check prints
   the facts and exits before the render.

   ⚠ A mutation that accidentally satisfies the clause it was meant to break is
   the trap here, and it has already been hit once: moving u-b from (7,8) to
   (6,8) to kill the stack CREATED a new one with u-e at (6,6) — same column,
   same parity, dz 2 — and the gate stayed green while looking like it had been
   tested. The final line of defence is the `txt === base` check (a mutation
   that does not apply is reported, never silently skipped) plus the unmutated
   control run at the end. Read the reasons printed beside each RED.

   Usage: node .gauntlet/tabletop/_crowd-negcontrol.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC  = fileURLToPath(new URL('./shot.mjs', import.meta.url));
const TMP  = fileURLToPath(new URL('./_crowd-mutant.mjs', import.meta.url));
const base = fs.readFileSync(SRC, 'utf8');

/* Each mutation breaks exactly ONE of the brief's four requirements, and the
   comment says which clause it is aimed at. */
const MUTANTS = [
  /* → biggestBlob (tight cluster) and, as a side effect, enclosedHoles */
  ['scrum pulled apart (no tight cluster, no interior holes)', t => t
    .replace("{ id:'u-a',   key:'mage',    x:7,  z:7,", "{ id:'u-a',   key:'mage',    x:1,  z:1,")
    .replace("{ id:'u-b',   key:'wyrm',    x:7,  z:8,", "{ id:'u-b',   key:'wyrm',    x:12, z:10,")
    .replace("{ id:'u-c',   key:'imp',     x:7,  z:5,", "{ id:'u-c',   key:'imp',     x:1,  z:10,")
    .replace("{ id:'u-d',   key:'crystal', x:8,  z:6,", "{ id:'u-d',   key:'crystal', x:12, z:1,")
    .replace("{ id:'u-e',   key:'bunny',   x:6,  z:6,", "{ id:'u-e',   key:'bunny',   x:0,  z:5,")],

  /* → alignedStacks. u-b goes to column 5, NOT column 6: u-e stands at (6,6)
     and (6,8)/(6,6) would be a fresh same-parity pair — the trap above. u-c
     moves off column 7 too, or (7,5)/(7,7) survives as a stack. */
  ['u-b and u-c moved off column 7 (nothing stacked front-to-back)', t => t
    .replace("{ id:'u-b',   key:'wyrm',    x:7,  z:8,", "{ id:'u-b',   key:'wyrm',    x:5,  z:8,")
    .replace("{ id:'u-c',   key:'imp',     x:7,  z:5,", "{ id:'u-c',   key:'imp',     x:8,  z:5,")],

  /* → sides */
  ['every unit flipped to mine (ownership not under test)', t =>
    t.replace(/side:'foe'/g, "side:'mine'")],

  /* → moveTiles, and enclosedHoles with it: an empty region encloses nothing */
  ['speed 0 (region too small to read)', t =>
    t.replace('const CROWD_SPEED = 4;', 'const CROWD_SPEED = 0;')],
];

const run = f => spawnSync(process.execPath, [f, 'neg.png', '--scene', 'crowd', '--check'], { encoding: 'utf8' });

let allRed = true;
for (const [name, mutate] of MUTANTS){
  const txt = mutate(base);
  /* a mutation that no longer matches the file is NOT a pass — it is this
     script silently testing nothing, which is the exact failure it exists to
     catch in shot.mjs */
  if (txt === base){ console.log('MUTATION DID NOT APPLY (anchor rotted): ' + name); allRed = false; continue; }
  fs.writeFileSync(TMP, txt);
  const r = run(TMP);
  const red = r.status !== 0 && /no longer exercises TABLETOP-BAR/.test(r.stderr || '');
  if (!red) allRed = false;
  const why = ((r.stderr || '').match(/^ {2}- .+/gm) || ['(GATE STAYED GREEN — exit ' + r.status + ')']).join(' | ');
  console.log((red ? 'RED  ' : 'GREEN') + '  ' + name + '\n        ' + why);
}

/* The control-of-the-control. Without this, "it went red" would only prove the
   COPY is broken — every mutant would go red even if assertCrowd did nothing,
   because a syntax error reds too. */
fs.writeFileSync(TMP, base);
const ok = run(TMP);
console.log((ok.status === 0 ? 'GREEN' : 'RED  ') + '  unmutated copy (must be GREEN)');
fs.unlinkSync(TMP);

const pass = allRed && ok.status === 0;
console.log(pass ? '\nNEGATIVE CONTROL PASSED' : '\nNEGATIVE CONTROL FAILED');
process.exit(pass ? 0 : 1);
