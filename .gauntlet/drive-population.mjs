/* ══════════════════════════════════════════════════════════════════════════
   👥 DRIVE-POPULATION — every resident is accounted for.

   THE ASK, §23: "Do NOT fake population growth. Every increase or decrease
   should have an identifiable cause… the simulation should be able to account
   for the difference through Births + Immigration − Deaths − Emigration = Net
   Population Change."

   🔴 THAT IS THE ONE CLAIM THIS DRIVER EXISTS FOR, and it is asserted as an
      EXACT equality on integers, never a tolerance. A tolerance would hide the
      exact class of bug it is here to catch — a flow that half-counts, or a
      population nudged somewhere outside the ledger. The first run of the model
      failed it by −1.46e-11: ageing added fractional deaths, the arithmetic was
      morally right and the identity was false, because floating point does not
      care what anybody meant.

   🔴 WHAT THIS REPLACED. node-city grew its citizenry on one rule: Food, Water
      and Health coverage all ≥ 90% added 0.35 people a minute; any under 60%
      removed up to 0.55. Placing a house really did just hand you NPCs, which
      is the thing the owner asked to stop. Nobody arrived or left for a reason
      that could be named, and the number could not be accounted for at all.

   Pinned, with controls:
     · 🔴 births + immigration − deaths − emigration = the population, exactly
     · …across a good city, a collapsing one, a disaster and a recovery
     · the weights are not equal — necessities outweigh comforts by design
     · a term the city cannot measure is ABSENT, not scored zero
     · 🔴 CONTROL: attraction alone brings nobody — no housing, no immigration
     · 🔴 CONTROL: …nor does a city with no water, however desirable
     · nobody leaves over one bad minute; a bad month empties the town
     · a disaster is a shock that FADES, not a permanent scar
     · children do not become workers by appearing — they have to grow up
     · the ledger survives a save and reload
     · bottlenecks name the part of the city that runs out first

   Run:  node .gauntlet/drive-population.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
const P = 9810 + (process.pid % 30);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => errs.push(String(e).slice(0, 220)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('cdn.jsdelivr.net') || u.includes('unpkg.com')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.__nc && !!window.__nc.jobfair', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(6000);

const out = {};
const MOD = '/src/city/population.js';

/* ══ 🏢 THE DENSITY LADDER IS REAL, AND BOTH FILES AGREE ABOUT IT ══════════
   🔴 THE HOUSING MARKET WAS COUNTING SHOPS AS HOMES. households.js ships a
      five-tier ladder, and only TWO buildings in node-city's catalogue of 175
      had a popCap — Housing and the Storm Shelter — so the middle rungs were
      mapped onto Retail Parade, Office Block and Stadium. The market was
      reporting a stadium as 180 beds and counting shoppers as residents.
      The fix was not to re-point the table at other borrowed buildings; it was
      to give the city the residential ladder it never had.
   ⚠ `cap` IN THE TIER TABLE AND `popCap` ON THE BUILDING ARE THE SAME CLAIM
     IN TWO FILES. Drift means the housing market and the city's own housing
     ceiling quietly disagree about how many people fit — the population sim
     reads one while the dashboard shows the other, and neither looks wrong. */
{
  const city = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8').split('\r\n').join('\n');
  const hh = fs.readFileSync(path.join(ROOT, 'src', 'city', 'households.js'), 'utf8');
  const tiers = [...hh.matchAll(/\{ id: '(\w+)',\s*name: '[^']+',\s*build: \['(\w+)'\],\s*cap: (\d+)/g)]
    .map((m) => ({ id: m[1], build: m[2], cap: +m[3] }));
  const rows = tiers.map((t) => {
    const i = city.indexOf('\n  ' + t.build + ':');
    const chunk = i >= 0 ? city.slice(i, i + 600) : '';
    const m = chunk.match(/popCap:\s*(\d+)/);
    return { tier: t.id, build: t.build, cap: t.cap, popCap: m ? +m[1] : null,
             /* higher density has to cost more infrastructure, per the ask */
             power: (chunk.match(/powerNeed:\s*([\d.]+)/) || [])[1] || null };
  });
  out.ladder = {
    tiers: rows.length,
    rows,
    allExist: rows.length > 0 && rows.every((r) => r.popCap !== null),
    allAgree: rows.length > 0 && rows.every((r) => r.popCap === r.cap),
    /* 🔴 …and every rung above the house draws MORE power than the last. */
    powerClimbs: (() => {
      const p = rows.map((r) => (r.power === null ? 0 : +r.power));
      for (let i = 2; i < p.length; i++) if (!(p[i] > p[i - 1])) return false;
      return p.length > 2;
    })(),
  };
}

/* ══ 1 · the model, exercised directly and hard ════════════════════════════ */
out.model = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  let seed = 987654321;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const good = { housing: .9, food: .95, water: .95, safety: .85, power: .9, healthcare: .8,
                 jobs: .8, affordability: .7, wages: .6, education: .6, crime: .8,
                 transport: .6, entertainment: .5, environment: .6, economy: .7 };
  const bad = { housing: .2, food: .25, water: .3, safety: .2, power: .2, healthcare: .15,
                jobs: .1, affordability: .2, wages: .2, education: .2, crime: .2,
                transport: .2, entertainment: .1, environment: .2, economy: .1 };
  const S = P.create(240);
  const start = S.pop;
  let terms = good;
  const marks = [];
  /* Three simulated days: a good city, a collapse, a disaster, a recovery. */
  for (let m = 0; m < 4320; m++) {
    if (m === 1440) terms = bad;
    if (m === 2400) P.shock(S, 1.5);
    if (m === 2880) terms = good;
    P.tick(S, { terms, dtMin: 1, housingFree: 100000, rng,
      liveable: { water: terms.water, food: terms.food, power: terms.power, safety: terms.safety } });
    if (m % 60 === 0) P.age(S, 1 / 12);
    if (m % 720 === 0) marks.push(Math.round(S.pop));
  }
  const a = P.audit(S, start);
  return {
    audit: a, marks,
    /* every flow is a whole number of people, which is what makes the equality exact */
    integral: [a.births, a.deaths, a.immigration, a.emigration].every((v) => Number.isInteger(v)),
    grew: marks[2] > marks[0], fell: marks[4] < marks[2],
  };
}, MOD);

