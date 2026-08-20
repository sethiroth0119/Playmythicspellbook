/* ══════════════════════════════════════════════════════════════════════════
   ⛏ THE EXTRACTION ROUND — THE DRIVEN PROOF.
   ----------------------------------------------------------------------------
   Not a reading. Every claim below is produced by running the SHIPPED seams:
   ECO_BUILDING_MAP and ecoGroundRefusal are BRACE-MATCHED OUT OF
   public/node-city/index.html and evaluated (the technique round0f/0p already
   use — a copy tests a fiction the moment the two drift), and everything else
   is window.MythicEconomy's own public surface.

     §1  a node whose survey says a seam is PRESENT → the extractor placed →
         the resource ARRIVING in the city's inventory.
     §2  a node whose survey says NONE → the build REFUSED, with the game's own
         refusal sentence printed verbatim.
     §3  THE DEAD RECIPE. `freshWater` before and after, through the bottleneck
         tracer, on one city, one variable.
     §4  the closed-loop audit over the whole run.

   node .gauntlet/drive-seams.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));

global.window = global.window || {};
window.MythicCityBridge = { addCinders: async () => true, getCinders: async () => 9e9 };

const NC = readFileSync(join(here, '../public/node-city/index.html'), 'utf8');

/* Brace-match a declaration out of the shipped file. */
function blockAfter(src, decl, open) {
  const at = src.indexOf(decl); if (at < 0) return null;
  const o = src.indexOf(open || '{', at + decl.length - 1);
  const oc = open || '{', cc = oc === '[' ? ']' : '}';
  let d = 0, i = o, q = null;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === oc) d++;
    else if (c === cc) { d--; if (!d) return src.slice(o, i + 1); }
  }
  return null;
}
function fnText(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const body = blockAfter(src.slice(at), 'function ' + name + '(');
  const bo = src.indexOf('{', src.indexOf(')', at));
  return src.slice(at, bo) + body;
}
const ECO_BUILDING_MAP = new Function('return (' + blockAfter(NC, 'const ECO_BUILDING_MAP = {') + ');')();
const OP_ECO_MAP       = new Function('return (' + blockAfter(NC, 'const OP_ECO_MAP = {') + ');')();
const OPS_PREFIX       = /const\s+OPS_PREFIX\s*=\s*'([^']*)'/.exec(NC)[1];
for (const t of Object.keys(OP_ECO_MAP)) ECO_BUILDING_MAP[OPS_PREFIX + t] = OP_ECO_MAP[t];

/* The shipped gate and its label helper, lifted and RUN — never re-typed. The
   two identifiers it reads that this file does not own (BUILDINGS, opsTypeOf)
   are supplied from the shipped file too. */
const BUILDINGS = (() => {
  const txt = blockAfter(NC, 'const BUILDINGS = {');
  const scope = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : 0) });
  return new Function('__s', 'with (__s) { return (' + txt + '); }')(scope);
})();
const GATE = new Function('ECO_BUILDING_MAP', 'BUILDINGS', 'OPS_PREFIX',
  fnText(NC, '_ecoResLabel') + '\n' + fnText(NC, 'ecoGroundRefusal') + '\n' +
  "const opsTypeOf = (b) => (b && b.indexOf(OPS_PREFIX) === 0) ? b.slice(OPS_PREFIX.length) : null;\n" +
  'return ecoGroundRefusal;')(ECO_BUILDING_MAP, BUILDINGS, OPS_PREFIX);

const E = (await import('../public/src/economy/index.js')).default;

const NEW = ['waterintake', 'deepmine', 'alloyworks', 'canecroft', 'riftbore'];
const HOST = { powerFactor: 1, waterFactor: 1, hasBank: true, infrastructure: .8,
               logisticsCounts: { warehouse: 3, depot: 3 } };
const DAY = 24 * 60;
let bad = 0;
const chk = (name, cond, extra) => {
  console.log((cond ? '✅ ' : '❌ ') + name + (cond ? '' : (extra ? ' :: ' + extra : '')));
  if (!cond) bad++;
  return cond;
};
/* The shipped ecoBuildings() shape: one row per standing business tile, with
   the OUTPUT chosen by the ground through pickAvailable — the same two lines
   node-city runs. */
