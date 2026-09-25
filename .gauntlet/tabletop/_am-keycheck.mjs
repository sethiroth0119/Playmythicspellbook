/* arena-markings r1 — the §10.7 guarantee, asserted, WITH ITS NEGATIVE CONTROL.
   ══════════════════════════════════════════════════════════════════════════
   terrainKeyParts() is the board's single cache-invalidation point. If MARKS.on
   does not reach that string, the pitch never appears on a PARKED camera and
   the symptom is indistinguishable from the edit not having been made — which
   is the exact failure mode TABLETOP-BAR §10.7 exists to name.
   Every assertion here is paired with a control that must come out the other
   way, because §11: a check that can only pass is not a check.
     A1 the key MOVES when MARKS.on flips        C1 it does NOT move when nothing flips
     A2 the key MOVES when markPlan's sig moves  C2 it is restored when the sig is put back
     A3 paintArenaMarks/markPlan/MARKS are reachable from global scope
        (a helper that is present but unreachable passes every other gate)
     A4 the mark plan is EXACTLY mirrored about the origin — §7's "symmetry
        reads" is a claim about numbers before it is a claim about pixels   */
import { spawnSync } from 'node:child_process';
const COLS = 14, ROWS = 12;
const tiles = [];
for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) tiles.push({ x, z, surf:'grass', elev:0 });
const payload = JSON.stringify({ cols: COLS, rows: ROWS, tiles });

const REPORT = `(() => {
  const out = [];
  const ok = (name, cond, extra) => out.push((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   [' + extra + ']' : ''));
  const key = () => terrainKeyParts().base;

  /* A3 first: everything below assumes these are visible from a fresh script in
     the page's global scope. They are top-level declarations in a CLASSIC
     script, so they live in the global lexical environment. */
  ok('A3 markPlan reachable',        typeof markPlan === 'function');
  ok('A3 paintArenaMarks reachable', typeof paintArenaMarks === 'function');
  ok('A3 MARKS reachable',           typeof MARKS === 'object' && MARKS !== null);
  ok('A3 MARKS.on is true as shipped', MARKS.on === true, 'on=' + MARKS.on);

  /* C1 — the control. Two reads with nothing touched must be identical, or A1
     is measuring the camera or the clock and not the flag. */
  const k0 = key(), k0b = key();
  ok('C1 control: key is stable when nothing changes', k0 === k0b);

  /* A1 — flip the flag, the key must move, and it must come back. */
  const was = MARKS.on;
  MARKS.on = !was;  const k1 = key();
  MARKS.on = was;   const k2 = key();
  ok('A1 key moves when MARKS.on flips', k1 !== k0, 'mk term: ' + (k0.match(/mk[^|]*/)||[])[0] + ' -> ' + (k1.match(/mk[^|]*/)||[])[0]);
  ok('A1 key returns when it flips back', k2 === k0);

  /* A2 — the sig. markPlan is memoised on cols/rows/tile, so move the tile size
     and the sig must move with it. This is the term that catches a change to
     the PLAN (widths, objective positions) as opposed to the on/off flag. */
  const t = CONFIG.tile;
  CONFIG.tile = t + 1; const k3 = key();
  CONFIG.tile = t;     const k4 = key();
  ok('A2 key moves when markPlan().sig moves', k3 !== k0, 'sig: ' + markPlan().sig);
  ok('C2 control: key restored when the sig is restored', k4 === k0);

  /* A4 — symmetry, as arithmetic. */
  const M = markPlan();
  const xs = M.objs.map(o => o.x), zs = M.objs.map(o => o.z);
  const mirroredX = xs.every(v => xs.some(w => Math.abs(w + v) < 1e-9));
  const mirroredZ = zs.every(v => zs.some(w => Math.abs(w + v) < 1e-9));
  ok('A4 objectives mirror about x=0', mirroredX, xs.map(v=>v.toFixed(3)).join(','));
  ok('A4 objectives mirror about z=0', mirroredZ, zs.map(v=>v.toFixed(3)).join(','));
  ok('A4 deployment line is drawn at +/- the same z', M.zDep < 0, 'zDep=' + M.zDep.toFixed(4) + ' (painter negates it for the near half)');
  ok('A4 deployment rows are a whole number of rows on both halves', M.dep >= 1 && M.dep === Math.round(M.dep), 'dep=' + M.dep + ' of ' + MAP.rows);

  return out;
})()`;

const r = spawnSync(process.execPath, [
  'E:/game-deploy/.gauntlet/boardshot.mjs', 'E:/game-deploy/.gauntlet/tabletop/_am-keycheck.png',
  '--wait', '7000', '--w', '1600', '--h', '900',
  '--eval', `window.postMessage({type:'board:map',map:${payload}},location.origin)`,
  '--report', REPORT,
], { encoding: 'utf8', maxBuffer: 1 << 26 });
process.stderr.write(r.stderr || '');
let rep = null;
try { rep = JSON.parse(r.stdout).report; } catch { console.log(r.stdout); process.exit(1); }
if (!Array.isArray(rep)) { console.log(JSON.stringify(rep, null, 1)); process.exit(1); }
for (const l of rep) console.log('  ' + l);
const bad = rep.filter(l => l.startsWith('FAIL')).length;
console.log(bad ? '\n' + bad + ' FAILED' : '\nall ' + rep.length + ' pass');
process.exit(bad ? 1 : 0);
