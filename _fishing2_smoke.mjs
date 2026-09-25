/* 🦈 v121v97 — Woods Fishing round 2, driven: the threat meter, sharks that bite the
   hull, harpoon / flee / kill / wreck, boat stats, levels and refits, crew ranks,
   injury and death, weather and the clock, the hold, the tournament seams.

   The round-2 block in index.html is lifted whole into a vm with a stubbed
   engine (_wf3S, _wf3Live, the DOM helpers, the ledger) and a scripted trip is
   run through it. Nothing here reads a screenshot.

   Run: node _fishing2_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const SQL = readFileSync('./sql/127_fishing_records.sql', 'utf8');

const b0 = SRC.indexOf('const WF3_THREATS = [');
const b1 = SRC.indexOf("const WF3_FISH_TIERS = ['Common', 'Uncommon', 'Rare', 'Legendary'];", b0);
ok(b0 > 0 && b1 > b0, 'the round-2 block is where expected');
const BLOCK = SRC.slice(b0, b1);
const CLASSES = SRC.slice(SRC.indexOf('const WF_BOAT_CLASSES = ['), SRC.indexOf('\n];', SRC.indexOf('const WF_BOAT_CLASSES = [')) + 3);

function world(opts) {
  opts = opts || {};
  const salvage = {}; const logs = []; const flashes = []; const toasts = [];
  const boat = Object.assign({ id: 'b1', name: 'Tin Gull', classId: opts.classId || 'trawler', hull: 80, hullMax: 80, status: 'docked', xp: opts.xp | 0, mods: opts.mods || [] }, opts.boat || {});
  const crew = opts.crew || [{ id: 'c1', firstName: 'Mara', lastName: 'Voss', skill: 5, luck: 4, exp: opts.crewExp | 0, fear: 0, traits: opts.traits || [], status: 'idle' }];
  const f = { boats: [boat], crew, dockSlots: [], live: { currentBiome: opts.biome || 'reef', level: opts.level || 3 } };
  const els = {};
  const el = (id) => els[id] || (els[id] = { textContent: '', innerHTML: '', style: {}, onclick: null, querySelector: () => ({ onclick: null }), appendChild: () => {} });
  const ctx = {
    WF_BOAT_CLASSES: null, Profile: { gems: 100000, cloud: { signedIn: false } }, App: { screen: 'woodsFishing' },
    ensureFishingCorp: () => f, _wf3Live: () => f.live, _wf3Biome: () => ({ name: f.live.currentBiome }),
    _wfLog: (lv, m) => logs.push(lv + ': ' + m), _wf3FlashLog: (m) => flashes.push(m), showToast: (m) => toasts.push(m),
    _wf3$: (id) => el(id), _wf3SetPrompt: () => {}, _wf3ResetToIdle: () => { if (ctx.S) ctx.S.state = 'IDLE'; }, _wf3RecordCatch: () => {},
    _wf3Clamp: (v, a, b) => Math.max(a, Math.min(b, v)), escapeHtml: (s) => String(s), _meta: (id) => ({ name: id }),
    addSalvage: (b) => { for (const k in b) salvage[k] = (salvage[k] || 0) + b[k]; }, addRes: (id, n) => { salvage[id] = (salvage[id] || 0) + n; }, cxProduce: () => {},
    spendResources: () => true, spendCinders: (n) => { ctx.Profile.gems -= n; return true; }, saveProfile: () => {}, render: () => {},
    _wf3GoToBattle: (r) => { ctx.App._fishingEncounterPending = { enemyName: r.name }; ctx.fought = r; }, WF3_RARITY_COLOR: {},
    Cloud: null, document: { querySelector: () => null, getElementById: () => null, createElement: () => ({ innerHTML: '', firstChild: {} }), body: { appendChild: () => {} }, querySelectorAll: () => [] },
    Math: Object.assign(Object.create(Math), { random: () => (opts.rnd != null ? opts.rnd : 0.5) }), Date, Number, Object, String, Array, console,
    salvage, logs, flashes, toasts, f, boat,
  };
  vm.createContext(ctx);
  vm.runInContext(CLASSES + '\n' + BLOCK + '\nthis.X = { init: _wf3ExpansionInit, onCast: _wf3ThreatOnCast, tick: _wf3ThreatTick, bite: _wf3Bite, harpoon: _wf3Harpoon, flee: _wf3Flee, fight: _wf3FightAttacker, kill: _wf3KillAttacker, wreck: _wf3Wreck, onCatch: _wf3ExpOnCatch, onClose: _wf3ExpOnClose, stats: _wfBoatStats, level: _wfBoatLevel, slots: _wfBoatSlots, gain: _wfBoatGainXp, install: _wfInstallMod, rank: _wfCrewRank, hurt: _wfCrewHurt, expHurt: _wfExpCrewHurt, deckhand: _wf3PickDeckhand, weather: _wf3RollWeather, odds: _wf3AttackerEscapeOdds, submit: _wfTourneySubmit, week: _wfTourneyWeek };', ctx);
  return ctx;
}
function trip(ctx, extra) {
  const S = Object.assign({ state: 'IDLE', castsLeft: 12, G: null }, ctx.X.init(ctx.boat), extra || {});
  vm.runInContext('_wf3S = null;', ctx);   // the block reads the engine's global; hand it ours
  ctx._wf3S = S; ctx.S = S;
  vm.runInContext('var _wf3S = this._wf3S;', ctx);
  return S;
}

/* ── 1. boat stats, levels, refits ──────────────────────────────────────── */
{
  const w = world({ classId: 'armored', xp: 0 });
  let st = w.X.stats(w.boat);
  ok(st.armor === 0.45 && st.level === 1 && st.slots === 0 && st.ammo === 4, 'an Armored Fishing Vessel: 45% armour, level 1, no slots, 4 harpoons');
  ok(w.X.slots(1) === 0 && w.X.slots(2) === 1 && w.X.slots(4) === 2 && w.X.slots(6) === 3, 'refit slots open at L2 / L4 / L6');
  w.X.gain(w.boat, 250);
  ok(w.X.level(w.boat) === 3 && w.logs.some((l) => /boat level 3/.test(l)), '250 XP is boat level 3, and the level-up is logged');
  ok(w.X.install('b1', 'hull') === true && w.boat.mods.join() === 'hull', 'a Reinforced Hull fits into the open slot (Cinder and metal charged)');
  st = w.X.stats(w.boat);
  ok(Math.abs(st.armor - 0.65) < 1e-9, '…and armour is now 65%');
  ok(w.X.install('b1', 'sonar') === false && /No free refit slot/.test(w.toasts[w.toasts.length - 1]), 'a second mod needs a second slot (level 4)');
  ok(w.X.install('b1', 'hull') === false, 'the same mod cannot be fitted twice');
  const w2 = world({ classId: 'skiff', xp: 600, mods: ['harpoon', 'sonar', 'pumps'] });
  st = w2.X.stats(w2.boat);
  ok(st.level === 7 && st.ammo === 7 && st.hit === 10 && st.sonar === 2 && Math.abs(st.stability - 0.25) < 1e-9, 'three mods on a level-7 skiff: 7 harpoons, +10% to hit, sonar 2 (a skiff has none of its own), stability 25%');
}

