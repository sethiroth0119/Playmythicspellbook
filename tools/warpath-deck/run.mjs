// ─────────────────────────────────────────────────────────────────────────────
// 🏟 THE EXPERIMENT. Drafts real Warpath pools and plays them against each
// other, and against normal collection decks, through the REAL Mythic
// Spellbook battle engine running in headless Chromium.
//
//   node tools/warpath-deck/run.mjs                 # everything
//   node tools/warpath-deck/run.mjs --stage q4      # one stage
//   node tools/warpath-deck/run.mjs --workers 6 --scale 2
//
// Stages
//   control  seat / first-player bias, measured on a mirror match. Read this
//            first: every other number is only as trustworthy as this one.
//   q1       is a drafted pool legal and playable?
//   q2       two independently drafted pools — is it fair?
//   q3       is any biome archetype dominant?
//   q4       Warpath pools vs normal collection decks (the pay-to-win test)
//   q5       does the 25 → 60 progression curve work?
//
// Results are written to tools/warpath-deck/out/<stage>.json.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEngine } from './engine.mjs';
import { runExpedition, Data, Map_ } from './draft.mjs';
import { draftPools, poolWithGains, shape } from './pools.mjs';
import { wilson, fmtRate, describe, pct, rng } from './stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const STAGE = flag('stage', 'all');
const WORKERS = Number(flag('workers', 5));
const SCALE = Number(flag('scale', 1));
const HERO = flag('hero', 'cedric');           // same hero both sides: isolates the DECK
const want = s => STAGE === 'all' || STAGE === s;

const line = s => console.log(s);
const head = s => { console.log('\n' + '═'.repeat(78)); console.log(s); console.log('═'.repeat(78)); };
const save = (name, obj) => fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(obj, null, 1));

const E = await openEngine({ workers: WORKERS });
const CAT = await E.catalog();
const META = CAT.cards;
line(`engine: ${CAT.heroes.length} heroes, ${Object.keys(META).length} built-in cards, `
   + `DECK_SIZE ${CAT.deckSize}, MAX_COPIES ${CAT.maxCopies}, hand ${CAT.handSize}, ${WORKERS} tabs`);

/* Play a block of matches between two 40-card decks and return DECK ONE's win
   rate.
   ⚠ THE ENGINE IS NOT SYMMETRIC BETWEEN ITS TWO SEATS. `control` measures a
   first-move disadvantage (the side moving SECOND gets +1 max energy for the
   whole match — startTurn's isFirstTurnNoGain only suppresses the gain for
   'player' on turn 1, index.html:96632) and a residual 'player'-seat effect.
   So every duel is run as a balanced 2×2: deck one occupies each seat half the
   time and moves first half the time. Both biases cancel by construction
   rather than by hoping they are small. */
async function duel(deck1, deck2, n, tag) {
  const cfgs = [];
  for (let i = 0; i < n; i++) {
    const oneIsA = (i % 2) === 0;                 // which seat deck one sits in
    const aFirst = (i % 4) < 2;                   // which seat moves first
    cfgs.push({ heroA: HERO, heroB: HERO,
                keysA: oneIsA ? deck1 : deck2, keysB: oneIsA ? deck2 : deck1,
                aFirst, maxHalfTurns: 220, turnTimeoutMs: 12000, _oneIsA: oneIsA });
  }
  const rs = await E.playMany(cfgs);
  let a = 0, done = 0, unres = 0, deckOuts = 0;
  const turns = [], stranded1 = [], stranded2 = [];
  rs.forEach((r, i) => {
    const oneIsA = cfgs[i]._oneIsA;
    if (r.deckOut) deckOuts++;
    if (!r.winner) { unres++; return; }
    done++; turns.push(r.halfTurns);
    if (r.piles) {
      stranded1.push(oneIsA ? r.piles.A.hand : r.piles.B.hand);
      stranded2.push(oneIsA ? r.piles.B.hand : r.piles.A.hand);
    }
    if (r.winner === (oneIsA ? 'A' : 'B')) a++;
  });
  return { tag, a, done, unres, deckOuts, rate: wilson(a, done),
           turns: describe(turns), strandedA: describe(stranded1), strandedB: describe(stranded2) };
}