const listOf = (tiles) => Object.entries(tiles).map(([k, t]) => {
  const m = ECO_BUILDING_MAP[t.type]; if (!m) return null;
  const out = E.pickAvailable(m.out); if (!out) return null;
  return { key: k, out, ind: m.ind, lvl: t.lvl || 1, name: (BUILDINGS[t.type] || {}).name };
}).filter(Boolean);

/* ── §0 THE GAP, RE-MEASURED THROUGH THE SHIPPED MAP ───────────────────── */
{
  console.log('\n########## §0 the gap ##########');
  const DEP = E.recipes.DEPOSITS;
  const outs = new Set();
  for (const k in ECO_BUILDING_MAP) for (const o of ECO_BUILDING_MAP[k].out) outs.add(o);
  const dep = Object.keys(DEP);
  const gap = dep.filter(d => !outs.has(d));
  console.log('  DEPOSITS ' + dep.length + ' | EXTRACTABLE ' + (dep.length - gap.length) +
              ' | NO BUILDING ' + gap.length + ' → ' + (gap.join(' ') || '—'));
  chk('every deposit but `wood` now has an extractor (the 🪵 exclusion is deliberate)',
      gap.length === 1 && gap[0] === 'wood', gap.join(','));
  for (const t of NEW) chk('`' + t + '` is in ECO_BUILDING_MAP', !!ECO_BUILDING_MAP[t]);
}

/* ── §1 PRESENT → PLACED → ARRIVING ─────────────────────────────────────── */
console.log('\n########## §1 the survey says PRESENT, and the resource arrives ##########');
let nodeAll = null;
for (let i = 0; i < 400 && !nodeAll; i++) {
  const id = 'seam-' + i;
  E.mount({ nodeId: id, population: 140, established: false });
  if (NEW.every(t => E.pickAvailable(ECO_BUILDING_MAP[t].out))) nodeAll = id;
}
chk('found a node whose ground supports ALL FIVE new buildings', !!nodeAll, 'scanned 400 nodes');
const tiles = {};
let auditFails = 0, auditWorst = 0;
const tick = () => {
  E.tick(DAY, HOST);
  const s = E.snapshot();
  if (!s.audit || !s.audit.ok) auditFails++;
  if (s.audit && Math.abs(s.audit.err || 0) > Math.abs(auditWorst)) auditWorst = s.audit.err;
};
if (nodeAll) {
  E.mount({ nodeId: nodeAll, population: 140, established: false });
  const sv = E.survey();
  const picks = {};
  for (const t of NEW) picks[t] = E.pickAvailable(ECO_BUILDING_MAP[t].out);
  console.log('  node ' + nodeAll + ' — what each new building would work here, and its grade:');
  for (const t of NEW) console.log('    ' + t.padEnd(12) + picks[t].padEnd(20) + sv.grade(picks[t]));

  // place all five, through the shipped reconcile
  let x = 0;
  for (const t of NEW) tiles[(x++) + ',0'] = { type: t, lvl: 1, damaged: false };
  tiles['9,0'] = { type: 'purifier', lvl: 1, damaged: false };
  E.syncBuildings(listOf(tiles));
  const firms = E.firms();
  for (const t of NEW) {
    const p = picks[t];
    chk('a firm was founded for `' + p + '` when the ' + t + ' went up',
        firms.some(f => f.out === p), 'firms: ' + firms.map(f => f.out).join(','));
  }
  for (let d = 0; d < 90; d++) { tick(); E.syncBuildings(listOf(tiles)); }
  const inv = E.inventory();
  for (const t of NEW) {
    const p = picks[t];
    const f = E.firms().find(q => q.out === p);
    const made = f ? (f.lastProduced || 0) : 0;
    chk('`' + p + '` is ARRIVING in the city inventory (' + t + ')',
        made > 0 || (inv[p] || 0) > 0,
        'produced today ' + made.toFixed(3) + ' · inventory ' + (inv[p] || 0).toFixed(3));
  }
  console.log('  inventory after 90 days: ' + NEW.map(t => picks[t] + ' ' +
              (inv[picks[t]] || 0).toFixed(1)).join(' · '));
}

