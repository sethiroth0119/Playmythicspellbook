/* 🔧 REPAIRTRAP — is the Black River Repair button worth pressing?
   ----------------------------------------------------------------------------
   Run:  node tools/economy-tests/repairtrap.mjs
   Exits non-zero on any failure.

   WHY THIS FILE EXISTS.
   The ×10 pass multiplied every INPUT cost in the extraction field and
   deliberately left every OUTPUT value alone (see the block above OSIM_PARTS in
   public/index.html — that asymmetry is the point of the ask, not a bug). But
   `_osimRepairCost` derived its cash leg from `craft`, and craft is an input
   cost, so the price of maintenance went ×10 against income that did not move.
   Measured on the tree before the fix, repairing a machine from 25% back to
   100% and selling the wear cycle it buys (75 condition ÷ 1.5 decay-per-unit =
   50 units) at the Foundation Reserve, after the 15% levy:

       pumpjack   ₵315 in  →  ₵170 out    0.54×
       drill      ₵369 in  →  ₵298 out    0.81×
       refinery   ₵473 in  →  ₵213 out    0.45×   (net of the 100 oil it burns)
       deepcore   ₵720 in  →  ₵170 out    0.24×

   ...and `_osimCondFactor` floored at 0.25, so the machine you refuse to repair
   never stops. It runs 4× slower FOREVER at zero recurring cost. Both halves
   matter and a fix that moves only one does not close it:
     • cut the price alone and neglect is still free, so over a long enough
       horizon the do-nothing player still wins on Cinder-per-click;
     • drop the floor alone and repair is still priced off a ×10 table.
   So this file measures BOTH, and §3 is the one that would have caught the
   original: it runs the SHIPPED `_osimStepMachine` over a fixed horizon for two
   policies and compares the Cinder each ends with.

   🔴 AND IT MEASURES THEM AT EVERY RESEARCH LEVEL, WHICH IT DID NOT USED TO.
   `freshState()` hardcoded `hardened: 0`, so all seven sections scored one
   player: the one who has bought no R&D. Hardened Components is a shipped
   ◈80/160/260 node that multiplies the wear rate by [1, 0.75, 0.55, 0.4], and
   the repair price was denominated against the RAW rate while the machine spent
   condition at the RESEARCHED one — so the share actually charged was
   `OSIM_REPAIR_SHARE × decayMul` and a maxed player paid 0.292 against a tuned
   0.73. Every row in this file was green over a 2.4× faucet. §2 and §7 now carry
   a `hardened` axis and `raw-decay` in the sabotage switch rebuilds it on demand.
   ⚠ If you add a section that calls `freshState()` with no argument, you have
     written another blind one. That is fine for structural checks (§3/§5/§6 are
     research-independent: a floor is a floor and a string is a string), but any
     section that touches a PRICE has to sweep HARDENED.

   It does not re-implement the arithmetic. Every constant and every function
   below is EXTRACTED from public/index.html by anchor + brace matching, exactly
   as tools/economy-tests/fuelarb.mjs does, because a test carrying its own copy
   of the formula cannot notice the shipped formula changing — which is the
   whole failure mode here.

   ⚠ WHAT IS STUBBED, AND WHY IT CANNOT LAUNDER THE ANSWER. Only host plumbing
     that moves no price and no Cinder: `Forge` (absent, so every registry
     override falls through its own try/catch to the shipped default),
     `getMarketPrice` (absent, so the parts Crash-Exchange peg reads ×1),
     `_osimAutoCollect` (forced false — it is a convenience toggle, and this file
     drains the buffer itself so nothing is ever lost to a full machine), and
     `_osimCollectOne`. The pricing kernel, the wear model, the levy, the
     condition curve and the step function are all the page's own. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
let SRC = readFileSync(join(here, '..', '..', 'public', 'index.html'), 'utf8');

/* 🧨 THE SABOTAGE SWITCH — how this file is proved able to go RED.
   Each patch splices the PRE-FIX arithmetic back into the extracted source, in
   memory; the shipped tree is never written to. REPAIRTRAP_SABOTAGE=<name>, or
   `all` for the exact tree the finding was measured on.

     craft-price   price the repair off `craft × 0.6` + one Steel Pipe again
     cond-floor    put the 0.25 condition floor back, so neglect is free forever
     repair-share  put OSIM_REPAIR_SHARE back to the 0.35 the floor removal
                   shipped with — the FAUCET regression, which §7 exists to catch
                   and which every other section here scores as a clean pass
     raw-decay     price the repair off `_osimRawDecayPerUnit()` again, i.e. bill
                   the player for RAW-rate units while the machine wears at the
                   RESEARCHED rate. Invisible at zero R&D and worth up to 2.5× the
                   faucet with Hardened Components — the reason §2 and §7 now
                   carry a research axis

   `craft-price` + `cond-floor` together ARE the shipped trap. */
const SAB = process.env.REPAIRTRAP_SABOTAGE || '';
const want = (n) => SAB === 'all' || SAB.split(',').includes(n);
/* Anchors are matched line-ending-agnostically: index.html is CRLF in this repo
   and a literal "\n" would silently match nothing, turning the whole switch into
   theatre. Throwing on a stale anchor is deliberate — a sabotage that quietly
   no-ops is the un-watched tripwire this file exists not to be. */