const results = {};

/* ═══ CONTROL ═══════════════════════════════════════════════════════════ */
if (want('control')) {
  head('CONTROL — mirror match. The harness must not favour a seat.');
  const starterDeck = await E.pad(Data.STARTER_POOL);
  const n = 200 * SCALE;
  const cfgs = [];
  for (let i = 0; i < n; i++) {
    cfgs.push({ heroA: HERO, heroB: HERO, keysA: starterDeck, keysB: starterDeck,
                aFirst: i % 2 === 0, maxHalfTurns: 220, turnTimeoutMs: 12000 });
  }
  const rs = await E.playMany(cfgs);
  let aw = 0, fw = 0, done = 0, unres = 0;
  const cell = { 'A-first': [0, 0], 'B-first': [0, 0] };   // [A wins, games]
  const turns = [];
  rs.forEach((r, i) => {
    if (!r.winner) { unres++; return; }
    done++; turns.push(r.halfTurns);
    const c = cfgs[i].aFirst ? 'A-first' : 'B-first';
    cell[c][1]++;
    if (r.winner === 'A') { aw++; cell[c][0]++; }
    if (r.winner === (cfgs[i].aFirst ? 'A' : 'B')) fw++;
  });
  line(`identical 40-card decks, identical hero, ${done} matches (${unres} unresolved)`);
  line(`  seat A wins                ${fmtRate(aw, done)}`);
  line(`  the side moving FIRST wins ${fmtRate(fw, done)}`);
  line(`    when A moves first, A wins ${fmtRate(cell['A-first'][0], cell['A-first'][1])}`);
  line(`    when B moves first, A wins ${fmtRate(cell['B-first'][0], cell['B-first'][1])}`);
  const t = describe(turns);
  line(`  match length: median ${t.p50} half-turns (p10 ${t.p10}, p90 ${t.p90})`);
  results.control = { aWins: aw, firstWins: fw, done, unres, turns: t, cell };

  /* SENSITIVITY. A harness that cannot tell a good deck from a bad one would
     report 50% for everything and look reassuring while measuring nothing.
     These two are deliberately far apart. */
  const junk = new Array(40).fill('unit:goblin');       // the cheapest, weakest body
  const tuned = await E.tunedDeck();
  const s1 = await duel(tuned, junk, 120 * SCALE, 'tuned-vs-junk');
  const s2 = await duel(tuned, starterDeck, 120 * SCALE, 'tuned-vs-starter');
  line('');
  line('  sensitivity — can this rig detect a deck-strength difference at all?');
  line(`    tuned catalogue deck vs 40× Goblin Scout : tuned wins ${fmtRate(s1.a, s1.done)}`);
  line(`    tuned catalogue deck vs the Warpath start: tuned wins ${fmtRate(s2.a, s2.done)}`);
  results.control.sensitivity = { junk: s1.rate, starter: s2.rate };
  save('control', results.control);
}