/* ══ 2 · the weights, and the absent-term rule ═════════════════════════════ */
out.weights = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  const W = P.WEIGHTS;
  const need = ['housing', 'food', 'water', 'safety', 'power', 'healthcare'];
  const fun = ['entertainment', 'transport', 'environment', 'economy'];
  const sum = (k) => k.reduce((a, x) => a + (W[x] || 0), 0);
  /* 🔴 A CITY WITH EVERY COMFORT AND NO NECESSITY MUST BE UNLIVEABLE. */
  const comfortsOnly = P.score({ entertainment: 1, transport: 1, environment: 1, economy: 1,
                                 housing: 0, food: 0, water: 0, safety: 0, power: 0, healthcare: 0 });
  const needsOnly = P.score({ entertainment: 0, transport: 0, environment: 0, economy: 0,
                              housing: 1, food: 1, water: 1, safety: 1, power: 1, healthcare: 1 });
  /* 🔴 ABSENT ≠ ZERO. A build with no sewage model must not be marked down for
     it, and a city whose sewers FAILED must be. */
  const withAbsent = P.score({ housing: 1, food: 1, water: 1 });
  const withZero  = P.score({ housing: 1, food: 1, water: 1, sanitation: 0, transport: 0, entertainment: 0 });
  return {
    needTotal: sum(need), funTotal: sum(fun), total: P.WEIGHT_TOTAL,
    comfortsOnly: comfortsOnly.score, needsOnly: needsOnly.score,
    absentScore: withAbsent.score, zeroScore: withZero.score,
    absentMeasured: withAbsent.measured, zeroMeasured: withZero.measured,
    bands: P.BANDS.map((x) => x.id),
    bandAt: [P.bandFor(95).id, P.bandFor(80).id, P.bandFor(65).id, P.bandFor(50).id, P.bandFor(35).id, P.bandFor(10).id],
  };
}, MOD);

