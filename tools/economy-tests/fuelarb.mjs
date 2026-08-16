/* 🛢 FUELARB — the NPC fuel vendor round-trip invariant.
   ----------------------------------------------------------------------------
   Run:  node tools/economy-tests/fuelarb.mjs
   Exits non-zero on any failure.

   WHY THIS FILE EXISTS, and why it does NOT hand-roll the arithmetic:
   the gas-station vendor has now printed money twice, and BOTH times the bug
   lived in the seam between two functions that each looked right alone:
     round 1  fcNpcBuy quoted the PRE-impact mark; fcNpcSell read the POST-impact
              mark that the buy itself had just raised.
     round 2  fcNpcQuote capped the BUY leg at s.hedge.price while fcSettleHedge
              paid out (s.npc - hedge.price) * qty — i.e. the buyer was handed
              back the very price rise their own capped buy had just caused.
     round 3  the fix for round 2 ENUMERATED the player's own price impact
              (s.selfLift / s.selfDrop) and missed the largest entry: the Crash
              Exchange's own player orders, _cxExecuteBuy / _cxExecuteSell, which
              write bumpMarketPriceUp('fuel', …) directly, need no inventory, and
              move the exact mark the hedge and the position settle against.
   Round 2 shipped past a green suite because that suite ASSIGNED s.hedge = {...}
   directly and only ever measured buy→sell. It never pressed the four buttons a
   player actually presses. Round 3 shipped past THIS suite because every section
   below drove the gas station's own buttons and none of them drove a button that
   lives on another screen. So §9 exists: it runs the real _cxExecuteBuy /
   _cxExecuteSell against the same profile. Every section measures Profile.gems,
   not a formula.

   And it does not re-implement the vendor or the exchange: it EXTRACTS the
   shipped function text out of public/index.html by brace-matching and evaluates
   THAT. The pricing kernel, both market writers, the mark and both legs all come
   from the page. Only non-pricing host plumbing (toasts, saves, cloud push, the
   txn ledger) is stubbed. A test carrying its own copy of the arithmetic cannot
   catch a change to the shipped arithmetic — which is the whole failure mode. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
let SRC = readFileSync(join(here, '..', '..', 'public', 'index.html'), 'utf8');

/* 🧨 THE SABOTAGE SWITCH — how this file is proved able to go RED.
   ----------------------------------------------------------------------------
   A tripwire nobody has watched trip is a comment, and this suite's predecessor
   printed seven green hedge rows while the hedge exploit was live. So each
   guard here accepts a deliberate injury: the ORIGINAL arithmetic is spliced
   back into the extracted source, in memory, and the shipped tree is never
   touched. FUELARB_SABOTAGE=<name>, or `all` for the full round-2 build:

     hedge-cap      put min(ask, s.hedge.price) back on the BUY leg
     hedge-payout   pay the hedge the raw (npc - strike), self-move included
     pos-mark       close a position against the raw s.npc
     forced-shock   treat a Force-Triggered shock as though the RNG rolled it

   `hedge-cap` + `hedge-payout` together ARE round 2. `pos-mark` and
   `hedge-payout` are also exactly what the round-2/round-3 tree did on the Crash
   Exchange path — with the self ledger at 0 (which is what a CX-only sequence
   leaves it at) "raw s.npc" IS the round-2 arithmetic — so they are what proves
   §9's guard load-bearing. Expected red rows are listed next to each patch. */
const SAB = process.env.FUELARB_SABOTAGE || '';
const want = (n) => SAB === 'all' || SAB.split(',').includes(n);
/* Anchors are matched line-ending-agnostically: index.html is CRLF in this repo
   and a literal "\n" in the pattern silently matches nothing, which would turn
   every sabotage into a no-op and this whole switch into theatre. */
/* `supersededBy` names a sabotage that rewrites the SAME expression and injures
   it strictly harder, so the two can never both apply. Only `linear-impact` vs
   `asym-tick` are in that relation today: linear-impact restores the retired
   kernel whole, which is the linear form AND the +1.2%/−1.0% asymmetry, so it
   consumes the line asym-tick would have patched. Without this, FUELARB_SABOTAGE
   =all threw on a stale-anchor error that was not stale at all — and a switch
   that dies on its own headline setting is exactly the un-watched tripwire this
   file exists to not be. The throw stays loud for every genuine case. */
function splice(name, find, repl, supersededBy) {
  if (!want(name)) return;
  if (supersededBy && want(supersededBy)) {
    console.log('🧨 SABOTAGE SKIPPED: ' + name + ' (superseded by ' + supersededBy + ', same expression)');
    return;
  }
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n'));
  if (!re.test(SRC)) throw new Error('FUELARB sabotage "' + name + '": anchor no longer present — the patch needs updating, not deleting');
  SRC = SRC.replace(re, () => repl);
  console.log('🧨 SABOTAGE ACTIVE: ' + name);
}
/* Apply the first alternative whose anchor is present. For a line that another
   sabotage may already have rewritten, so the two can compose in either order.
   Throws if none match — silence here would be the same un-watched tripwire. */
function spliceAny(name, alts) {
  if (!want(name)) return;
  for (const [find, repl] of alts) {
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n'));
    if (re.test(SRC)) { SRC = SRC.replace(re, () => repl); console.log('🧨 SABOTAGE ACTIVE: ' + name); return; }
  }
  throw new Error('FUELARB sabotage "' + name + '": no alternative anchor present — the patch needs updating, not deleting');
}
/* → expected red: NONE on its own, and that is worth stating plainly rather than
   pretending otherwise. With the payout guard in place, restoring the buy-leg
   cap makes the pump cheaper but leaves settlement at zero, and 0.95 x the
   post-impact bid never catches the pre-impact ask (the bid/ask ratio peaks at
   0.9579 around u=8 units). So removing the cap is NOT the load-bearing guard —
   `lift` is. The cap is gone because one instrument should have one payout and
   because it deletes the H term from the proof above; keep this switch because
   combined with `hedge-payout` it reconstitutes round 2 exactly (+41,055 at
   N=1250, +337,603 over 12 cycles), which is the number that matters. */
splice('hedge-cap',
  'function fcNpcQuote(qty, dir) {\n  const ask = fcNpcMark(qty, dir);',
  'function fcNpcQuote(qty, dir) {\n  const _s = ensureFuelCommand();\n  let ask = fcNpcMark(qty, dir);\n  if (_s.hedge && typeof _s.hedge.price === \'number\' && _s.hedge.price > 0) ask = Math.min(ask, _s.hedge.price);');
// → expected red: §4c (3 rows). With `hedge-cap` too: also §2 (5) and §4 (1).
splice('hedge-payout',
  'const diff = (mark - s.hedge.price) * s.hedge.qty;',
  'const diff = (s.npc - s.hedge.price) * s.hedge.qty;');