/* ═══ KEYS — every card key Warpath can hand the engine ════════════════ */
if (want('keys') || want('q1')) {
  head('KEYS — does every card key in warpath-data.js resolve in the engine?');
  const all = new Set(Data.STARTER_POOL);
  for (const b of Object.keys(Data.DISCOVERY)) for (const [k] of Data.DISCOVERY[b].cards) all.add(k);
  for (const p of Object.values(Data.RECRUIT_POOLS)) for (const o of p.offers) all.add(o.key);
  const keys = [...all];
  const insp = await E.inspect(keys);
  line(`  ${keys.length} distinct keys reachable from the starter pool, the six discovery`);
  line(`  tables and the three recruit pools.`);
  if (insp.unresolved.length) line(`  ✘ ${insp.unresolved.length} DO NOT RESOLVE: ${insp.unresolved.join(', ')}`);
  else line('  ✔ all of them resolve through the game\'s own resolveDeckCard');
  // CARD_META is the offline fallback the draft modal renders from.
  const metaMissing = keys.filter(k => !Data.CARD_META[k]);
  const metaExtra = Object.keys(Data.CARD_META).filter(k => !all.has(k));
  line(`  CARD_META: ${metaMissing.length ? '✘ missing ' + metaMissing.join(', ') : '✔ covers every key'}`
     + `${metaExtra.length ? '; ' + metaExtra.length + ' extra entries no table can offer' : ''}`);
  results.keys = { keys, unresolved: insp.unresolved, metaMissing, metaExtra };
  save('keys', results.keys);
}

/* ═══ Q1 — is a drafted pool legal and playable? ════════════════════════ */
if (want('q1')) {
  head('Q1 — is a drafted pool legal and playable?');
  const N = 400;
  const runs = draftPools(N, { turns: 60 });
  const gains = runs.map(r => r.gains.length);
  const disc = runs.map(r => r.discovered.length);
  const rec = runs.map(r => r.recruited.length);
  const ext = runs.map(r => r.extracted.length);
  const g = describe(gains), d = describe(disc), rr = describe(rec), ee = describe(ext);
  line(`${N} full 60-turn runs of the real draft (verified against Postgres by verify.mjs):`);
  line(`  cards discovered  mean ${d.mean.toFixed(1)}  p10 ${d.p10}  median ${d.p50}  p90 ${d.p90}  range ${d.min}–${d.max}`);
  line(`  cards recruited   mean ${rr.mean.toFixed(1)}  range ${rr.min}–${rr.max}`);
  line(`  total pool gain   mean ${g.mean.toFixed(1)}  range ${g.min}–${g.max}`);
  line(`  extractable       mean ${ee.mean.toFixed(1)}  range ${ee.min}–${ee.max}   (brief wants 8–12)`);

  // The same runs, stopped early — how long does a run have to last?
  const curve = [];
  for (const T of [5, 10, 15, 20, 30, 45, 60]) {
    const rs = draftPools(80, { turns: T });
    const dd = describe(rs.map(r => r.gains.length));
    curve.push({ turns: T, mean: +dd.mean.toFixed(1), p10: dd.p10, p90: dd.p90 });
  }
  line('  pool gain vs run length: ' + curve.map(c => `${c.turns}t→${c.mean}`).join('  '));

  /* An encounter can only fire on a tile this expedition has NEVER stood on
     (warpath_encounters is unique on (expedition_id, x, y)). So the single
     biggest lever on how many cards a run yields is not drafting skill — it is
     whether the hero walks new ground or farms resource nodes. */
  const styles = [];
  for (const style of ['explore', 'harvest']) {
    const rs = draftPools(200, { turns: 60, style });
    const gg = describe(rs.map(r => r.gains.length));
    const ex = describe(rs.map(r => r.extracted.length));
    styles.push({ style, gain: gg, extracted: ex });
    line(`  playstyle "${style}": gained mean ${gg.mean.toFixed(1)} (p10 ${gg.p10}, p90 ${gg.p90}, range ${gg.min}–${gg.max}), `
       + `extracted mean ${ex.mean.toFixed(1)} (range ${ex.min}–${ex.max})`);
  }

  // Scenarios, all built from the SAME real draft stream.
  const base = runs[0];
  const scen = [
    ['starter only (24 cards, no draft)', Data.STARTER_POOL],
    ['sim-observed low  (+3 gained)', poolWithGains(base, 3)],
    ['sim-observed high (+13 gained)', poolWithGains(base, 13)],
    ['brief intent      (+40 gained)', poolWithGains(runs.find(r => r.gains.length >= 40) || base, 40)],
  ];
  const rows = [];
  for (const [name, pool] of scen) {
    const padded = await E.pad(pool);
    const insp = await E.inspect(padded);
    const sh = shape(padded, META);
    rows.push({ name, poolSize: pool.length, deckSize: padded.length, ...sh, engineSaysLegal: insp.legalSize && insp.legalCopies, engineOver: insp.overLimit });
  }
  line('');
  line('  after the SHIPPED battle bridge (warpathPadDeck, index.html:215643):');
  for (const r of rows) {
    line(`  ${r.name.padEnd(34)} pool ${String(r.poolSize).padStart(3)} → deck ${r.deckSize}  `
       + `units ${String(r.units).padStart(2)} traps ${String(r.traps).padStart(2)} loc ${String(r.locations).padStart(2)} `
       + `spell ${String(r.spells).padStart(2)} wthr ${String(r.weather).padStart(2)}  avg cost ${r.avgCost.toFixed(2)}  `
       + `distinct ${r.distinct}`);
    line(`  ${''.padEnd(34)} curve ${JSON.stringify(r.curve)}  unresolvable ${r.unknown}  `
       + `over-3-copies: ${r.overLimit.length ? r.overLimit.join(', ') : 'none'}  `
       + `single-slot surplus ${r.singleSlotSurplus}`);
  }
  results.q1 = { draft: { discovered: d, recruited: rr, gain: g, extracted: ee }, curve, styles, scenarios: rows };
  save('q1', results.q1);

  // Playability: can each scenario finish a real match against itself?
  line('');
  line('  playability (each scenario mirrored against itself, real engine):');
  const play = [];
  for (const [name, pool] of scen) {
    const padded = await E.pad(pool);
    const r = await duel(padded, padded, 40 * SCALE, name);
    line(`  ${name.padEnd(34)} ${r.done}/${r.done + r.unres} matches reached a verdict, `
       + `median ${r.turns.p50} half-turns, deck-outs ${r.deckOuts}, `
       + `cards stranded in hand at the end ${r.strandedA.mean.toFixed(1)}`);
    play.push({ name, ...r });
  }
  results.q1.play = play;
  save('q1', results.q1);
}

