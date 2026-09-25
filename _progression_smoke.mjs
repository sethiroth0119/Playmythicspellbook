/* 🌳 PROGRESSION — the level gate, the point bank, and the panel's scroll.

   Asked for: "Allow players to buy 2 development points for $5", "Create a
   City level that players will need to reach to open some of these
   Requires … last level 25", and "Fix milestone scrollbar, it shoots you
   back to the top when you scroll down."

   What this file defends, headless, through the real state.js and tree.js:
     · a node with `level: N` is locked while the city is below N, opens at
       N, and FAILS OPEN when the host hands over no level reader;
     · milestone points are spent before the bank, the bank is asked to hand
       its share over, and a bank that will not pay unlocks nothing;
     · `bankSpent` rides the save (`b`) and is re-derived sanely on a corrupt
       spend counter;
     · the tree still validates with every level stamped on it;
     · panel.js keeps the three scroll positions across a redraw and skips
       the write when nothing changed (pinned on the text — it needs a DOM).

   Run: node _progression_smoke.mjs */
import { readFileSync } from 'fs';

globalThis.window = globalThis.window || {};
const T = await import('./public/src/progression/tree.js');
const { makeState } = await import('./public/src/progression/state.js');

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

/* A host that reaches every milestone so points are plentiful, and whose
   level and bank the test can turn. */
function host(o) {
  const h = Object.assign({
    pop: () => 1e9, built: () => 1e9, cinderRate: () => 1e9, employed: () => 1e9, mood: () => 100,
    crewPosted: () => 1e9, earned: () => 1e9, schooled: () => 1e9,
    hasLicence: () => true, licenceLabel: (k) => k, licencePrice: () => 0, licences: () => [],
    zones: () => ({}), tileTypes: () => [], toast: () => {}, logEvent: () => {}, save: () => {},
  }, o || {});
  return h;
}

console.log('\n=== 1. the tree still validates with level gates on it ===');
{
  const problems = T.validate();
  ok(problems.length === 0, 'validate() finds no problem', problems.join('; '));
  const gated = T.NODES.filter((n) => (n.level | 0) > 1);
  ok(gated.length >= 20, gated.length + ' nodes carry a city level');
  ok(gated.every((n) => n.level >= 2 && n.level <= 25), 'every level is inside 2..25');
  ok(T.NODES.filter((n) => n.auto).every((n) => !(n.level > 1)), 'no trunk node is level-gated');
  const top = Math.max(...gated.map((n) => n.level));
  ok(top === 20 && T.NODE_BY_ID.myth_arena.level === 20, 'the Mythic Entertainment District is the deepest gate, level 20');
  ok(T.NODE_BY_ID.res_high.level === 12 && T.NODE_BY_ID.tra_rail.level === 10, 'towers at 12, rail at 10');
}

console.log('\n=== 2. a level gate locks, then opens, and fails open unread ===');
{
  let level = 1;
  const st = makeState(host({ cityLevel: () => level }));
  st.load({ v: 1, u: [], g: [], m: [], a: [], s: 0 });
  st.tick();                                          // every milestone passes
  const n = T.NODE_BY_ID.res_apt;                     // level 3, req res_row
  st._grant = null;
  st.S.granted.add('res_row');
  let s = st.status(n);
  ok(s.state === 'locked' && s.blockers.some((b) => b.kind === 'level'), 'res_apt is locked at city level 1: ' + (s.blockers[0] && s.blockers[0].text));
  ok(/Requires city level 3 — this city is level 1/.test(s.blockers.find((b) => b.kind === 'level').text), 'the blocker names both numbers');
  level = 3;
  s = st.status(n);
  ok(s.state === 'available', 'and opens the moment the city reaches level 3', JSON.stringify(s.blockers));
  const r = st.unlock('res_apt');
  ok(r.ok && st.has('res_apt'), 'unlock goes through at level 3');

  const blind = makeState(host({}));                  // no cityLevel reader at all
  blind.load({ v: 1, u: [], g: [], m: [], a: [], s: 0 }); blind.tick();
  blind.S.granted.add('res_row');
  const sb = blind.status(n);
  ok(sb.state === 'available', 'with no level reader the gate fails OPEN', JSON.stringify(sb.blockers));
  const lv = blind.levelState(3);
  ok(lv && lv.met === null && lv.have === null, 'and levelState says so (met: null)');
}