// → expected red, measured: 2 rows — §5 (1) and §10d (1, +112,580 at buy 1 /
//   sell 7 / settle-first). It used to redden §4c too; it no longer can, because
//   a forced shock stops moving the mark at all (see forced-mark-move), so there
//   is no self-made rise left for a raw payout to collect. Two guards covering
//   one row each is the healthy state — the count dropping is not the switch
//   going stale.
splice('pos-mark',
  'const mark = _fcSettleMark(s.pos.entry, dir, s.pos.exoLift, s.pos.exoDrop);',
  'const mark = s.npc;');
// → expected red, measured: 13 rows — §4b (8) and §9's five position rows, which
//   are the round-3 numbers exactly: +17,000,000 on a ¢5,000,000 long off one
//   ¢5,249 Crash Exchange order, and +23,000,000 on the short.
// → expected red: §4c. Treats a pressed Force Trigger as though the RNG rolled it.
splice('forced-shock',
  'if (forced) return;',
  'if (forced && false) return;');
/* → expected red, measured: 1 row (§12). Restores round 3's "a forced shock
   still moves the market, it just does not pay derivatives" — which protected
   the hedge and left the pump's physical leg selling into a free +50%. */
splice('forced-mark-move',
  'if (forced) return;',
  'if (forced) { _fcSelfMove(d, units, reason); return; }',
  'forced-shock');
// → expected red, measured: 4 rows — §4c (3) and §12 (1, +66,473).
/* ── round-4 sabotages. These reintroduce the two halves of the SPLIT-
   INDEPENDENCE invariant separately, so §10 is proved load-bearing for each on
   its own rather than only for both at once. */
// → expected red, measured ALONE: 10 rows — §10a (1), §10c (7, worst B=11/S=29
//   at +51,851), §10d (1), §10e (1). Under FUELARB_SABOTAGE=all, where the other
//   guards are down too, the same cell reads +62,829 — the number measured on
//   the shipped tree. This single line IS round 4: Math.round makes
//   barrels-per-unit non-constant (1.0 at qty=1, 29.0 at qty=29, 15.0 at
//   qty=30) so an 11-bbl buy and a 29-bbl sell cost the same one unit of impact
//   while the sell moves 2.6x the barrels.
/* Reintroduces the ROUNDING ONLY, and leaves the venue scale where it now
   belongs (on the price row) so this switch isolates round 4 rather than
   bundling §11c's door with it. The units are quantised to multiples of 20 bbl,
   which is exactly what max(1, round(bbl/20)) whole units meant before the scale
   moved: 11 bbl and 29 bbl both land on one unit, 30 bbl on two.
   ⚠ The literal 0.05, not FC_NPC_CX_UNITS_PER_BBL. The first version of this
     patch used the alias and this switch went red on a NaN — the alias resolves
     through CX_IMPACT_SCALE, so a patch that also blanked the scale made every
     impact undefined and the market simply stopped moving. It was red, and red
     for a reason that has nothing to do with the bug it claims to restore. A
     sabotage that fails for the wrong reason is worse than none: it reports the
     guard is load-bearing when the guard was never exercised. */
splice('step-units',
  'function _fcCxUnits(qty) { return Math.max(0, +qty || 0); }',
  'function _fcCxUnits(qty) { return Math.max(1, Math.round(Math.max(1, qty | 0) * 0.05)) / 0.05; }');
// → expected red, measured: 7 rows — §10a (1) and §10b (6). The retired kernel: impact
//   linear in the LOT, so (1+t·a)(1+t·b) != (1+t·(a+b)) and the mark depends on
//   how the order was chopped. Also restores the +1.2%/−1.0% asymmetry, which
//   is what lifted the sell path above the buy path independently of rounding.
splice('linear-impact',
  '  const rate = (dir > 0 && reason === \'craft\') ? CX_PRICE_TICK_CRAFT : CX_PRICE_TICK_TRADE;\n  const factor = Math.pow(1 + rate, dir > 0 ? n : -n);\n  if (dir > 0) return Math.min(p.base * CX_PRICE_MAX_FACTOR, p.current * factor);\n  return Math.max(p.base * CX_PRICE_MIN_FACTOR, p.current * factor);',
  '  if (dir > 0) {\n    const tick = (reason === \'craft\' ? CX_PRICE_TICK_CRAFT : CX_PRICE_TICK_TRADE);\n    return Math.min(p.base * CX_PRICE_MAX_FACTOR, p.current * (1 + tick * n));\n  }\n  return Math.max(p.base * CX_PRICE_MIN_FACTOR, p.current * (1 - 0.010 * n));');
// → expected red, measured: 6 rows, ALL of them §10b, and §10c stays green.
//   State that plainly rather than implying more: with the step function gone,
//   asymmetry alone (+1.2% up vs −1.0% down) does NOT make a physical round trip
//   profitable at any lot size in GRID — the 5% vendor spread still covers it.
//   What it does is ratchet: one 62.5-unit wash cycle leaves the mark at ¢112.46
//   instead of ¢100, so the mark is no longer a function of net position and
//   every repeat lifts it again, for free. That is a faucet for anything reading
//   the mark (the hedge, both position sides, p2p listings, every other screen
//   that prices off cx 'fuel'), and it is the state the tree was in for three
//   rounds while a pair-only proof called it safe. §10b is deliberately a
//   PROPERTY test on the mark, not a money test, because the money test does not
//   see this one until someone finds the instrument that monetises it.
splice('asym-tick',
  'const factor = Math.pow(1 + rate, dir > 0 ? n : -n);',
  'const factor = dir > 0 ? Math.pow(1 + rate, n) : Math.pow(1 - 0.010, n);',
  'linear-impact');
// → expected red, measured ALONE: 5 rows — §11a (3, q=250/400/600), §11b (1),
//   §11c (1). Restores the pre-impact quote on both CX legs, the state the tree
//   shipped in for four rounds. Alone the numbers are small (+101 to +9,014)
//   because the venue scale now damps a share's impact 20x; with the scale also
//   down, under =all, the same wash cycle reads +83,785 at 400 shares. Both
//   guards are needed and neither is sufficient — which is the point of having
//   them as separate switches.
splice('cx-pre-impact',
  'let _mark = cxImpactedPrice(_pRow, qty, +1, \'buy\');',
  'let _mark = _pRow.current;');
splice('cx-pre-impact',
  'let _markS = cxImpactedPrice(_pRowS, qty, -1, \'sell\');',
  'let _markS = _pRowS.current;');
// → expected red, measured: 1 row (§11b). Restores the raw typed price.
splice('cx-typed-price',
  'const px = (typeof _pxOverride === \'number\' && isFinite(_pxOverride)) ? Math.max(_pxOverride, _mark) : _mark;',
  'const px = (typeof _pxOverride === \'number\') ? _pxOverride : _mark;');
splice('cx-typed-price',
  'const marketPx = (typeof _pxOverride === \'number\' && isFinite(_pxOverride)) ? Math.min(_pxOverride, _markS) : _markS;',
  'const marketPx = (typeof _pxOverride === \'number\') ? _pxOverride : _markS;');