/* ── §2 NONE → REFUSED, IN THE GAME'S OWN WORDS ─────────────────────────── */
console.log('\n########## §2 the survey says NONE, and the build is refused ##########');
{
  let shown = 0;
  /* 💧 THE WATER INTAKE IS THE ONE BUILDING THIS GATE CAN NEVER REFUSE, and
     that is endowment.js's design rather than an accident: `rawWater` is on its
     GUARANTEED list, lifted to at least POOR on every node, with the reason
     written out at the site — "a node with no water is not specialised, it is
     unplayable, and the player did not choose the node". So it is asserted the
     other way round: 4,000 nodes, refused on none of them. */
  {
    let refused = 0, N = 4000;
    for (let i = 0; i < N; i++) {
      E.mount({ nodeId: 'gw-' + i, population: 60, established: false });
      if (GATE('waterintake')) refused++;
    }
    chk('`waterintake` is refused on 0 of ' + N + ' nodes — rawWater is GUARANTEED, by design',
        refused === 0, refused + ' refusals');
  }
  for (const t of NEW) {
    if (t === 'waterintake') continue;
    let node = null, scanned = 0;
    for (let i = 0; i < 20000 && !node; i++) {
      scanned = i + 1;
      const id = 'none-' + t + '-' + i;
      E.mount({ nodeId: id, population: 80, established: false });
      if (!E.pickAvailable(ECO_BUILDING_MAP[t].out)) node = id;
    }
    if (!node) { chk('found a node with NONE of ' + t + "'s seams", false, 'scanned ' + scanned); continue; }
    console.log('  (' + t + ': the first node in ' + scanned + ' whose ground carries none of its ' +
                ECO_BUILDING_MAP[t].out.length + ' seams)');
    E.mount({ nodeId: node, population: 80, established: false });
    const sv = E.survey();
    const grades = ECO_BUILDING_MAP[t].out.map(id => id + '=' + sv.grade(id)).join(' ');
    const why = GATE(t);
    chk('`' + t + '` is REFUSED on ' + node + ' (' + grades + ')', !!why, 'gate returned null');
    if (why && shown < 5) { console.log('    ↳ ' + why); shown++; }
    // …and the SAME gate says nothing about a factory, or about an op licence
    chk('  …and the same gate waves through `smelter` (a factory is not gated by the ground)',
        GATE('smelter') === null, String(GATE('smelter')));
    chk('  …and waves through `' + OPS_PREFIX + 'mining` (a licence already paid for is never refused)',
        GATE(OPS_PREFIX + 'mining') === null, String(GATE(OPS_PREFIX + 'mining')));
  }
}

