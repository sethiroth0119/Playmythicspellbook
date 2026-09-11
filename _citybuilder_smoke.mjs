/* 🏙 THE CITY BUILDER'S RULES THAT BROKE ON 2026-09-04, pinned.

   node-city/index.html is a 53k-line page script, not a module, so the
   functions under test are lifted by name and run against stubs — the same
   trick tools/economy-tests/run.mjs uses — and the decisions that live in
   DATA (a building row, a recipe) are pinned on the text.

   1. A Street Light's rotation persists. It always DID save; the arm was
      re-rolled with Math.random on every rebuild, so the saved turn landed on
      a different base. The pin is that the roll is gone.
   2. Residents take open jobs at any population, and the intake scales.
   3. The Restaurant pays Cinder when crewed and no longer mints food.
   4. Every save carries the vitals the node mirrors (sql/109).
   5. The city level: 25 rungs on lifetime Cinder, saved as `xp`, never lost.
   6. Posts filled: 10–200 per building by size, seeded so it never changes
      under the player (crew.city.js postCapacity).
   7. The virus rides the Outbreak Risk card and the phone feed.

   Run: node _citybuilder_smoke.mjs */
import { readFileSync } from 'fs';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

const SRC = readFileSync('./public/node-city/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const constLine = (name) => { const m = SRC.match(new RegExp('^const ' + name + ' = ([^;]+);', 'm')); return m ? m[1] : null; };

console.log('\n=== 1. the street light keeps the way it was turned ===');
{
  const f = fnText('makeStreetlight');
  ok(!/R\(\)\s*\*\s*4/.test(f) && !/Math\.random\(\)\s*\*\s*4/.test(f), 'makeStreetlight no longer rolls a random quarter-turn on the arm');
  ok(/inner\.rotation\.y = 0;/.test(f), 'the arm starts at a fixed heading, so t.rot is the whole facing');
  ok(/t\.rot = \(\(t\.rot \| 0\) \+ 1\) & 3;/.test(SRC) && /rot: \(t\.rot \| 0\) & 3,/.test(SRC), 'rotate writes t.rot and serialize saves it (the parts that were never broken)');
  ok(/kerbRot = \(dx < 0\) \? 0 : \(dz > 0\) \? 1 : \(dx > 0\) \? 2 : 3;/.test(SRC), 'a new pole faces the kerb it was placed against');
  ok(/rot: canRotate\(placeType\) \? \(\(def\.roadLink && !placeRot\) \? kerbRot : placeRot\) : 0/.test(SRC), '…unless the player turned it while placing');
}

console.log('\n=== 2. residents take the open jobs, at any scale ===');
{
  const every = +constLine('AUTOSTAFF_EVERY'), minTake = +constLine('AUTOSTAFF_MIN_INTAKE'), share = +constLine('AUTOSTAFF_SHARE');
  ok(every > 0 && minTake >= 1 && share > 0 && share < 1, 'the pacing constants exist (every ' + every + 's, min ' + minTake + ', share ' + share + ')');

  function build({ need, workers, soldiers = 0, buildingPop = 0, popCap, cityPop }) {
    const game = { army: { workers, soldiers, rank: 0 } };
    const toasts = [];
    const env = {
      game, AUTOSTAFF_EVERY: every, AUTOSTAFF_MIN_INTAKE: minTake, AUTOSTAFF_SHARE: share,
      crewNeeded: () => need,
      popCap: () => popCap,
      popUsed: () => game.army.workers + game.army.soldiers + buildingPop,
      cityPop: () => cityPop,
      toast: (m) => toasts.push(m), updateHUD: () => {}, saveSoon: () => {},
    };
    const names = Object.keys(env);
    const api = new Function(...names,
      'let autoStaffNext = 0;\n' + fnText('autoStaffPool') + '\n' + fnText('autoStaffIntake') + '\n' + fnText('autoStaffTick') +
      '\nreturn { autoStaffTick, autoStaffPool, autoStaffIntake, tick: (n) => { autoStaffTick(n); return game.army.workers; } };'
    )(...names.map((k) => env[k]));
    return Object.assign(api, { game, toasts });
  }

  // a full city with idle residents — the case that used to hire nobody
  {
    const s = build({ need: 40, workers: 10, buildingPop: 20, popCap: 30, cityPop: 300 });
    ok(s.game.army.workers === 10 && (30 - (10 + 0 + 20)) === 0, 'setup: housing is full (room 0), 270 residents idle, 30 jobs open');
    const w = s.tick(0);
    ok(w > 10, 'full housing + idle residents: people still take the open jobs (workers ' + w + ')');
  }
  // a young city with room but nobody idle — the old rule still works
  {
    const s = build({ need: 12, workers: 2, popCap: 20, cityPop: 2 });
    ok(s.tick(0) > 2, 'housing room and nobody idle: a newcomer moves in and takes the job');
  }
  // nobody idle and nowhere to live — nothing happens
  {
    const s = build({ need: 12, workers: 2, buildingPop: 18, popCap: 20, cityPop: 20 });
    ok(s.tick(0) === 2, 'no room and no idle residents: nobody is invented');
  }
  // never past what the jobs need
  {
    const s = build({ need: 5, workers: 0, popCap: 1000, cityPop: 1000 });
    let w = 0; for (let t = 0; t < 600; t += every) w = s.tick(t);
    ok(w === 5, 'staffing stops dead at crewNeeded (' + w + '/5)');
    ok(s.toasts.some((m) => /full rate/.test(m)), 'and says so once the roster is complete');
  }
  // the intake scales with the shortfall
  {
    const s = build({ need: 10000, workers: 0, popCap: 12000, cityPop: 12000 });
    const w1 = s.tick(0);
    ok(w1 >= 1000, 'a 10,000-job shortfall takes at least a tenth per intake (' + w1 + ')');
    let w = w1, beats = 1;
    for (let t = every; t < 3600 && w < 10000; t += every) { w = s.tick(t); beats++; }
    ok(w === 10000 && beats * every <= 240, '10,000 jobs fill inside four minutes of play (' + (beats * every) + 's)');
    const tiny = build({ need: 5, workers: 0, popCap: 10, cityPop: 5 });
    ok(tiny.autoStaffIntake(5) === Math.max(minTake, Math.ceil(5 * share)), 'a shortfall of 5 uses the floor');
  }
  // paced: two ticks inside one interval are one intake
  {
    const s = build({ need: 100, workers: 0, popCap: 200, cityPop: 200 });
    const a = s.tick(0), b = s.tick(every - 1);
    ok(a === b, 'two ticks inside one interval are one intake (' + a + ')');
  }
}

console.log('\n=== 3. the Restaurant eats food and pays Cinder when crewed ===');
{
  const row = (SRC.match(/^\s*restaurant:\{[^\n]*\n[^\n]*\n[^\n]*/m) || [''])[0];
  ok(/gen: \{ cinder: 0\.24 \}/.test(row), 'the Restaurant has a Cinder leg');
  ok(!/cannedFood|bread|beverages/.test(row.split('desc:')[0]), 'and no longer generates canned food, bread or beverages');
  ok(/crew: 2/.test(row), 'it needs a crew of 2 — tileMult scales its output by staffingRatio, so unstaffed it pays nothing');
  ok(/svc: \{ need: 'food', supply: 1\.6, input: 'rations', rate: 0\.80/.test(row), 'it still eats rations for its coverage');
  ok(/STOCK_RAW_FALLBACK = \{ rations: 'food'/.test(SRC), 'and burns raw food when the cannery is empty');
  /* 👥 STAFFING IS PER BUILDING NOW, and this assertion moved with it rather
     than being deleted. It used to pin the literal `(def.crew ? staff : 1)` —
     `staff` being the CITY-WIDE hired-worker ratio, which is exactly the bug
     _citybiz_smoke.mjs documents: a city staffed by its own residents ran every
     crewed building at zero. What matters here is unchanged and still pinned —
     a crewed building's output is scaled by staffing and an uncrewed one is
     not; staffAt() is just the honest answer to "staffed by whom". */
  ok(/\* \(def\.crew \? staffAt\(key\(x, z\), def, staff\) : 1\)/.test(fnText('tileMult')),
    'tileMult applies staffing to every crewed building — and asks per building, not city-wide');
}

console.log('\n=== 4. every save carries the vitals the node mirrors ===');
{
  const ser = fnText('serialize');
  ok(/vitalsSnap: \(function \(\) \{/.test(ser), 'serialize writes vitalsSnap');
  ok(/pop: Math\.max\(0, Math\.round\(cityPop\(\)\)\), cap: Math\.max\(0, popCap\(\) \| 0\)/.test(ser), 'with the same headcount and capacity pushCityReport sends');
  ok(/civ: Math\.round\(vit\.civilization\), trade: Math\.round\(vit\.trade\)/.test(ser), 'and the city\'s own civilization and trade');
  const sql = readFileSync('./sql/109_city_vitals_from_save.sql', 'utf8');
  ok(/->'vitalsSnap'->>'pop'/.test(sql) && /->'vitalsSnap'->>'cap'/.test(sql), 'sql/109 reads them');
  ok(/nullif\(p_state->>'npcPop', ''\)/.test(sql), 'and falls back to npcPop for a save from before the field existed');
  ok(/after insert or update of state, node_id on public\.city_state/.test(sql), 'as a trigger on every city save');
  ok(/exception when others then[\s\S]{0,160}?null;/.test(sql), 'that can never block the save');
}

console.log('\n=== 5. the city level — 25 rungs on the Cinder the city makes ===');
{
  const MAX = +constLine('CITY_LEVEL_MAX');
  ok(MAX === 25, 'CITY_LEVEL_MAX is 25');
  const toasts = [], logs = [];
  const game = { cityXp: 0 };
  const env = { game, CITY_LEVEL_MAX: MAX, toast: (m) => toasts.push(m), logEvent: (k, m) => logs.push(m), saveSoon: () => {}, window: {} };
  const code = fnText('cityLevelXpFor') + '\n' + fnText('cityLevel') + '\n' + fnText('cityXpAdd') +
    '\nreturn { cityLevelXpFor, cityLevel, cityXpAdd };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  ok(F.cityLevelXpFor(1) === 0 && F.cityLevelXpFor(2) === 80, 'level 2 comes at 80 🔥');
  const ladder = []; for (let L = 1; L <= MAX; L++) ladder.push(F.cityLevelXpFor(L));
  ok(ladder.every((v, i) => i === 0 || v > ladder[i - 1]), 'the ladder climbs strictly: ' + ladder.slice(0, 5).join(',') + ' … ' + ladder[MAX - 1].toLocaleString());
  ok(ladder[MAX - 1] > 100000 && ladder[MAX - 1] < 300000, 'level 25 is a long-run goal (' + ladder[MAX - 1].toLocaleString() + ' 🔥 lifetime)');
  ok(F.cityLevelXpFor(99) === ladder[MAX - 1] && F.cityLevelXpFor(0) === 0, 'the ladder is clamped to 1..25');
  let L = F.cityLevel();
  ok(L.level === 1 && L.next === 80 && L.pct === 0, 'a fresh city is level 1 with 80 to go');
  F.cityXpAdd(79);
  ok(F.cityLevel().level === 1 && toasts.length === 0, '79 🔥 is still level 1, nothing announced');
  F.cityXpAdd(1);
  L = F.cityLevel();
  ok(L.level === 2 && toasts.length === 1 && /City level 2/.test(toasts[0]) && logs.length === 1, '80 🔥 is level 2, toasted and logged once');
  F.cityXpAdd(ladder[9] - 80);
  ok(F.cityLevel().level === 10 && toasts.length === 2, 'one big payout jumps straight to level 10 with one toast, not eight');
  F.cityXpAdd(-500);
  ok(game.cityXp === ladder[9], 'a negative amount is ignored — XP never falls');
  F.cityXpAdd(1e9);
  L = F.cityLevel();
  ok(L.level === 25 && L.max && L.pct === 100 && L.next === null, 'level 25 is the top: max, 100%, no next');
  ok(/cityXpAdd\(whole\);/.test(SRC) && /cityXpAdd\(total\);/.test(SRC) && /cityXpAdd\(pay\);/.test(SRC), 'production, patronage and ops sales feed it');
  ok(/xp: Math\.round\(game\.cityXp \|\| 0\),/.test(SRC) && /if \(Number\.isFinite\(\+s\.xp\) && \+s\.xp > 0\) game\.cityXp = \+s\.xp;/.test(SRC), 'xp rides the save and loads back');
  ok(/🏙 City level <b>/.test(SRC) && /class="mbar lvl"/.test(SRC), 'the Vital Signs card draws the level bar');
}

console.log('\n=== 6. posts filled — 10 to 200, by the size of the business ===');
{
  const C = await import('./public/src/work/crew.city.js');
  ok(C.POSTS_MIN === 10 && C.POSTS_MAX === 200, 'the range is 10..200');
  const farm = { type: 'farm', lvl: 1 }, stadium = { type: 'stadium', lvl: 1 }, huge = { type: 'x', lvl: 1 };
  const f = C.postCapacity(farm, { cost: { cinder: 14 } }, '3,3');
  const st = C.postCapacity(stadium, { cost: { cinder: 600 } }, '5,5');
  const h = C.postCapacity(huge, { cost: { cinder: 11000 } }, '7,7');
  ok(f >= 10 && f <= 30, 'a 14 🔥 Farm offers ' + f + ' posts');
  ok(st >= 100 && st <= 200 && st > f, 'a 600 🔥 Stadium offers ' + st);
  ok(h === 200, 'an 11,000 🔥 building tops out at 200 (' + h + ')');
  ok(C.postCapacity(farm, { cost: { cinder: 14 } }, '3,3') === f, 'the same tile rolls the same number every time');
  let spread = new Set(); for (let i = 0; i < 40; i++) spread.add(C.postCapacity(stadium, { cost: { cinder: 600 } }, i + ',' + i));
  ok(spread.size >= 8, 'different tiles roll different numbers (' + spread.size + ' distinct across 40 stadiums)');
  const lv3 = C.postCapacity({ type: 'stadium', lvl: 3 }, { cost: { cinder: 600 } }, '5,5');
  ok(lv3 > st, 'a level-3 building holds more than a level-1 one (' + lv3 + ' vs ' + st + ')');
  ok(C.postCapacity({ type: 'q', lvl: 1 }, {}, '1,1') === 10, 'no price at all reads as the smallest business');
  ok(/return postCapacity\(t, def, k\);/.test((await import('fs')).readFileSync('./public/src/work/crew.city.js', 'utf8')), 'slotsAt() hands the count to postCapacity');
}

console.log('\n=== 7. the virus on the outbreak card and the phone ===');
{
  const P = await import('./public/src/zombie/panel.js');
  const rep = { pressure: 0.42, roster: 50, cases: 7, share: 0.14, healthDrag: 0.09, log: [],
    strains: [{ strain: { id: 's1', name: 'Ashfall Fever', isolate: 'AF-3', severity: 2 }, cases: 7, stages: { incubating: 2, symptomatic: 4, critical: 1 } }] };
  rep.worst = rep.strains[0];
  const lines = P.virusLines(rep, { def: { icon: '🦠', name: 'Grey Cough', line: 'It is in the water.' } });
  const txt = lines.join('\n');
  ok(/World virus/.test(txt) && /Grey Cough/.test(txt), 'the world virus is named');
  ok(/<b class="bad">7<\/b> of 50 residents sick \(14%\)/.test(txt), 'cases, roster and share are the module\'s own');
  ok(/Ashfall Fever/.test(txt) && /2 incubating · 4 symptomatic · 1 critical/.test(txt), 'each strain lists its stages');
  ok(/−9%/.test(txt), 'the output drag is shown');
  const quiet = P.virusLines({ pressure: 0.05, roster: 50, cases: 0, share: 0, strains: [], log: [] }, null).join('');
  ok(/no active cases/.test(quiet) && /5%/.test(quiet), 'no cases reads as clear with the pressure');
  ok(/not tracked|no illness is being tracked/.test(P.virusLines(null, null).join('')), 'no module reads as "not tracked", never as zero');
  const full = P.render({ armed: false, risk: 0, unburied: 0 }, { virus: rep, worldVirus: null });
  ok(/Ashfall Fever/.test(full), 'the dormant card carries the virus block too');

  const Src = await import('./public/src/broadcast/sources.js');
  const Ph = await import('./public/src/broadcast/phrases.js');
  const Sub = await import('./public/src/broadcast/subjects.js');
  ok(!!Sub.SUBJECTS.virus && Sub.SUBJECTS.virus.dept === 'health' && Sub.SUBJECTS.virus.citizen, 'the virus subject exists, spoken by residents and the Health Department');
  ok(Ph.clauses('virus', 'cit', 'bad', 'mild').length >= 3 && Ph.clauses('virus', 'dept', 'bad', 'severe').length >= 2 && Ph.clauses('virus', 'cit', 'good', 'great').length >= 1, 'every band has clauses');
  const ctx = { game: { log: [], cov: { pct: {} }, tiles: {} }, cityPop: () => 50, NEED_META: {}, BUILDINGS: {}, plague: () => rep };
  const evs = Src.observe(ctx).filter((e) => e.subject === 'virus');
  ok(evs.length >= 2, 'observe() emits virus posts for both a resident and the department (' + evs.length + ')');
  const e0 = evs[0];
  ok(e0 && e0.pole === 'bad' && e0.facts.n === '7' && e0.facts.v === 'Ashfall Fever', 'the post carries the case count and the strain name', JSON.stringify(e0 && e0.facts));
  ok(e0 && e0.band === 'notable', '7 of 50 sick is a notable complaint (' + (e0 && e0.band) + ')');
  const cured = Src.observe({ ...ctx, plague: () => ({ cases: 0, roster: 50, share: 0, pressure: 0, strains: [], log: [{ kind: 'cured', text: '💉 Ashfall Fever (AF-3) cleared.', strainId: 's1', at: 1 }] }) })
    .filter((e) => e.subject === 'virus');
  ok(cured.length >= 1 && cured[0].pole === 'good' && cured[0].facts.v === 'Ashfall Fever', 'a cleared strain is a contented post naming it', JSON.stringify(cured[0] && cured[0].facts));
  ok(Src.observe({ ...ctx, plague: () => null }).filter((e) => e.subject === 'virus').length === 0, 'no report, no post');
  ok(/plague: \(\) => \(_plagueReport \? _plagueReport\(\) : null\),/.test(SRC) && SRC.split('plague: () => (_plagueReport ? _plagueReport() : null),').length === 3, 'node-city hands the report to both the card and the feed');
}

console.log('\n=== 8. a refusal is a modal, not only a toast ===');
{
  const f = fnText('refuse');
  ok(/toast\(msg, 'bad'\)/.test(f) && /id = 'ncrefuse'/.test(f) && /role="alertdialog"/.test(f), 'refuse() toasts AND opens the ncrefuse dialog');
  ok(/if \(window\.__ncToastSink\) return;/.test(f), 'the zoning bulk sink still swallows it (one summary line, not forty dialogs)');
  const tp = fnText('tryPlace');
  ok(!/toast\([^;]*'bad'\)/.test(tp), 'no refusal inside tryPlace is a bare toast any more');
  ok((tp.match(/refuse\(/g) || []).length >= 12, 'tryPlace refuses through the modal (' + (tp.match(/refuse\(/g) || []).length + ' sites)');
  ok(/refuse\(bldCrewBusyMsg\(\)/.test(SRC) && /refuse\(bldCeilingMsg\(/.test(SRC), 'the build crew being busy and the build ceiling are modals');
  ok(/refuse\(await cannotAfford\(def\.name, cost\)\)/.test(SRC) && /refuse\(await cannotAfford\('the upgrade', cost\)\)/.test(SRC), 'not being able to afford a building or an upgrade is a modal');
  ok(/#ncconfirm,#ncrefuse\{/.test(SRC), 'it wears the confirm box skin');
  ok(!/refuse\('💥 Raiders/.test(SRC) && /toast\('🚨 ' \+ W\.ico/.test(SRC), 'raids and weather stay toasts — a modal that interrupts a raid is worse than a missed toast');
  /* drive it: a refusal builds the dialog, Enter closes it, a repeat inside 1.5 s does not stack */
  const dom = { els: [], listeners: [] };
  const mk = () => { const el = { id: '', innerHTML: '', children: [], addEventListener: (k, fn) => { el._click = fn; }, querySelector: () => ({ focus: () => {} }), remove: () => { dom.els = dom.els.filter((x) => x !== el); } }; return el; };
  const env = {
    toast: () => {}, window: {}, Date,
    document: { getElementById: (id) => dom.els.find((e) => e.id === id) || (id === 'wrap' ? { appendChild: (e) => dom.els.push(e) } : null),
                createElement: mk, addEventListener: (k, fn) => dom.listeners.push(fn), removeEventListener: () => { dom.listeners = []; }, body: { appendChild: (e) => dom.els.push(e) } },
  };
  const code = 'const _refuseLast = { msg: \'\', at: 0 };\n' + f + '\nreturn refuse;';
  const R = new Function(...Object.keys(env), code)(...Object.values(env));
  R('Cannot afford Farm — short 20 🔥.');
  ok(dom.els.length === 1 && dom.els[0].id === 'ncrefuse' && /Cannot afford Farm/.test(dom.els[0].innerHTML), 'the dialog is on the page with the sentence in it');
  R('Cannot afford Farm — short 20 🔥.');
  ok(dom.els.length === 1, 'the same refusal again does not stack a second dialog');
  dom.listeners[0]({ key: 'Enter', preventDefault: () => {}, stopPropagation: () => {} });
  ok(dom.els.length === 0, 'Enter closes it');
  env.window.__ncToastSink = () => {};
  R('bulk refusal');
  ok(dom.els.length === 0, 'with the zoning sink installed, no dialog opens');
}

console.log('\n=== 9. NPC seats follow the posts, and the names on the books earn ===');
{
  const tiles = { '1,1': { type: 'farm' }, '2,2': { type: 'stadium' }, '3,3': { type: 'tree' }, '4,4': { type: 'farm', bld: { k: 0 } } };
  const citizens = [];
  for (let i = 0; i < 30; i++) citizens.push({ id: 'c' + i, job: i < 10 ? '1,1' : (i < 25 ? '2,2' : null) });
  const env = {
    game: { tiles }, BUILDINGS: { farm: { crew: 2, gen: {} }, stadium: { crew: 2, gen: {} }, tree: {} },
    bldSite: (t) => !!(t && t.bld), citizens, performance: { now: () => 5000 },
    CREW: { slotsAt: (k) => (k === '1,1' ? 20 : k === '2,2' ? 150 : 0) },
  };
  const code = 'const NPC_WORK_BONUS = 1.0; let _npcJobCounts = null, _npcJobCountsAt = -1e9;\n'
    + ['npcSeatsAt', 'npcNamedAt', 'npcWorkMult', 'citJobSlots'].map(fnText).join('\n')
    + '\nreturn { npcSeatsAt, npcNamedAt, npcWorkMult, citJobSlots };';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  ok(F.npcSeatsAt('1,1') === 20 && F.npcSeatsAt('2,2') === 150, 'a building seats as many names as it has posts (20, 150) — not def.crew\'s 2');
  ok(F.npcSeatsAt('3,3') === 0 && F.npcSeatsAt('4,4') === 0, 'a tree seats nobody and a construction site seats nobody');
  env.CREW = null;
  const G = new Function(...Object.keys(env), code)(...Object.values(env));
  ok(G.npcSeatsAt('1,1') === 2, 'with no crew module the old def.crew count stands (2)');
  ok(F.npcNamedAt('1,1') === 10 && F.npcNamedAt('2,2') === 15, '10 and 15 names are on the books');
  ok(Math.abs(F.npcWorkMult('1,1') - 1.5) < 1e-9, '10 of 20 seats lifts the Farm ×1.5');
  ok(Math.abs(F.npcWorkMult('2,2') - 1.1) < 1e-9, '15 of 150 lifts the Stadium ×1.1');
  ok(F.npcWorkMult('3,3') === 1 && F.npcWorkMult('9,9') === 1, 'no seats, no lift (×1)');
  const slots = F.citJobSlots();
  ok(slots.length === 170 && slots.filter((k) => k === '2,2').length === 150, 'citJobSlots offers one entry per seat (170 across the two)');
  ok(/\* npcWorkMult\(key\(x, z\)\);/.test(SRC), 'tileMult multiplies by it, beside crewMult, inside the cap');
  ok(/\* npcWorkMult\(key\(x, z\)\);\s*if \(isMoraleVenue/.test(SRC), '…before the venue, finance and power terms, i.e. above the ceiling line');
  ok(/if \(!\(npcSeatsAt\(key\) > 0\)\) return false;/.test(SRC), 'setJob validates against the same seat count');
  ok(/const seats = npcSeatsAt\(k\) \|\| \(def\.crew \| 0\);/.test(SRC) && !/it never touches what the building produces/.test(SRC), 'the roster card prints the real seat count and no longer says names do not matter');
  ok(/MAX: 400,/.test(SRC), 'the named roster can grow to 400 so a city can fill those seats');
}

console.log('\n=== 10. the Public Health chip sits in the top bar, in the flow ===');
{
  const PL = readFileSync('./public/src/city/plague.city.js', 'utf8');
  ok(/\.pl-badge\{position:static;margin-left:auto;pointer-events:auto;/.test(PL), 'the chip is laid out, not fixed');
  ok(/\(document\.getElementById\('topbar'\) \|\| document\.body\)\.appendChild\(b\);/.test(PL), 'and is appended to #topbar');
  ok(!/bottom:118px/.test(PL), 'the bottom-right corner rule is gone');
  ok(/body>\.pl-badge\{position:fixed;right:12px;top:calc\(var\(--topbarh,60px\) \+ 4px\)/.test(PL), 'a page with no top bar still pins it under where the bar would be, never the corner');
}

console.log('\n' + (fails ? `❌ ${fails} FAILED\n` : '✅ all clear\n'));
process.exit(fails ? 1 : 0);