/* ═══ Q2 — fairness between two independent drafts ══════════════════════ */
if (want('q2')) {
  head('Q2 — two independently drafted pools. Does draft luck decide the game?');
  const POOLS = 16;
  const PAIRS = 24;
  const MATCHES = 40 * SCALE;
  const runs = draftPools(POOLS, { turns: 60, seed0: 100003 });
  const decks = [];
  for (const r of runs) decks.push({ run: r, keys: await E.pad(r.pool) });
  const r0 = rng(20260812);
  const seen = new Set(), pairs = [];
  while (pairs.length < Math.min(PAIRS, POOLS * (POOLS - 1) / 2)) {
    const i = Math.floor(r0() * POOLS), j = Math.floor(r0() * POOLS);
    if (i === j) continue;
    const k = Math.min(i, j) + ':' + Math.max(i, j);
    if (seen.has(k)) continue;
    seen.add(k); pairs.push([i, j]);
  }
  const out = [];
  for (const [i, j] of pairs) {
    const r = await duel(decks[i].keys, decks[j].keys, MATCHES, `${i}v${j}`);
    out.push({ i, j, rate: r.rate.p, lo: r.rate.lo, hi: r.rate.hi, n: r.done,
               gi: decks[i].run.gains.length,
               gj: decks[j].run.gains.length,
               medianTurns: r.turns.p50 });
    line(`  pool ${String(i).padStart(2)} (+${String(out.at(-1).gi).padStart(2)} drafted) vs pool ${String(j).padStart(2)} (+${String(out.at(-1).gj).padStart(2)}): `
       + `${pct(r.rate.p)} [${pct(r.rate.lo)}–${pct(r.rate.hi)}] over ${r.done}`);
  }
  const rates = out.map(o => o.rate);
  const dd = describe(rates);
  const lopsided = out.filter(o => o.lo > 0.60 || o.hi < 0.40).length;
  const totalA = out.reduce((a, o) => a + o.rate * o.n, 0), totalN = out.reduce((a, o) => a + o.n, 0);
  line('');
  line(`  ${out.length} independent pairings × ${MATCHES} matches = ${totalN} matches`);
  line(`  pooled win rate for the "left" pool: ${pct(totalA / totalN)} (should be ~50% — pools are drafted symmetrically)`);
  line(`  per-pairing win rate: mean ${pct(dd.mean)}  sd ${pct(dd.sd)}  p10 ${pct(dd.p10)}  median ${pct(dd.p50)}  p90 ${pct(dd.p90)}  range ${pct(dd.min)}–${pct(dd.max)}`);
  line(`  pairings that are statistically lopsided (95% CI clear of 40–60%): ${lopsided}/${out.length}`);
  // Does the size of the pool advantage predict the win rate?
  const withDelta = out.map(o => ({ d: o.gi - o.gj, r: o.rate }));
  const mx = describe(withDelta.map(o => o.d)), my = describe(withDelta.map(o => o.r));
  let cov = 0;
  withDelta.forEach(o => { cov += (o.d - mx.mean) * (o.r - my.mean); });
  const corr = (mx.sd && my.sd) ? cov / ((withDelta.length - 1) * mx.sd * my.sd) : 0;
  line(`  correlation between "drafted more cards" and "won": r = ${corr.toFixed(3)}`);
  results.q2 = { pairs: out, spread: dd, lopsided, pooled: totalA / totalN, corr };
  save('q2', results.q2);
}