// → expected red, measured: 2 rows — §11c (+18,469 at 400 bbl + 100 shares) and
//   §11d. Puts the 1/20 back at the gas station's call site and takes it off the
//   price row, which is exactly the split that let a ¢100 CX share out-shove
//   twenty ¢88 barrels. Composes with step-units (11 rows together).
splice('venue-split-scale',
  'const CX_IMPACT_SCALE      = { fuel: 0.05 };',
  'const CX_IMPACT_SCALE      = { };');
/* This one composes with step-units — both move the same line, and the two
   doors really are independent, so the pair must be able to apply together.
   spliceAny takes the first alternative whose anchor is present: the second is
   the shape _fcCxUnits has once step-units has already patched it. Exactly one
   must match, and spliceAny throws if none does. */
spliceAny('venue-split-scale', [
  ['function _fcCxUnits(qty) { return Math.max(0, +qty || 0); }',
   'function _fcCxUnits(qty) { return Math.max(0, +qty || 0) * 0.05; }'],
  ['function _fcCxUnits(qty) { return Math.max(1, Math.round(Math.max(1, qty | 0) * 0.05)) / 0.05; }',
   'function _fcCxUnits(qty) { return Math.max(1, Math.round(Math.max(1, qty | 0) * 0.05)); }'],
]);
/* FUELARB_SABOTAGE=all ⇒ asym-tick skipped (superseded), 52 rows red — and that
   run reconstitutes the ORIGINAL tree closely enough to reproduce every number
   this file's history quotes, which is the real check that these switches are
   faithful rather than merely destructive:
       §2   hedge combo N=1250 ............ +41,055   (round 2's headline)
       §4   twelve repeated cycles ........ +337,603  (the non-decaying faucet)
       §9   long ¢5,000,000 + cx buy 50 ... +17,000,000 (round 3's headline)
       §10c buy 11 / sell 29 .............. +62,829   (round 4's headline)
       §11a 400-share wash trade .......... +83,785
       §11b typed prices .................. +44,882,771
       §11c 400 bbl + 300 shares .......... +87,298
       §12  1250 bbl + Force Trigger ...... +71,796
   53 rows red in total.                                                     */

let bad = 0;
const fail = (m) => { bad++; console.log('   ❌ ' + m); };
const ok   = (m) => console.log('   ✅ ' + m);

/* ── EXTRACTION ─────────────────────────────────────────────────────────────
   Pull `function NAME(...) { ... }` out of the page by counting braces from the
   opening one. Crude, but every function taken here is a plain top-level
   declaration with balanced braces and no brace-bearing string or regex
   literal, and the alternative — a second copy of the code living in the test —
   is precisely what let round 2 ship green. */
function grabFn(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('FUELARB: cannot find function ' + name + ' in index.html');
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(at + 1, j + 1); }
  }
  throw new Error('FUELARB: unbalanced braces in ' + name);
}
/* Constants come from the page too: "no numeric literal at a call site" is only
   a meaningful rule if the test reads the same named values. */
function grabConst(name) {
  const m = new RegExp('^const ' + name + '\\s*=\\s*([^;]+);', 'm').exec(SRC);
  if (!m) throw new Error('FUELARB: cannot find const ' + name);
  return 'const ' + name + ' = ' + m[1].replace(/\/\/.*$/gm, '').trim() + ';';
}

const CONSTS = [
  'CX_PRICE_TICK_TRADE', 'CX_PRICE_TICK_CRAFT', 'CX_IMPACT_SCALE',
  'CX_PRICE_MIN_FACTOR', 'CX_PRICE_MAX_FACTOR', 'CX_DECAY_FACTOR',
  'CX_DECAY_INTERVAL_MS', 'CX_TXN_LOG_CAP',
  /* §9 — the Foundation Reserve quote the real CX order desk trades through. */
  'CX_RESERVE_SPREAD', 'CX_RESERVE_REFILL_RATE', 'CX_RESERVE_MIN_FILL_MS',
  'FC_NPC_CX_ANCHOR', 'FC_NPC_SPREAD', 'FC_NPC_MIN', 'FC_NPC_MAX',
  'FC_NPC_SUPPLY_PER_BBL', 'FC_NPC_CX_UNITS_PER_BBL', 'FC_NPC_EVENT_SHOCK_BBL',
];
/* Order matters only for readability — these are hoisted declarations. */
const FNS = [
  '_fcClamp', '_fcCxUnits', '_cxBasePrice',
  'getCrashExchange', 'getMarketPrice', 'tickMarketDecay',
  'cxImpactedPrice', 'bumpMarketPriceUp', 'dropMarketPriceDown',
  /* §9 — the REAL player order desk, extracted, not re-implemented. */
  '_cxInitialReserve', '_cxEnsureReserveModel', '_cxGetReserve',
  '_cxQuoteBuy', '_cxQuoteSell', '_cxReserveOnBuy', '_cxReserveOnSell',
  '_cxExecuteBuy', '_cxExecuteSell',
  'fcNpcMark', 'fcNpcQuote', 'fcRecalcNpc',
  'fcNpcBuy', 'fcNpcSell', 'fcLockHedge', 'fcSettleHedge',
  '_fcSelfMove', '_fcExoMove', '_fcWriteMark', '_fcSettleMark',
  'fcOpenPos', 'fcClosePos', '_fcRnd', '_fcShock', 'fcFireEvent',
];

/* ── HOST STUBS ─────────────────────────────────────────────────────────────
   Only things that move no price and no Cinder, plus addGems/Profile which ARE
   the measurement. Deliberately thin: if the vendor ever routes currency through
   a path not listed here the extraction throws rather than passing quietly. */
