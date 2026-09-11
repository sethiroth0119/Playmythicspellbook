/* ══════════════════════════════════════════════════════════════════════════
   🔒 SECRET STASH — the rules, driven directly

   Capacity, tier order and eligibility. The DEATH behaviour is not tested
   here: it lives in index.html and is driven by .gauntlet/drive-stash-death.mjs
   against the real _fieldBagLossOnDefeat(). Asserting it in this file would be
   asserting against a re-implementation, which is the one thing that cannot
   prove a loot rule.

   Run:  node tools/stash-tests/run.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import S from '../../public/src/stash/stash.js';

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F512} SECRET STASH\n');

/* ── 1. The tier ladder, exactly as the brief specifies ─────────────────── */
ok('a new player is LOCKED — no free stash', S.isLocked(0) && S.slotsForTier(0) === 0);
/* 🔒 THE TWO NUMBERS THE BRIEF ACTUALLY FIXES: "7 is for base, 30 is for the
   highest stash". Everything between them is tuning, and pinning the middle
   three here would mean re-editing this file every retune — which is how a
   test ends up being edited to agree with a bug. The SHAPE is checked below
   (monotonic, five rungs); only the ends are pinned. */
const want = [7, 30];
ok('five tiers, base 7 slots and top 30',
   S.MAX_TIER === 5 && S.slotsForTier(1) === want[0] && S.slotsForTier(5) === want[1],
   [1, 2, 3, 4, 5].map(t => S.slotsForTier(t)).join(' / '));
ok('capacity only ever grows',
   [1, 2, 3, 4, 5].every((t, i) => i === 0 || S.slotsForTier(t) > S.slotsForTier(t - 1)));
ok('tier 5 is the maximum', S.isMaxed(5) && S.nextTier(5) === null);

/* ── 2. Sequential purchase ─────────────────────────────────────────────── */
ok('a locked player may buy Tier 1', S.canBuy(0, 1).ok);
ok('\u{1F3AF} a locked player may NOT jump to Tier 5', !S.canBuy(0, 5).ok, S.canBuy(0, 5).reason);
ok('\u{1F3AF} Tier 2 may not skip to Tier 4', !S.canBuy(2, 4).ok, S.canBuy(2, 4).reason);
ok('Tier 2 may buy Tier 3', S.canBuy(2, 3).ok);
ok('you cannot re-buy what you own', !S.canBuy(3, 3).ok, S.canBuy(3, 3).reason);
ok('you cannot buy past the cap', !S.canBuy(5, 6).ok, S.canBuy(5, 6).reason);
ok('every step of the ladder is reachable in order',
   [1, 2, 3, 4, 5].every((t, i) => S.canBuy(i, t).ok));

/* ── 3. Capacity ──────────────────────────────────────────────────────────
   ⚠ EVERY NUMBER HERE IS DERIVED FROM STASH_TIERS, NOT TYPED. The first version
     hard-coded "five stacks fill a Tier 1 stash", and when the ladder was
     retuned (5/10/20/35/50 Cinder → 7/12/18/24/30 Aza) four checks went red
     while nothing was wrong with the code. A test that has to be edited every
     time the table it guards changes is a test that will eventually be edited
     to agree with a bug. What must be TRUE is the shape: exactly-tier stacks
     fill it, one more is refused, a top-up is not, and the next tier has room
     for exactly the difference. */
const one = () => 1;
const T1 = S.slotsForTier(1), T2 = S.slotsForTier(2);
let stash = {};
for (let i = 0; i < T1; i++) stash['res' + i] = 10;
ok('exactly Tier 1’s worth of stacks fills it',
   S.slotsUsed(stash, one) === T1 && S.freeSlots(stash, 1, one) === 0, T1 + ' slots');
ok('\u{1F3AF} a full stash refuses a NEW item',
   !S.canDeposit(stash, 1, 'res99', 1, one).ok, S.canDeposit(stash, 1, 'res99', 1, one).reason);
ok('\u{1F3AF} …but topping up an EXISTING stack still works',
   S.canDeposit(stash, 1, 'res0', 500, one).ok);