/* ══ 3 · 🔴 THE GATES — attraction is never enough on its own ══════════════ */
out.gates = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  const perfect = { housing: 1, food: 1, water: 1, safety: 1, power: 1, healthcare: 1,
                    jobs: 1, affordability: 1, wages: 1, education: 1, crime: 1,
                    transport: 1, entertainment: 1, environment: 1, economy: 1 };
  const run = (over, housingFree, live) => {
    const S = P.create(200);
    let imm = 0, beds = housingFree;
    for (let m = 0; m < 240; m++) {
      const r = P.tick(S, { terms: Object.assign({}, perfect, over || {}), dtMin: 1,
        housingFree: beds, liveable: live || { water: 1, food: 1, power: 1, safety: 1 } });
      imm += r.immigration;
      /* ⚠ BEDS ARE CONSUMED, the way the city consumes them — popHousingFree()
         is popCap() minus the people already in it, so it shrinks as they
         arrive. Holding it constant let the same two beds admit somebody every
         minute for four hours and the assertion failed against a model that was
         behaving correctly. */
      beds = Math.max(0, beds - r.immigration);
    }
    return { imm, blocked: S.blocked ? S.blocked.id : null, pop: S.pop };
  };
  return {
    /* the control: a desirable city with beds does take people */
    open: run(null, 5000),
    /* 🔴 …and the SAME city with nowhere to live takes nobody */
    noHousing: run(null, 0),
    /* 🔴 …nor with the taps dry, however desirable it is otherwise */
    noWater: run(null, 5000, { water: 0.05, food: 1, power: 1, safety: 1 }),
    noPower: run(null, 5000, { water: 1, food: 1, power: 0.02, safety: 1 }),
    unsafe: run(null, 5000, { water: 1, food: 1, power: 1, safety: 0.05 }),
    /* …and housing headroom caps arrivals at the number of actual beds */
    twoBeds: run(null, 2),
  };
}, MOD);

/* ══ 4 · patience: nobody leaves over one bad minute ═══════════════════════ */
out.patience = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  const bad = { housing: .1, food: .1, water: .1, safety: .1, power: .1, healthcare: .1,
                jobs: .1, affordability: .1, wages: .1, education: .1, crime: .1,
                transport: .1, entertainment: .1, environment: .1, economy: .1 };
  const good = { housing: .9, food: .9, water: .9, safety: .9, power: .9, healthcare: .9,
                 jobs: .9, affordability: .9, wages: .9, education: .9, crime: .9,
                 transport: .9, entertainment: .9, environment: .9, economy: .9 };
  const live = { water: 1, food: 1, power: 1, safety: 1 };
  /* a five-minute crisis */
  const A = P.create(400);
  for (let m = 0; m < 5; m++) P.tick(A, { terms: bad, dtMin: 1, housingFree: 0, liveable: live });
  const shortSpell = A.ledger.emigration;
  /* …and a two-hour one */
  const B = P.create(400);
  for (let m = 0; m < 120; m++) P.tick(B, { terms: bad, dtMin: 1, housingFree: 0, liveable: live });
  const longSpell = B.ledger.emigration;
  /* strain drains again once things are put right */
  const strainAfterBad = B.strain;
  for (let m = 0; m < 200; m++) P.tick(B, { terms: good, dtMin: 1, housingFree: 5000, liveable: live });
  return { shortSpell, longSpell, strainAfterBad: Math.round(strainAfterBad), strainRecovered: Math.round(B.strain) };
}, MOD);

/* ══ 5 · a disaster fades ══════════════════════════════════════════════════ */
out.disaster = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  const good = { housing: .9, food: .9, water: .9, safety: .9, power: .9, healthcare: .9,
                 jobs: .8, affordability: .8, wages: .7, education: .7, crime: .8,
                 transport: .7, entertainment: .6, environment: .7, economy: .7 };
  const live = { water: 1, food: 1, power: 1, safety: 1 };
  const S = P.create(300);
  const before = P.score(good).score;
  P.shock(S, 1);
  const hit = P.score(good, { shock: S.shock }).score;
  for (let m = 0; m < 60; m++) P.tick(S, { terms: good, dtMin: 1, housingFree: 9000, liveable: live });
  const after = P.score(good, { shock: S.shock }).score;
  return { before, hit, after, shockLeft: Math.round(S.shock * 10) / 10 };
}, MOD);