function boot(opts) {
  opts = opts || {};
  const stub = {};
  stub.Profile = { gems: opts.gems || 10000000, cxHoldings: {} };
  stub.Forge = { crashExchange: { prices: {}, txnLog: [], lastDecayAt: Date.now() }, cxReserve: {} };
  /* The REAL SALVAGE_RES row for fuel (index.html:75777) — no `value`, no
     `price`, no `cat`, so _cxBasePrice falls through to its 100 default. Do not
     leave this map empty: an absent id skips the resource branch entirely and
     _cxBasePrice returns its 200 item default, which quietly doubles every
     number in this file and pushes §8 into the FC_NPC_MAX rail. */
  stub._SALVAGE_BY_ID = { fuel: { id: 'fuel', name: 'Fuel', icon: '⛽' } };
  stub.showToast = () => {};
  stub.saveProfile = () => {};
  stub.saveForge = () => {};
  stub.cxCloudQueuePush = () => {};
  stub._serverMirrorCharge = () => {};
  stub._fcLog = () => {};
  stub._fcFmt = (n) => String(n);
  stub.notEnoughToast = () => false;
  stub.recordMarketTxn = () => {};              // append-only ledger; moves no price
  /* §9 host plumbing for _cxExecuteBuy/_cxExecuteSell. None of it moves a price
     or a Cinder balance — the CX's own Cinder movements go through Profile.gems
     and addGems, which are the measurement. */
  stub._saveCxHoldings = () => {};
  stub._cxPushEvent = () => {};
  stub._cxFmtCR = (n) => String(Math.round(n)) + ' CR';
  stub._persistProgressNow = () => {};
  /* Only the three price-moving events matter here; the rest do damage/reputation
     and are irrelevant to a currency invariant. Shapes match FC_EVENTS. */
  stub.FC_EVENTS = [{ id: 'spike', sev: 2, nm: 'Price Spike', ico: '📈', d: '' },
                    { id: 'short', sev: 2, nm: 'Sector Shortage', ico: '🛢', d: '' },
                    { id: 'glut',  sev: 2, nm: 'Refinery Glut', ico: '📉', d: '' }];
  stub.addGems = (n) => { stub.Profile.gems = (stub.Profile.gems | 0) + (n | 0); };

  const S = {
    fuel: 0, fuelCap: opts.fuelCap || 1250, supply: 50, npc: 0, lastNpc: 0,
    npcHist: [], hedge: null, pos: null, upgrades: { tank: 1 },
    workers: 3, insured: false, exoLift: 0, exoDrop: 0,
    // fields fcFireEvent's other branches read; irrelevant to the invariant but
    // they must exist or a forced event throws before reaching the shock
    threat: 18, security: 35, damage: 0, power: 100, crude: 120, crudeCap: 800,
    repSafety: 0, repQuality: 0, repReli: 0, rep: 62, log: [],
  };
  stub.ensureFuelCommand = () => S;

  const names = Object.keys(stub);
  /* Memoised: §10 boots a fresh profile per sweep cell and the extraction walks
     an 11 MB string 30-odd times. Building the body once takes the sweep from
     minutes to seconds; the per-boot state is all in `stub`, which is rebuilt
     above every call, so nothing leaks between cells. */
  if (!boot._body) boot._body = [
    ...CONSTS.map(grabConst),
    ...FNS.map(grabFn),
    'return { ' + [...FNS, ...CONSTS].join(', ') + ' };',
  ].join('\n');
  const w = new Function(...names, boot._body)(...names.map((n) => stub[n]));
  w.S = S;
  w.Profile = stub.Profile;
  w.fcRecalcNpc();
  return w;
}

const money  = (w) => w.Profile.gems | 0;
const cxFuel = (w) => w.getMarketPrice('fuel').current;
const fmt    = (n) => (n >= 0 ? '+' : '') + Math.round(n).toLocaleString('en-US');
const pad    = (n) => String(n).padStart(4);

console.log('\n🛢  FUELARB — NPC fuel vendor round-trip invariant');
const QTYS = [1, 5, 25, 50, 137, 200, 500, 999, 1250];

/* ── §1  THE PLAIN ROUND TRIP ───────────────────────────────────────────────
   Buy N, immediately sell N. Strictly poorer at every N, including sizes big
   enough to slam the exchange into a clamp. */
console.log('\n§1 buy N → sell N must always LOSE');
for (const n of QTYS) {
  const w = boot();
  const g0 = money(w);
  w.fcNpcBuy(n); w.fcNpcSell(n);
  const d = money(w) - g0;
  d < 0 ? ok(`N=${pad(n)}  net ${fmt(d)}`)
        : fail(`N=${n} round trip PROFITED ${fmt(d)} — the vendor is a faucet`);
}

/* ── §2  THE HEDGE COMBO — the round-2 exploit, pressed as a player presses it.
   Lock → Buy → Settle → Sell through the REAL fcLockHedge / fcSettleHedge. A
   test that assigns s.hedge by hand is blind to this; that is how it shipped. */
console.log('\n§2 Lock → Buy → Settle → Sell must always LOSE');
for (const n of QTYS) {
  const w = boot();
  const g0 = money(w);
  w.fcLockHedge(n);   // free, struck at the pre-buy mark
  w.fcNpcBuy(n);      // the buy raises the exchange
  w.fcSettleHedge();  // ...settle tries to collect that self-made rise
  w.fcNpcSell(n);     // ...then dump the barrels as well
  const d = money(w) - g0;
  d < 0 ? ok(`N=${pad(n)}  net ${fmt(d)}`)
        : fail(`N=${n} hedge combo PROFITED ${fmt(d)} — FUELARB is live`);
}

/* Settling AFTER the dump is a different four-click path, so pin it separately. */
console.log('\n§3 Lock → Buy → Sell → Settle must always LOSE');
for (const n of QTYS) {
  const w = boot();
  const g0 = money(w);
  w.fcLockHedge(n); w.fcNpcBuy(n); w.fcNpcSell(n); w.fcSettleHedge();
  const d = money(w) - g0;
  d < 0 ? ok(`N=${pad(n)}  net ${fmt(d)}`)
        : fail(`N=${n} hedge-last combo PROFITED ${fmt(d)}`);
}

/* ── §4  REPETITION. The round-2 faucet did not decay: once the exchange pinned
   at its 35% floor every further cycle netted a flat positive, forever. One
   profitable cycle is a bug; a NON-DECAYING one is unbounded. Pin the sum. */
console.log('\n§4 twelve repeated hedge cycles on ONE profile must LOSE overall');
{
  const w = boot();
  const g0 = money(w);
  const n = w.S.fuelCap;
  for (let c = 0; c < 12; c++) { w.fcLockHedge(n); w.fcNpcBuy(n); w.fcSettleHedge(); w.fcNpcSell(n); }
  const d = money(w) - g0;
  d < 0 ? ok(`12 cycles @ ${n} bbl  net ${fmt(d)}`)
        : fail(`12 repeated cycles PROFITED ${fmt(d)} — unbounded faucet`);
}

/* ── §4b  THE LEVERED TWIN. fcOpenPos/fcClosePos settles against the same mark
   with 4x leverage and no stake ceiling, so the identical mechanism was a
   strictly larger faucet — and one the round-2 brief did not name. Both sides:
   a LONG pumps the mark by buying, a SHORT dumps it by selling. Closing may
   never return more than the stake when the only mover was us. */
console.log('\n§4b LONG/SHORT + self-move must never return more than the stake');
for (const stake of [1000, 100000, 1000000, 5000000]) {
  {                                             // LONG: pump the mark by buying
    const w = boot({ gems: 40000000 });
    w.fcOpenPos('long', stake);
    w.fcNpcBuy(w.S.fuelCap);
    const pre = money(w);
    w.fcClosePos();
    const back = money(w) - pre;
    back <= stake ? ok(`long  stake ${String(stake).padStart(7)}  close returned ${fmt(back)} <= stake`)
                  : fail(`long stake ${stake} close returned ${fmt(back)} > stake — levered faucet`);
  }
  {                                             // SHORT: dump the mark by selling
    const w = boot({ gems: 40000000 });
    w.fcNpcBuy(w.S.fuelCap);                    // stock up first (costs money)
    w.fcOpenPos('short', stake);
    w.fcNpcSell(w.S.fuel);
    const pre = money(w);
    w.fcClosePos();
    const back = money(w) - pre;
    back <= stake ? ok(`short stake ${String(stake).padStart(7)}  close returned ${fmt(back)} <= stake`)
                  : fail(`short stake ${stake} close returned ${fmt(back)} > stake — levered faucet`);
  }
}

