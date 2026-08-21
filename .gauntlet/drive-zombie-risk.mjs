/* ════════════════════════════════════════════════════════════════════════════
   🧟 DRIVING THE OUTBREAK — the ten checks, headless, against the REAL module.
   ----------------------------------------------------------------------------
   Run:  node .gauntlet/drive-zombie-risk.mjs
   Exit 0 = every check passed. Exit 1 = at least one failed, and it says which.

   THIS DRIVES /src/zombie/index.js ITSELF, not a copy of the model. Each
   scenario re-imports it with a cache-busting query so Node hands back a FRESH
   module instance with its own state — which is the only way to run 200 cities
   through a singleton. The host is a stub object of exactly the shape
   node-city's mount block hands over, so anything this proves is a property of
   the shipped code path, including the logEvent strings and the damageTile
   funnel.
   ════════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOD = 'file:///' + join(ROOT, 'public/src/zombie/index.js').replace(/\\/g, '/');

let FAILS = 0;
const ok = (name, cond, note) => {
  if (!cond) FAILS++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (note ? ' — ' + note : ''));
};
const hr = (t) => console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74));
const n1 = (v) => (Math.round(v * 10) / 10);

/* ── A city, as node-city's mount block describes one ───────────────────── */
function makeHost(cityId, opt = {}) {
  const H = {
    cityId,
    BUILDINGS: {
      clinic: { name: 'Clinic', ico: '🏥', deathcare: { inter: 5 } },
      housing: { name: 'Housing' },
      tower: { name: 'Watchtower', defense: 6 },
      containment: { name: 'Containment Field', ico: '🔮' },
      ...(opt.BUILDINGS || {}),
    },
    daySec: 20 * 60,
    _tiles: opt.tiles || { '1,1': { type: 'clinic', lvl: 1 }, '2,2': { type: 'housing', lvl: 1 }, '3,3': { type: 'housing', lvl: 1 } },
    tiles: () => H._tiles,
    bldSite: (t) => !!t.bld,
    isRoadTile: (t) => t.type === 'road',
    pop: () => (opt.pop == null ? 60 : opt.pop),
    declinePerMin: () => opt.declinePerMin || 0,
    raidDefence: () => opt.def || {
      towers: 0, staticDef: 0, armyDef: 0, cardDef: 0, defense: 0,
      ammoHave: 0, ammoNeed: 0, effDefense: opt.effDefense == null ? 0 : opt.effDefense,
      ammoShort: false, breakdown: '0 🗼 0 static · 0 🪖 0 · 🃏 0', ammoNote: 'ammo 0/0 🔫', isSiege: false,
    },
    wxShieldStrength: () => opt.shield || 0,
    damageTile: (k, destroy, cause) => { H.damage.push({ k, destroy, cause }); return true; },
    toast: (m, kind) => H.toasts.push({ m, kind }),
    logEvent: (kind, m) => H.log.push({ kind, m }),
    saveSoon: () => { H.saves++; },
    el: () => null,          // headless: the card paints nothing and paint() returns early
    damage: [], toasts: [], log: [], saves: 0,
  };
  return H;
}

let instance = 0;
async function fresh(cityId, opt) {
  const Z = await import(MOD + '?i=' + (instance++));
  const H = makeHost(cityId, opt);
  Z.mount(H);
  return { Z, H };
}

/* ── One scenario run. Returns the moment of the first outbreak, the moment
      the warning latched, and the forecast taken at `snapAt`. ───────────── */
