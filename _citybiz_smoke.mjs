/* 🏭 BUSINESSES DID NOT WORK, AND IT WAS THREE DEFECTS (v121v78).

   Reported: "Place a building that is a business — Pharmacy, Medical Chemicals
   (as two examples, but it impacts all businesses). Let them run for a bit —
   this issue is always present. I've had buildings stuck on it for days and it
   results in the businesses going bankrupt." And separately: "The sugar mill
   has zero outputs contributing to the city and there's no supply chain
   detailed on its popup… my Cinema is not functioning properly due to missing
   goods, even though I have plenty of other goods being created."

   1. NOBODY'S RESIDENTS COULD STAFF ANYTHING. tileMult multiplied a crewed
      building's output by staffingRatio() — one CITY-WIDE number,
      game.army.workers ÷ crewNeeded(), counting HIRED workers only. A city
      full of employed residents and no hired workers ran every crewed building
      at staff = 0, i.e. zero output, for ever. The names were not idle —
      npcWorkMult() paid them a bonus — but a bonus multiplies output, and the
      output was zero. ×2 of nothing is nothing, which is why it read as "it
      doesn't work" rather than "it is slow". The Pharmacy earns through
      `gen: { cinder: 0.18 }`, so at staff 0 it earns nothing and goes broke
      exactly as described.

   2. THE MACHINE SHOP COULD NEVER RUN. It declares `use: { ingots: … }`, but
      `ingots` was never added to HUD_DISPLAY_RES — the list refreshLedgerMirror
      fetches into game.res, which is what haveOf() reads. So its input read 0
      for ever no matter how many ingots the player held. It is one of only TWO
      buildings that make `goods`, which is what a Cinema sells over the
      counter — so this is half of the reported Cinema starvation on its own.

   3. THE SUGAR MILL MADE NOTHING. `pop`, `crew`, `powerNeed`, a description
      promising it is "the reason a Cinema or a Club has anything to sell over
      the counter" — and no `gen` and no `use` at all.

   Run: node _citybiz_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');

function fnText(name) {
  const i = NC.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0;
  for (let k = NC.indexOf('{', i); k < NC.length; k++) {
    if (NC[k] === '{') d++;
    else if (NC[k] === '}') { d--; if (!d) return NC.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
/* Lift a top-level object/array literal by brace matching. */
function litOf(name, open) {
  const i = NC.indexOf('const ' + name + ' = ' + open);
  if (i < 0) throw new Error('cannot find ' + name);
  const close = open === '[' ? ']' : '}';
  let d = 0;
  for (let k = NC.indexOf(open, i); k < NC.length; k++) {
    if (NC[k] === open) d++;
    else if (NC[k] === close) { d--; if (!d) return NC.slice(NC.indexOf(open, i), k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const BUILDINGS = (() => {
  const ctx = { STOCK_CAP_PER_WAREHOUSE: 400 };
  vm.createContext(ctx);
  /* The literal references a handful of consts; anything still undefined is
     stubbed to 0 rather than the suite giving up, because the shape is what is
     being asserted, not the tuning. */
  for (let i = 0; i < 40; i++) {
    try { return vm.runInContext('(' + litOf('BUILDINGS', '{') + ')', ctx); }
    catch (e) {
      const m = /(\w+) is not defined/.exec(String(e && e.message));
      if (!m) throw e;
      ctx[m[1]] = 0;
    }
  }
  throw new Error('BUILDINGS would not evaluate');
})();

/* ── 1. THE STAFFING RULE, run for real ──────────────────────────────────── */
{
  const ctx = { Math, Number, npcNamedAt: () => 0 };
  vm.createContext(ctx);
  vm.runInContext(fnText('staffAt'), ctx);
  const at = (named, crew, pool) => { ctx.npcNamedAt = () => named; return vm.runInContext('staffAt("k",{crew:' + crew + '},' + pool + ')', ctx); };

  ok(at(4, 4, 0) === 1, 'a building whose seats are ALL filled by residents is fully staffed with zero hired workers — this is the reported bug', String(at(4, 4, 0)));
  ok(at(2, 4, 0) === 0.5, 'half its seats named is half staffed', String(at(2, 4, 0)));
  ok(at(0, 4, 0) === 0, 'and with nobody named it is exactly the old city-wide number — the old value is the FLOOR, never lowered', String(at(0, 4, 0)));
  ok(at(0, 4, 0.5) === 0.5, 'the hired pool alone still reads exactly as it always did', String(at(0, 4, 0.5)));
  ok(at(2, 4, 0.5) === 1, 'and the two sources ADD — residents cover their own seats on top of the pool', String(at(2, 4, 0.5)));
  ok(at(0, 4, 1) === 1 && at(4, 4, 1) === 1, 'a fully hired city is unchanged in both directions — the min() binds');
  ok(at(9, 4, 0) === 1, 'more names than seats cannot push staffing above 1', String(at(9, 4, 0)));
  ok(at(0, 0, 0) === 1, 'a building with no crew requirement is unaffected', String(at(0, 0, 0)));
  ok(at(0, 4, -5) === 0 && at(0, 4, 99) === 1, 'a nonsense pool value is clamped rather than inverting the rule');
}

/* ── 2. production actually reads it ─────────────────────────────────────── */
{
  ok(/\* \(def\.crew \? staffAt\(key\(x, z\), def, staff\) : 1\)/.test(NC),
    'tileMult multiplies by staffAt() for this building, not by the raw city-wide pool');
  ok(!/\* \(def\.crew \? staff : 1\)/.test(NC), 'and the old city-wide multiplier is gone');
  ok(/function npcWorkMult/.test(NC), 'npcWorkMult still exists — coverage and the quality bonus are separate questions');
}

/* ── 3. the pill says which of the two labour sources is short ────────────── */
{
  ok(/function tileStatusOf\(t, def, halt, k\)/.test(NC), 'the badge takes the tile key, so it can ask about THIS building');
  const i = NC.indexOf("return P('warn', 'understaffed', 'UNDERSTAFFED'");
  ok(i > 0, 'the understaffed badge is still there');
  const seg = NC.slice(i, i + 400);
  ok(/seats taken by residents/.test(seg), 'and it now names the seats residents hold');
  ok(/still uncovered/.test(seg), 'and how many are still uncovered');
  ok(/const _sf = \(k == null\) \? _cityStaff : staffAt/.test(NC),
    'with no key it falls back to the old city-wide answer rather than guessing or throwing');
  /* Every caller that knows its key must hand it over, or the badge silently
     degrades to the old city-wide behaviour and this fix does nothing on screen. */
  /* Balanced-paren extraction, because the arguments contain calls of their
     own — `insHalted(t)` — and a lazy regex stops at the first ")" and reports
     a keyless call that is nothing of the sort. */
  const calls = [];
  let at = -1;
  while ((at = NC.indexOf('tileStatusOf(', at + 1)) >= 0) {
    if (/function\s+$/.test(NC.slice(Math.max(0, at - 10), at))) continue;   // the definition
    if (NC.slice(at).startsWith('tileStatusOf()')) continue;                 // prose in a comment
    let d = 0;
    for (let i = NC.indexOf('(', at); i < NC.length; i++) {
      if (NC[i] === '(') d++;
      else if (NC[i] === ')') { d--; if (!d) { calls.push(NC.slice(at, i + 1)); break; } }
    }
  }
  ok(calls.length >= 3, 'found the call sites', String(calls.length));
  const keyless = calls.filter(c => !/,\s*(k|String\(k\))\s*\)$/.test(c));
  ok(keyless.length === 0, 'every call site passes its key — a keyless one silently degrades to the old city-wide badge',
    keyless.join(' | '));
}

/* ── 4. THE INVARIANT THAT WOULD HAVE CAUGHT THE MACHINE SHOP ─────────────── */
{
  const stock = Object.keys(vm.runInContext('(' + litOf('CITY_STOCK', '{') + ')', vm.createContext({})));
  const hudRes = vm.runInContext('(' + litOf('HUD_RES', '[') + ')', vm.createContext({}));
  const extra = /HUD_RES\.concat\((\[[^\]]*\])\)/.exec(NC);
  const display = hudRes.concat(JSON.parse(extra[1].replace(/'/g, '"')));

  /* 🪞 THE MIRROR IS NO LONGER THE DISPLAY LIST, and this section is the reason
     the split was worth making. It used to read HUD_DISPLAY_RES, because that
     was both what the topbar showed AND what refreshLedgerMirror fetched — so
     giving a building an input meant remembering to hand-add the id to a
     display list, and forgetting was silent. Twice.
     LEDGER_MIRROR_RES is now COMPUTED from the recipes, so the property below
     is true by construction. The check stays as a TRIPWIRE: it fails the day
     somebody replaces the derivation with a literal again. */
  ok(/const LEDGER_MIRROR_RES = \(\(\) => \{/.test(NC), 'the mirror list exists');
  ok(/for \(const k in BUILDINGS\)[\s\S]{0,200}d\.use/.test(NC),
    'and it is DERIVED from the buildings\' own recipes, not hand-written — the hand-written version is what starved the Machine Shop and the Feedstock Plant');
  ok(/const list = LEDGER_MIRROR_RES;/.test(NC), 'and refreshLedgerMirror actually fetches that list');

  /* Recompute the derivation exactly as the page does, and check the property
     against it rather than against the display list. */
  const mirrored = display.slice();
  {
    const seen = new Set(mirrored);
    for (const k of Object.keys(BUILDINGS)) {
      const d = BUILDINGS[k] || {};
      const add = (r) => { if (r && !seen.has(r) && stock.indexOf(r) < 0 && r !== 'power' && r !== 'cinder') { seen.add(r); mirrored.push(r); } };
      for (const r of Object.keys(d.use || {})) add(r);
      if (d.svc && d.svc.input) add(d.svc.input);
    }
  }
  const usable = new Set(stock.concat(mirrored));

  const bad = [];
  for (const key of Object.keys(BUILDINGS)) {
    const d = BUILDINGS[key];
    for (const r of Object.keys((d && d.use) || {})) if (!usable.has(r)) bad.push(key + '.use.' + r);
    if (d && d.svc && d.svc.input && !usable.has(d.svc.input)) bad.push(key + '.svc.input=' + d.svc.input);
  }
  ok(bad.length === 0,
    'EVERY building input is a resource the mirror actually fetches — an id that is not can never be held, so the building never runs',
    bad.join(', '));
  ok(usable.has('ingots'), 'ingots specifically, because the Machine Shop eats them and could never run without this');
  ok(mirrored.indexOf('ingots') >= 0, 'and it is on the MIRROR list, not merely a city-stock key');
}

/* ── 5. …and every mirrored id has somewhere on screen to be written ─────── */
{
  const hudRes = vm.runInContext('(' + litOf('HUD_RES', '[') + ')', vm.createContext({}));
  const extra = /HUD_RES\.concat\((\[[^\]]*\])\)/.exec(NC);
  const display = hudRes.concat(JSON.parse(extra[1].replace(/'/g, '"')));
  /* ⚠ HUD_DISPLAY_RES, DELIBERATELY — NOT LEDGER_MIRROR_RES. Only the ids the
     topbar actually paints need a chip; the mirror is far larger and painting
     it would need a chip per id, which is the topbar that does not fit on a
     phone. If this ever starts walking the mirror it will demand ~28 chips that
     should not exist. */
  const missing = display.filter(r => NC.indexOf('id="r-' + r + '"') < 0 || NC.indexOf('id="d-' + r + '"') < 0);
  ok(missing.length === 0,
    'every mirrored resource has both its HUD elements — updateHUD writes to them unguarded and would THROW on a missing one, killing the whole HUD',
    missing.join(', '));
}

/* ── 6. THE SUGAR MILL MAKES SOMETHING ───────────────────────────────────── */
{
  const m = BUILDINGS.sugarmill;
  ok(!!m, 'the Sugar Mill exists');
  ok(m && m.gen && Object.keys(m.gen).length > 0, 'and it finally declares an output', JSON.stringify(m && m.gen));
  ok(m && m.gen && m.gen.goods > 0, 'it makes `goods` — what a Cinema and a Club actually sell over the counter', String(m && m.gen && m.gen.goods));
  ok(m && m.gen && m.gen.sugar > 0, 'and `sugar`, which its own description promised', String(m && m.gen && m.gen.sugar));
  ok(m && m.use && Object.keys(m.use).length > 0, 'it consumes something, so it is a step in a chain and not a faucet', JSON.stringify(m && m.use));
  ok(!(m && m.gen && m.gen.cinder), 'and it does NOT mint Cinder — output is goods, sold on by the venues that buy them');
  /* It must not out-produce the thing it feeds, or one mill trivialises leisure. */
  const cinemaDraw = BUILDINGS.cinema && BUILDINGS.cinema.svc && BUILDINGS.cinema.svc.rate;
  ok(m.gen.goods < cinemaDraw, 'one mill supplies less than one Cinema draws, so a leisure block still needs more than one supplier',
    m.gen.goods + ' vs ' + cinemaDraw);
}

/* ── 7. every building that promises production in prose delivers it ─────── */
{
  /* Not a general rule — most buildings are honest — but the Sugar Mill's
     description promised an output for months while it declared none, and this
     is the cheap check that catches the next one. */
  const claimsOutput = /Presses cane into sugar/;
  ok(claimsOutput.test(NC) && BUILDINGS.sugarmill.gen.sugar > 0,
    'the Sugar Mill\'s description and its recipe now agree');
}

/* ── 8. the popup names the two ends of the chain ────────────────────────── */
{
  ok(/function _chainMakers/.test(NC) && /function _chainTakers/.test(NC), 'the panel can say who supplies and who consumes');
  ok(/comes from/.test(NC) && /feeds/.test(NC), 'and prints both directions');
  ok(/nothing in this city makes it/.test(NC), 'an input nothing produces is called out rather than left blank');
  {
    /* Derived from BUILDINGS, never hand-listed — a hand-written chain drifts
       the moment a recipe changes, which is the whole reason this is code. */
    const i = NC.indexOf('function _chainMakers');
    const seg = NC.slice(i, i + 700);
    ok(/for \(const key in BUILDINGS\)/.test(seg), 'derived from the building table itself, not a hand-kept list');
    ok(/!tt\.damaged && !bldSite\(tt\)/.test(seg), 'and it counts what is STANDING, so "none built" and "all broken" are different answers');
  }
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