/* ── §4c  THE FORCE-TRIGGER DOOR. The Events tab renders a "Force Trigger"
   button for EVERY event (_fcRenderEvents, data-fc-fire), two of which shock the
   fuel price. That made the cheapest faucet of the lot — no Cinder spent at all:
   Lock 1250 → Force Trigger 'Price Spike' → Settle. A shock the player pressed
   is a shock the player caused. */
console.log('\n§4c Lock → FORCE spike → Settle must pay nothing');
for (const ev of ['spike', 'short']) {
  const w = boot();
  const g0 = money(w);
  w.fcLockHedge(w.S.fuelCap);
  w.fcFireEvent(ev);                             // the button, one click
  w.fcSettleHedge();
  const d = money(w) - g0;
  d <= 0 ? ok(`forced '${ev}' → hedge paid ${fmt(d)}`)
         : fail(`forced '${ev}' PAID ${fmt(d)} for a shock the player chose`);
}
{ /* and it must not accumulate across repeats, which is how it reached +275k */
  const w = boot();
  const g0 = money(w);
  for (let c = 0; c < 6; c++) { w.fcLockHedge(w.S.fuelCap); w.fcFireEvent('spike'); w.fcSettleHedge(); }
  const d = money(w) - g0;
  d <= 0 ? ok(`6 forced-spike cycles → ${fmt(d)}`)
         : fail(`6 forced-spike cycles PAID ${fmt(d)}`);
}
/* The other half of that line: a ROLLED shock is exogenous and MUST still pay,
   or the hedge has no reason to exist. _fcShock(false, ...) is the rolled path. */
console.log('\n§4d a ROLLED spike is exogenous and must still pay the hedge');
{
  const w = boot();
  w.fcLockHedge(w.S.fuelCap);
  const g0 = money(w);
  w._fcShock(false, 'gasStation:spike');
  w.fcSettleHedge();
  const d = money(w) - g0;
  d > 0 ? ok(`rolled spike → hedge paid ${fmt(d)}`)
        : fail('a rolled spike paid nothing — the hedge was gutted, not fixed');
}

/* ── §5  AN UNATTRIBUTED MARK MOVE PAYS NOTHING — the round-3 guard, stated in
   its most general form. Round 2 asked "did WE cause this rise?" and paid if the
   answer was no; the answer was computed from a list of our own call sites, and
   _cxExecuteBuy was not on it. Round 3 asks "is a recorded exogenous shock on
   file for this rise?" and pays only that far. Here the mark is shoved by writing
   p.current directly — the crudest possible stand-in for a mover this file has
   never heard of — and the correct payout is zero.
   ⚠ THIS INVERTS THE OLD §5. That is the deliberate trade: fail-closed costs a
   hedger payout on a move nobody recorded, where fail-open minted Cinder. §4d,
   §5b and §5c are what keep the instruments real. */
console.log('\n§5 a mark move with no recorded shock behind it pays NOTHING');
{
  const w = boot();
  w.fcLockHedge(500);
  const p = w.getMarketPrice('fuel');
  p.current *= 1.5;                              // a mover this file cannot name
  w.fcRecalcNpc();
  const g0 = money(w);
  w.fcSettleHedge();
  const d = money(w) - g0;
  d === 0 ? ok(`unattributed +50% → hedge paid ${fmt(d)}`)
          : fail(`unattributed +50% PAID ${fmt(d)} — the ledger is fail-open again`);
}
/* Guard against "fixed" by neutering: the instruments must still pay on the one
   thing that IS recorded — a shock the RNG rolled — and must survive a self-move
   mixed in, which contributes nothing but must not poison the exogenous half. */
console.log('\n§5b a LONG across a ROLLED spike still pays, even after a self-buy');
{
  const w = boot({ gems: 40000000 });
  w.fcOpenPos('long', 100000);
  w.fcNpcBuy(200);                               // our own pump — must NOT count
  w._fcShock(false, 'gasStation:spike');         // the RNG's — must count
  const pre = money(w);
  w.fcClosePos();
  const back = money(w) - pre;
  back > 100000 ? ok(`rolled spike → long returned ${fmt(back)} on a 100,000 stake`)
                : fail(`long returned ${fmt(back)} <= stake on a rolled shock — instrument is dead`);
}
/* The SHORT side has to be alive too, or the UI ships a button that can only
   lose. Its payer is the rolled 'glut' — the only writer of s.exoDrop. */
console.log('\n§5c a SHORT across a ROLLED glut still pays, even after a self-sell');
{
  const w = boot({ gems: 40000000 });
  w.fcNpcBuy(400);                               // stock up (costs money)
  w.fcOpenPos('short', 100000);
  w.fcNpcSell(400);                              // our own dump — must NOT count
  w._fcShock(false, 'gasStation:glut', -1);      // the rolled downward shock
  const pre = money(w);
  w.fcClosePos();
  const back = money(w) - pre;
  back > 100000 ? ok(`rolled glut → short returned ${fmt(back)} on a 100,000 stake`)
                : fail(`short returned ${fmt(back)} <= stake on a rolled glut — short side is dead`);
}

/* ── §6  TRADES MOVE THE EXCHANGE, in the right direction. */
console.log('\n§6 buy pushes cx fuel UP, sell pushes it DOWN');
{
  const w = boot();
  const a = cxFuel(w); w.fcNpcBuy(200); const b = cxFuel(w);
  b > a ? ok(`buy  200: cx fuel ${a.toFixed(3)} → ${b.toFixed(3)}`)
        : fail(`buy did not raise cx fuel (${a} → ${b})`);
  w.fcNpcSell(200); const c = cxFuel(w);
  c < b ? ok(`sell 200: cx fuel ${b.toFixed(3)} → ${c.toFixed(3)}`)
        : fail(`sell did not lower cx fuel (${b} → ${c})`);
}

/* ── §7  THE QUOTE AND THE WRITE ARE THE SAME NUMBER — round 1 in one line. */
console.log('\n§7 quoted post-impact mark == mark after the write');
for (const n of [1, 50, 200, 1250]) {
  const w = boot();
  const quoted = w.fcNpcQuote(n, +1).ask;
  w.fcNpcBuy(n);
  Math.abs(quoted - w.S.npc) < 1e-9
    ? ok(`N=${pad(n)}  ask ¢${quoted.toFixed(4)} == post-write mark`)
    : fail(`N=${n} quote ¢${quoted} but market landed at ¢${w.S.npc}`);
}

/* ── §8  THE NPC PRICE DERIVES FROM THE EXCHANGE, not from a local index. */
console.log('\n§8 npc mark is a pure function of the crash exchange');
{
  const w = boot();
  const before = w.S.npc;
  w.S.supply = 3;                                // slam the local sentiment index
  w.fcRecalcNpc();
  Math.abs(w.S.npc - before) < 1e-9 ? ok('s.supply no longer prices anything')
                                    : fail('s.supply still moves the vendor price');
  const p = w.getMarketPrice('fuel');
  p.current = p.base * 2;
  w.fcRecalcNpc();
  const want = p.current * w.FC_NPC_CX_ANCHOR;
  Math.abs(w.S.npc - want) < 1e-9
    ? ok(`cx fuel ×2 → npc ¢${w.S.npc.toFixed(2)} = cx × FC_NPC_CX_ANCHOR`)
    : fail(`npc ¢${w.S.npc} != cx ${p.current} × anchor ${w.FC_NPC_CX_ANCHOR}`);
}