console.log('\n=== 3. milestone points first, the bank for the remainder ===');
{
  /* A city that has earned exactly 1 point (one milestone) and an account
     with 5 in the bank. res_row costs 1, res_apt 2, res_condo 3. */
  let bank = 5;
  const spendLog = [];
  const st = makeState(host({
    cityLevel: () => 25,
    bankPoints: () => bank,
    spendBank: (n) => { spendLog.push(n); if (bank < n) return 0; bank -= n; return n; },
    pop: () => 0, built: () => 1, cinderRate: () => 0, employed: () => 0, mood: () => 0, crewPosted: () => 0, earned: () => 0, schooled: () => 0,
  }));
  st.load({ v: 1, u: [], g: [], m: [], a: [], s: 0 });
  st.tick();
  const p0 = st.points();
  ok(p0.earned >= 0 && p0.earned <= 2 && p0.own === p0.earned, 'the city has earned ' + p0.earned + ' point(s) from its milestones, none spent');
  ok(p0.bank === 5 && p0.available === p0.own + 5, 'available = own ' + p0.own + ' + bank 5 = ' + p0.available);
  const own0 = p0.own;

  let r = st.unlock('res_row');                       // cost 1: paid from milestones
  ok(r.ok, 'Row Housing (1 ⬡) unlocks');
  ok(spendLog.length === 0 || own0 === 0, 'paid from milestone points, the bank untouched (' + JSON.stringify(spendLog) + ')');
  r = st.unlock('res_apt');                           // cost 2: the bank pays the shortfall
  ok(r.ok, 'Apartments (2 ⬡) unlocks');
  const p1 = st.points();
  ok(p1.own === 0, 'milestone points are exhausted first (own = ' + p1.own + ')');
  const expectBankSpent = 3 - own0;
  ok(st.S.bankSpent === expectBankSpent && bank === 5 - expectBankSpent, 'the bank covered ' + expectBankSpent + ' — bank now ' + bank + ', bankSpent ' + st.S.bankSpent);

  const saved = st.save();
  ok(saved.b === st.S.bankSpent && saved.s === 3, 'the save carries s=3 and b=' + saved.b);

  bank = 0;
  r = st.unlock('res_condo');                         // cost 3, nothing left anywhere
  ok(!r.ok && r.reason === 'blocked', 'Condominiums refuse with an empty bank: ' + (r.blockers && r.blockers[0].text));
  ok(!st.has('res_condo') && st.S.spent === 3, 'and nothing was recorded');

  /* the bank claims 3 but pays 0 — the counter must not move */
  bank = 3;
  const lying = makeState(host({ cityLevel: () => 25, bankPoints: () => 3, spendBank: () => 0,
    pop: () => 0, built: () => 1, cinderRate: () => 0, employed: () => 0, mood: () => 0, crewPosted: () => 0, earned: () => 0, schooled: () => 0 }));
  lying.load({ v: 1, u: [], g: [], m: [], a: [], s: 0 }); lying.tick();
  lying.S.granted.add('res_row'); lying.S.granted.add('res_apt');
  const lr = lying.unlock('res_condo');
  ok(!lr.ok && !lying.has('res_condo') && lying.S.bankSpent === 0, 'a bank that will not pay unlocks nothing: ' + (lr.blockers && lr.blockers[0].text));
}

console.log('\n=== 4. the save round-trips, and a corrupt counter is re-derived ===');
{
  const st = makeState(host({ cityLevel: () => 25 }));
  const r = st.load({ v: 1, u: ['res_row', 'res_apt'], g: [], m: [], a: [], s: 3, b: 2 });
  ok(!r.legacy && st.S.spent === 3 && st.S.bankSpent === 2, 'u/s/b load back (spent 3, bankSpent 2)');
  const st2 = makeState(host({ cityLevel: () => 25 }));
  st2.load({ v: 1, u: ['res_row'], g: [], m: [], a: [], s: 9, b: 9 });
  ok(st2.S.spent === 1 && st2.S.bankSpent === 1, 'a spend counter above the nodes is re-derived, and bankSpent clamped with it (' + st2.S.spent + '/' + st2.S.bankSpent + ')');
  const st3 = makeState(host({}));
  st3.load(undefined);
  ok(st3.S.legacy && st3.S.bankSpent === 0, 'a legacy save loads with an empty bank record');
}

console.log('\n=== 5. the panel keeps its scroll (pinned on the text) ===');
{
  const src = readFileSync('./public/src/progression/panel.js', 'utf8');
  ok(/const keep = \['\.pgmain', '\.pgside', '\.pgrail'\]\.map\(/.test(src), 'the three panes\' scrollTop are captured before innerHTML');
  ok(/if \(html === lastHtml\) return;/.test(src), 'an identical redraw is skipped entirely');
  ok(/forEach\(\(sel, i\) => \{ const el = root\.querySelector\(sel\); if \(el && keep\[i\]\) el\.scrollTop = keep\[i\]; \}\)/.test(src), 'and restored after the write');
  ok(/data-act="buypts"/.test(src) && /api\.buyPoints\(\)/.test(src), 'the Buy points button reaches api.buyPoints');
  ok(/🏙 Lv ' \+ n\.level/.test(src), 'a gated node wears its level on the card');
  const idx = readFileSync('./public/src/progression/index.js', 'utf8');
  ok(/cityLevel: ctx\.cityLevel, bankPoints: ctx\.bankPoints, spendBank: ctx\.spendBank,/.test(idx), 'index.js hands the level and bank readers to the state');
  const city = readFileSync('./public/node-city/index.html', 'utf8');
  ok(/cityLevel: \(\) => \{ try \{ return cityLevel\(\)\.level; \}/.test(city) && /spendBank:  \(n\) =>/.test(city) && /buyPoints:  \(\) =>/.test(city), 'node-city hands all three over to the tree');
}

console.log('\n' + (fails ? `❌ ${fails} FAILED\n` : '✅ all clear — levels gate, the bank pays, the list stays put\n'));
process.exit(fails ? 1 : 0);