/* ═══ Q3 — biome archetypes ════════════════════════════════════════════ */
if (want('q3')) {
  head('Q3 — is any biome archetype dominant? ("always go to the volcano")');
  const BIOMES = Object.keys(Data.DISCOVERY);          // plains forest graveyard facility mountain wastes
  const INSTANCES = 3;
  const MATCHES = 24 * SCALE;
  const byBiome = {};
  for (const b of BIOMES) {
    byBiome[b] = [];
    for (let k = 0; k < INSTANCES; k++) {
      const r = runExpedition({ seed: (900001 + k * 7919) >>> 0, slot: k % 4, turns: 60, pick: 'value', target: b });
      byBiome[b].push({ run: r, keys: await E.pad(r.pool) });
    }
    const g = byBiome[b].map(x => x.run.gains.length);
    const sh = shape(byBiome[b][0].keys, META);
    line(`  ${b.padEnd(10)} drafted +${g.join('/+')} cards; sample deck: units ${sh.units} traps ${sh.traps} loc ${sh.locations} spell ${sh.spells} wthr ${sh.weather}, avg cost ${sh.avgCost.toFixed(2)}`);
  }
  const table = {};
  BIOMES.forEach(b => { table[b] = { wins: 0, games: 0, vs: {} }; });
  for (let i = 0; i < BIOMES.length; i++) {
    for (let j = i + 1; j < BIOMES.length; j++) {
      const A = BIOMES[i], B = BIOMES[j];
      let aw = 0, n = 0;
      for (let k = 0; k < INSTANCES; k++) {
        const r = await duel(byBiome[A][k].keys, byBiome[B][k].keys, MATCHES, `${A}v${B}`);
        aw += r.a; n += r.done;
      }
      table[A].wins += aw; table[A].games += n;
      table[B].wins += (n - aw); table[B].games += n;
      table[A].vs[B] = wilson(aw, n); table[B].vs[A] = wilson(n - aw, n);
      line(`  ${A.padEnd(10)} vs ${B.padEnd(10)} ${fmtRate(aw, n)}`);
    }
  }
  line('');
  line('  overall (each biome against all five others):');
  const rank = BIOMES.map(b => ({ b, ...wilson(table[b].wins, table[b].games) }))
                     .sort((x, y) => y.p - x.p);
  rank.forEach(r => line(`  ${r.b.padEnd(10)} ${pct(r.p)} [${pct(r.lo)}–${pct(r.hi)}]  (${r.k}/${r.n})`));
  const spread = rank[0].p - rank.at(-1).p;
  line(`  spread between best and worst biome: ${pct(spread)}`);
  results.q3 = { table, rank, spread };
  save('q3', results.q3);
}