/* ── §3 THE DEAD RECIPE — freshWater, before and after ──────────────────── */
console.log('\n########## §3 the dead recipe: freshWater from rawWater ##########');
{
  /* The state a REAP leaves behind, reached the way a player reaches it: an
     ESTABLISHED city (so bootstrap does not run and does not re-seed the hidden
     rawWater firm) with a Purifier standing on it. That is exactly what a save
     looks like the day after the bootstrap waterworks went bankrupt. */
  const node = 'dead-water-1';
  E.mount({ nodeId: node, population: 140, established: false });
  const boot = E.firms().filter(f => f.out === 'rawWater');
  chk('BEFORE THIS ROUND, the ONLY rawWater producer was a bootstrap firm with no tileKey',
      boot.length === 1 && boot[0].tileKey == null,
      boot.map(f => f.out + '/' + f.tileKey).join(','));
  console.log('  ↳ i.e. a business the player never built, cannot see in the build menu, and');
  console.log('    (before the Water Intake) could never replace once it was reaped.');

  const empty = E.serialize();
  /* Strip the waterworks pair out of the saved firm list — the POST-REAP state,
     byte for byte what `Firms.reap()` leaves behind — and remount as an
     ESTABLISHED city so `bootstrap()` does not run and cannot quietly re-seed
     the hidden rawWater firm. */
  const wiped = JSON.parse(JSON.stringify(empty));
  wiped.firms.firms = (wiped.firms.firms || []).filter(f => f.out !== 'rawWater' && f.out !== 'freshWater');
  E.mount({ nodeId: node, population: 140, state: wiped, established: true });

  const t2 = { '0,0': { type: 'purifier', lvl: 1, damaged: false },
               '1,0': { type: 'farm', lvl: 1, damaged: false } };
  E.syncBuildings(listOf(t2));
  for (let d = 0; d < 40; d++) { E.tick(DAY, HOST); E.syncBuildings(listOf(t2)); }

  const beforeFW = E.trace('freshWater');
  const beforeRW = E.trace('rawWater');
  const fwB = E.firms().find(f => f.out === 'freshWater');
  console.log('  BEFORE — tracer on `freshWater`:');
  beforeFW.forEach(x => console.log('    ' + (x.cause.ico || '') + ' ' + x.res + ' · ' + x.step + ' — ' + x.detail));
  console.log('  BEFORE — tracer on `rawWater`, the input it runs on:');
  beforeRW.forEach(x => console.log('    ' + (x.cause.ico || '') + ' ' + x.res + ' · ' + x.step + ' — ' + x.detail));
  chk('BEFORE: the tracer on rawWater says NOBODY IN THE CITY MAKES IT',
      beforeRW.some(x => x.res === 'rawWater' && x.cause.key === 'NO_PRODUCER'),
      JSON.stringify(beforeRW.map(x => x.res + ':' + x.cause.key)));
  chk('BEFORE: there is no rawWater firm and no rawWater in the city',
      !E.firms().some(f => f.out === 'rawWater') && !(E.inventory().rawWater > 0),
      'firms ' + E.firms().filter(f => f.out === 'rawWater').length + ' inv ' + (E.inventory().rawWater || 0));

  /* 🔴 WHY NOBODY EVER NOTICED — AND WHY THIS ASSERTION IS THE OPPOSITE OF
     WHAT IT WAS. When this round was written the Purifier was not idle here: it
     reported HEALTHY and made a FULL DAY'S OUTPUT out of an input the city did
     not hold one unit of, which is precisely what disguised a missing building
     as a working chain. That was the ALT_FEEDSTOCK hole — sim.js
     availabilityMap() built its `want` table from the leg each firm ran LAST and
     only that leg, and both readers treat an absent id as 100% available, so
     every leg a firm was NOT running read as perfect and was therefore always
     the cheapest one to switch to.

     ✅ IT IS CLOSED, by commit 31c8ae4 ("Cities were powering themselves with no
     fuel at all"), which found the same default behind four of the seven
     ALT_FEEDSTOCK ids and electricity worst of all. So the number this section
     was built on — 1,200 freshWater from zero rawWater — no longer describes the
     game, and the assertion that asserted it went RED while its own printed line
     said "made 0 freshWater today out of 0 rawWater": a driver contradicting
     itself in adjacent lines, which is worse than no driver, because a reader
     cannot tell which half to believe.

     🔴 THE ASSERTION IS NOT DELETED, IT IS TURNED OVER. What §3 needs from
     this point is unchanged — that BEFORE the Water Intake the chain is
     genuinely dead — and today the honest evidence for that is the STRONGER
     one: the Purifier produces exactly nothing and the tracer names the real
     cause. Deleting the check instead would have quietly dropped the only line
     standing between this round and a regression that re-opened the hole. */
  const madeFromNothing = fwB ? fwB.lastProduced : 0;
  console.log('  ✅ the Purifier made ' + madeFromNothing.toFixed(0) + ' freshWater today out of ' +
              (E.inventory().rawWater || 0).toFixed(0) + ' rawWater. Before 31c8ae4 it made a full');
  console.log('    day\'s output from the same nothing — the ALT_FEEDSTOCK hole — which is what made');
  console.log('    a missing building look like a working chain. It is closed, so the gap now SHOWS.');
  chk('BEFORE: the Purifier produces NOTHING, because there is nothing to produce from',
      madeFromNothing === 0 && !(E.inventory().rawWater > 0),
      'produced ' + madeFromNothing + ' out of ' + (E.inventory().rawWater || 0) + ' rawWater — ' +
      'if this is non-zero the ALT_FEEDSTOCK hole 31c8ae4 closed has been re-opened');
  chk('BEFORE: and the tracer says so out loud, rather than reporting a healthy line',
      beforeFW.some(x => x.res === 'freshWater') && beforeFW.some(x => x.cause.key === 'NO_PRODUCER'),
      JSON.stringify(beforeFW.map(x => x.res + ':' + x.cause.key)));
  const revB = 0;

  /* ONE VARIABLE: a Water Intake goes up on the next tile. Nothing else moves. */
  const t3 = { ...t2, '2,0': { type: 'waterintake', lvl: 1, damaged: false } };
  chk('the ground here carries rawWater, so the gate allows the Intake',
      GATE('waterintake') === null && E.pickAvailable(['rawWater']) === 'rawWater');
  E.syncBuildings(listOf(t3));
  for (let d = 0; d < 40; d++) { E.tick(DAY, HOST); E.syncBuildings(listOf(t3)); }

  const afterRW = E.trace('rawWater');
  const fwA = E.firms().find(f => f.out === 'freshWater');
  const rwA = E.firms().find(f => f.out === 'rawWater');
  console.log('  AFTER — tracer on `rawWater`:');
  afterRW.forEach(x => console.log('    ' + (x.cause.ico || '') + ' ' + x.res + ' · ' + x.step + ' — ' + x.detail));
  chk('AFTER: the trace no longer contains a NO_PRODUCER step for rawWater',
      !afterRW.some(x => x.res === 'rawWater' && x.cause.key === 'NO_PRODUCER'),
      JSON.stringify(afterRW.map(x => x.res + ':' + x.cause.key)));
  chk('AFTER: the rawWater firm is TILE-OWNED — the player built it and can rebuild it',
      !!rwA && rwA.tileKey === '2,0', rwA ? String(rwA.tileKey) : 'no firm');
  chk('AFTER: the intake is actually producing rawWater',
      !!rwA && rwA.lastProduced > 0, 'lastProduced ' + (rwA ? rwA.lastProduced.toFixed(2) : 'no firm'));
  chk('AFTER: the Purifier is still producing freshWater — now against a real supply',
      !!fwA && fwA.lastProduced > 0, 'lastProduced ' + (fwA ? fwA.lastProduced.toFixed(2) : 'no firm'));
  /* 🔴 THE ONE THAT MATTERS: the money walks UP the chain. gauntlet3 proves the
     card line the same way — a firm with lifetime revenue has real customers. */
  chk('AFTER: CINDER REACHED THE WATER INTAKE — the chain is trading, not just standing',
      !!rwA && rwA.lifetimeRevenue > revB,
      'lifetimeRevenue ' + (rwA ? rwA.lifetimeRevenue.toFixed(2) : 'no firm'));
  console.log('  rawWater: produced ' + (rwA ? rwA.lastProduced.toFixed(1) : 0) + '/day, ' +
              'lifetime revenue ' + (rwA ? rwA.lifetimeRevenue.toFixed(2) : 0) + ' 🔥, ' +
              'inventory ' + (E.inventory().rawWater || 0).toFixed(1));
  console.log('  the Purifier now names the Water Intake among its suppliers: ' +
              JSON.stringify(Object.keys((fwA && fwA.suppliers) || {})));
}

