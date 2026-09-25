/* ══ procedural-ruins — REACHABILITY, not presence ═══════════════════════════
   The failure this pass keeps re-learning is a check that exits 0 while
   answering a question one degree from the one that mattered: "does the symbol
   appear" instead of "can anything see it". So every assertion below is phrased
   as CAN ANYTHING DRAW A SKYLINE BEHIND THE BOARD, and every one of them is
   shipped with a mutant that must turn it red. Run:

       node .gauntlet/tabletop/_pr-reach.mjs

   It prints the real checks, then the negative controls. A negative control
   that does NOT go red is itself a failure and exits non-zero — that is the
   whole point of it being here rather than in a handoff paragraph. */
import { readFileSync } from 'fs';

const V = readFileSync('./public/src/battle/stage/vista.js', 'utf8').replace(/\r\n/g, '\n');
const BB = readFileSync('./public/battle-board/index.html', 'utf8').replace(/\r\n/g, '\n');

/* brace-match a block starting at the '{' at or after `from` */
function block(src, from) {
  const i = src.indexOf('{', from);
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return { a: i, b: k + 1 }; }
  }
  return null;
}

/* Call sites only. Prose in the comments writes the generator as `ridgeLayer()`
   with empty parens; a real call always passes arguments, and the definition is
   preceded by `function `. Both are excluded on purpose — an earlier draft of
   this check counted 9 "calls", 6 of which were sentences. */
function ridgeCallSites(src) {
  const out = [];
  const re = /ridgeLayer\(\s*[^)\s]/g;
  let m;
  while ((m = re.exec(src))) {
    if (src.slice(Math.max(0, m.index - 9), m.index) === 'function ') continue;
    out.push(m.index);
  }
  return out;
}

/* ── the three questions ─────────────────────────────────────────────────── */
function checks(V, BB) {
  const r = [];

  /* 1. Nothing can paint a procedural mesa range behind the board. */
  const bl = V.indexOf('function bakeLand(');
  const blk = bl < 0 ? null : block(V, bl);
  const gate = blk ? V.indexOf('if (RIDGES_ON) {', blk.a) : -1;
  const gblk = gate > 0 && gate < blk.b ? block(V, gate) : null;
  const sites = ridgeCallSites(V);
  const inGate = gblk ? sites.filter(i => i > gblk.a && i < gblk.b) : [];
  r.push(['vista: RIDGES_ON is declared false',
    /const RIDGES_ON = false;/.test(V)]);
  r.push(['vista: bakeLand gates the ranges behind it',
    !!gblk]);
  r.push(['vista: EVERY ridgeLayer call site is inside that gate (' +
    inGate.length + '/' + sites.length + ')',
    sites.length > 0 && inGate.length === sites.length]);

  /* 2. The board page's fallback sky no longer builds a city. The 26 building
        silhouettes lived in the `no backdrop art` branch of drawSky; what is
        left there must be the fog gradient and nothing that loops. */
  const ds = BB.indexOf('function drawSky(');
  const dsb = ds < 0 ? null : block(BB, ds);
  const body = dsb ? BB.slice(dsb.a, dsb.b) : '';
  const fb = body.indexOf('if (!(BACKDROP.img && BACKDROP.img.complete))');
  const fbk = fb >= 0 ? block(body, fb + 40) : null;
  const fallback = fbk ? body.slice(fbk.a, fbk.b) : '';
  r.push(['board page: the fallback sky branch exists (the horizon hand-off is kept)',
    !!fbk]);
  r.push(['board page: it draws no repeated structures — no loop in the branch',
    !!fbk && !/\bfor\s*\(|\bwhile\s*\(|\.forEach\(/.test(fallback)]);
  r.push(['board page: and no rect/quad painter in it either',
    !!fbk && !/fillRect\([^)]*\)[\s\S]*fillRect\(/.test(fallback)]);

  /* 3. …and that fallback is not what a real match renders anyway: the vista
        module owns the pass, with drawSky only as the catch arm. */
  r.push(['board page: vista.draw owns the pass; drawSky is the catch arm only',
    /try \{ window\.BBX\.vista\.draw\(api\); \} catch \(e\) \{ drawSky\(\); drawShards\(\); \}/.test(BB)]);

  return r;
}

let bad = 0;
console.log('── checks ──');
for (const [name, ok] of checks(V, BB)) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
  if (!ok) bad++;
}

/* ── negative controls: each mutant must make the named check go red ─────── */
const mutants = [
  ['RIDGES_ON flipped true',
    v => v.replace('const RIDGES_ON = false;', 'const RIDGES_ON = true;'), null,
    'vista: RIDGES_ON is declared false'],
  ['a stray ridge call outside the gate',
    v => v.replace('    /* ── 🎲 THE TABLE, AND THE BOARD',
      '    ridgeLayer(api, g, { rand: rand, key: \'sneak\' });\n    /* ── 🎲 THE TABLE, AND THE BOARD'), null,
    'vista: EVERY ridgeLayer call site is inside that gate'],
  ['the gate removed entirely',
    v => v.replace('    if (RIDGES_ON) {', '    if (true) {'), null,
    'vista: bakeLand gates the ranges behind it'],
  ['a building loop put back in the fallback sky', null,
    b => b.replace('    const horizon = project(gp(0,-14));',
      '    for (let i=0;i<26;i++) ctx.fillRect(i*40,100,30,60);\n    const horizon = project(gp(0,-14));'),
    'board page: it draws no repeated structures'],
  ['the vista hook taken off the pass', null,
    b => b.replace('try { window.BBX.vista.draw(api); } catch (e) { drawSky(); drawShards(); }',
      'drawSky(); drawShards();'),
    'board page: vista.draw owns the pass']
];

console.log('\n── negative controls (each must go red) ──');
for (const [name, mv, mb, expect] of mutants) {
  const v2 = mv ? mv(V) : V, b2 = mb ? mb(BB) : BB;
  if ((mv && v2 === V) || (mb && b2 === BB)) {
    console.log('FAIL ' + name + ' — the mutation did not apply, so it proves nothing');
    bad++; continue;
  }
  const res = checks(v2, b2);
  const hit = res.find(([n]) => n.startsWith(expect));
  const went = hit && !hit[1];
  console.log((went ? 'ok   ' : 'FAIL ') + name + ' → "' + expect + '" ' +
    (went ? 'went red' : 'STAYED GREEN — this check is not doing its job'));
  if (!went) bad++;
}

console.log(bad ? '\n' + bad + ' failure(s)' : '\nall good');
process.exit(bad ? 1 : 0);