/* ── 2. crew ranks, injury and death ────────────────────────────────────── */
{
  const w = world({ rnd: 0.95 });
  const c = w.f.crew[0];
  ok(w.X.rank({ exp: 0 }).name === 'Deckhand' && w.X.rank({ exp: 120 }).name === 'Mate' && w.X.rank({ exp: 700 }).name === 'Captain', 'ranks: Deckhand → Mate at 120 → Captain at 700');
  ok(w.X.hurt(c, 30, 'test') === false && c.health === 70, 'a hurt crewman loses health and lives');
  ok(w.X.hurt(c, 100, 'a bad expedition') === true && w.f.crew.length === 0 && w.logs.some((l) => /☠ Mara Voss/.test(l)), 'at health 0 with a bad roll (0.95 > 0.70) he is lost, removed from the roster and logged');
  const w3 = world({ rnd: 0.85, traits: ['veteran'] });
  const c3 = w3.f.crew[0];
  ok(w3.X.hurt(c3, 200, 'a shark') === false && c3.health === 25 && w3.f.crew.length === 1, 'a veteran survives the same roll (0.85 < 0.90) and is laid up at 25');
  const w4 = world({ rnd: 0.5 });
  w4.X.expHurt(w4.f.crew, 0, 2, w4.boat);
  ok(w4.f.crew[0].exp === 12 && w4.boat.xp === 31, 'a clean expedition pays crew exp (6 + 3×danger) and boat XP (15 + 8×danger)');
}