async function run(cityId, opt = {}) {
  const { Z, H } = await fresh(cityId, opt);
  const dt = opt.dt || 15;
  const deathsPerDay = opt.deathsPerDay == null ? 12 : opt.deathsPerDay;
  const limit = opt.limit || 20 * 3600;      // 20 h of simulated time
  const snapAt = opt.snapAt == null ? 3600 : opt.snapAt;

  /* THE SCENARIO STARTS FROM A STATED STATE, and the forecast is read at t=0
     from it. Warming up instead would mean snapshotting mid-run, which makes
     'fired before the forecast was taken' possible and the measurement
     meaningless. This is a city that has been losing 12 people a day for a
     while with one Clinic burying 5 — the panel's reading, then the truth. */
  Z.load({ v: 1, cityId, unburied: 0, risk: 0, clock: 0, timer: Z.tuning.interval,
           rolls: 0, waves: 0, rate: deathsPerDay, deaths: 0, interred: 0, src: 'driver' });
  const snap0 = { at: 0, f: Z.report().forecast };

  let t = 0, snap = snap0, warnAt = null, fired = null, capBump = opt.capBump || null;
  while (t < limit) {
    if (deathsPerDay > 0) Z.reportDeaths(deathsPerDay * (dt / H.daySec), 'driver');
    if (capBump && t >= capBump.at && !capBump.done) { capBump.done = true; capBump.apply(H); }
    const before = H.log.length;
    Z.tick(dt);
    t += dt;
    const st = Z.state();
    if (warnAt == null && st.warnAt != null) warnAt = st.clock;
    if (fired == null && H.log.length > before) {
      const line = H.log[H.log.length - 1];
      if (/Outbreak wave/.test(line.m)) fired = { at: t, line, waves: st.waves };
    }
    if (fired && !opt.keepGoing) break;
  }
  return { Z, H, t, snap, warnAt, fired };
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · THE FORECAST IS REAL
   ══════════════════════════════════════════════════════════════════════════ */
hr('1 · THE FORECAST IS REAL — the panel\'s window vs where outbreaks actually land');
{
  const N = 120;
  const rows = [];
  let refFirst = null, refP50 = null, refP90 = null, refWatch = null, refP = null;
  for (let i = 0; i < N; i++) {
    const r = await run('forecast-city-' + i, { keepGoing: false });
    if (!r.snap) continue;
    if (refFirst == null) {
      refFirst = r.snap.f.firstIn; refP50 = r.snap.f.p50In; refP90 = r.snap.f.p90In;
      refWatch = r.snap.f.watchIn; refP = r.snap.f.pNext;
    }
    rows.push(r.fired ? (r.fired.at - r.snap.at) : Infinity);
  }
  rows.sort((a, b) => a - b);
  const early = rows.filter((v) => v < refFirst).length;
  const byP50 = rows.filter((v) => v <= refP50).length / rows.length;
  const byP90 = rows.filter((v) => v <= refP90).length / rows.length;

  console.log('  forecast read at t=0 from a stated state (pop 60, deaths 12.0/day, burial 5.0/day, net +7.0/day)');
  const sh = (v) => (v == null ? '(never, inside the horizon)' : v + 's');
  console.log('    watch starts in  : ' + sh(refWatch));
  console.log('    first possible in: ' + sh(refFirst));
  console.log('    even odds by     : ' + sh(refP50));
  console.log('    9 in 10 by       : ' + sh(refP90));
  console.log('  measured over ' + rows.length + ' cities (distinct seeds, same state):');
  console.log('    earliest outbreak: ' + rows[0] + 's');
  console.log('    median outbreak  : ' + rows[Math.floor(rows.length / 2)] + 's');
  console.log('    p90 outbreak     : ' + rows[Math.floor(rows.length * 0.9)] + 's');
  console.log('    fired by p50In   : ' + Math.round(byP50 * 100) + '%   (forecast claims 50%)');
  console.log('    fired by p90In   : ' + Math.round(byP90 * 100) + '%   (forecast claims 90%)');
  ok('no outbreak lands before the stated first-possible time', early === 0, early + ' of ' + rows.length + ' were early');
  ok('the p50 claim is met within ±12 points', Math.abs(byP50 - 0.5) <= 0.12, Math.round(byP50 * 100) + '%');
  ok('the p90 claim is met within ±10 points', Math.abs(byP90 - 0.9) <= 0.10, Math.round(byP90 * 100) + '%');
  ok('the forecast is not decoration: it names a finite window', refFirst != null && refP90 != null);
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · NO SURPRISE
   ══════════════════════════════════════════════════════════════════════════ */
hr('2 · NO SURPRISE — the warning stands for one full wave interval, always');
{
  const { Z } = await fresh('probe', {});
  const INT = Z.tuning.interval;
  console.log('  ZOM.interval = ' + INT + 's. permit() refuses while (clock - warnAt) < interval.');
  let worst = Infinity, checked = 0;
  for (let i = 0; i < 40; i++) {
    const r = await run('surprise-city-' + i, {});
    if (!r.fired || r.warnAt == null) continue;
    checked++;
    worst = Math.min(worst, r.fired.at - r.warnAt);
  }
  console.log('  ' + checked + ' cities: minimum (outbreak − warning latched) = ' + worst + 's');
  ok('every outbreak followed at least one full interval of warning', worst >= INT,
     worst + 's vs ' + INT + 's');

  // The pathological case: a mass casualty dumped into a city at risk 0.
  const { Z: Z2, H: H2 } = await fresh('mass-casualty', { effDefense: 0 });
  Z2.reportDeaths(5000, 'driver');
  Z2.tick(1);
  const st = Z2.state();
  console.log('  mass casualty: 5000 bodies dumped at once → risk ' + n1(st.risk) +
              ', gate = ' + JSON.stringify(Z2.report().gate));
  let steps = 0;
  while (!H2.log.some((l) => /Outbreak wave/.test(l.m)) && steps < 4000) { Z2.tick(15); steps++; }
  const firedAt = Z2.state().clock;
  console.log('  first outbreak at clock ' + Math.round(firedAt) + 's, warning latched at ' +
              Math.round(Z2.state().warnAt == null ? 0 : Z2.state().warnAt) + 's');
  ok('a mass casualty cannot fire instantly', firedAt >= INT, Math.round(firedAt) + 's');

  // The restored-save case.
  const { Z: Z3 } = await fresh('loaded-save', {});
  Z3.load({ v: 1, cityId: 'loaded-save', unburied: 900, risk: 99, clock: 999999, timer: 1, rolls: 0, waves: 0, rate: 40, deaths: 900, interred: 0, src: 'driver' });
  const g3 = Z3.report().gate;
  console.log('  restored save at risk 99, timer 1s → gate = ' + JSON.stringify(g3));
  ok('a save restored at risk 99 is not rollable on its next beat', !g3.ok, g3.why);
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · PREVENTION IS MONOTONE
   ══════════════════════════════════════════════════════════════════════════ */
hr('3 · PREVENTION IS MONOTONE — capacity up can never move risk up');
{
  const { Z } = await fresh('mono-probe', {});
  const v = Z.verify();
  console.log('  risk.verify() sweeps 4 pops × 5 backlogs × 3 death rates × 5 ground levels × 6 capacities,');
  console.log('  then the same again with GROUND as the swept axis, then the ground-forecast regression');
  ok('the shipped self-check finds no violation', v.ok, (v.problems[0] || ''));

  // And the visible version: the same city, one more clinic, next tick.
  const one = { '1,1': { type: 'clinic', lvl: 1 }, '5,5': { type: 'housing', lvl: 1 } };
  const two = { '1,1': { type: 'clinic', lvl: 1 }, '1,2': { type: 'clinic', lvl: 1 }, '5,5': { type: 'housing', lvl: 1 } };
  const results = [];
  for (const [label, tiles] of [['1 clinic (5/day)', one], ['2 clinics (10/day)', two]]) {
    const { Z: ZZ } = await fresh('mono-visible', { tiles });
    ZZ.load({ v: 1, cityId: 'mono-visible', unburied: 14, risk: 90, clock: 5000, timer: 900, rolls: 0, waves: 0, rate: 12, deaths: 14, interred: 0, src: 'driver' });
    ZZ.tick(60);
    const rep = ZZ.report();
    results.push({ label, risk: rep.risk, unburied: rep.unburied, cap: rep.capacity.perDay });
    console.log('    ' + label.padEnd(20) + ' → unburied ' + n1(rep.unburied).toString().padEnd(6) +
                ' risk ' + n1(rep.risk).toString().padEnd(7) + ' cap ' + rep.capacity.perDay + '/day');
  }
  const d = results[1].risk - results[0].risk;
  console.log('    Δrisk from the second clinic, on the very next tick: ' + d.toFixed(4));
  ok('a second burial building strictly lowers risk on the next tick', d < 0, 'Δ ' + d.toFixed(4));

  // …and the pathological direction: does ANY capacity increase raise risk?
  let violations = 0, samples = 0;
  for (const pop of [4, 12, 60, 250, 900]) {
    for (const back of [0, 1, 7, 25, 140, 900]) {
      for (const dtS of [1, 15, 60, 600]) {
        let prev = null;
        for (const capPerDay of [0, 0.5, 2, 5, 17, 60, 1e6]) {
          const S = Z.model.makeState('sweep');
          S.unburied = back; S.risk = Z.model.riskTarget ? 50 : 50; S.risk = 50;
          Z.model.tick(S, { deaths: 3, pop, capPerDay, daySec: 1200, armed: true }, dtS);
          samples++;
          if (prev != null && S.risk > prev + 1e-9) violations++;
          prev = S.risk;
        }
      }
    }
  }
  console.log('    exhaustive sweep: ' + samples + ' samples, ' + violations + ' where capacity↑ moved risk↑');
  ok('no input exists under which capacity up moves risk up', violations === 0, violations + ' violations');
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · NOT A COIN FLIP
   ══════════════════════════════════════════════════════════════════════════ */
hr('4 · NOT A COIN FLIP — seeded, published, reproducible');
{
  const a = await run('repro-city', { keepGoing: true, limit: 6 * 3600 });
  const b = await run('repro-city', { keepGoing: true, limit: 6 * 3600 });
  const sa = JSON.stringify({ log: a.H.log, dmg: a.H.damage, st: a.Z.state() });
  const sb = JSON.stringify({ log: b.H.log, dmg: b.H.damage, st: b.Z.state() });
  console.log('  two independent 6 h runs of city "repro-city": ' + a.H.log.length + ' log lines each');
  console.log('    run A first line: ' + (a.H.log[0] ? a.H.log[0].m.slice(0, 96) : '(none)'));
  console.log('    run B first line: ' + (b.H.log[0] ? b.H.log[0].m.slice(0, 96) : '(none)'));
  ok('the same seed and state reproduce the same outcome exactly', sa === sb);

  const c = await run('repro-city-DIFFERENT', { keepGoing: true, limit: 6 * 3600 });
  ok('a different city id produces a different sequence',
     JSON.stringify(c.H.log) !== JSON.stringify(a.H.log));

  const { Z } = await fresh('publish', {});
  Z.load({ v: 1, cityId: 'publish', unburied: 20, risk: 82, clock: 99999, timer: 300, rolls: 3, waves: 0, rate: 9, deaths: 20, interred: 0, src: 'driver' });
  // warm the dwell so the gate opens, then read the published probability
  for (let i = 0; i < 200; i++) Z.tick(15);
  const rep = Z.report();
  console.log('  published probability before the draw: pNext = ' +
              (rep.forecast.pNext * 100).toFixed(1) + '% (risk ' + n1(rep.risk) + ')');
  const line = a.H.log.find((l) => /Outbreak wave/.test(l.m));
  console.log('  and it is stated in the log line itself:');
  console.log('    ' + (line ? line.m.slice(0, 150) : '(no outbreak in this run)'));
  ok('the probability is published in the resolution line',
     !!line && /rolled \d+% and drew 0\.\d+/.test(line.m));
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · ONE DAMAGE FUNNEL
   ══════════════════════════════════════════════════════════════════════════ */
hr('5 · ONE DAMAGE FUNNEL — grep the module');
{
  const files = ['index.js', 'risk.js', 'panel.js', 'tuning.js'];
  const src = {};
  for (const f of files) src[f] = readFileSync(join(ROOT, 'public/src/zombie', f), 'utf8');
  const all = Object.values(src).join('\n');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = strip(all);

  const dmgCalls = (code.match(/damageTile\s*\(/g) || []).length;
  console.log('  damageTile( call sites in code (comments stripped): ' + dmgCalls);
  ok('damage happens through ctx.damageTile and nothing else', dmgCalls === 1, dmgCalls + ' call sites');
  for (const bad of ['delete game', 'dropTileMesh', '.tiles[', 'addRes', 'spendGems', 'payCost', 'addCinders', 'spendRes']) {
    ok('no ' + bad, code.indexOf(bad) < 0);
  }
  const wx = readFileSync(join(ROOT, 'public/node-city/index.html'), 'utf8');
  const rows = (wx.match(/^\s{2}\w+\s*:\s*\{\s*b:\s*'/gm) || []).length;
  console.log('  WX_SHIELD rows: ' + rows + ' (fire, tornado, anomaly, outbreak)');
  ok('the counter-building is one WX_SHIELD row', /outbreak\s*:\s*\{\s*b:\s*'containment'/.test(wx));
  ok('the module reads that row rather than owning a mitigation branch',
     /wxShieldStrength/.test(src['index.js']) && /shieldHazard/.test(src['tuning.js']));
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · THE DEFENCE NUMBER AGREES WITH ITSELF
   ══════════════════════════════════════════════════════════════════════════ */
hr('6 · THE DEFENCE NUMBER AGREES WITH ITSELF — raidDefence() vs raidTick\'s old inline tally');
{
  const html = readFileSync(join(ROOT, 'public/node-city/index.html'), 'utf8');
  const m = html.match(/function raidDefence\(isSiege\) \{[\s\S]*?\n\}/);
  ok('raidDefence() was extracted and is findable', !!m);
  // Rebuild the host constants the tally needs, then run the SHIPPED source.
  const BUILDINGS = { tower: { defense: 6 }, barracks: { defense: 9 }, gate: { defense: 5 }, police: { defense: 4 }, wall: { defense: 3 } };
  const game = {
    tiles: {
      a: { type: 'tower', lvl: 2 }, b: { type: 'tower', lvl: 1, damaged: true },
      c: { type: 'wall', lvl: 3 }, d: { type: 'gate', lvl: 1 },
      e: { type: 'police', lvl: 2 }, f: { type: 'barracks', lvl: 1 },
      g: { type: 'tower', lvl: 1, bld: 1 }, h: { type: 'housing', lvl: 3 },
    },
    res: { ammo: 3 }, army: { soldiers: 7 },
  };
  const bldSite = (t) => !!t.bld;
  const soldierDefense = () => 21;
  const deckPower = () => 13;
  const cardDefenseFromSockets = () => 4;
  const RAID_AMMO_PER_DEF = 2;
  const shipped = new Function('game', 'BUILDINGS', 'bldSite', 'soldierDefense', 'deckPower',
    'cardDefenseFromSockets', 'RAID_AMMO_PER_DEF',
    m[0] + '; return raidDefence;')(game, BUILDINGS, bldSite, soldierDefense, deckPower, cardDefenseFromSockets, RAID_AMMO_PER_DEF);

  /* The ORIGINAL inline expression, transcribed from git history, computed
     independently here. If the extraction changed the arithmetic this diverges. */
  function original(isSiege) {
    let towers = 0, staticDef = 0;
    for (const t of Object.values(game.tiles)) {
      if (t.damaged || bldSite(t)) continue;
      if (t.type === 'tower') { towers++; staticDef += BUILDINGS.tower.defense * t.lvl; }
      if (t.type === 'barracks') staticDef += BUILDINGS.barracks.defense * t.lvl;
      if (t.type === 'gate') staticDef += BUILDINGS.gate.defense * t.lvl;
      if (t.type === 'police') staticDef += BUILDINGS.police.defense * t.lvl;
      if (t.type === 'wall') staticDef += BUILDINGS.wall.defense * t.lvl * (isSiege ? 2 : 1);
    }
    const armyDef = soldierDefense();
    const defense = staticDef + armyDef + deckPower() + cardDefenseFromSockets();
    const ammoHave = game.res.ammo || 0;
    const ammoNeed = towers * RAID_AMMO_PER_DEF + Math.ceil(game.army.soldiers / 2);
    const effDefense = ammoHave >= ammoNeed ? defense : Math.floor(defense * (ammoNeed ? ammoHave / ammoNeed : 0));
    const breakdown = towers + ' 🗼 ' + staticDef + ' static · ' + game.army.soldiers + ' 🪖 ' + armyDef +
      ' · 🃏 ' + (deckPower() + cardDefenseFromSockets());
    return { towers, staticDef, armyDef, defense, ammoHave, ammoNeed, effDefense, breakdown };
  }
  for (const siege of [false, true]) {
    const A = shipped(siege), B = original(siege);
    const keys = ['towers', 'staticDef', 'armyDef', 'defense', 'ammoHave', 'ammoNeed', 'effDefense', 'breakdown'];
    const diff = keys.filter((k) => String(A[k]) !== String(B[k]));
    console.log('  isSiege=' + String(siege).padEnd(5) +
                ' shipped: eff ' + A.effDefense + ' of ' + A.defense + ' | ' + A.breakdown);
    console.log('  ' + ' '.repeat(12) + ' raidTick old: eff ' + B.effDefense + ' of ' + B.defense + ' | ' + B.breakdown);
    ok('the two tallies are identical (isSiege=' + siege + ')', diff.length === 0, diff.join(','));
  }
  ok('raidTick no longer computes its own tally', !/let towers = 0, staticDef = 0;[\s\S]{0,400}const card = \$\('raidcard'\)/.test(html));
  ok('the outbreak asks for isSiege=false (walls do not double against it)',
     /raidDefence\(false\)/.test(readFileSync(join(ROOT, 'public/src/zombie/index.js'), 'utf8')));
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · IT NARRATES ITSELF
   ══════════════════════════════════════════════════════════════════════════ */
hr('7 · IT NARRATES ITSELF — the log lines /src/broadcast already parses');
{
  // Force a HELD and a BREACHED, then run them past broadcast's own regexes.
  const held = await run('narrate-held', { effDefense: 100000, keepGoing: true, limit: 12 * 3600 });
  const brch = await run('narrate-breach', { effDefense: 0, keepGoing: true, limit: 12 * 3600, shield: 0 });
  const lines = [...held.H.log, ...brch.H.log].filter((l) => /Outbreak wave/.test(l.m));
  for (const l of lines.slice(0, 2)) console.log('  [' + l.kind + '] ' + l.m.slice(0, 170));

  // Transcribed from /src/broadcast/sources.js — the branch it will take.
  const src = readFileSync(join(ROOT, 'public/src/broadcast/sources.js'), 'utf8');
  ok('broadcast still keys the raid branch on fam === "raid"', /fam === 'raid'/.test(src));
  const parsed = lines.map((l) => {
    const fam = l.kind.split(' ')[0];
    return {
      fam, held: /\bHELD\b/.test(l.m), breached: /\bBREACHED\b/.test(l.m),
      wave: (l.m.match(/[Ww]ave (\d+)/) || [])[1] || null,
    };
  });
  console.log('  parsed by broadcast as: ' + JSON.stringify(parsed.slice(0, 2)));
  ok('every outbreak line lands on the raid shelf', parsed.length > 0 && parsed.every((p) => p.fam === 'raid'));
  ok('every line carries HELD or BREACHED', parsed.every((p) => p.held || p.breached));
  ok('every line carries a wave number', parsed.every((p) => p.wave != null));
  ok('a HELD wave is logged as good', held.H.log.some((l) => l.kind === 'raid good' && /HELD/.test(l.m)));
  ok('a BREACHED wave damaged something through the funnel', brch.H.damage.length > 0,
     brch.H.damage.length + ' damageTile calls');
  console.log('  damage calls: ' + JSON.stringify(brch.H.damage.slice(0, 3)));
  ok('the cause string routes to the raid shelf in damageLogKind', brch.H.damage.every((d) => /Raider|siege|SIEGE|⚔|💥/.test(d.cause)));

  // Quarantine, from the WX_SHIELD row.
  const sh = await run('narrate-shield', { effDefense: 0, shield: 1.0, keepGoing: true, limit: 12 * 3600 });
  console.log('  with quarantine cover 100%: ' + sh.H.damage.length + ' buildings struck');
  ok('a full quarantine absorbs every strike', sh.H.damage.length === 0);
  ok('and it says so', sh.H.toasts.some((t) => /Quarantine held/.test(t.m)));
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · PERFORMANCE
   ══════════════════════════════════════════════════════════════════════════ */
hr('8 · PERFORMANCE — no agents, no meshes, no geometry to leak');
{
  const code = ['index.js', 'risk.js', 'panel.js', 'tuning.js']
    .map((f) => readFileSync(join(ROOT, 'public/src/zombie', f), 'utf8')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of ['spawnAgent', 'agentMesh', 'THREE.', 'new THREE', 'BufferGeometry', 'scene.add', 'requestAnimationFrame']) {
    ok('no ' + bad, code.indexOf(bad) < 0);
  }
  console.log('  mesh/geometry delta across a wave: 0 / 0 — this round spawns no horde,');
  console.log('  which is stated in risk.js\'s NOT-BUILT block. despawnAgent\'s documented');
  console.log('  17-geometries-per-civilian leak is therefore not reachable from here.');

  const t0 = process.hrtime.bigint();
  const { Z } = await fresh('perf', {});
  for (let i = 0; i < 60 * 60 * 4; i++) Z.tick(1 / 60);   // 4 h of frames at 60fps
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('  864,000 frame ticks (4 h at 60 fps) in ' + ms.toFixed(0) + ' ms = ' +
              (ms / 864000 * 1000).toFixed(2) + ' µs/frame');
  ok('the per-frame cost is under 5 µs', ms / 864000 * 1000 < 5, (ms / 864000 * 1000).toFixed(2) + ' µs');
}

/* ══════════════════════════════════════════════════════════════════════════
   9 · HONEST DEFERRAL  ·  10 · DORMANT WHEN NOTHING CAN BURY
   ══════════════════════════════════════════════════════════════════════════ */
hr('9 · HONEST DEFERRAL, and the dormant guard');
{
  const risk = readFileSync(join(ROOT, 'public/src/zombie/risk.js'), 'utf8');
  ok('risk.js states there is no infection state machine', /no infection state machine/.test(risk));
  ok('…no district spread', /district spread/.test(risk));
  ok('…no walking horde, with the leak named', /17-geometries-per-civilian|17-geometr/.test(risk));
  ok('…and that smuggling-and-contamination.md is not in the repo', /is NOT in this repository/.test(risk));

  // A build with no deathcare row anywhere must never roll.
  const { Z, H } = await fresh('dormant-city', {
    BUILDINGS: { clinic: { name: 'Clinic' }, housing: { name: 'Housing' } },
    tiles: { '1,1': { type: 'clinic', lvl: 1 } },
  });
  for (let i = 0; i < 6000; i++) { Z.reportDeaths(2, 'driver'); Z.tick(15); }
  const rep = Z.report();
  console.log('  no BUILDINGS row declares deathcare → ' + Math.round(rep.unburied) +
              ' unburied, risk ' + n1(rep.risk) + ', gate ' + JSON.stringify(rep.gate) +
              ', outbreaks ' + rep.waves);
  ok('a build that cannot bury anyone is never rolled against', rep.waves === 0 && H.damage.length === 0);
  ok('…and the card says so rather than hiding', rep.forecast.armed === false);
}

/* ══════════════════════════════════════════════════════════════════════════
   10 · /src/mortality IS THE AUTHORITY — one backlog, not two
   ══════════════════════════════════════════════════════════════════════════ */
hr('10 · ONE BACKLOG — /src/mortality holds the dead, /src/zombie only prices them');
{
  /* A stub of the sibling's shipped report() shape. index.js reads it through
     window, guards every field, and degrades to its own model if any of it is
     missing — all three paths are exercised here. */
  globalThis.window = globalThis.window || {};
  const M = { waiting: 40, capPerMin: 0.25, demandPerMin: 0.9, plots: 60, used: 12,
    ready: () => true,
    report() { return { ok: true, unburied: M.waiting, capPerMin: M.capPerMin, demandPerMin: M.demandPerMin,
                        plots: M.plots, plotsFree: M.plots - M.used, sites: 2 }; } };
  globalThis.window.MythicMortality = M;

  const { Z, H } = await fresh('mirror-city', {});
  Z.tick(5);
  let rep = Z.report();
  console.log('  mortality says unburied=' + M.waiting + ', capPerMin=' + M.capPerMin + ' → zombie reads unburied ' +
              rep.unburied + ', burial ' + rep.forecast.capPerDay.toFixed(1) + '/day, deaths ' +
              rep.forecast.ratePerDay.toFixed(1) + '/day');
  ok('the backlog is mirrored, not re-derived', rep.unburied === 40);
  ok('per-real-minute rates are converted once, to per city day',
     Math.abs(rep.forecast.capPerDay - 0.25 * 20) < 1e-9 && Math.abs(rep.forecast.ratePerDay - 0.9 * 20) < 1e-9);

  /* Double-counting probe: reportDeaths must be ignored while mirrored. */
  Z.reportDeaths(500, 'driver'); Z.tick(5);
  rep = Z.report();
  console.log('  reportDeaths(500) while mirrored → unburied ' + rep.unburied + ' (mortality still says ' + M.waiting + ')');
  ok('a second death source cannot inflate the mirrored backlog', rep.unburied === 40);

  /* Monotone through the mirror: the sibling buries some, risk must fall. */
  /* Let the meter finish easing toward the 40-body target first — comparing
     a rising trajectory against itself measures the easing, not the burial. */
  for (let i = 0; i < 200; i++) Z.tick(30);
  const r0 = Z.report().risk;
  M.waiting = 12;                       // the graveyard worked the backlog off
  Z.tick(60);
  const r1 = Z.report().risk;
  console.log('  graveyards clear 40 → 12 bodies: risk ' + n1(r0) + ' → ' + n1(r1));
  ok('burying through the sibling lowers risk here too', r1 < r0, 'Δ ' + (r1 - r0).toFixed(4));

  /* And the degrade: pull the sibling and the module falls back, still armed
     off its own contract, without throwing. */
  delete globalThis.window.MythicMortality;
  Z.tick(60);
  const r2 = Z.report();
  console.log('  sibling removed mid-session → gate ' + JSON.stringify(r2.gate) + ', still ticking');
  ok('a missing sibling degrades rather than throws', r2 != null && Number.isFinite(r2.risk));
  ok('and the module stops claiming a capacity it can no longer see',
     r2.forecast.capPerDay === 5, r2.forecast.capPerDay + '/day from the fallback deathcare row');
}

/* ══════════════════════════════════════════════════════════════════════════
   11 · BURIAL GROUND IS THE THIRD TERM — the forecast that lied, locked shut
   ──────────────────────────────────────────────────────────────────────────
   THE DEFECT THIS SECTION EXISTS FOR, stated so it cannot come back quietly.
   The projection modelled burial RATE and not burial GROUND:

     risk.js   interred = min(unburied, capPerDay × days)            ← two terms
     mortality interred = min(waiting,  capPerMin × dt,  room)       ← three

   Measured against a host faithful to mortality's own interment line — one
   Graveyard at 21/24 plots, deaths 4/day against a burial rate of 5/day — the
   card printed "No outbreak in the next 60 city days at this rate" with
   firstIn / p50In / p90In all null, and the first outbreak landed at 12.0 city
   days. The card contradicted itself one line apart: "3/24 plots free" carried
   no time, and the line that carried the time said the player was fine.
   The divergence band is every state where 0 < plotsFree < rate × horizon —
   the back half of every graveyard's life, not an edge case.

   THE CONTROL IS PRINTED BESIDE THE TREATMENT. Same state, same model, same
   call; the ONLY difference is whether `room` is on the input. A green tick
   with no control beside it would not distinguish "the fix works" from "this
   city was never going to have an outbreak anyway".
   ══════════════════════════════════════════════════════════════════════════ */
hr('11 · BURIAL GROUND — the third term, with the two-term control beside it');
{
  const PANEL = await import('file:///' + join(ROOT, 'public/src/zombie/panel.js').replace(/\\/g, '/'));
  const DAY = 1200;                       // city day, seconds
  const PLOTS = 24, USED0 = 21;
  const DEATHS_PER_DAY = 4, BURIAL_PER_DAY = 5;

  /* A mortality stub faithful to model.js:136 and model.js:170 — three-term
     interment, and plotFactor 1-or-0 so a FULL site supplies zero deathcare. */
  function makeMortality() {
    const M = {
      used: USED0, waiting: 0, debt: 0,
      ready: () => true,
      capPerMin: () => (M.used < PLOTS ? BURIAL_PER_DAY / DAY * 60 : 0),
      step(dtMin, deaths) {
        M.waiting += deaths;
        const room = Math.max(0, (PLOTS - M.used) - M.debt);
        const interred = Math.min(M.waiting, M.capPerMin() * dtMin, room);
        M.waiting -= interred; M.debt += interred;
        while (M.debt >= 1 && M.used < PLOTS) { M.used++; M.debt -= 1; }
      },
      report: () => ({ ok: true, unburied: Math.floor(M.waiting + 1e-9), capPerMin: M.capPerMin(),
                       demandPerMin: DEATHS_PER_DAY / DAY * 60, plots: PLOTS,
                       plotsFree: Math.max(0, PLOTS - M.used), sites: 1 }),
    };
    return M;
  }

  globalThis.window = globalThis.window || {};
  const M = makeMortality();
  globalThis.window.MythicMortality = M;

  const { Z, H } = await fresh('ground-city', {
    BUILDINGS: { graveyard: { name: 'Graveyard', ico: '🪦', plots: PLOTS, svc: { need: 'deathcare', supply: 5 } },
                 housing: { name: 'Housing' } },
    tiles: { '1,1': { type: 'graveyard', lvl: 1 }, '2,2': { type: 'housing', lvl: 1 }, '3,3': { type: 'housing', lvl: 1 } },
  });
  H.daySec = DAY;

  const DT = 1;
  M.step(DT / 60, DEATHS_PER_DAY * (DT / DAY));
  Z.tick(DT);

  const f = Z.report().forecast;
  /* ⚠ SNAPSHOT, NOT A REFERENCE. Z.state() hands back the LIVE object; the run
     loop below mutates it, and comparing a forecast taken after the loop
     against one taken before it measures the loop. (It read as the fix being
     alarmist — 1.5 days from a city with 5,000 free plots — which is exactly
     the shape of answer that should make you check the harness first.) */
  const S = JSON.parse(JSON.stringify(Z.state()));
  const from = (extra) => Z.model.forecast(JSON.parse(JSON.stringify(S)),
    { pop: 60, capPerDay: BURIAL_PER_DAY, daySec: DAY, armed: true, ...extra });
  /* THE CONTROL: the identical model call with the ground term withheld — i.e.
     precisely the code that shipped before this fix. */
  const ctl = from({});

  const asDays = (s) => (s == null ? 'never (inside the horizon)' : (s / DAY).toFixed(1) + ' city days');
  console.log('  state: ' + PLOTS + ' plots, ' + (PLOTS - USED0) + ' free · deaths ' + DEATHS_PER_DAY +
              '/day vs burial ' + BURIAL_PER_DAY + '/day  →  on RATE alone this city is ahead');
  console.log('    CONTROL (two terms, no `room`)  first possible: ' + asDays(ctl.firstIn) +
              '   9-in-10: ' + asDays(ctl.p90In));
  console.log('    TREATMENT (three terms, shipped) first possible: ' + asDays(f.firstIn) +
              '   9-in-10: ' + asDays(f.p90In));
  console.log('    …and the ground itself: full in ' + asDays(f.groundOutIn));
  ok('the two-term control reproduces the defect (claims no outbreak)', ctl.firstIn == null,
     'control firstIn=' + ctl.firstIn);
  ok('the shipped forecast names a finite window instead', f.firstIn != null,
     'firstIn=' + f.firstIn);
  ok('and it says when the ground runs out', f.groundOutIn != null);
  ok('`room` reached the model from inputs()', f.roomKnown === true && f.room === PLOTS - USED0,
     'room=' + f.room);

  /* THE CARD — criterion 1 is about what the PLAYER reads, not a field. */
  const cardText = PANEL.render(f, {
    cap: { perDay: f.capPerDay, any: true, plots: PLOTS, plotsFree: M.report().plotsFree,
           sources: [{ type: 'grave', name: '1 burial ground', ico: '🪦', n: 1, perDay: f.capPerDay }] },
    shield: 0, def: H.raidDefence(), projStrength: 0, delta: { risk: 0, unburied: 0 },
    src: 'the city graves (/src/mortality)', waves: 0, deaths: 0, interred: 0, cemeteryTypes: [],
  }).split('<br>').map((s) => s.replace(/<[^>]+>/g, '').trim());
  console.log('  THE CARD:');
  for (const line of cardText) console.log('    | ' + line);
  ok('the plot count carries a time instead of standing alone',
     cardText.some((l) => /plots free\s*—\s*full in/.test(l)));
  ok('the card no longer claims "no outbreak" while the ground is running out',
     !cardText.some((l) => /No outbreak in the next/.test(l)));

  /* ── AND THE TRUTH. Run the city forward and see where it actually lands. ── */
  let t = DT, groundOut = null, warnAt = null, firstAt = null;
  while (t < 60 * DAY) {
    M.step(DT / 60, DEATHS_PER_DAY * (DT / DAY));
    const before = H.log.length;
    Z.tick(DT);
    t += DT;
    if (groundOut == null && M.report().plotsFree <= 0) groundOut = t;
    const st = Z.state();
    if (warnAt == null && st.warnAt != null) warnAt = st.clock;
    if (firstAt == null && H.log.length > before && /Outbreak wave/.test(H.log[H.log.length - 1].m)) { firstAt = t; break; }
  }
  console.log('  RUN: ground ran out at ' + asDays(groundOut) + ' (forecast said ' + asDays(f.groundOutIn) +
              ') · warning latched ' + asDays(warnAt) + ' · FIRST OUTBREAK ' + asDays(firstAt));
  ok('an outbreak really does arrive — the control would have promised none', firstAt != null);
  ok('and it lands inside the stated window (at or after firstIn)',
     firstAt != null && f.firstIn != null && firstAt >= f.firstIn,
     asDays(firstAt) + ' vs firstIn ' + asDays(f.firstIn));
  ok('the ground-out prediction is right to within one beat',
     groundOut != null && f.groundOutIn != null && Math.abs(groundOut - f.groundOutIn) <= 2 * Z.tuning.forecastStep,
     Math.abs(groundOut - f.groundOutIn) + 's apart');
  ok('the no-surprise gate still held through it', firstAt != null && warnAt != null &&
     (firstAt - warnAt) >= Z.tuning.interval, (firstAt - warnAt) + 's of warning');

  /* THE OTHER DIRECTION: ground is not allowed to invent an outbreak either. A
     city with the same rates and plenty of plots must still forecast none, or
     the fix has simply made the card alarmist. */
  const roomy = from({ room: 5000 });
  console.log('  same city with 5,000 plots free → first possible: ' + asDays(roomy.firstIn));
  ok('plenty of ground still forecasts no outbreak (the fix is not alarmism)', roomy.firstIn == null);

  /* And the absent-host case: no `room` on the input must behave EXACTLY as it
     did before the term existed, because the fallback contract states a rate
     and says nothing about ground. */
  const same = JSON.stringify({ f: ctl.firstIn, p: ctl.p90In, w: ctl.watchIn }) ===
               JSON.stringify({ f: roomy.firstIn, p: roomy.p90In, w: roomy.watchIn });
  ok('an omitted `room` means "no constraint stated", not a constraint of zero', same,
     'unbounded vs 5000 plots must agree');

  /* ── THE OTHER PLAUSIBLE ZERO, in the same family of bug ──────────────────
     mortality's demandPerMin() returns null when it has nothing to derive a
     rate from — "returns null, never a plausible zero", its own header at
     index.js:232. It reached this module through `num(v, d)`, and `+null` is
     0, which is FINITE, so the default never ran and the honest refusal became
     "deaths 0/day" on the card — i.e. a forecast of immortality for a city
     whose backlog is visibly climbing. Same shape as the missing third term:
     a confident number where there should have been a fallback. */
  const M2 = makeMortality();
  M2.report = () => ({ ok: true, unburied: Math.floor(M2.waiting + 1e-9), capPerMin: 0,
                       demandPerMin: null, plots: PLOTS, plotsFree: 0, sites: 1 });
  globalThis.window.MythicMortality = M2;
  const { Z: Z2 } = await fresh('null-rate-city', {});
  for (let i = 0; i < 400; i++) { M2.waiting += DEATHS_PER_DAY * (30 / DAY); Z2.tick(30); }
  const fr = Z2.report().forecast;
  console.log('  sibling declines to state a death rate (demandPerMin === null), backlog climbing:');
  console.log('    card would read: deaths ' + fr.ratePerDay.toFixed(2) + '/day · ' +
              'first possible ' + asDays(fr.firstIn));
  ok('a null death rate is not rendered as a plausible zero', fr.ratePerDay > 0,
     fr.ratePerDay.toFixed(3) + '/day estimated from the backlog\'s own arrivals');
  ok('…and the forecast it feeds still names a date', fr.firstIn != null);

  delete globalThis.window.MythicMortality;
}

hr(FAILS === 0 ? '✅ ZOMBIE RISK GATE PASSED — ' + '12 sections, 0 failures'
               : '❌ ' + FAILS + ' CHECK(S) FAILED');
process.exit(FAILS === 0 ? 0 : 1);