/* ══ 6 · children have to grow up ══════════════════════════════════════════ */
out.ageing = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  const S = P.create(1000);
  /* put everyone in the cradle and see who can work */
  S.stages = { baby: 1000, child: 0, teen: 0, young: 0, adult: 0, elder: 0 };
  const workersAt = (st) => P.WORKING_STAGES.reduce((a, k) => a + (st[k] || 0), 0);
  const w0 = workersAt(S.stages);
  P.age(S, 3);                      // three years: babies become children
  const w3 = workersAt(S.stages);
  P.age(S, 12);                     // …and children are teenagers, not workers
  const w15 = workersAt(S.stages);
  P.age(S, 12);                     // now some are of working age
  const w27 = workersAt(S.stages);
  return { w0: Math.round(w0), w3: Math.round(w3), w15: Math.round(w15), w27: Math.round(w27),
           stages: Object.fromEntries(Object.entries(S.stages).map(([k, v]) => [k, Math.round(v)])) };
}, MOD);

/* ══ 7 · save / load ═══════════════════════════════════════════════════════ */
out.persist = await pg.evaluate(async (mod) => {
  const P = (await import(mod)).default;
  const good = { housing: .9, food: .9, water: .9, safety: .9, power: .9, healthcare: .9 };
  const live = { water: 1, food: 1, power: 1, safety: 1 };
  const S = P.create(150);
  const start = S.pop;
  for (let m = 0; m < 600; m++) P.tick(S, { terms: good, dtMin: 1, housingFree: 9000, liveable: live });
  const before = P.audit(S, start);
  const blob = JSON.parse(JSON.stringify(P.save(S)));
  const S2 = P.load(blob, 1);
  const after = P.audit(S2, start);
  return { before, after,
    same: before.actual === after.actual && before.births === after.births
       && before.immigration === after.immigration && before.deaths === after.deaths
       && before.emigration === after.emigration && after.ok };
}, MOD);

/* ══ 8 · the city itself, wired up ═════════════════════════════════════════ */
out.city = await pg.evaluate(() => {
  const N = window.__nc.jobfair;
  const o = { have: !!(N.population && N.population.ready && N.population.ready()) };
  if (!o.have) return o;
  o.terms = N.population.terms();
  o.termCount = Object.keys(o.terms).filter((k) => Number.isFinite(o.terms[k])).length;
  const sc = N.population.score();
  o.score = sc ? sc.score : null;
  o.band = (N.population.band() || {}).name;
  o.caps = N.population.caps();
  o.bottlenecks = N.population.bottlenecks();
  /* 🔴 RUN THE CITY'S OWN INSTANCE FORWARD and audit THAT — the model passing
     in isolation is not the same claim as the city keeping its books. */
  o.audit = N.population.sim(2000, 2);
  o.dash = (N.population.dashHtml() || '').length;
  o.dashHasLedger = /Where the number came from/.test(N.population.dashHtml() || '');
  o.dashHasWhy = /Why people/.test(N.population.dashHtml() || '');
  return o;
});

/* ══ 🏠 THE HOUSEHOLD LAYER ════════════════════════════════════════════════
   population.js guarantees the head-count is the sum of four counted flows.
   households.js has to guarantee that every one of those people is SOMEWHERE
   — in a household with an address, or explicitly homeless. A household layer
   that drifted from the ledger would be worse than none, because the
   dashboard would show the demographics of a city that does not exist.
   🔴 IT BROKE THE FIRST TIME BY EXACTLY THE HOMELESS COUNT — 2, 92 and 3
      across three housing markets — because unhoused people were counted both
      in their household's size AND in a separate homeless tally. A
      discrepancy that tracks one quantity IS that quantity, counted twice.
      Homelessness is derived from the households now, not stored beside them. */