/* ── 3. a scripted trip: the meter, a shark, bites, harpoon, kill ───────── */
{
  const w = world({ classId: 'trawler', rnd: 0.5, level: 5, biome: 'reef' });
  const S = trip(w);
  ok(S.hull === 80 && S.hullMax === 80 && S.harpoons === 4 && S.threat === 0 && S.attacker === null && S.holdCap === 60, 'a trip opens with the boat\'s hull, 4 harpoons, threat 0 and a 60-unit hold');
  ok(S.weather && S.weather.id && typeof S.night === 'boolean', 'weather and the clock are rolled');
  ok(S.deckhandName === 'Mara Voss', 'the best idle crewman ships as deckhand');
  let casts = 0;
  while (!S.attacker && casts < 40) { w.X.onCast(); casts++; }
  ok(S.attacker && casts >= 6 && casts <= 20, 'the meter fills over several casts and something surfaces', casts + ' casts, threat ' + S.threat.toFixed(0));
  ok(w.flashes.some((m) => /surfaces/.test(m)), '…and the player is told');
  const def = S.attacker.def; const hull0 = S.hull;
  w.X.bite();
  const soaked = Math.round(def.bite * (1 - 0.15));
  ok(S.hull === hull0 - soaked && soaked < def.bite, 'a bite is soaked by the trawler\'s 15% armour', def.bite + ' → ' + soaked);
  const hp0 = S.attacker.hp; w.X.harpoon();
  ok(S.harpoons === 3, 'a harpoon shot spends ammo');
  w.Math.random = () => 0.01;
  while (S.attacker) { w.X.harpoon(); if (S.harpoons <= 0 && S.attacker) break; }
  ok(!S.attacker && (w.salvage.monsterParts | 0) >= def.parts[0] && S.kills === 1 && S.threat === 20, 'sure shots kill it: Leviathan Parts drop, the meter resets low, a kill is counted', JSON.stringify(w.salvage));
  ok(w.boat.xp >= def.hp, 'the boat earns XP for the kill');
  /* the hold */
  const c0 = S.castsLeft; w.X.onCatch({ rarity: 'Common', amount: 20, item: { name: 'Ashfin' } }, { freshFish: 20 });
  ok(S.hold === 20 && S.castsLeft === c0, 'a catch fills the hold');
  w.X.onCatch({ rarity: 'Rare', amount: 45, item: { name: 'Emberjaw' } }, { primeSeafood: 45 });
  ok(S.hold === 65 && S.castsLeft === 0 && w.flashes.some((m) => /Hold full/.test(m)), 'a full hold ends the trip');
  ok(w.f.live.records && Object.keys(w.f.live.records).length === 1, 'the heaviest catch is weighed for the tournament');
  w.X.onClose();
  ok(w.boat.hull === S.hull && w.boat.status === 'docked' && w.f.crew[0].exp >= 10, 'closing writes the hull back to the boat and pays the deckhand');
}

/* ── 4. flee, and the wreck ─────────────────────────────────────────────── */
{
  const w = world({ classId: 'speed', rnd: 0.5 });
  const S = trip(w); S.threat = 100; vm.runInContext('_wf3SpawnAttacker()', w);
  ok(!!S.attacker, 'an attacker is up');
  const odds = w.X.odds();
  ok(odds > 0.7, 'a Speed Boat has good odds of getting away', odds.toFixed(2));
  w.Math.random = () => 0.1; w.X.flee();
  ok(!S.attacker && S.threat === 35 && w.flashes.some((m) => /got away/.test(m)), 'a good roll gets away and the meter drops to 35');
  const w2 = world({ classId: 'skiff', rnd: 0.5 });
  const S2 = trip(w2); S2.threat = 100; vm.runInContext('_wf3SpawnAttacker()', w2);
  w2.Math.random = () => 0.99; w2.X.flee();
  ok(!!S2.attacker && S2.hull < S2.hullMax, 'a bad roll on a skiff: it stays on you and bites');
  while (S2.hull > 0 && S2.attacker) w2.X.bite();
  ok(S2.hull === 0 && w2.boat.status === 'damaged' && w2.boat.hull === 0 && S2.castsLeft === 0 && w2.logs.some((l) => /WRECKED/.test(l)), 'hull 0 is a wreck: the boat docks damaged, the trip is over, and it is logged');
}