/* ── §9  THE CRASH EXCHANGE DOOR — round 3, and the reason this file now boots
   the real order desk. _cxExecuteBuy('fuel', 50) costs ¢5,249, needs no fuel in
   the tank (CX shares are pure paper) and lives on a different screen, so round
   2's enumeration of the gas station's own call sites never saw it. It moved the
   mark by +60% and the position collected the lot:
        stake ¢5,000,000 → close returned +17,000,000  (+11,994,751 net)
        stake ¢1,000,000 → close returned  +3,400,000  ( +2,394,751 net)
   The only extra beat is fcRecalcNpc(), which the shipped client runs for free
   every 30s inside fcTick. */
console.log('\n§9 a Crash Exchange order must not fund a hedge or a position');
for (const stake of [1000, 100000, 1000000, 5000000]) {
  const w = boot({ gems: 60000000 });
  w.fcOpenPos('long', stake);
  w._cxExecuteBuy('fuel', 50);                   // the real order desk
  w.fcRecalcNpc();                               // the 30s fcTick
  const pre = money(w);
  w.fcClosePos();
  const back = money(w) - pre;
  back <= stake ? ok(`long  stake ${String(stake).padStart(8)}  cx-pumped close returned ${fmt(back)} <= stake`)
                : fail(`long stake ${stake} cx-pumped close returned ${fmt(back)} > stake — FUELARB round 3 is live`);
}
{
  const w = boot({ gems: 60000000 });
  const g0 = money(w);
  w.fcLockHedge(w.S.fuelCap);
  w._cxExecuteBuy('fuel', 50);
  w.fcRecalcNpc();
  w.fcSettleHedge();
  const d = money(w) - g0;
  d < 0 ? ok(`hedge ${w.S.fuelCap} + cx buy 50  net ${fmt(d)}`)
        : fail(`hedge + cx buy PROFITED ${fmt(d)} — the exchange still funds the hedge`);
}
{ /* and the short half: dump CX shares to shove the mark down under a SHORT */
  const w = boot({ gems: 60000000 });
  w._cxExecuteBuy('fuel', 400);
  w.fcRecalcNpc();
  w.fcOpenPos('short', 5000000);
  w._cxExecuteSell('fuel', 400);
  w.fcRecalcNpc();
  const pre = money(w);
  w.fcClosePos();
  const back = money(w) - pre;
  back <= 5000000 ? ok(`short stake 5,000,000  cx-dumped close returned ${fmt(back)} <= stake`)
                  : fail(`short cx-dumped close returned ${fmt(back)} > stake — FUELARB round 3 is live`);
}

/* ── §10  ROUND 4 — THE SEQUENCE CASE. ──────────────────────────────────────
   Everything above §10 measures ONE PAIR: buy q, sell the same q. That is what
   the shipped five-step proof covers, and it stayed true through round 4 while
   the vendor was a faucet — because a player does not have to close in the lot
   size they opened in. §10 measures SEQUENCES, and the mismatched buy/sell
   sizes are the whole point of the grid.

   The invariant being pinned: the mark is p0 · ρ^(units bought − units sold)
   with one ρ for both directions, so it depends only on NET quantity and never
   on how the order was split. §10a and §10b test the two halves of that
   directly and cheaply; §10c–§10e are the end-to-end money sweep that would
   have caught round 4 without anyone knowing which door to look for. */
const GRID = [1, 7, 11, 29, 30, 100, 250];

console.log('\n§10a the mark depends on NET quantity, not on how the order was split');
{
  const marks = GRID.map((lot) => {
    const w = boot();
    const p = w.getMarketPrice('fuel');
    /* Exactly 1050 barrels every time, including the short final lot — most of
       GRID does not divide 1050, and letting the loop overshoot would compare
       rows that traded different totals and call the difference
       split-dependence. The ragged last lot is itself another split, so it
       belongs in the test rather than being rounded away.
       1050 bbl = 52.5 units ⇒ 1.012^52.5 = ¢186.8, clear of the ¢350 ceiling:
       a clamped row would land on the ceiling from every direction and pass
       this check while proving nothing. */
    for (let done = 0; done < 1050; done += lot) {
      const take = Math.min(lot, 1050 - done);
      w._fcWriteMark(+1, w._fcCxUnits(take), 'gasStation:npcBuy');
    }
    return { lot, px: p.current };
  });
  const lo = Math.min(...marks.map((m) => m.px)), hi = Math.max(...marks.map((m) => m.px));
  const spread = (hi - lo) / lo;
  spread < 1e-9
    ? ok(`1050 bbl in lots of ${GRID.join('/')} all land on cx ¢${hi.toFixed(6)}`)
    : fail(`split-dependent mark: same 1050 bbl lands ¢${lo.toFixed(3)}–¢${hi.toFixed(3)} ` +
           `(${(spread * 100).toFixed(1)}% spread) — order splitting moves the price`);
}

console.log('\n§10b N units up then N units down returns the mark EXACTLY to where it started');
for (const n of [1, 0.55, 1.45, 5, 12.5, 62.5]) {
  const w = boot();
  const p = w.getMarketPrice('fuel');
  const p0 = p.current;
  w._fcWriteMark(+1, n, 'gasStation:npcBuy');
  w._fcWriteMark(-1, n, 'gasStation:npcSell');
  const drift = Math.abs(p.current - p0) / p0;
  drift < 1e-12
    ? ok(`n=${String(n).padStart(5)}  cx ¢${p0.toFixed(4)} → ¢${p.current.toFixed(4)} (drift ${drift.toExponential(1)})`)
    : fail(`n=${n} round trip left the mark at ¢${p.current.toFixed(6)} not ¢${p0.toFixed(6)} — ` +
           `impact is not reciprocal, so the sell path is not the mirror of the buy path`);
}

/* ── §10c  THE SWEEP. Accumulate to the tank cap in B-bbl lots, then liquidate
   every barrel in S-bbl lots. Ends holding NOTHING, so the Cinder delta is the
   entire story. B != S is the case the pair proof never covered and the case
   round 4 lived in. No cell may profit. */
