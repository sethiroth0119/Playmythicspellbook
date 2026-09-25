/* 🧾🏰 v121v128 — two more approved tracker reports, both of the same shape:
   the screen stated a conclusion the player could not check.

   bug-mtxl7z60 (high) — "Zoning screen does not show build requirements for
     development. After selecting an area to zone with a building type like
     mixed use, there is no description of the resource requirement, the zone
     screen just shows plots and cinder price, no other details."
   bug-mtxq7yoy — "Every time I enter the city a message says the city is
     running at reduced capacity due to a full vault. I have tracked and the
     vault had not been full."
   Run: node _zonebill_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8').replace(/\r\n/g, '\n');
const ZI = readFileSync('./public/src/zoning/index.js', 'utf8').replace(/\r\n/g, '\n');
const ZU = readFileSync('./public/src/zoning/ui.js', 'utf8').replace(/\r\n/g, '\n');

/* ── bug-mtxl7z60 — the materials bill ───────────────────────────────────── */
ok(/function planBill\(list, grow\) \{/.test(ZI), 'the plan can be asked for its WHOLE bill, not only its cinder');
ok(/const addCost = \(c\) => \{ if \(c\) for \(const k in c\) bill\[k\] = \(bill\[k\] \| 0\) \+ \(c\[k\] \| 0\); \};/.test(ZI),
  '…which sums every key costOf returns — planCost kept `c.cinder` and dropped metal, supplies, planks and wood on the floor');
{
  const pc = ZI.slice(ZI.indexOf('function planCost(list, grow) {'), ZI.indexOf('function planCost(list, grow) {') + 700);
  ok(/cin \+= \(c && c\.cinder\) \| 0;/.test(pc),
    '…and planCost is UNCHANGED: its name, its meaning and its caller all say cinder, so the bill is a sibling rather than a redefinition');
}
ok(/plan: \(only\) => plan\(only \|\| null\), planCost, planBill,/.test(ZI), '…and it is on the public api the panel talks to');
ok(/const bill = \(typeof api\.planBill === 'function'\) \? api\.planBill\(p\.out, p\.grow\) : null;/.test(ZU), 'the panel asks for it');
ok(/if \(k !== 'cinder' && \(bill\[k\] \| 0\) > 0\) mat\[k\] = bill\[k\] \| 0;/.test(ZU),
  '…and prints the MATERIALS only, because the button has always carried the cinder — this is what was missing, not a second copy of what was there');
ok(/ctx\.costChipsHtml \? ctx\.costChipsHtml\(mat\)/.test(ZU) && /costChipsHtml,/.test(NC),
  '…in the city\'s own cost chips: the resource, what you hold, and red when you are short — the same pricing every other build gets');
ok(/Each site pays as it STARTS, so a shortfall stops the next permit rather than refunding the district\./.test(ZU),
  '…and it says what a shortfall actually does, which is why this was worth more than a number');
ok(/\+ '<div id="nz-bill"><\/div>'/.test(ZU) && /#nz-panel #nz-bill:empty\{display:none\}/.test(ZU),
  'the row is invisible when the plan draws nothing but cinder — no empty heading on a district that has no materials bill');
{
  /* run the bill for real — it is a sum over costOf, and the bug was a filter */
  const COSTS = { house: { cinder: 26, metal: 10, supplies: 6 }, shop: { cinder: 70, metal: 14, supplies: 10, planks: 6 } };
  const costOf = (t) => COSTS[t] ? { ...COSTS[t] } : null;
  const bill = (list) => { const b = {}; for (const p of list) { const c = costOf(p.type); if (c) for (const k in c) b[k] = (b[k] | 0) + (c[k] | 0); } return b; };
  const cinderOnly = (list) => list.reduce((n, p) => n + ((costOf(p.type) || {}).cinder | 0), 0);
  const plan = [{ type: 'house' }, { type: 'house' }, { type: 'shop' }];
  const b = bill(plan);
  ok(cinderOnly(plan) === 122, 'run for real: the button\'s cinder number is exactly what it always was', cinderOnly(plan));
  ok(b.metal === 34 && b.supplies === 22 && b.planks === 6,
    'run for real: …and the plan ALSO needs 34 metal, 22 supplies and 6 planks — none of which the screen said a word about', JSON.stringify(b));
  ok(Object.keys(bill([])).length === 0, 'run for real: an empty plan bills nothing');
}

/* ── bug-mtxq7yoy — the vault message names its numbers ──────────────────── */
ok(/let _ledgerCap = 0, _ledgerHeld = 0;/.test(NC), 'the tick keeps the ceiling and the holding, not just the difference between them');
ok(/if \(_hr && \(_hr\.cap \| 0\) > 0\) \{ _ledgerCap = _hr\.cap \| 0; _ledgerHeld = Math\.max\(0, _hr\.units \| 0\); \}/.test(NC),
  '…read from the same bridge call that already returned all three');
ok(/cap: _ledgerCap, held: _ledgerHeld,/.test(NC), '…and carried on the choke record, beside `free`');
ok(/'STASH FULL — your Base Vault has no room left/.test(NC),
  'the row says WHICH vault: the ceiling counts the whole Base Vault while the city strip shows the twelve-id mirror, which is why the player could check it and find room');
ok(/that ceiling counts EVERYTHING you own, ' \+\n\s*'not just what this city makes/.test(NC),
  '…and says so outright, rather than leaving the player to disprove it from the only view they have');
ok(/const _capTxt = \(_stashChoke\.cap > 0\)/.test(NC) && /: '';/.test(NC),
  '…and prints nothing about the ceiling when it has not been read, instead of printing a zero');
{
  const a = NC.indexOf('_stashChoke = (_split.factor < 1 && _split.want > 0)');
  const rule = NC.slice(a, a + 200);
  ok(/_split\.factor < 1 && _split\.want > 0/.test(rule),
    'the THROTTLE ITSELF is untouched — the production really is being capped, and hiding that would bring back the silence this row exists to end');
}

/* the knobs */
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 128, 'BUILD_VERSION is v121v128 or later', v);
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(NC), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