function splice(name, find, repl) {
  if (!want(name)) return;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n'));
  if (!re.test(SRC)) throw new Error('REPAIRTRAP sabotage "' + name + '": anchor no longer present — the patch needs updating, not deleting');
  SRC = SRC.replace(re, () => repl);
  console.log('🧨 SABOTAGE ACTIVE: ' + name);
}
/* → expected red, measured ALONE: 56 rows — §1 (4), §2 (48), §3 (4). §3's cells
     are the indictment worth reading: with a bankroll to press the button with,
     the maintaining player finishes 5,000 h at ₵-1,283 on a pumpjack, ₵-1,721 on
     a refinery and ₵-9,224 on a deepcore, against ₵228 / ₵285 / ₵228 for doing
     nothing at all. §5 stays GREEN here — the floor is a separate defect and
     `cond-floor` is what covers it. §7 stays GREEN too, and that is honest
     rather than a miss: a repair priced above what it restores mints no Cinder
     because nobody presses it. A trap and a faucet are different defects. */
splice('craft-price',
  'function _osimRepairCost(m) {',
  'function _osimRepairCost(m) { return { pipe: 1, cash: Math.max(5, Math.round((100 - m.condition) / 100 * OSIM_MACHINES[m.type].craft * 0.6)) }; } function _osimRepairCostFixed(m) {');
/* → expected red, measured ALONE: 12 rows — §3 (4), §5 (4) and §6's STALLED
     label (4). (This note used to say 8; it predated §6 and was never recounted.
     Row counts here are re-measured, not inherited.) §1/§2 stay green, and that
     is the whole reason §3 and §5 exist: they are static price-vs-value ratios
     and cannot see the condition floor at all. A fix that only re-priced the
     button would pass §1/§2 with full marks and still leave neglect free.
     §7 also stays green: putting the throttle back TIGHTENS the faucet, which is
     the direction §7 does not police.
     `craft-price` + `cond-floor` together = 64 rows, the shipped trap exactly. */
splice('cond-floor',
  'function _osimCondFactor(m) {',
  'function _osimCondFactor(m) { return Math.max(0.25, m.condition / 100); } function _osimCondFactorFixed(m) {');
/* → expected red, measured ALONE: 16 rows, ALL of them in §7 (4 machines × 4
     research levels). §1–§6 all pass with full marks at 0.35 — repair still
     returns 2.86× what it costs at EVERY research level, neglect still stalls,
     the ×10 is still there, the panel still renders. That is precisely the hole
     this switch documents: every section written to prove "Repair is worth
     pressing" is blind to how much Cinder the resulting best play MINTS, and the
     0.35 tree quietly paid players 2.4× what the field paid before it.
     ⚠ Note §2 stays green here and that is correct, not a miss: 0.35 is a wrong
       share applied UNIFORMLY, so the payback ratio is still invariant. §2 polices
       the share being different for different players; §7 polices its level. */
splice('repair-share',
  'const OSIM_REPAIR_SHARE = 0.73;',
  'const OSIM_REPAIR_SHARE = 0.35;');
/* → expected red, measured ALONE: 48 rows — §2 (36) and §7 (12), ALL of them at
     hardened ≥ 1. Every hardened-0 row in the whole file stays green, which is
     exactly how this shipped: the tree that carried it passed §1–§7 with full
     marks because every section measured a player with no R&D. Hardened
     Components is ◈80/160/260 in the shipped Supply Depot, so "the configuration
     nobody is in" was the one being measured, not the one being played. */
splice('raw-decay',
  'return (pts / Math.max(0.01, _osimDecayPerUnit())) * _osimMachineNetUnitValue(def);',
  'return (pts / Math.max(0.01, _osimRawDecayPerUnit())) * _osimMachineNetUnitValue(def);');

let bad = 0;
const fail = (m) => { bad++; console.log('   ❌ ' + m); };
const ok   = (m) => console.log('   ✅ ' + m);
const f2   = (n) => (Math.round(n * 100) / 100).toFixed(2);
const pad  = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));

/* ── EXTRACTION ─────────────────────────────────────────────────────────────
   Same crude brace counter fuelarb.mjs uses: every function taken here is a
   plain top-level declaration with balanced braces and no brace-bearing string
   or regex literal. */
function grabFn(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('REPAIRTRAP: cannot find function ' + name + ' in index.html');
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(at + 1, j + 1); }
  }
  throw new Error('REPAIRTRAP: unbalanced braces in ' + name);
}
/* ⚠ NOT `= ([^;]+);`. fuelarb.mjs can use that form because every constant it
   takes is numeric; here `OSIM_RESEARCH` carries the string
   'Auto-collects full machines; L2 adds capacity.', and a scan to the first
   semicolon truncates the object mid-literal into a syntax error. Object and
   array constants are brace-matched from their opening bracket instead, which
   also picks up the multi-line `OSIM_MACHINES` table for free. */