console.log('\n§10c buy-lot × sell-lot sweep — no cell may profit');
{
  let worst = null;
  const rows = [];
  for (const B of GRID) {
    const cells = [];
    for (const S of GRID) {
      const w = boot();
      const g0 = money(w);
      let guard = 0;
      while (w.S.fuel + B <= w.S.fuelCap && guard++ < 4000) if (!w.fcNpcBuy(B)) break;
      guard = 0;
      while (w.S.fuel > 0 && guard++ < 4000) w.fcNpcSell(Math.min(S, w.S.fuel));
      const d = money(w) - g0;
      if (!worst || d > worst.d) worst = { B, S, d };
      if (d >= 0) fail(`buy ${B} / sell ${S} PROFITED ${fmt(d)} — the sell path is above the buy path`);
      cells.push(fmt(d).padStart(11));
    }
    rows.push('   ' + String(B).padStart(4) + ' |' + cells.join(''));
  }
  console.log('   buy\\sell |' + GRID.map((s) => String(s).padStart(11)).join(''));
  rows.forEach((r) => console.log(r));
  console.log(`   WORST cell: buy ${worst.B} / sell ${worst.S} → ${fmt(worst.d)}`);
  worst.d < 0 ? ok(`worst of ${GRID.length * GRID.length} cells is a ${fmt(worst.d)} LOSS`)
              : fail(`worst cell profits ${fmt(worst.d)}`);
}

/* ── §10d  the same sweep with a HEDGE wrapped around it, settled on both sides
   of the dump. Round 4 needed no hedge, but a critic will ask whether the two
   combine — the hedge pays only for a recorded shock (§5) and there is none
   here, so the answer must be "identical numbers, still a loss". */
console.log('\n§10d the sweep with a hedge cycle wrapped around it — still no profit');
{
  let worst = null;
  for (const B of GRID) for (const S of GRID) for (const when of ['settle-first', 'settle-last']) {
    const w = boot();
    const g0 = money(w);
    w.fcLockHedge(w.S.fuelCap);
    let guard = 0;
    while (w.S.fuel + B <= w.S.fuelCap && guard++ < 4000) if (!w.fcNpcBuy(B)) break;
    if (when === 'settle-first') w.fcSettleHedge();
    guard = 0;
    while (w.S.fuel > 0 && guard++ < 4000) w.fcNpcSell(Math.min(S, w.S.fuel));
    if (when === 'settle-last') w.fcSettleHedge();
    const d = money(w) - g0;
    if (!worst || d > worst.d) worst = { B, S, when, d };
  }
  worst.d < 0 ? ok(`worst hedged cell: buy ${worst.B} / sell ${worst.S} / ${worst.when} → ${fmt(worst.d)}`)
              : fail(`hedged sweep PROFITED ${fmt(worst.d)} at buy ${worst.B} / sell ${worst.S} / ${worst.when}`);
}

/* ── §10e  and with a levered CX position open across it. Door 2's guard is the
   exogenous ledger; this checks the two guards do not cancel — the position
   must return exactly its stake while the physical sweep still loses. */
console.log('\n§10e the sweep with a CX position opened and closed across it — still no profit');
{
  let worst = null;
  for (const side of ['long', 'short']) for (const B of GRID) for (const S of GRID) {
    const w = boot({ gems: 60000000 });
    const g0 = money(w);
    w.fcOpenPos(side, 5000000);
    w._cxExecuteBuy('fuel', 50);                 // the paper leg, on another screen
    let guard = 0;
    while (w.S.fuel + B <= w.S.fuelCap && guard++ < 4000) if (!w.fcNpcBuy(B)) break;
    guard = 0;
    while (w.S.fuel > 0 && guard++ < 4000) w.fcNpcSell(Math.min(S, w.S.fuel));
    w.fcRecalcNpc();
    w.fcClosePos();
    const held = (w.Profile.cxHoldings.fuel && w.Profile.cxHoldings.fuel.qty) | 0;
    if (held > 0) w._cxExecuteSell('fuel', held);
    const d = money(w) - g0;
    if (!worst || d > worst.d) worst = { side, B, S, d };
  }
  worst.d < 0 ? ok(`worst position cell: ${worst.side} buy ${worst.B} / sell ${worst.S} → ${fmt(worst.d)}`)
              : fail(`position sweep PROFITED ${fmt(worst.d)} at ${worst.side} buy ${worst.B} / sell ${worst.S}`);
}

/* ── §10f  THE FEATURE MUST SURVIVE. Every guard above is a refusal to pay, and
   a refusal to pay is trivially satisfiable by making fuel worthless. A player
   who buys, holds while the mark genuinely rises on a shock they did not cause,
   and then sells, MUST come out ahead — otherwise this is not a fix, it is a
   removal.
   ⚠ FILLED IN LOTS, deliberately. A single 1250-bbl market order is 62.5 units
     of impact in one click: it doubles the mark by itself and the buyer pays
     that doubled mark on every barrel. That trade loses to two +50% shocks and
     SHOULD — it is slippage on an order the size of the whole market, not the
     guard biting. It also lost by almost exactly the same amount before this
     round's kernel change (measured: −57,833 on the retired linear kernel,
     −58,292 now), so a one-click row here would be pinning a pre-existing cost
     of market impact and calling it a regression. What must hold, and what this
     measures, is that a holder who fills sensibly is paid for a rise they did
     not cause — at every size, including the tank cap. */
console.log('\n§10f honest buy-and-hold across a rise the player did not cause must PROFIT');
for (const n of [100, 500, 1250]) for (const lot of [25, 100]) {
  const w = boot();
  const g0 = money(w);
  let guard = 0;
  while (w.S.fuel < n && guard++ < 4000) w.fcNpcBuy(Math.min(lot, n - w.S.fuel));
  w._fcShock(false, 'gasStation:spike');         // the RNG's shock, not ours
  w._fcShock(false, 'gasStation:short');
  guard = 0;
  while (w.S.fuel > 0 && guard++ < 4000) w.fcNpcSell(Math.min(lot, w.S.fuel));
  const d = money(w) - g0;
  d > 0 ? ok(`held ${pad(n)} bbl (filled in ${pad(lot)}-bbl lots) across two rolled spikes → ${fmt(d)}`)
        : fail(`held ${n} bbl in ${lot}-bbl lots across two rolled spikes and still LOST ${fmt(d)} — ` +
               `the vendor has been neutered, not fixed`);
}

/* ── §11  THE ORDER DESK PRICES ITS OWN LEGS. ───────────────────────────────
   Found while closing round 4, both predating it, both in _cxExecuteBuy /
   _cxExecuteSell, and both the SAME defect the invariant names: a leg priced
   from something other than the mark after its own impact.

   §9 above only ever asked whether a CX order could fund a HEDGE or a POSITION
   — a derivative question, answered by the exogenous ledger. It never asked
   whether the CX order was profitable BY ITSELF, so nothing in this file looked
   at the two legs as a pair. They were, at every size above ~25 shares. */
console.log('\n§11a a Crash Exchange wash trade must LOSE (both legs post-impact)');
for (const q of [1, 25, 50, 100, 250, 400, 600]) {
  const w = boot({ gems: 200000000 });
  const g0 = money(w);
  if (!w._cxExecuteBuy('fuel', q).ok) { ok(`q=${pad(q)} buy refused`); continue; }
  const held = (w.Profile.cxHoldings.fuel && w.Profile.cxHoldings.fuel.qty) | 0;
  w._cxExecuteSell('fuel', held);
  const d = money(w) - g0;
  d < 0 ? ok(`q=${pad(q)}  buy ${q} shares → sell them all  net ${fmt(d)}`)
        : fail(`q=${q} CX wash trade PROFITED ${fmt(d)} — the desk quotes a mark its own order moved`);
}