out.households = await pg.evaluate(async (mods) => {
  const P = (await import(mods.pop)).default;
  const H = (await import(mods.hh)).default;
  let seed = 20260901;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  H.seed(rng);
  const terms = { housing: .5, food: .9, water: .9, safety: .85, power: .9, healthcare: .8,
                  jobs: .8, affordability: .5, wages: .6, education: .6, crime: .8,
                  transport: .6, entertainment: .5, environment: .6, economy: .7 };
  const run = (stock, mins) => {
    const S = P.create(120), HS = H.create();
    HS.tail.people = S.pop; HS.tail.housed = S.pop;
    for (let m = 0; m < (mins || 2600); m++) {
      const rep = P.tick(S, { terms, dtMin: 1, housingFree: 99999, rng,
        liveable: { water: .9, food: .9, power: .9, safety: .9 } });
      H.sync(HS, { arrived: rep.births + rep.immigration, left: rep.deaths + rep.emigration,
        stock, pop: S.pop, eduLevel: 0.6, shape: P.HOUSEHOLDS[Math.floor(rng() * P.HOUSEHOLDS.length)] });
      H.tick(HS, { stock, pop: S.pop, dtMin: 1, terms, threat: 0 });
    }
    const a = H.audit(HS, S.pop);
    const M = H.market(HS, stock, S.pop);
    const tiers = {};
    for (const h of HS.list) tiers[h.home || 'homeless'] = (tiers[h.home || 'homeless'] || 0) + 1;
    return { pop: S.pop, audit: a, market: M, tiers, moves: HS.moves, evictions: HS.evictions,
             traits: new Set(HS.list.map((h) => h.trait)).size,
             careers: new Set(HS.list.map((h) => h.career)).size,
             edus: new Set(HS.list.map((h) => h.edu)).size };
  };
  const o = {};
  o.plenty = run({ house: 30, apartment: 4, aptblock: 2, apttower: 1, highrise: 0 });
  o.scarce = run({ house: 5, apartment: 0, aptblock: 0, apttower: 0, highrise: 0 });
  /* 🔴 THE CASE THE ASK NAMES: "Poor NPCs should not automatically occupy
     expensive housing." A city of nothing but high-rises has thousands of
     empty beds AND people sleeping rough, because they cannot pay for them. */
  o.luxury = run({ house: 0, apartment: 0, aptblock: 0, apttower: 0, highrise: 6 });

  /* 🚸 REFUGEES (§15) — offered, costed, and answerable three ways. */
  const RS = H.create();
  const offer = H.offerRefugees(RS, 137, { at: 0 });
  o.refugee = { text: offer.text, needs: offer.needs };
  o.refAll = H.decideRefugees(RS, 'all');
  H.offerRefugees(RS, 137);
  o.refSome = H.decideRefugees(RS, 'some', 50);
  H.offerRefugees(RS, 137);
  o.refNone = H.decideRefugees(RS, 'none');
  o.refCleared = RS.refugees === null;

  /* 💾 save / load keeps the households AND the invariant */
  const S2 = P.create(200), HS2 = H.create();
  HS2.tail.people = S2.pop; HS2.tail.housed = S2.pop;
  const stock2 = { house: 40, apartment: 4, aptblock: 1, apttower: 0, highrise: 0 };
  for (let m = 0; m < 900; m++) {
    const rep = P.tick(S2, { terms, dtMin: 1, housingFree: 99999, rng, liveable: { water: .9, food: .9, power: .9, safety: .9 } });
    H.sync(HS2, { arrived: rep.births + rep.immigration, left: rep.deaths + rep.emigration, stock: stock2, pop: S2.pop, eduLevel: .6, shape: P.HOUSEHOLDS[0] });
    H.tick(HS2, { stock: stock2, pop: S2.pop, dtMin: 1, terms, threat: 0 });
  }
  const beforeSave = H.audit(HS2, S2.pop);
  const HS3 = H.load(JSON.parse(JSON.stringify(H.save(HS2))));
  const afterLoad = H.audit(HS3, S2.pop);
  o.persist = { before: beforeSave, after: afterLoad,
                same: beforeSave.tracked === afterLoad.tracked && afterLoad.ok === true };
  return o;
}, { pop: MOD, hh: '/src/city/households.js' });

/* ══ …and the CITY's own household books ══════════════════════════════════ */
out.cityHH = await pg.evaluate(() => {
  const N = window.__nc.jobfair.population;
  if (!N.hhReady || !N.hhReady()) return { have: false };
  const o = { have: true, stock: N.hhStock(), market: N.hhMarket(), audit: N.hhAudit() };
  /* 🚸 accepting refugees must go through the LEDGER — an immigration flow,
     not people appearing from nowhere. */
  const before = N.audit();
  N.hhRefugees(60);
  const took = N.hhAccept('some', 25);
  const after = N.audit();
  o.took = took;
  o.immigrationRose = after.immigration - before.immigration;
  o.stillBalances = after.ok === true && after.discrepancy === 0;
  o.hhStillBalances = N.hhAudit().ok === true;
  return o;
});

await pg.close();

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const MD = out.model || {}, W = out.weights || {}, G = out.gates || {}, PA = out.patience || {},
      DZ = out.disaster || {}, AG = out.ageing || {}, PE = out.persist || {}, CY = out.city || {};
const A = MD.audit || {};

