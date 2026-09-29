/* 🧪 YOU COULD NOT MAKE A CURE THAT WORKED (v121v77).

   Reported: "After trying multiple strains, it is simply impossible to create
   something that will work against the existing viruses… when you research a
   strain the markers are so far apart, no combination of anything works… if you
   get to one suitable marker, adjusting anything else moves it from that
   marker… some markers are so far apart it's impossible to get remotely close
   and you burn quite a lot of resources doing so… it feels like I am missing a
   lot of what needs to be shown on the UI… we have many resources that fit in
   this system, add them."

   THREE SEPARATE DEFECTS, and the player experienced them as one wall.

   1. GEOMETRY. blendOf() is a WEIGHTED AVERAGE, so every mix lands inside the
      CONVEX HULL of the reagent points in 4-space. With the thirteen reagents
      the file shipped with, that hull had no vertex in four corners the strain
      generator happily produces — high envelope with low resilience, very low
      replication, very low vector, very high vector with low resilience — and a
      signature outside the hull cannot be matched by ANY mix. Measured over 400
      strains each given the mathematically optimal mix: 7.8% could never reach
      broad-spectrum however well they were played. Twelve reagents drawn from
      RESOURCES (which had grown to 142 while this table was still built against
      the original 14) took that to 0.8%.

   2. THE HELPER WAS WORSE THAN NO HELPER. suggestMix picked, per axis
      independently, the reagent nearest that axis's target and put all four in
      together — but a weighted average does not compose, it averages, so the
      result landed in the middle of the four rather than at any of them.
      Measured on 200 strains with good lab work: the old suggestion reached
      broad-spectrum 0.0% of the time and produced something WORSE than a viable
      cure 19.5% of the time. That is the button the game offers a stuck player.

   3. THE BENCH SHOWED THE PROBLEM AND NOT THE MOVE. Four gaps and twenty-odd
      jars, with no way to connect them — and "adjusting anything else moves it
      from that marker" is precisely the coupling a weighted average creates.
      Every jar now prints what ONE MORE UNIT would do to the vessel in front of
      the player, and the list is ordered by it.

   Run: node _cures_smoke.mjs */
import { readFileSync } from 'fs';
import { AXES, makeStrain } from './public/src/plague/strains.js';
import { REAGENTS, REAGENT_IDS, formulate, suggestMix, marginalOf, gradeOf } from './public/src/plague/cures.js';
import { synthesisPanel } from './public/src/biolab/hud.js';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const IDX = readFileSync('./public/index.html', 'utf8');
const CRAFT = { sequenced: true, synthesis: 0.6, centrifuge: 0.6, assayed: true, sealed: true };
const RICH = () => { const h = {}; REAGENT_IDS.forEach(k => h[k] = 40); return h; };

/* ── 1. EVERY REAGENT IS A RESOURCE THE PLAYER CAN ACTUALLY HOLD ──────────────
   The file's own opening rule, and the reason it is a rule: an id a player can
   hold but cannot spend or make is "worse than missing, because their pile of
   it is real and inert". */
{
  const m = /const RESOURCES = \[([\s\S]*?)\n\];/.exec(IDX);
  const real = new Set([...m[1].matchAll(/id: '([a-zA-Z]+)'/g)].map(x => x[1]));
  const bogus = REAGENT_IDS.filter(k => !real.has(k));
  ok(bogus.length === 0, 'every reagent id is a real RESOURCES id the game produces', bogus.join(', '));
  ok(REAGENT_IDS.length >= 24, 'the bench has at least 24 reagents (it shipped with 13)', String(REAGENT_IDS.length));
  const idMismatch = REAGENT_IDS.filter(k => REAGENTS[k].id !== k);
  ok(idMismatch.length === 0, 'and each entry\'s id matches its key', idMismatch.join(', '));
}

/* ── 2. THE FOUR CORNERS THAT WERE MISSING ────────────────────────────────────
   Pinned individually. A future retune that drops one of these silently
   reintroduces a class of strain nobody can cure, and the symptom is a player
   report months later rather than a red suite. */
{
  const any = (f) => REAGENT_IDS.some(k => f(REAGENTS[k].axis));
  ok(any(a => a.envelope >= 88 && a.resilience <= 20),
    'a high-envelope / LOW-resilience reagent exists — haemic strains were unreachable without one');
  ok(any(a => a.replication <= 8),
    'a reagent that halts replication exists — fungal strains ask for 11 and the old floor was 20');
  ok(any(a => a.vector <= 10),
    'a very-low-vector reagent exists — strains ask for as little as 2 and the old floor was 20');
  ok(any(a => a.vector >= 95),
    'a very-high-vector reagent exists — strains ask for 100 and the old ceiling was 85');
  ok(REAGENT_IDS.some(k => REAGENTS[k].weight <= 0.4),
    'and at least one reagent is quiet enough to TRIM with — "adjusting anything else moves it from that marker" is what weight does');
}