/* The price the desk charges comes from `_pxOverride`, which at the only two
   call sites (cx-buy-go / cx-sell-go) is parseFloat of a TEXT INPUT the player
   types. It was used verbatim. A limit price the player can only set AGAINST
   themselves is harmless; one they can set in their own favour is the whole
   balance. */
console.log('\n§11b a typed price may never beat the mark');
{
  const w = boot({ gems: 200000000 });
  const g0 = money(w);
  w._cxExecuteBuy('fuel', 500, 0.01);            // "I will pay one hundredth each"
  const held = (w.Profile.cxHoldings.fuel && w.Profile.cxHoldings.fuel.qty) | 0;
  if (held > 0) w._cxExecuteSell('fuel', held, 100000);   // "...and receive 100,000 each"
  const d = money(w) - g0;
  d < 0 ? ok(`typed ¢0.01 buy + ¢100,000 sell  net ${fmt(d)}`)
        : fail(`typed prices PROFITED ${fmt(d)} — the order desk trusts a text input`);
}
{ /* and the honest direction still works: paying MORE than the mark is allowed */
  const w = boot({ gems: 200000000 });
  const g0 = money(w);
  w._cxExecuteBuy('fuel', 10, 100000);
  const spent = g0 - money(w);
  spent > 1000000 ? ok(`an override ABOVE the mark still charges it (¢${spent.toLocaleString()} for 10)`)
                  : fail(`override above the mark was ignored (¢${spent}) — the clamp is backwards`);
}

/* ── §11c  THE TWO VENUES MAY NOT ARBITRAGE EACH OTHER. ─────────────────────
   The pump and the order desk move the SAME mark. If a unit of mark-impact is
   cheaper on one than the other, the trade writes itself: buy impact where it is
   cheap, sell inventory into it where it is dear. It was cheap on the exchange —
   a ¢100 share moved the mark as far as twenty ¢88 barrels, because the gas
   station divided its barrels by FC_NPC_CX_UNITS_PER_BBL before calling the
   kernel and the exchange did not. Measured before the fix: +87,298 at 400 bbl
   + 300 shares, profitable across most of this grid. The scale now rides on the
   price row so both desks inherit it. */
console.log('\n§11c pumping the mark on one venue to dump inventory on the other must LOSE');
{
  let worst = null;
  for (const bbl of [50, 100, 200, 400, 620, 800, 1250])
    for (const sh of [10, 25, 50, 100, 124, 200, 300]) {
      const w = boot({ gems: 200000000 });
      const g0 = money(w);
      w.fcNpcBuy(bbl);                             // physical, at the pump
      w._cxExecuteBuy('fuel', sh);                 // shove the shared mark, cheap
      let guard = 0;
      while (w.S.fuel > 0 && guard++ < 400) w.fcNpcSell(w.S.fuel);
      const h = (w.Profile.cxHoldings.fuel && w.Profile.cxHoldings.fuel.qty) | 0;
      if (h > 0) w._cxExecuteSell('fuel', h);      // unwind the paper
      const d = money(w) - g0;
      if (!worst || d > worst.d) worst = { bbl, sh, d };
    }
  worst.d < 0 ? ok(`worst of 49 cross-venue cells: ${worst.bbl} bbl + ${worst.sh} shares → ${fmt(worst.d)}`)
              : fail(`cross-venue pump PROFITED ${fmt(worst.d)} at ${worst.bbl} bbl + ${worst.sh} shares — ` +
                     `mark-impact is cheaper on one desk than the other`);
}
/* And the scale must be a tuning constant, not player state: a hand-edited save
   that carries its own impactScale must not get to choose how hard its orders
   move the market. getMarketPrice recomputes it on every read. */
console.log('\n§11d a profile cannot choose its own impact scale');
{
  const w = boot();
  const p = w.getMarketPrice('fuel');
  p.impactScale = 0.000001;                        // "my orders move nothing"
  const after = w.getMarketPrice('fuel');
  Math.abs(after.impactScale - w.CX_IMPACT_SCALE.fuel) < 1e-12
    ? ok(`a forged impactScale is overwritten on read (${after.impactScale})`)
    : fail(`forged impactScale survived the read (${after.impactScale}) — it is player state`);
}

/* ── §12  A FREE BUTTON MAY NOT MOVE THE MARK. ──────────────────────────────
   §4c already checks that a FORCED shock pays no HEDGE. It never checked the
   physical leg, and the physical leg does not need a derivative: the mark is
   the price the pump pays you. Buy the tank full, press the Events tab's free
   "Force Trigger", sell into the +50%. Measured before this package: +71,796.
   A player-chosen mark move must cost at least what it can pay out, and a free
   button cannot, at any magnitude — so a forced event now moves the mark by
   nothing at all. */
console.log('\n§12 buy → free Force Trigger → dump must LOSE');
{
  let worst = null;
  for (const bbl of [100, 400, 800, 1250]) for (const ev of ['spike', 'short', 'glut']) for (const lot of [25, 100, 1250]) {
    const w = boot({ gems: 200000000 });
    const g0 = money(w);
    let guard = 0;
    while (w.S.fuel < bbl && guard++ < 4000) w.fcNpcBuy(Math.min(lot, bbl - w.S.fuel));
    w.fcFireEvent(ev);                             // the button, one click, free
    guard = 0;
    while (w.S.fuel > 0 && guard++ < 4000) w.fcNpcSell(Math.min(lot, w.S.fuel));
    const d = money(w) - g0;
    if (!worst || d > worst.d) worst = { bbl, ev, lot, d };
  }
  worst.d < 0 ? ok(`worst of 36 force-dump cells: ${worst.bbl} bbl '${worst.ev}' lot ${worst.lot} → ${fmt(worst.d)}`)
              : fail(`force-dump PROFITED ${fmt(worst.d)} at ${worst.bbl} bbl '${worst.ev}' lot ${worst.lot} — ` +
                     `a free button still moves the mark`);
}
/* The other half, again: the ROLLED path must still move it, or the events
   system is decoration and §4d/§5b/§5c are passing vacuously. */
console.log('\n§12b a ROLLED shock still moves the mark');
{
  const w = boot();
  const before = w.getMarketPrice('fuel').current;
  w._fcShock(false, 'gasStation:spike');
  const after = w.getMarketPrice('fuel').current;
  after > before * 1.4
    ? ok(`rolled spike moved cx ¢${before.toFixed(1)} → ¢${after.toFixed(1)}`)
    : fail(`rolled spike moved cx ¢${before.toFixed(1)} → ¢${after.toFixed(1)} — the event system is dead`);
}

console.log(bad ? `\n❌ FUELARB: ${bad} failure(s)\n` : '\n✅ FUELARB: all green\n');
process.exit(bad ? 1 : 0);