/* ── the headline ─────────────────────────────────────────────────────────── */
need('SETUP: three simulated days actually moved people',
     (A.births + A.immigration + A.deaths + A.emigration) > 50, A);
need('🔴 THE ASK: births + immigration − deaths − emigration = the population, EXACTLY',
     A.ok === true && A.discrepancy === 0, A);
need('🔴 …and every flow is a whole number of people', MD.integral === true, MD.integral);
need('a good city grows…', MD.grew === true, MD.marks);
need('…and a collapsing one shrinks', MD.fell === true, MD.marks);

/* ── the weights ──────────────────────────────────────────────────────────── */
need('THE ASK: necessities outweigh comforts, and not narrowly',
     (W.needTotal || 0) >= (W.funTotal || 0) * 5, { needs: W.needTotal, comforts: W.funTotal });
need('🔴 …so every comfort and no necessity is an unliveable city',
     (W.comfortsOnly || 99) < 15, W.comfortsOnly);
need('…and necessities alone are already a good place to live',
     (W.needsOnly || 0) > 85, W.needsOnly);
need('🔴 a term the city cannot measure is ABSENT, not scored zero',
     W.absentScore === 100 && W.zeroScore < 100 && W.absentMeasured < W.zeroMeasured, W);
need('the six bands read in order', JSON.stringify(W.bandAt) ===
     JSON.stringify(['booming', 'growing', 'stable', 'stagnating', 'declining', 'crisis']), W.bandAt);

/* ── the gates ────────────────────────────────────────────────────────────── */
need('SETUP: a desirable city with beds does take people', (G.open || {}).imm > 0, G.open);
need('🔴 THE ASK: perfect attraction with NO HOUSING brings nobody',
     (G.noHousing || {}).imm === 0 && (G.noHousing || {}).blocked === 'housing', G.noHousing);
need('🔴 …with no water, nobody', (G.noWater || {}).imm === 0 && (G.noWater || {}).blocked === 'water', G.noWater);
need('🔴 …with no power, nobody', (G.noPower || {}).imm === 0 && (G.noPower || {}).blocked === 'power', G.noPower);
need('🔴 …and nowhere unsafe, nobody', (G.unsafe || {}).imm === 0 && (G.unsafe || {}).blocked === 'safety', G.unsafe);
need('…and arrivals never exceed the beds that exist', (G.twoBeds || {}).imm <= 2, G.twoBeds);

/* ── patience ─────────────────────────────────────────────────────────────── */
need('🔴 THE ASK: nobody leaves over one bad spell', (PA.shortSpell || 0) === 0, PA);
need('…but a long one empties the town', (PA.longSpell || 0) > 0, PA);
/* ⚠ NOT  — a fully recovered city has strain 0, which is falsy, so the
   fallback fired and the assertion compared 99 against 53 and failed on a city
   that had recovered perfectly. */
need('…and patience returns once things are put right',
     Number(PA.strainRecovered) < Number(PA.strainAfterBad), PA);

/* ── disasters ────────────────────────────────────────────────────────────── */
need('THE ASK: a disaster hits attraction hard', (DZ.hit || 99) <= (DZ.before || 0) - 20, DZ);
need('🔴 …and FADES rather than scarring the city permanently',
     (DZ.after || 0) > (DZ.hit || 0) + 15 && (DZ.shockLeft || 99) < 2, DZ);

/* ── ageing ───────────────────────────────────────────────────────────────── */
need('SETUP: a city of babies has no workers', AG.w0 === 0, AG);
need('🔴 THE ASK: children do not become workers by appearing', AG.w3 === 0 && AG.w15 === 0, AG);
need('…they have to grow up first', (AG.w27 || 0) > 0, AG);

/* ── persistence ──────────────────────────────────────────────────────────── */
need('THE ASK: the whole ledger survives a save and reload', PE.same === true, PE);

/* ── and the city keeps its own books ─────────────────────────────────────── */
need('SETUP: the city mounted the simulation', CY.have === true, CY.have);
need('…and measures real terms off its own state', (CY.termCount || 0) >= 6, { count: CY.termCount, terms: CY.terms });
need('…and reports a score and a band', Number.isFinite(CY.score) && !!CY.band, { score: CY.score, band: CY.band });
need('🔴 THE CITY\'S OWN LEDGER BALANCES after 2,000 simulated minutes',
     !!(CY.audit && CY.audit.ok === true && CY.audit.discrepancy === 0), CY.audit);