/* ── §4 THE AUDIT, over everything above ────────────────────────────────── */
console.log('\n########## §4 the closed loop ##########');
{
  // one more long run with all five standing, measured end to end
  E.mount({ nodeId: nodeAll || 'seam-0', population: 160, established: false });
  const t = {};
  let i = 0;
  for (const b of NEW) t[(i++) + ',1'] = { type: b, lvl: 1, damaged: false };
  t['8,1'] = { type: 'purifier', lvl: 1, damaged: false };
  t['9,1'] = { type: 'housing', lvl: 2, damaged: false };
  E.syncBuildings(listOf(t));
  let fails = 0, worst = 0, syncDelta = 0;
  for (let d = 0; d < 240; d++) {
    E.tick(DAY, HOST);
    const s = E.snapshot();
    if (!s.audit || !s.audit.ok) fails++;
    if (s.audit && Math.abs(s.audit.err || 0) > Math.abs(worst)) worst = s.audit.err;
    const c0 = E.totalCinder(); E.syncBuildings(listOf(t)); syncDelta += E.totalCinder() - c0;
  }
  chk('240 days with all five new buildings standing — the audit never failed',
      fails === 0, fails + ' failures');
  chk('…and no Cinder moved at any syncBuildings (founding is a transfer)',
      Math.abs(syncDelta) < 1e-6, String(syncDelta));
  console.log('  worst |err| over 240 days: ' + Math.abs(worst).toExponential(3) +
              ' · §1 run: ' + auditFails + ' failures, worst |err| ' + Math.abs(auditWorst).toExponential(3));
  chk('the §1 run audited clean too', auditFails === 0, auditFails + ' failures');
}

console.log('\n' + (bad ? '❌ DRIVE: ' + bad + ' FAILED' : '✅ DRIVE: ALL PASS'));
process.exit(bad ? 1 : 0);