/* ── 5. the fight route hands the parts to the battle's return ──────────── */
{
  const w = world({ rnd: 0.5 });
  const S = trip(w); S.threat = 100; vm.runInContext('_wf3SpawnAttacker()', w);
  w.X.fight();
  ok(w.fought && w.fought.name === S.attacker.def.name && (w.App._fishingEncounterPending.parts | 0) >= 1, 'Fight routes to the card battle with the attacker and stakes its parts');
  ok(/parts: won \? \(fe\.parts \| 0\) : 0/.test(SRC) && /addSalvage\(\{ monsterParts: fa\.parts \| 0 \}\)/.test(SRC), '…and a WON battle pays them on the way back, a lost one pays nothing');
}

/* ── 6. seams and the tournament server side ────────────────────────────── */
{
  ok(/\.\.\.\(_wf3ExpansionInit\(boat\)\),/.test(SRC), 'the trip state carries the round-2 fields');
  ok(/try \{ _wf3ThreatTick\(dt, t\); \} catch \(e\) \{\}/.test(SRC), 'every frame ticks the threat');
  ok(/try \{ _wf3ThreatOnCast\(\); \} catch \(e\) \{\}/.test(SRC), 'every cast stirs the water');
  ok(/try \{ _wf3ExpOnCatch\(result, banked\); \} catch \(e\) \{\}/.test(SRC), 'every catch fills the hold and weighs in');
  ok(/try \{ _wf3ExpOnClose\(\); \} catch \(e\) \{\}/.test(SRC), 'closing the trip writes the boat back');
  ok(/\+ \(\(_wf3S && _wf3S\.expLuck\) \|\| 0\); \}/.test(SRC), 'weather, night and the deckhand feed the luck roll');
  ok(/try \{ _wfExpCrewHurt\(crew, hullDmg, exp\.danger \| 0, b\); \} catch \(e\) \{\}/.test(SRC), 'expeditions hurt crew and pay boat XP');
  ok(/data-wfa-refit="' \+ b\.id \+ '"/.test(SRC) && /\[data-wfa-refit\]/.test(SRC), 'every slip has a refit button');
  ok(/navItem\('tournament',  'TOURNAMENT', null\)/.test(SRC) && /_wfRenderTournament\(f\)/.test(SRC) && /_wfBindTournament\(\)/.test(SRC), 'the TOURNAMENT tab is wired');
  ok(/rpc\('fishing_record_submit'/.test(SRC) && /rpc\('fishing_records_top'/.test(SRC), 'the client posts and reads records through the two RPCs');
  ok(/kg\s+numeric\s+not null check \(kg > 0 and kg <= 120\)/.test(SQL) && /v_kg := least\(120, greatest\(0\.1, coalesce\(p_kg, 0\)\)\);/.test(SQL), 'sql/127 clamps a weight to 120 kg server-side');
  ok(/constraint fishing_records_week_user_uniq unique \(week, user_id\)/.test(SQL) && /on conflict \(week, user_id\) do update/.test(SQL), 'one record per angler per week, upserted only upward');
  ok(/for select to authenticated using \(true\)/.test(SQL) && !/for insert/.test(SQL), 'anyone signed in reads the board; nobody inserts directly');
  ok(/revoke all on function public\.fishing_record_submit\(text, numeric, text\) from public, anon;/.test(SQL), 'the submit RPC is revoked from anon');
}

/* ── 7. the knobs ────────────────────────────────────────────────────────── */
{
  const NC = readFileSync('./public/node-city/index.html', 'utf8');
  const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
  ok(!!v && readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION', v);
  ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
  ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
  ok(new RegExp('effects\\.js\\?v=' + v + '"').test(SRC) && new RegExp('handset\\.js\\?v=' + v + '"').test(SRC), 'effects.js and handset.js busters equal the build');
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