need('THE ASK: bottlenecks name what runs out first', !!(CY.bottlenecks && CY.bottlenecks.list.length), CY.bottlenecks);
need('THE ASK: the dashboard shows the ledger', CY.dashHasLedger === true, CY.dashHasLedger);
need('…and why people come and go', CY.dashHasWhy === true, CY.dashHasWhy);

/* ── 🏠 the household layer ───────────────────────────────────────────────── */
const HHo = out.households || {}, CH = out.cityHH || {};
for (const key of ['plenty', 'scarce', 'luxury']) {
  const r = HHo[key] || {};
  need('🔴 THE SECOND INVARIANT holds — everybody is in a household or homeless (' + key + ')',
       !!(r.audit && r.audit.ok === true && r.audit.discrepancy === 0), r.audit);
}
need('THE ASK: households have varied traits, careers and schooling',
     (HHo.plenty || {}).traits >= 3 && (HHo.plenty || {}).careers >= 2 && (HHo.plenty || {}).edus >= 2, HHo.plenty);
need('THE ASK: a city with room houses its people', ((HHo.plenty || {}).audit || {}).homeless <= 5, (HHo.plenty || {}).audit);
need('…and families prefer HOUSES to apartment blocks when both are available',
     ((HHo.plenty || {}).tiers || {}).house > (((HHo.plenty || {}).tiers || {}).apttower || 0), (HHo.plenty || {}).tiers);
need('🔴 THE ASK: a city with no beds leaves people homeless',
     ((HHo.scarce || {}).audit || {}).homeless > 20, (HHo.scarce || {}).audit);
need('…and the rent goes UP when housing is scarce',
     ((HHo.scarce || {}).market || {}).rentMul >= 2, (HHo.scarce || {}).market);
need('…and DOWN when there is a surplus',
     ((HHo.plenty || {}).market || {}).rentMul <= 0.8, (HHo.plenty || {}).market);
need('🔴 THE ASK: poor households do NOT occupy expensive housing —',
     ((HHo.luxury || {}).market || {}).vacant > 100 && ((HHo.luxury || {}).audit || {}).homeless > 20,
     { vacant: ((HHo.luxury || {}).market || {}).vacant, homeless: ((HHo.luxury || {}).audit || {}).homeless });

need('🚸 THE ASK: refugees arrive with a number and a stated cost',
     /survivors have arrived/.test(((HHo.refugee || {}).text) || '') && !!(HHo.refugee || {}).needs, HHo.refugee);
need('…Accept All takes everybody', (HHo.refAll || {}).taken === 137, HHo.refAll);
need('…Accept Some takes the number given', (HHo.refSome || {}).taken === 50 && (HHo.refSome || {}).turned === 87, HHo.refSome);
need('…and Reject takes nobody', (HHo.refNone || {}).taken === 0, HHo.refNone);
need('…and the offer is cleared either way', HHo.refCleared === true, HHo.refCleared);
need('THE ASK: households survive a save and reload', (HHo.persist || {}).same === true, HHo.persist);

need('SETUP: the city mounted the household layer', CH.have === true, CH.have);
need('…and reads its housing stock off the buildings', !!CH.stock, CH.stock);
need('🔴 THE CITY\'S household books balance', !!(CH.audit && CH.audit.ok === true), CH.audit);
need('🚸 accepting refugees goes through the LEDGER as immigration',
     (CH.immigrationRose || 0) === ((CH.took || {}).taken || -1), CH);
need('🔴 …and BOTH ledgers still balance afterwards',
     CH.stillBalances === true && CH.hhStillBalances === true, CH);

/* ── 🏢 the density ladder ────────────────────────────────────────────────── */
const LD = out.ladder || {};
need('SETUP: the housing ladder has all five rungs', (LD.tiers || 0) === 5, LD.tiers);
need('🔴 THE ASK: every housing tier is a building the city can actually BUILD',
     LD.allExist === true, LD.rows);
need('🔴 …and both files agree how many people fit in it',
     LD.allAgree === true, LD.rows);
need('THE ASK: higher density demands stronger infrastructure',
     LD.powerClimbs === true, (LD.rows || []).map((r) => r.build + ':' + r.power));

need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 1).slice(0, 6000));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — every resident is accounted for: births + immigration − deaths − emigration = the population, exactly.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