/* ── 3. THE PLAYER-FACING GUARANTEE: the bench can answer the virus ───────── */
{
  const n = 200;
  let broad = 0, viable = 0, worse = 0, iatro = 0;
  for (let i = 0; i < n; i++) {
    const st = makeStrain('cure' + i, {});
    const f = formulate(st, suggestMix(st, 24, RICH(), CRAFT), CRAFT);
    if (f.grade.key === 'broad') broad++;
    else if (f.grade.key === 'viable') viable++;
    else { worse++; if (f.grade.key === 'iatrogenic') iatro++; }
  }
  ok(worse === 0, 'SUGGEST A BLEND reaches a VIABLE CURE or better on all 200 strains',
    worse + ' fell short (' + iatro + ' iatrogenic)');
  ok(broad >= 20, 'and broad-spectrum on a decent share of them, so the grade still means something',
    (100 * broad / n).toFixed(1) + '% broad, ' + (100 * viable / n).toFixed(1) + '% viable');
  ok(broad <= 180, 'but NOT on nearly all of them — a suggestion that always wins is a solved puzzle',
    (100 * broad / n).toFixed(1) + '%');
}

/* ── 4. AND IT IS BETTER THAN WHAT IT REPLACED, measured on the same strains ── */
{
  /* The OLD per-axis greedy, verbatim, so the regression is evidence. */
  const oldSuggest = (strain, budget) => {
    const sig = (strain && strain.sig) || {};
    const cap = Math.max(6, Math.min(48, (budget | 0) || 24));
    const mix = {};
    for (const ax of AXES) {
      const want = +sig[ax] || 50;
      let best = null, bestD = Infinity;
      for (const k of REAGENT_IDS) {
        const R = REAGENTS[k];
        const d = Math.abs((R.axis[ax] || 0) - want) + R.weight * 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best) mix[best] = (mix[best] | 0) + Math.round(cap * 0.22);
    }
    mix.water = (mix.water | 0) + Math.round(cap * 0.14);
    mix.supplies = (mix.supplies | 0) + Math.round(cap * 0.10);
    for (const k of Object.keys(mix)) if (mix[k] <= 0) delete mix[k];
    return mix;
  };
  const n = 120;
  let oldEff = 0, newEff = 0, oldBad = 0, newBad = 0;
  for (let i = 0; i < n; i++) {
    const st = makeStrain('cmp' + i, {});
    const a = formulate(st, oldSuggest(st, 24), CRAFT);
    const b = formulate(st, suggestMix(st, 24, RICH(), CRAFT), CRAFT);
    oldEff += a.efficacy; newEff += b.efficacy;
    if (a.grade.key === 'inert' || a.grade.key === 'palliative' || a.grade.key === 'iatrogenic') oldBad++;
    if (b.grade.key === 'inert' || b.grade.key === 'palliative' || b.grade.key === 'iatrogenic') newBad++;
  }
  ok(newEff / n > oldEff / n + 0.10, 'the solver beats the old per-axis greedy on mean efficacy by a wide margin',
    (oldEff / n).toFixed(3) + ' → ' + (newEff / n).toFixed(3));
  ok(newBad < oldBad, 'and it stops handing the player a batch that is not a cure',
    oldBad + ' → ' + newBad + ' of ' + n);
}

/* ── 5. IT PLANS INSIDE THE SHELF, and that has to be IN the solver ───────── */
{
  const st = makeStrain('shelf', {});
  const only = { medicine: 6, water: 6, cloth: 4 };
  const mix = suggestMix(st, 24, only, CRAFT);
  const over = Object.keys(mix).filter(k => (mix[k] | 0) > (only[k] | 0));
  ok(over.length === 0, 'a suggestion never asks for a reagent the player does not hold', over.join(', '));
  ok(Object.keys(mix).every(k => k in only), 'and never reaches for a jar that is not on the shelf at all',
    Object.keys(mix).filter(k => !(k in only)).join(', '));
  ok(Object.keys(mix).length > 0, 'a thin shelf still produces a suggestion rather than nothing');
  const empty = suggestMix(st, 24, {}, CRAFT);
  ok(Object.keys(empty).length === 0, 'and an EMPTY shelf produces an empty mix rather than an unaffordable one');
}

/* ── 6. THE SOLVER WILL NOT HAND OVER A MUTANT FACTORY ────────────────────── */
{
  let bad = 0;
  for (let i = 0; i < 80; i++) {
    const st = makeStrain('iat' + i, {});
    const f = formulate(st, suggestMix(st, 24, RICH(), CRAFT), CRAFT);
    if (f.grade.key === 'iatrogenic' || f.stability < 35) bad++;
  }
  ok(bad === 0, 'no suggested blend is iatrogenic or below the stability floor', String(bad));
}