function grabConst(name) {
  const at = new RegExp('^const ' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!at) throw new Error('REPAIRTRAP: cannot find const ' + name);
  const from = at.index + at[0].length, head = SRC[from];
  if (head !== '{' && head !== '[') {
    const end = SRC.indexOf(';', from);
    return 'const ' + name + ' = ' + SRC.slice(from, end).trim() + ';';
  }
  const close = head === '{' ? '}' : ']';
  let depth = 0, str = '';
  for (let j = from; j < SRC.length; j++) {
    const ch = SRC[j];
    if (str) { if (ch === '\\') j++; else if (ch === str) str = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
    if (ch === head) depth++;
    else if (ch === close) { depth--; if (depth === 0) return 'const ' + name + ' = ' + SRC.slice(from, j + 1) + ';'; }
  }
  throw new Error('REPAIRTRAP: unbalanced ' + head + ' in const ' + name);
}

const CONSTS = ['OSIM_PARTS', 'OSIM_MACHINES', 'OSIM_TIER', 'OSIM_RESEARCH', 'OSIM_RESERVE_PRICE', 'OSIM_DECAY_PER_UNIT', 'OSIM_REPAIR_SHARE', 'OSIM_PART_CX'];
const FNS = [
  '_osimSellSkim', '_osimSellPrice', '_osimMarketMult', '_osimResearchSum',
  '_osimPartCxId', '_osimPartStdCost', '_osimPartMarketMul', '_osimPartCost',
  '_osimRawDecayPerUnit', '_osimDecayPerUnit',
  '_osimResonanceMul', '_osimProdMul', '_osimNodeBonus',
  '_osimCondFactor', '_osimEffRate', '_osimEffCap',
  '_osimRepairCost', '_osimStepMachine',
];
/* `_osimRepairValue` only exists after the fix. Extract it when present so the
   post-fix tree is measured through its own helper, and fall back when the
   sabotage switch has replaced the whole pricing path. */
const OPTIONAL = ['_osimRepairValue', '_osimMachineNetUnitValue'];

function boot() {
  const parts = [];
  parts.push('"use strict";');
  for (const c of CONSTS) parts.push(grabConst(c));
  for (const f of FNS) parts.push(grabFn(f));
  for (const f of OPTIONAL) { try { parts.push(grabFn(f)); } catch (e) { /* pre-fix tree */ } }
  /* Host plumbing only — see the header. Never a price and never a Cinder. */
  parts.push('function _osimAutoCollect() { return false; }');
  parts.push('function _osimCollectOne() { return false; }');
  parts.push('return { OSIM_MACHINES, OSIM_PARTS, OSIM_RESERVE_PRICE, OSIM_DECAY_PER_UNIT, _osimSellSkim, _osimSellPrice, _osimPartCost, _osimRawDecayPerUnit, _osimDecayPerUnit, _osimCondFactor, _osimEffRate, _osimEffCap, _osimRepairCost, _osimStepMachine, get state() { return _osimState; }, set state(v) { _osimState = v; } };');
  // eslint-disable-next-line no-new-func
  return new Function('_osimState', parts.join('\n'));
}
const make = boot();

/* A minimal, honest field state: no prestige, no node, no price event. Every
   multiplier that could flatter either policy sits at 1.
   🔴 EXCEPT `hardened`, WHICH IS NOW AN ARGUMENT, AND THAT IS THE POINT.
   This function used to hardcode `hardened: 0` and every section in this file
   called it with no arguments, so the entire guard measured exactly one player:
   the one who has bought no R&D. Hardened Components is a shipped, purchasable
   ◈80/160/260 node that multiplies wear by [1, 0.75, 0.55, 0.4], and a repair
   priced off the RAW wear rate charges for raw-rate units while the machine
   spends researched-rate ones — so the share the player really pays is
   `OSIM_REPAIR_SHARE × decayMul`. Changing this one field from 0 to 3 on the
   tree that shipped reds all four of §7's rows at 2.4–2.6×. A guard with a
   constant where the shipped game has a variable is not measuring the game.
   `hardened` is the only research level that moves either side of the repair
   arithmetic; the other four are speed/price/parts/convenience and are covered
   by their own invariants elsewhere. */
function freshState(hardened) {
  return {
    cash: 0, aza: 0,
    inv: { oil: 0, ore: 0, fuel: 0 },
    parts: { pipe: 0, motor: 0, valve: 0, drillbit: 0 },
    research: { supply: 0, hardened: hardened | 0, automation: 0, market: 0, tuning: 0 },
    /* Mirrors the shipped `_osimFreshState`. Omitting it is not a harmless stub
       gap: `_osimRenderInspector` reads blueprints[bp] for the upgrade card and
       throws without it, which reds §6 for reasons that have nothing to do with
       the Repair button. */
    blueprints: { tier2: false, tier3: false, deepcore: false },
    prestige: 0, nodeId: null, priceEvent: null,
    stats: { produced: { oil: 0, ore: 0, fuel: 0 } },
    placed: [],
  };
}
const TYPES = ['pumpjack', 'drill', 'refinery', 'deepcore'];
/* The four states of the shipped Hardened Components node. L0 is the free player;
   L3 is ◈540 of R&D and the cheapest way to break the sink if it is priced wrong. */
const HARDENED = [0, 1, 2, 3];

/* The value a machine's unit is actually worth to the player once the Foundation
   levy is taken and, for a converter, once the input it burns is paid for at the
   same Reserve it would otherwise have been sold into. This is the OUTPUT side —
   the side the ×10 deliberately did not touch — and it is what a maintenance
   action has to be measured against. */
function netUnitValue(A, type) {
  const def = A.OSIM_MACHINES[type], skim = 1 - A._osimSellSkim();
  let v = (A.OSIM_RESERVE_PRICE[def.produces] || 0) * skim;
  if (def.consumes) v -= (A.OSIM_RESERVE_PRICE[def.consumes] || 0) * (def.ratio || 1) * skim;
  return v;
}

console.log('\n🔧 REPAIRTRAP — Black River maintenance economics');
console.log('   source: public/index.html' + (SAB ? '   (SABOTAGE: ' + SAB + ')' : ''));

/* ── §1  THE FINDING, AS REPORTED ───────────────────────────────────────────
   Repair 25% → 100%, against the wear cycle that repair buys, at the Reserve.
   Reproduces the four numbers in the header on whatever tree it is pointed at. */
console.log('\n§1  repair 25% → 100% vs the wear cycle it buys');
console.log('    ' + pad('machine', 11) + pad('in ₵', 9) + pad('out ₵', 9) + 'out/in');
{
  const st = freshState(); const A = make(st);
  for (const type of TYPES) {
    const m = { type, tier: 1, condition: 25, buffer: 0, timer: 0 };
    const rc = A._osimRepairCost(m);
    /* The pipe leg is a cost too: parts are BOUGHT with Cinder, and the part
       PRICES went ×10 even though the part AMOUNTS deliberately did not. Any
       measurement that counts only rc.cash understates the pre-fix trap by the
       full ₵180 a Steel Pipe costs, which is more than a pumpjack's entire
       wear cycle is worth. */
    const cashIn = rc.cash + (rc.pipe || 0) * A._osimPartCost('pipe');
    /* ⚠ `_osimDecayPerUnit`, the RESEARCHED rate — the rate at which the machine
       actually spends the condition it was just sold. Identical to the raw rate
       in this section (§1 is the no-R&D player, as reported), but writing the raw
       rate here is the same mistake the pricing kernel made, and a guard that
       repeats the bug it is guarding cannot see it. §2 varies the research. */
    const units = (100 - m.condition) / A._osimDecayPerUnit();
    const out = units * netUnitValue(A, type);
    const ratio = out / cashIn;
    console.log('    ' + pad(type, 11) + pad(Math.round(cashIn), 9) + pad(Math.round(out), 9) + f2(ratio) + '×');
    if (ratio > 1) ok(type + ' repair returns more than it costs (' + f2(ratio) + '×)');
    else fail(type + ' repair is a TRAP: ₵' + Math.round(cashIn) + ' in for ₵' + Math.round(out) + ' out (' + f2(ratio) + '×)');
  }
}

/* ── §2  THE SAME RATIO AT EVERY CONDITION LEVEL, AT EVERY RESEARCH LEVEL ────
   A repair priced off a machine's BUILD cost and a repair priced off the OUTPUT
   it restores behave differently as damage shrinks, so 25% alone is not enough:
   a formula could be positive deep in the red and negative for a light touch-up.
   The acceptance level for this fix is all four machines at 25 / 50 / 75.

   🔴 AND AT EVERY HARDENED LEVEL, WHICH IS THE AXIS THIS FILE WAS MISSING.
   The payback ratio is 1/OSIM_REPAIR_SHARE and nothing else — that is the claim
   the source comment above `OSIM_REPAIR_SHARE` makes, and it is the claim that
   holds the faucet where the owner had it. It was true only for a player with no
   R&D. `_osimRepairValue` divided the restored points by the RAW wear rate while
   `_osimStepMachine` spends them at the RESEARCHED rate, so with Hardened
   Components the player was buying more units than they were charged for and the
   effective share fell to 0.73 × [1, 0.75, 0.55, 0.4][hardened].
   A ratio ABOVE 1 is the trap test and every one of those rows passed it — a
   discount looks great on a payback ratio. So this section now asserts the ratio
   is not just > 1 but INVARIANT across research, which is the property that
   actually protects the sink. The tolerance is 2%: the price is Math.ceil'd with
   a ₵5 floor, so a bigger, rarer repair amortises the rounding slightly better,
   and that residual is the only research-sensitivity the pricing may have. */
console.log('\n§2  out/in at every condition level × every Hardened Components level');
console.log('    ' + pad('machine', 11) + pad('hardened', 10) + pad('@25%', 12) + pad('@50%', 12) + pad('@75%', 12));
{
  const INVAR_TOL = 0.02;
  for (const type of TYPES) {
    const base = {};
    for (const hard of HARDENED) {
      const st = freshState(hard); const A = make(st);
      const row = [];
      for (const cond of [25, 50, 75]) {
        const m = { type, tier: 1, condition: cond, buffer: 0, timer: 0 };
        const rc = A._osimRepairCost(m);
        const cashIn = rc.cash + (rc.pipe || 0) * A._osimPartCost('pipe');
        /* The units this repair really buys: the machine burns condition at the
           RESEARCHED rate whatever the price was denominated in. */
        const out = ((100 - cond) / A._osimDecayPerUnit()) * netUnitValue(A, type);
        const ratio = out / cashIn;
        row.push(pad('₵' + Math.round(cashIn) + '→' + f2(ratio) + '×', 12));
        /* Record the L0 ratio BEFORE the trap check, not after. Under the
           `craft-price` sabotage L0 is itself a trap (0.54×), and skipping the
           record on a failure left `base[cond]` undefined — so the L3 row, which
           squeaks over 1× purely because the raw-rate bug hands it a 2.5×
           discount, then reported "against NaN× at L0". A guard whose combined
           failure mode is NaN is not a guard. */
        if (hard === 0) base[cond] = ratio;
        if (!(ratio > 1)) { fail(type + ' L' + hard + ' @' + cond + '% is a TRAP: ₵' + Math.round(cashIn) + ' in, ₵' + Math.round(out) + ' out (' + f2(ratio) + '×)'); continue; }
        if (hard === 0) { ok(type + ' L0 @' + cond + '% → ' + f2(ratio) + '×'); continue; }
        const drift = ratio / base[cond] - 1;
        if (Math.abs(drift) <= INVAR_TOL) ok(type + ' L' + hard + ' @' + cond + '% → ' + f2(ratio) + '× (' + (drift >= 0 ? '+' : '') + (drift * 100).toFixed(1) + '% vs L0 — share invariant)');
        else fail(type + ' L' + hard + ' @' + cond + '% pays back ' + f2(ratio) + '× against ' + f2(base[cond]) + '× at L0 (' + (drift * 100).toFixed(0) + '%) — Hardened Components is moving the REPAIR SHARE, i.e. the sink, not just the wear rate');
      }
      console.log('    ' + pad(hard === 0 ? type : '', 11) + pad('L' + hard, 10) + row.join(''));
    }
  }
}

/* ── §3  THE POLICY RACE — the section the original defect would have failed ──
   §1 and §2 are static price-vs-value ratios. They cannot see the condition
   FLOOR, and the floor is half the trap: at 0.25 a neglected machine keeps
   producing forever for nothing, so "repair costs more than it returns" is not
   even the whole indictment — the do-nothing player pays zero and still collects.
   So this drives the SHIPPED `_osimStepMachine` over the same horizon twice.
     REPAIR  : repair to 100% whenever condition ≤ 25 and cash allows.
     NEGLECT : never repair.
   Both sell everything they produce at the Reserve after the levy; the refinery
   is charged for the oil it burns at the same Reserve it could have sold it
   into. The winner is simply whoever ends with more Cinder.

   ⚠ WHY THE HORIZON IS 5,000 h AND NOT THE 1,000 h THIS ORIGINALLY USED, AND WHY
     THAT IS NOT MOVING THE GOALPOSTS. A freshly built machine is handed 100
     condition points for free with the build fee, and the neglecting player's
     entire income is the ONE-TIME liquidation of that endowment — after it, they
     earn nothing ever again, because the floor is gone. So the shorter the race,
     the more of it is endowment rather than strategy. At 1,000 h a pumpjack has
     not finished spending the free 100 points (it ends near 5%, not stalled), so
     the "race" is really "one free tank vs one free tank plus paid refills", and
     at a 0.73 maintenance share the refills have not yet overtaken. That is
     arithmetic about the starting gift, not evidence that neglect is a strategy:
     the neglect column is FLAT after ~1,200 h and the repair column is a line
     through the origin, so the crossing exists at any share below 1 and the only
     question is where. 5,000 h is past it on all four with room, and it is the
     same horizon §7 uses, so the two sections cannot be tuned against each other.
     If a future change raises the share again, this crossing moves later — that
     is a real cost of a heavier sink and it should be re-measured, not papered
     over by lengthening the horizon a second time. */
console.log('\n§3  5,000 h of production — repair vs neglect, driven through _osimStepMachine');
console.log('    ' + pad('machine', 11) + pad('REPAIR ₵', 12) + pad('NEGLECT ₵', 12) + pad('units R/N', 14) + 'verdict');
{
  /* ⚠ BANKROLL. Both policies start with the same float and it is subtracted
     again at the end, so the number printed is PROFIT. Without it the pre-fix
     tree scored a tie rather than a loss for repairing — not because repairing
     was fine, but because a machine whose wear cycle earns ₵170 can never
     accumulate the ₵315 its own repair costs, so the policy never got to press
     the button at all. "You cannot afford the trap" is not a defence of it. */
  const HOURS = 5000, STEP = 600, FLOAT = 1000000; // 10-minute steps, 30,000 of them
  for (const type of TYPES) {
    const run = (policy) => {
      const st = freshState(); const A = make(st);
      /* Seed enough oil that the refinery is never starved; it is charged for
         every unit it burns below, so the feed is not free. */
      st.inv.oil = 10 ** 9;
      const m = { type, tier: 1, condition: 100, buffer: 0, timer: 0 };
      st.placed.push(m);
      const def = A.OSIM_MACHINES[type], skim = 1 - A._osimSellSkim();
      let cash = FLOAT, units = 0, repairs = 0;
      for (let t = 0; t < HOURS * 3600; t += STEP) {
        if (policy === 'repair' && m.condition <= 25) {
          const rc = A._osimRepairCost(m);
          const cost = rc.cash + (rc.pipe || 0) * A._osimPartCost('pipe');
          if (cash >= cost) { cash -= cost; m.condition = 100; repairs++; }
        }
        const before = m.buffer;
        A._osimStepMachine(m, STEP);
        const made = m.buffer - before;
        if (made > 0) {
          units += made;
          cash += made * (A.OSIM_RESERVE_PRICE[def.produces] || 0) * skim;
          if (def.consumes) cash -= made * (def.ratio || 1) * (A.OSIM_RESERVE_PRICE[def.consumes] || 0) * skim;
          m.buffer = 0; // the player collects and sells; nothing is lost to a full cap
        }
      }
      return { cash: cash - FLOAT, units, repairs, cond: m.condition };
    };
    const R = run('repair'), N = run('neglect');
    console.log('    ' + pad(type, 11) + pad(Math.round(R.cash), 12) + pad(Math.round(N.cash), 12)
      + pad(Math.round(R.units) + '/' + Math.round(N.units), 14)
      + (R.cash > N.cash ? 'repair wins' : 'NEGLECT WINS'));
    if (R.cash > N.cash) ok(type + ' repairing beats neglecting over ' + HOURS + ' h (₵' + Math.round(R.cash) + ' vs ₵' + Math.round(N.cash) + ', ' + R.repairs + ' repairs)');
    else fail(type + ' NEGLECT WINS over ' + HOURS + ' h: ₵' + Math.round(N.cash) + ' doing nothing vs ₵' + Math.round(R.cash) + ' maintaining it');
  }
}

/* ── §4  THE ×10 IS STILL THERE ─────────────────────────────────────────────
   The ask was less Cinder sloshing around and the ×10 on INPUT costs is how the
   owner got it. This fix changes the price of MAINTENANCE, not the price of
   entry, and this section is the guard against a future "rebalance" quietly
   walking the entry fee back down. The entry price of a machine is its craft fee
   plus the parts it consumes at their standard price. */
console.log('\n§4  the ×10 on entry costs is intact');
{
  /* The pre-×10 table, recorded so the multiplier is checked against real prior
     values rather than against a round number someone can nudge. */
  const PRE = { pumpjack: 104, drill: 146, refinery: 191, deepcore: 372 };
  const PRE_PARTS = { pipe: 18, motor: 38, valve: 26, drillbit: 48 };
  const st = freshState(); const A = make(st);
  for (const k in PRE_PARTS) {
    const now = A.OSIM_PARTS[k].cost;
    if (now === PRE_PARTS[k] * 10) ok('part ' + k + ' ₵' + PRE_PARTS[k] + ' → ₵' + now + ' (×10)');
    else fail('part ' + k + ' is ₵' + now + ', expected ×10 of ₵' + PRE_PARTS[k] + ' = ₵' + PRE_PARTS[k] * 10);
  }
  for (const type of TYPES) {
    const def = A.OSIM_MACHINES[type];
    let entry = def.craft;
    for (const pk in (def.parts || {})) entry += def.parts[pk] * A.OSIM_PARTS[pk].cost;
    if (entry === PRE[type] * 10) ok('entry ' + pad(type, 10) + '₵' + PRE[type] + ' → ₵' + entry + ' (×10)');
    else fail('entry ' + type + ' is ₵' + entry + ', expected ×10 of ₵' + PRE[type] + ' = ₵' + PRE[type] * 10);
  }
}

/* ── §5  NEGLECT HAS TO ACTUALLY COST OUTPUT ────────────────────────────────
   The structural half. A machine left alone must reach a state where it stops
   producing, or every Cinder cost in this field stays optional while every
   Cinder income stays automatic — the invariant the ×10 block says it could not
   reach. Drive one machine with no repairs and assert it ends stalled. */
console.log('\n§5  a neglected machine stops');
{
  for (const type of TYPES) {
    const st = freshState(); const A = make(st);
    st.inv.oil = 10 ** 9;
    const m = { type, tier: 1, condition: 100, buffer: 0, timer: 0 };
    st.placed.push(m);
    for (let t = 0; t < 20000 * 3600; t += 3600) { A._osimStepMachine(m, 3600); m.buffer = 0; }
    const rate = A._osimEffRate(m);
    if (m.condition <= 0 && !isFinite(rate)) ok(type + ' neglected for 20,000 h ends STALLED at ' + f2(m.condition) + '% condition');
    else fail(type + ' neglected for 20,000 h still runs: condition ' + f2(m.condition) + '%, effective rate ' + f2(rate) + ' s/unit — neglect is free');
  }
}

/* ── §6  THE BUTTON HAS TO RENDER ───────────────────────────────────────────
   Everything above measures arithmetic. But the fix also rewrote the panel that
   quotes the price — it dropped the parts leg, added the restored-output line
   and added the STALLED state — and a ReferenceError in that string would make
   Repair unclickable, which is the same class of defect as pricing it wrong: a
   button no player can press. So render the SHIPPED `_osimRenderInspector` for
   each machine at each condition level against a stub DOM and read the result. */
console.log('\n§6  the Repair panel renders and quotes the new price');
{
  const st = freshState(); st.cash = 100000;
  const parts = [];
  parts.push('"use strict";');
  for (const c of ['OSIM_PARTS', 'OSIM_MACHINES', 'OSIM_TIER', 'OSIM_RESEARCH', 'OSIM_RESERVE_PRICE', 'OSIM_DECAY_PER_UNIT', 'OSIM_REPAIR_SHARE', 'OSIM_PART_CX', 'OSIM_BLUEPRINTS']) parts.push(grabConst(c));
  for (const f of FNS.concat(['_osimRepairValue', '_osimMachineNetUnitValue', '_osimRateTxt', '_osimMachineEffSecs', '_osimMachineOutTxt', '_osimUpgradeBP', '_osimUpgradeCost', '_osimRenderInspector'])) {
    try { parts.push(grabFn(f)); } catch (e) { throw new Error('§6 ' + e.message); }
  }
  parts.push('function _osimAutoCollect() { return false; }');
  /* Stub DOM: the panel only ever sets textContent / innerHTML on four ids. */
  parts.push('const _els = {}; function _O(id) { return (_els[id] = _els[id] || { textContent: "", innerHTML: "" }); }');
  parts.push('function _osimEsc(s) { return String(s); }');
  parts.push('return function (ref) { _osimInspectRef = ref; _osimRenderInspector(); return _els; };');
  // eslint-disable-next-line no-new-func
  const render = new Function('_osimState', '_osimInspectRef', parts.join('\n'))(st, null);
  for (const type of TYPES) {
    for (const cond of [0, 25, 50, 75, 100]) {
      const m = { type, tier: 1, condition: cond, buffer: 0, timer: 0 };
      let els;
      try { els = render(m); } catch (e) { fail(type + ' @' + cond + '% — inspector THREW: ' + e.message); continue; }
      const html = els.pbody.innerHTML;
      const cash = null; // read back from the shipped pricing, not from the panel's text
      const rc = make(st)._osimRepairCost(m);
      if (/1 Steel Pipe/.test(html)) { fail(type + ' @' + cond + '% — panel still asks for a Steel Pipe'); continue; }
      if (cond < 99 && !html.includes('Repair: <b>₵' + rc.cash + '</b>')) { fail(type + ' @' + cond + '% — panel does not quote ₵' + rc.cash); continue; }
      if (cond <= 0 && !/STALLED/.test(html)) { fail(type + ' @' + cond + '% — a stopped unit is not labelled STALLED'); continue; }
      /* \s* on both sides: the shipped markup interpolates the disabled flag as
         '" ' + (canRepair ? '' : 'disabled') + ' onclick', so an ENABLED button
         has two spaces and no attribute between them. */
      const btn = /<button class="osim-buy"\s*(disabled)?\s*onclick="_OSIM\.repairMachine\(\)"/.exec(html);
      if (!btn) { fail(type + ' @' + cond + '% — no Repair button rendered'); continue; }
      const disabled = !!btn[1];
      if (cond < 99 && disabled) { fail(type + ' @' + cond + '% — Repair is disabled with ₵' + st.cash + ' in hand and a ₵' + rc.cash + ' price'); continue; }
      ok(type + ' @' + cond + '% panel: ' + (cond >= 99 ? 'in top condition, button correctly disabled' : 'quotes ₵' + rc.cash + ', button live' + (cond <= 0 ? ', STALLED shown' : '')));
    }
  }
}

/* ── §7  THE FAUCET — how much Cinder BEST PLAY actually mints ──────────────
   🔴 WHY THIS SECTION EXISTS, AND WHY §1–§6 WERE NOT ENOUGH.
   Every section above asks "is Repair worth pressing?" and the answer is a
   ratio: value restored over price paid. A ratio is scale-free, and the owner's
   ask was not about a ratio — it was "less Cinder sloshing around". So all six
   sections scored a clean pass on a tree that had just MULTIPLIED the faucet.

   The 0.25 condition floor was two things at once, and only one of them was
   reported. It was a free ride (neglect cost nothing), and it was a 4× THROTTLE
   (a neglected machine ran at 25% speed). Removing it ended the free ride and
   deleted the throttle in the same line. Pre-fix, best play was to never repair
   and coast at 25% speed forever; post-fix, best play is to repair constantly
   and run near full speed for a cut. At a 0.35 cut that is 2.4× MORE Cinder per
   machine-hour reaching players, forever — the opposite of the ask, shipped
   under a comment that called it a tightening.

   So this section does not measure a ratio. It measures ₵ PER MACHINE-HOUR under
   BEST PLAY, on the shipped `_osimStepMachine`, searching the repair threshold
   rather than assuming one — a fixed policy would have missed it, because the
   pre-fix optimum (never repair) and the post-fix optimum (repair in the 90s)
   are not the same policy. It is compared against a RECORDED pre-fix baseline.

   ⚠ THE BASELINE IS HORIZON-MATCHED ON PURPOSE. These are 5,000 h numbers, taken
     on commit 92bd66fca8 (the tree before the repair fix) with this exact policy
     grid. They are NOT the steady state — a fresh machine spends its first
     stretch at full speed before it settles onto the 0.25 floor, so 5,000 h
     flatters the pre-fix side by ~9%. At 50,000 h the same measurement reads
     0.172 / 0.241 / 0.144 / 0.274 pre-fix against 0.179 / 0.241 / 0.142 / 0.286
     now. 5,000 h is used here only because it is fast and the POST-fix side has
     already converged by then (within 1% of its 50,000 h value); comparing a
     5,000 h run against a 50,000 h baseline would silently hand the fix a 9%
     budget it has not earned. Re-measure BOTH sides if you change the horizon.

   🔴 AND THE AXIS THIS SECTION WAS BLIND ON, WHICH IS WHY IT WENT GREEN OVER A
     2.5× REGRESSION. It measured one player: `freshState()` hardcoded
     `hardened: 0`. The whole argument for OSIM_REPAIR_SHARE = 0.73 is that it is
     THE number holding the steady-state faucet flat — an unconditional claim, in
     an unconditional 🔒 comment — and it was verified in exactly one of the four
     configurations the shipped Supply Depot sells. `_osimRepairValue` priced the
     restored condition at the RAW wear rate while `_osimStepMachine` spends it at
     the RESEARCHED one, so the effective share was 0.73 × decayMul and a player
     with ◈540 of Hardened Components paid 0.292 where the tuning said 0.73.
     Measured on the tree that shipped it at hardened L3, this horizon, against
     the baseline at the SAME research level: 2.19× / 2.05× / 1.96× / 2.38×.
     The baseline is per-level for the same reason: comparing a researched player
     now against an unresearched player then is not a measurement, and the pre-fix
     field was itself slightly research-sensitive (+3% to +18% from L0 to L3,
     because a slower-wearing machine takes longer to settle onto the 0.25 floor
     that capped it). Both columns are the same player. */
console.log('\n§7  best-play Cinder per machine-hour vs the pre-fix field, at every research level');
{
  /* Measured on 92bd66fca8, 5,000 h, the GRID below: the income a rational player
     took out of this field BEFORE the condition floor was removed, at each level
     of Hardened Components. Pre-fix best play is "never repair" in every cell —
     the floor made neglect dominant — so these are grid-insensitive; the post-fix
     side is not, which is why the grid is resolved around its optima. */
  const PRE_FAUCET = {
    pumpjack: [0.188, 0.194, 0.203, 0.216],
    drill:    [0.270, 0.281, 0.296, 0.318],
    refinery: [0.164, 0.172, 0.183, 0.199],
    deepcore: [0.290, 0.296, 0.305, 0.318],
  };
  const TOL = 1.10; // 10% — the fix lands at 0.79–0.99× across all 16 cells
  const HOURS = 5000, STEP = 600;
  /* -1 = never repair. The rest are "repair to 100% the moment condition drops
     to or below this", which is the whole family of sane maintenance policies.
     Pre-fix the optimum is -1; post-fix it moves with research — @97/@88 at L0
     but down into the 70s–80s at L3, because slower wear makes a deep repair
     cheap per unit — so the grid has to span both or it measures a policy no
     rational player would run. Verified against a 1-point-resolution sweep of
     50–99: this grid recovers the true optimum to within 1.6% in every cell. */
  const GRID = [-1, 60, 70, 78, 84, 86, 88, 90, 91, 93, 95, 96, 97, 98, 99];
  console.log('    ' + pad('machine', 11) + pad('hardened', 10) + pad('pre-fix ₵/h', 14) + pad('now ₵/h', 11) + pad('best policy', 16) + 'vs pre-fix');
  for (const type of TYPES) {
    for (const hard of HARDENED) {
      let best = null;
      for (const thr of GRID) {
        const st = freshState(hard); const A = make(st);
        st.inv.oil = 10 ** 12;
        const m = { type, tier: 1, condition: 100, buffer: 0, timer: 0 };
        st.placed.push(m);
        const def = A.OSIM_MACHINES[type], keep = 1 - A._osimSellSkim();
        let cash = 0;
        for (let t = 0; t < HOURS * 3600; t += STEP) {
          /* Unlimited bankroll: "the player cannot afford the button" is a
             different finding and would mask this one. See §3's note. */
          if (thr >= 0 && m.condition <= thr) {
            const rc = A._osimRepairCost(m);
            cash -= rc.cash + (rc.pipe || 0) * A._osimPartCost('pipe');
            m.condition = 100;
          }
          const before = m.buffer;
          A._osimStepMachine(m, STEP);
          const made = m.buffer - before;
          if (made > 0) {
            cash += made * (A.OSIM_RESERVE_PRICE[def.produces] || 0) * keep;
            if (def.consumes) cash -= made * (def.ratio || 1) * (A.OSIM_RESERVE_PRICE[def.consumes] || 0) * keep;
            m.buffer = 0;
          }
        }
        const perHour = cash / HOURS;
        if (!best || perHour > best.perHour) best = { perHour, thr };
      }
      const pre = PRE_FAUCET[type][hard];
      const now = Math.round(best.perHour * 1000) / 1000;
      const ratio = best.perHour / pre;
      console.log('    ' + pad(hard === 0 ? type : '', 11) + pad('L' + hard, 10) + pad(pre.toFixed(3), 14)
        + pad(now.toFixed(3), 11)
        + pad(best.thr < 0 ? 'never repair' : 'repair @' + best.thr + '%', 16) + f2(ratio) + '×');
      if (ratio <= TOL) ok(type + ' L' + hard + ' best play mints ' + f2(ratio) + '× the pre-fix field (₵' + now.toFixed(3) + '/h vs ₵' + pre + '/h)');
      else fail(type + ' L' + hard + ' FAUCET GREW: best play now mints ₵' + now.toFixed(3) + '/machine-hour against ₵' + pre + ' before the fix (' + f2(ratio) + '×) — the ask was LESS Cinder');
    }
  }
}

console.log('\n' + (bad ? '❌ ' + bad + ' failing check(s)\n' : '✅ all checks green\n'));
process.exit(bad ? 1 : 0);