ok('the same stash has room at Tier 2 for exactly the difference',
   S.freeSlots(stash, 2, one) === T2 - T1, (T2 - T1) + ' free');
ok('\u{1F3AF} the ladder never narrows — every tier holds more than the one below',
   S.STASH_TIERS.every((t, i) => i === 0 || t.slots > S.STASH_TIERS[i - 1].slots),
   S.STASH_TIERS.map(t => t.slots).join(' → '));
ok('\u{1F3AF} …and every tier costs more Aza than the one below',
   S.STASH_TIERS.every((t, i) => (t.aza | 0) > 0 && (i === 0 || t.aza > S.STASH_TIERS[i - 1].aza)),
   S.STASH_TIERS.map(t => 'A' + t.aza).join(' → '));
ok('a locked stash refuses everything', !S.canDeposit({}, 0, 'iron', 1, one).ok,
   S.canDeposit({}, 0, 'iron', 1, one).reason);

/* ── 4. Quantity does not buy capacity — the brief's anti-warehouse rule ── */
const big = S.moveToStash({ iron: 999999 }, {}, 1, 'iron', 999999, one);
ok('500,000 iron is still ONE slot', big.ok && S.slotsUsed(big.stash, one) === 1,
   S.slotsUsed(big.stash, one) + ' slot(s) for ' + (big.stash.iron | 0) + ' iron');
ok('…so a Tier 1 stash still only holds ' + T1 + ' kinds of thing',
   S.freeSlots(big.stash, 1, one) === T1 - 1);

/* ── 5. Moves are pure and conserve everything ──────────────────────────── */
const bag0 = { iron: 500, rifle: 1, medicine: 20 };
const m = S.moveToStash(bag0, {}, 1, 'rifle', 1, one);
ok('moving to the stash takes it out of the bag',
   m.ok && !m.bag.rifle && m.stash.rifle === 1);
ok('\u{1F3AF} the ORIGINAL bag object is untouched (pure)',
   bag0.rifle === 1, 'bag0.rifle=' + bag0.rifle);
const back = S.moveToBag(m.bag, m.stash, 'rifle', 1);
ok('and moving back restores it exactly',
   back.ok && back.bag.rifle === 1 && !back.stash.rifle);
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
ok('nothing is created or destroyed by a round trip',
   total(back.bag) === total(bag0), total(back.bag) + ' vs ' + total(bag0));
ok('you cannot stash what you are not carrying',
   !S.moveToStash({}, {}, 1, 'ghost', 1, one).ok);
ok('moving more than you carry moves only what you have',
   S.moveToStash({ iron: 3 }, {}, 1, 'iron', 99, one).qty === 3);

/* ── 6. Mission items ───────────────────────────────────────────────────── */
const blocked = new Set(['quest_beacon']);
ok('a blocked mission item cannot be protected',
   !S.canDeposit({}, 3, 'quest_beacon', 1, one, blocked).ok,
   S.canDeposit({}, 3, 'quest_beacon', 1, one, blocked).reason);
ok('…while everything else still can', S.canDeposit({}, 3, 'iron', 1, one, blocked).ok);

/* ── 7. Hostile input ───────────────────────────────────────────────────── */
let bad = null;
for (const v of [NaN, Infinity, -1, null, undefined, '3', {}]) {
  try {
    const r1 = S.slotsForTier(v), r2 = S.freeSlots({ a: 1 }, v, one);
    const r3 = S.moveToStash({ a: 1 }, {}, v, 'a', v, one);
    if (!isFinite(r1) || !isFinite(r2) || typeof r3.ok !== 'boolean') { bad = String(v); break; }
  } catch (e) { bad = String(v) + ' THREW ' + e.message; break; }
}
ok('hostile tiers and quantities never throw or yield NaN', bad === null, bad || 'clean');

console.log('');
if (fails) { console.log('❌ ' + fails + ' CHECK(S) FAILED'); process.exit(1); }
console.log('✅ SECRET STASH: all rule checks green');