/* ═══ Q4 — Warpath vs a normal collection deck ═════════════════════════ */
if (want('q4')) {
  head('Q4 — Warpath pools vs normal collection decks. The pay-to-win test.');
  const gen = await E.generatedDeck(HERO);
  const tuned = await E.tunedDeck();
  const gsh = shape(gen, META), tsh = shape(tuned, META);
  line(`  reference A "generated" (the game's own getGeneratedDeckForHero, index.html:71040):`);
  line(`     units ${gsh.units} spells ${gsh.spells} traps ${gsh.traps} loc ${gsh.locations} wthr ${gsh.weather}, avg cost ${gsh.avgCost.toFixed(2)}, over-3 ${gsh.overLimit.join(',') || 'none'}`);
  line(`  reference B "tuned" (best stats-per-energy from the full built-in catalogue):`);
  line(`     units ${tsh.units} spells ${tsh.spells} traps ${tsh.traps} loc ${tsh.locations} wthr ${tsh.weather}, avg cost ${tsh.avgCost.toFixed(2)}, over-3 ${tsh.overLimit.join(',') || 'none'}`);

  const runs = draftPools(6, { turns: 60, seed0: 555001 });
  const best = runs.slice().sort((a, b) =>
    b.gains.length - a.gains.length)[0];
  const cands = [
    ['starter pool only (24)', Data.STARTER_POOL],
    ['typical run (+13)', poolWithGains(runs[0], 13)],
    ['good run (+' + (best.gains.length) + ')', best.pool],
    ['brief intent (+40)', poolWithGains(best, 40)],
  ];
  const MATCHES = 80 * SCALE;
  const rows = [];
  for (const [name, pool] of cands) {
    const wp = await E.pad(pool);
    for (const [refName, ref] of [['generated', gen], ['tuned', tuned]]) {
      const r = await duel(wp, ref, MATCHES, `${name} vs ${refName}`);
      line(`  ${name.padEnd(22)} vs ${refName.padEnd(10)}  warpath wins ${fmtRate(r.a, r.done)}   median ${r.turns.p50} half-turns`);
      rows.push({ warpath: name, ref: refName, ...r.rate, medianTurns: r.turns.p50, deckOuts: r.deckOuts });
    }
  }
  results.q4 = { generated: gsh, tuned: tsh, rows };
  save('q4', results.q4);
}