/* ── 7. marginalOf ANSWERS FOR *THIS* VESSEL, which is the whole point ────── */
{
  const st = makeStrain('marg', {});
  const mix = { medicine: 4, water: 3 };
  const base = formulate(st, mix, CRAFT);
  const m = marginalOf(st, mix, CRAFT);
  ok(Object.keys(m).length === REAGENT_IDS.length, 'it answers for every reagent on the bench');
  /* Its numbers must be the real thing, not an approximation of it. */
  const k = 'acids';
  const check = formulate(st, Object.assign({}, mix, { [k]: (mix[k] | 0) + 1 }), CRAFT);
  const drift = AXES.map(ax => Math.abs(((base.blend[ax] || 0) + m[k].axis[ax]) - (check.blend[ax] || 0)));
  ok(Math.max(...drift) < 1e-9, 'and every axis delta is exactly what re-formulating gives', Math.max(...drift).toExponential(2));
  ok(Math.abs((base.efficacy + m[k].dEfficacy) - check.efficacy) < 1e-9, 'as is the efficacy delta');
  /* The coupling itself: a reagent moves axes it is not "for". */
  const moved = AXES.filter(ax => Math.abs(m[k].axis[ax]) > 0.01).length;
  ok(moved >= 3, 'one unit moves three or more axes at once — this IS the coupling the player was fighting blind',
    moved + ' of 4');
  /* And the same jar answers differently for a different vessel, which is why
     a fixed per-reagent profile could never have told the player this. */
  const m2 = marginalOf(st, { corruptedEssence: 9 }, CRAFT);
  ok(Math.abs(m2[k].axis.envelope - m[k].axis.envelope) > 0.5,
    'and it answers DIFFERENTLY for a different vessel — a fixed profile could not have said this',
    m[k].axis.envelope.toFixed(2) + ' vs ' + m2[k].axis.envelope.toFixed(2));
}

/* ── 8. THE BENCH SHOWS IT ────────────────────────────────────────────────── */
{
  const st = makeStrain('ui', {});
  const have = RICH();
  const mix = suggestMix(st, 24, have, CRAFT);
  const f = formulate(st, mix, CRAFT);
  const html = synthesisPanel({ strain: st, mix, have, f, known: true, bench: [], craft: CRAFT });
  ok(/class="bl-gap/.test(html), 'each axis prints a SIGNED gap, not just "27/92"');
  ok(/short<|over<|on target</.test(html), 'in words the player can act on', (html.match(/bl-gap[^>]*>([^<]*)</) || [])[1]);
  ok(/class="bl-mv/.test(html), 'and every jar prints what one more unit would do');
  ok(/efficacy<\/span>/.test(html), 'including what it does to efficacy');
  ok(/bl-mv ok|bl-mv-eff ok/.test(html) && /bl-mv no|bl-mv-eff no/.test(html),
    'marked toward the strain and away from it — and the SIGN is always printed too, never colour alone');
  {
    /* Ordering: the most useful jar first. */
    const order = [...html.matchAll(/data-act="mix\+" data-id="([a-zA-Z]+)"/g)].map(x => x[1]);
    ok(order.length === REAGENT_IDS.length, 'every reagent is still listed', order.length + '/' + REAGENT_IDS.length);
    const m = marginalOf(st, mix, CRAFT);
    const held = order.filter(k => (have[k] | 0) > (mix[k] | 0));
    let sorted = true;
    for (let i = 1; i < held.length; i++) if (m[held[i - 1]].dEfficacy < m[held[i]].dEfficacy - 1e-12) sorted = false;
    ok(sorted, 'ordered by what actually helps THIS vessel most, not by a fixed table order');
  }
  {
    /* Unsequenced: no target, so no ranking against it and no ticks. */
    const blind = synthesisPanel({ strain: st, mix, have, f, known: false, bench: [], craft: CRAFT });
    ok(!/class="bl-gap/.test(blind), 'an unsequenced strain shows no gaps — the Sequencer gate still means something');
    const order = [...blind.matchAll(/data-act="mix\+" data-id="([a-zA-Z]+)"/g)].map(x => x[1]);
    ok(order.join(',') === REAGENT_IDS.join(','), 'and the jars stay in declaration order rather than being ranked against a hidden signature');
  }
}

/* ── 9. NOTHING HERE SPENDS ANYTHING — the file's own contract ────────────── */
{
  const src = readFileSync('./public/src/plague/cures.js', 'utf8');
  ok(!/spendRes|addRes|spendGems|B\.getRes/.test(src), 'cures.js still touches no ledger — state.js owns every write');
  const st = makeStrain('pure', {});
  const mix = { medicine: 3 };
  const before = JSON.stringify(mix);
  suggestMix(st, 24, RICH(), CRAFT); marginalOf(st, mix, CRAFT); formulate(st, mix, CRAFT);
  ok(JSON.stringify(mix) === before, 'and none of the three mutate the mix they are handed');
}

/* ── 10. the grade bands are untouched — this fixed reach, not difficulty ── */
ok(gradeOf({ efficacy: 0.9, stability: 30, purity: 90, risk: 0.1 }).key === 'iatrogenic', 'an unstable batch is still iatrogenic however effective');
ok(gradeOf({ efficacy: 0.2, stability: 80, purity: 90, risk: 0 }).key === 'inert', 'a weak batch is still inert');
ok(gradeOf({ efficacy: 0.5, stability: 80, purity: 90, risk: 0 }).key === 'palliative', 'the palliative band is unchanged');
ok(gradeOf({ efficacy: 0.9, stability: 70, purity: 90, risk: 0 }).key === 'broad', 'and broad still needs efficacy, purity AND stability together');

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