/* ═══ Q5 — the progression curve ═══════════════════════════════════════ */
if (want('q5')) {
  head('Q5 — does 25 → 31 → 38 → 46 → 52 → 60 actually feel like progress?');
  const MILE = Data.DECK_MILESTONES;                   // [25,31,38,46,52,60]
  const STARTER_N = Data.STARTER_POOL.length;          // 24 cards, NOT 25
  line(`  STARTER_POOL is ${STARTER_N} cards; the brief's "25" counts the Hero, which is not a deck card.`);
  const donors = draftPools(24, { turns: 60, seed0: 770001 })
    .filter(r => STARTER_N + r.gains.length >= 60);
  line(`  ${donors.length}/24 full 60-turn runs reached a 60-card pool at all.`);
  const donor = donors[0] || draftPools(1, { turns: 60, seed0: 770001 })[0];
  const ref = await E.pad(Data.STARTER_POOL);          // the 24-card start is the yardstick
  const MATCHES = 80 * SCALE;
  const rows = [];
  for (const m of MILE) {
    const pool = poolWithGains(donor, Math.max(0, m - STARTER_N)).slice(0, m);
    const keys = await E.pad(pool);
    const sh = shape(keys, META);
    const r = await duel(keys, ref, MATCHES, 'mile' + m);
    line(`  ${String(m).padStart(2)} cards (pool ${pool.length})  vs the 24-card start: ${fmtRate(r.a, r.done)}   `
       + `units ${sh.units} loc ${sh.locations} distinct ${sh.distinct} avgCost ${sh.avgCost.toFixed(2)}  median ${r.turns.p50} half-turns`);
    rows.push({ milestone: m, poolSize: pool.length, shape: sh, ...r.rate, medianTurns: r.turns.p50 });
  }
  // Each step against the PREVIOUS step — is every rung a real improvement?
  line('');
  line('  each rung against the one below it:');
  const steps = [];
  for (let i = 1; i < MILE.length; i++) {
    const lo = poolWithGains(donor, Math.max(0, MILE[i - 1] - STARTER_N)).slice(0, MILE[i - 1]);
    const hi = poolWithGains(donor, Math.max(0, MILE[i] - STARTER_N)).slice(0, MILE[i]);
    const r = await duel(await E.pad(hi), await E.pad(lo), MATCHES, `${MILE[i]}v${MILE[i - 1]}`);
    line(`  ${MILE[i]} vs ${MILE[i - 1]}: ${fmtRate(r.a, r.done)}`);
    steps.push({ from: MILE[i - 1], to: MILE[i], ...r.rate });
  }
  results.q5 = { starterN: STARTER_N, donorsReaching60: donors.length, rows, steps };
  save('q5', results.q5);
}

/* ═══ Q6 — what the AI pilot cannot do, and what that costs a Warpath deck ═ */
if (want('q6')) {
  head('Q6 — dead cards under AI pilot. What does the AI refuse to play?');
  const starter = await E.pad(Data.STARTER_POOL);
  const probe = await E.playMatch({ heroA: HERO, heroB: HERO, keysA: starter, keysB: starter,
                                    aFirst: true, maxHalfTurns: 220, turnTimeoutMs: 12000 });
  line(`  one starter-mirror match: location ever on the field ${probe.sawLocation}, `
     + `weather ${probe.sawWeather}, trap ${probe.sawTrap}`);
  // Strip the card types the AI never touches and see what the deck is worth then.
  const noLoc = Data.STARTER_POOL.filter(k => (META[k] || {}).type !== 'location');
  const noLocDeck = await E.pad(noLoc);
  const MATCHES = 200 * SCALE;
  const r = await duel(noLocDeck, starter, MATCHES, 'noloc-vs-starter');
  line(`  starter pool with its 8 Location cards REMOVED (${noLoc.length} cards → ${noLocDeck.length}) `
     + `vs the shipped starter: ${fmtRate(r.a, r.done)}`);
  line(`  → that gap is the cost of cards the AI pilot cannot use. A HUMAN playing the same`);
  line(`    pool can play them, so every AI-piloted number in this report understates a`);
  line(`    location-heavy deck by roughly this much.`);
  const allRuns = [];
  for (const b of Object.keys(Data.DISCOVERY)) {
    const tot = Data.DISCOVERY[b].cards.reduce((a, c) => a + c[1], 0);
    const loc = Data.DISCOVERY[b].cards.filter(c => c[0].startsWith('location:')).reduce((a, c) => a + c[1], 0);
    allRuns.push(`${b} ${Math.round(100 * loc / tot)}%`);
  }
  line(`  share of each biome's discovery weight that is Location cards: ${allRuns.join(', ')}`);
  results.q6 = { probe: { sawLocation: probe.sawLocation, sawWeather: probe.sawWeather, sawTrap: probe.sawTrap },
                 noLocation: r.rate, locationWeightByBiome: allRuns };
  save('q6', results.q6);
}

head('page errors seen across every match');
const uniq = [...new Set(E.pageErrors)];
if (!uniq.length) line('  none');
else uniq.slice(0, 25).forEach(e => line('  ' + e));
save('page-errors', uniq);

await E.close();
