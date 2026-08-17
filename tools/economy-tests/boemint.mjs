/* 🏦 BOEMINT — a reset landing mid-deposit must not mint the deposit.
   ----------------------------------------------------------------------------
   Run:  node tools/economy-tests/boemint.mjs
   Exits non-zero on any failure.

   WHY THIS FILE EXISTS.
   `_boeResTx` serializes every read-modify-write of `BankEthos.resources` and
   guards it with an epoch compare-and-set, so a transfer in flight when the
   account is wiped cannot commit afterwards and resurrect the bank. That half
   worked. The CAS was checked only AFTER the server row had been written, and
   the comment sitting on it argued that was correct:

       "The row is already written at this point, which is correct: the server
        row belongs to whoever the account is now [...] The next boeLoad
        hydrates the truth either way."

   The next boeLoad hydrates OUR WRITE. Measured on the tree before the fix,
   with `boeDepositRes('metal', 1000)` suspended between its server write and
   its CAS while `_boeResReset()` fires:

       stash before   1,000 metal          bank row before   {}
       ─────────────────────────────────────────────────────────────
       deposit returns false, refunds via _refundRes → stash 1,000
       server row still holds              {"metal":1000}
       next boeFetch hydrates it           bank 1,000
       ─────────────────────────────────────────────────────────────
       TOTAL 2,000 out of 1,000 — 1,000 metal MINTED FROM NOTHING

   The refund is right; the row is wrong. They have to agree, and only one of
   them was ever checked. Both shipped resets reach this window:

     • `_applyGlobalReset` (index.html :54406) calls `_boeResReset()` and then
       fire-and-forgets its own zero push, which races our update.
     • `_applySeasonReset` (index.html :77636) is WORSE: the `season_apply` RPC
       zeroes the row BEFORE the local `_boeResReset()`, so there is no later
       zero push at all — whatever our in-flight update lands is final.

   ⚠ §4 measures a SECOND defect this file did not set out to find and does NOT
     fix: `_applyGlobalReset`'s own row wipe is dead code. It does
     `const t = _boeRow(); if (t) { t.update(...) }` and `_boeRow` is `async`,
     so `t` is a Promise, `t.update` is undefined, and the TypeError is
     swallowed by the enclosing `catch (e) {}`. The global reset has never
     cleared the resources column. That makes the repair in _boeResTx the only
     thing that corrects the row, which is why §4 pins it rather than assuming
     the reset will clean up after us.

   IT DOES NOT RE-IMPLEMENT THE BANK. `_boeResTx`, `_boeResReset` and
   `boeDepositRes` are EXTRACTED from public/index.html by anchor + brace
   matching and run as-is; so are the bank-wipe fragments of both resets. Only
   the world around them (the Supabase row, the stash, the toasts) is a mock,
   and the mock is what lets the reset be fired at a chosen instant. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
// index.html is CRLF in this repo. Normalize once so multi-line anchors below
// can be written the way they read, rather than silently matching nothing.
let SRC = readFileSync(join(here, '..', '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

/* 🧨 THE SABOTAGE SWITCH — how this file is proved able to go RED.
   Each patch splices the PRE-FIX code back into the extracted source, in
   memory; the shipped tree is never written to. BOEMINT_SABOTAGE=<name>.

     late-cas    remove the pre-flight CAS and the losing-CAS row repair, i.e.
                 restore the single post-write check the finding was measured
                 on. This is the shipped bug, verbatim.
     no-repair   keep the pre-flight CAS, drop only the repair. Proves the
                 pre-flight check ALONE does not close the window — it narrows
                 it to "reset fires during the await", which is the whole race.

   Anchors are matched line-ending-agnostically (index.html is CRLF here) and a
   stale anchor THROWS: a sabotage that quietly no-ops is theatre. */
const SAB = process.env.BOEMINT_SABOTAGE || '';
const want = (n) => SAB === 'all' || SAB.split(',').includes(n);
/* MEASURED, both switches: 9 failures each, the SAME 9 — §1 (3), §2's
   "reset pushes zero FIRST" (2), §3 both callers (4). `late-cas` restores the
   shipped tree exactly; `no-repair` scores identically, and that identity is
   the point of having two switches: THE PRE-FLIGHT CAS BUYS NOTHING FOR THIS
   RACE. It cannot, because the epoch bump it looks for happens inside the await
   that comes after it. The repair is the entire fix; the pre-flight check is
   only there to keep the already-lost case off the network. Anyone tempted to
   "simplify" by keeping the cheap half should run `no-repair` first. */
/* ── extraction ─────────────────────────────────────────────────────────── */
function fn(name, kw) {
  const at = SRC.indexOf('\n' + (kw || '') + 'function ' + name + '(');
  if (at < 0) throw new Error('BOEMINT: cannot find ' + name + ' in index.html');
  const open = SRC.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(at + 1, j + 1); }
  }
  throw new Error('BOEMINT: unbalanced ' + name);
}
function lit(text) {
  if (SRC.indexOf(text) < 0) throw new Error('BOEMINT: literal no longer present — ' + text.slice(0, 60));
  return text;
}
/* The bank-wipe fragment of each reset, lifted verbatim from its caller so the
   test fires the SHIPPED wipe rather than a paraphrase of it. If either line
   is edited, extraction throws and this file has to be re-read, which is the
   point: the fragments are the callers' half of the contract. */
const GLOBAL_WIPE = lit("try { if (typeof BankEthos === 'object' && BankEthos) { BankEthos.aza = 0; BankEthos.balance = 0; _boeResReset(); } } catch (e) {}");
const SEASON_WIPE = lit("          BankEthos.aza = 0; BankEthos.balance = 0; _boeResReset();");
/* _applyGlobalReset's own row push, verbatim, so §4 measures whether it works
   rather than assuming it does. */
const GLOBAL_ROW_PUSH = lit(`    try {
      if (typeof _boeRow === 'function' && Profile.cloud && Profile.cloud.userId) {
        const t = _boeRow();
        if (t) {
          t.update({ aza: 0, balance: 0, resources: {}, updated_at: new Date().toISOString() })
           .eq('user_id', Profile.cloud.userId)
           .then(() => {}, (err) => { try { console.warn('[reset] BoE wipe failed', err); } catch (_) {} });
        }
      }
    } catch (e) {}`);

let SEAM = [
  lit('let _boeResChain = Promise.resolve();'),
  lit('let _boeResEpoch = 0;'),
  fn('_boeResReset'),
  fn('_boeResTx', 'async '),
  fn('boeDepositRes', 'async '),
].join('\n');

/* The two sabotages operate on the EXTRACTED seam, not on the whole file, so
   their anchors are the fix's own lines and cannot drift onto something else. */
function sabotageSeam(name, find, repl) {
  if (!want(name)) return;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n'));
  if (!re.test(SEAM)) throw new Error('BOEMINT sabotage "' + name + '": seam anchor no longer present');
  SEAM = SEAM.replace(re, () => repl);
  console.log('🧨 SABOTAGE ACTIVE: ' + name);
}
const PRE_MARK = '/*BOEMINT:PRECAS*/';
const REPAIR_MARK_A = '/*BOEMINT:REPAIR*/';
const REPAIR_MARK_B = '/*BOEMINT:REPAIREND*/';
function cut(markA, markB) {
  const a = SEAM.indexOf(markA);
  if (a < 0) return null;
  const b = SEAM.indexOf(markB, a);
  if (b < 0) throw new Error('BOEMINT: unterminated marker ' + markA);
  return SEAM.slice(a, b + markB.length);
}
if (want('late-cas') || want('no-repair')) {
  const rep = cut(REPAIR_MARK_A, REPAIR_MARK_B);
  if (!rep) throw new Error('BOEMINT sabotage: the repair markers are gone — has the fix been reverted by hand?');
  sabotageSeam(want('late-cas') ? 'late-cas' : 'no-repair', rep, '');
}
if (want('late-cas')) {
  const pre = cut(PRE_MARK, '/*BOEMINT:PRECASEND*/');
  if (!pre) throw new Error('BOEMINT sabotage: the pre-flight CAS markers are gone');
  sabotageSeam('late-cas', pre, '');
}

/* ── the world ──────────────────────────────────────────────────────────── */
/* A bank_of_ethos row, a stash, and a one-shot hold that suspends the NEXT
   server write so the reset can be fired at the exact instant the finding
   describes. Nothing here models the bug; the bug is in the extracted code. */
function makeWorld() {
  const w = {
    row: { resources: {} },      // the server's bank_of_ethos row for u1
    stash: {},                   // Profile.salvage
    writes: [],                  // ordered log of resource writes that LANDED
    toasts: [],
    hold: null,                  // one-shot: consumed by the next write
    uid: 'u1',
  };
  w.armHold = () => {
    let rel;
    const p = new Promise(r => { rel = r; });
    w.hold = p;
    return rel;                  // call to let the suspended write land
  };
  const table = {
    update(patch) {
      const held = w.hold; w.hold = null;   // one-shot
      return {
        eq: (col, uid) => (async () => {
          if (held) await held;
          if (patch && 'resources' in patch) {
            w.row.resources = JSON.parse(JSON.stringify(patch.resources));
            w.writes.push({ uid, resources: JSON.parse(JSON.stringify(patch.resources)) });
          }
          return { error: null };
        })(),
      };
    },
  };
  w.table = table;
  return w;
}

function bank(w) {
  const BankEthos = { ready: true, resources: {}, aza: 0, balance: 0, _extCols: true };
  const Profile = { cloud: { userId: w.uid, signedIn: true }, salvage: w.stash };
  const env = {
    BankEthos, Profile,
    showToast: (m) => { w.toasts.push(String(m)); },
    _boeNeedCols: () => false,
    getRes: (id) => w.stash[id] | 0,
    spendResources: (o) => {
      for (const k in o) if ((w.stash[k] | 0) < o[k]) return false;
      for (const k in o) w.stash[k] = (w.stash[k] | 0) - o[k];
      return true;
    },
    _persistResourcesSoon: () => {},
    // Uncapped — the sanctioned undo credit. See _refundRes' header.
    _refundRes: (id, n) => { w.stash[id] = (w.stash[id] | 0) + (n | 0); },
    // Capped, and deliberately NOT reachable from the deposit unwind. If a
    // future edit reaches for it there, this counter catches it.
    addRes: (id, n) => { w.addResCalls = (w.addResCalls | 0) + 1; w.stash[id] = Math.min(9999, (w.stash[id] | 0) + (n | 0)); },
    _boeResName: (id) => id,
    boeLog: () => {},
    dropMarketPriceDown: () => {},
    _boeRow: async () => w.table,
    console,
  };
  const names = Object.keys(env);
  const body = SEAM + `
  return {
    boeDepositRes,
    _boeResReset,
    _boeResTx,
    epoch: () => _boeResEpoch,
    globalWipe: () => { ${GLOBAL_WIPE} },
    globalRowPush: () => {
${GLOBAL_ROW_PUSH}
    },
    seasonWipe: () => { try { if (typeof BankEthos === 'object' && BankEthos) {
${SEASON_WIPE}
    } } catch (e) {} },
    // What the next boeFetch would do: adopt the server row into memory.
    hydrate: async () => { const _r = w_row(); await _boeResTx(() => _r, { localOnly: true }); return BankEthos.resources; },
    mem: () => BankEthos.resources,
  };`;
  const api = new Function(...names, 'w_row', body)(...names.map(n => env[n]), () => JSON.parse(JSON.stringify(w.row.resources)));
  api.BankEthos = BankEthos;
  return api;
}

/* ── reporting ──────────────────────────────────────────────────────────── */
let bad = 0;
const ok = (cond, label, detail) => {
  if (cond) console.log('   ✅ ' + label + (detail ? '   ' + detail : ''));
  else { bad++; console.log('   ❌ ' + label + (detail ? '   ' + detail : '')); }
};
const tot = (w, api) => (w.stash.metal | 0) + ((api.mem().metal) | 0);
const rowJson = (w) => JSON.stringify(w.row.resources);

console.log('🏦 BOEMINT — reset vs. in-flight deposit');
console.log('   source: public/index.html' + (SAB ? '   (SABOTAGE: ' + SAB + ')' : ''));

/* Set up: 1,000 metal in the stash, an empty bank. Every section starts here,
   so the ONE number that matters is the same everywhere — 1,000 units exist,
   and 1,000 units must still exist afterwards, wherever they are sitting. */
function fresh() {
  const w = makeWorld();
  w.stash.metal = 1000;
  const api = bank(w);
  return { w, api };
}

/* ══ §1 — THE MINT, driven through _applyGlobalReset's wipe ═══════════════ */
console.log('\n§1  reset fires while the deposit is mid-write (global reset)');
{
  const { w, api } = fresh();
  const release = w.armHold();                 // suspend the deposit's write
  const p = api.boeDepositRes('metal', 1000);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  // ⏱ THE INSTANT: the mutator has run, the update is in flight, the CAS has
  // not been reached. This is what a reset landing on a slow connection is.
  api.globalWipe();
  release();
  const okRet = await p;
  await api.hydrate();                         // the next boeFetch

  console.log('       deposit returned      ' + okRet);
  console.log('       stash after           ' + (w.stash.metal | 0));
  console.log('       server row            ' + rowJson(w));
  console.log('       bank after hydrate    ' + ((api.mem().metal) | 0));
  console.log('       TOTAL                 ' + tot(w, api) + '   (started with 1,000)');

  ok(tot(w, api) === 1000, 'no units minted', '→ ' + tot(w, api));
  ok(!(w.stash.metal >= 1000 && ((api.mem().metal) | 0) >= 1000), 'stash and bank do not BOTH hold the deposit');
  ok(okRet === false ? !(w.row.resources.metal > 0) : (w.stash.metal | 0) === 0,
     'the refund and the server row agree',
     okRet === false ? 'refunded → row must be empty, row=' + rowJson(w)
                     : 'stood → stash must be 0, stash=' + (w.stash.metal | 0));
  ok(!(w.addResCalls > 0), 'the unwind used _refundRes, not addRes');
}

/* ══ §2 — BOTH ORDERINGS of the reset's push against ours ════════════════ */
/* The reset and the transfer both write the row. Whichever lands last must not
   be able to leave the deposit standing on the server after a refund. */
console.log('\n§2  both write orderings');
for (const order of ['reset pushes zero FIRST', 'reset pushes zero LAST', 'reset fires BEFORE the write']) {
  const { w, api } = fresh();
  let okRet;
  if (order === 'reset fires BEFORE the write') {
    // No hold at all: the wipe lands before boeDepositRes reaches its write.
    // Nothing should touch the server row on our behalf.
    api.globalWipe();
    okRet = await api.boeDepositRes('metal', 1000);
  } else if (order === 'reset pushes zero FIRST') {
    const release = w.armHold();
    const p = api.boeDepositRes('metal', 1000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    api.globalWipe();
    w.row.resources = {};                       // the reset's zero lands now
    release();
    okRet = await p;
  } else {
    const release = w.armHold();
    const p = api.boeDepositRes('metal', 1000);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    api.globalWipe();
    release();
    okRet = await p;
    w.row.resources = {};                       // the reset's zero lands last
  }
  await api.hydrate();
  const t = tot(w, api);
  console.log('   ' + order.padEnd(28) + ' returned ' + String(okRet).padEnd(6) +
              ' stash ' + String(w.stash.metal | 0).padStart(5) +
              '  row ' + rowJson(w).padEnd(16) + ' bank ' + String((api.mem().metal) | 0).padStart(5) + '  total ' + t);
  ok(t === 1000, order + ': conserved', '→ ' + t);
  ok(okRet === false ? !(w.row.resources.metal > 0) : (w.stash.metal | 0) === 0,
     order + ': refund and row agree');
}

/* ══ §3 — DRIVEN FROM BOTH CALLERS ═══════════════════════════════════════ */
/* Same window, fired through each reset's OWN extracted wipe line. The season
   reset is the harsher case: `season_apply` has already zeroed the row by the
   time the local wipe runs, so there is no second zero push behind us. */
console.log('\n§3  both callers');
for (const caller of ['_applyGlobalReset', '_applySeasonReset']) {
  const { w, api } = fresh();
  const release = w.armHold();
  const p = api.boeDepositRes('metal', 1000);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  if (caller === '_applySeasonReset') w.row.resources = {};   // season_apply RPC, already done
  if (caller === '_applyGlobalReset') api.globalWipe(); else api.seasonWipe();
  release();
  const okRet = await p;
  await api.hydrate();
  const t = tot(w, api);
  console.log('   ' + caller.padEnd(20) + ' returned ' + String(okRet).padEnd(6) +
              ' stash ' + String(w.stash.metal | 0).padStart(5) +
              '  row ' + rowJson(w).padEnd(16) + ' bank ' + String((api.mem().metal) | 0).padStart(5) + '  total ' + t);
  ok(t === 1000, caller + ': conserved', '→ ' + t);
  ok(!(w.row.resources.metal > 0), caller + ': server row does not hold the refunded deposit');
  ok(api.epoch() > 0, caller + ': the wipe really bumped the epoch (the fragment is live)');
}

/* ══ §4 — _applyGlobalReset's own row wipe is dead code ═══════════════════ */
/* Not this file's fix, and deliberately not fixed here — but it is the reason
   §1-§3 cannot lean on "the reset will clear the row anyway". If this section
   ever goes GREEN, the reset started working and this comment is stale. */
console.log('\n§4  does _applyGlobalReset actually push the zero row?');
{
  const { w, api } = fresh();
  w.row.resources = { metal: 4321 };
  api.globalRowPush();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const landed = !(w.row.resources.metal > 0);
  console.log('       row after the reset\'s own push   ' + rowJson(w) + (landed ? '' : '   ← never cleared'));
  ok(!landed, 'KNOWN, out of scope: the push is a no-op (`const t = _boeRow()` is a Promise, `t.update` is undefined, TypeError swallowed)');
}

/* ══ §5 — the happy path still works ═════════════════════════════════════ */
console.log('\n§5  no reset: the deposit stands');
{
  const { w, api } = fresh();
  const okRet = await api.boeDepositRes('metal', 1000);
  await api.hydrate();
  console.log('       returned ' + okRet + '  stash ' + (w.stash.metal | 0) + '  row ' + rowJson(w) + '  bank ' + ((api.mem().metal) | 0));
  ok(okRet === true, 'deposit succeeded');
  ok((w.stash.metal | 0) === 0, 'stash debited');
  ok(((api.mem().metal) | 0) === 1000 && w.row.resources.metal === 1000, 'bank + row hold it');
  ok(tot(w, api) === 1000, 'conserved', '→ ' + tot(w, api));
  ok(w.writes.length === 1, 'exactly one server write on the clean path', '→ ' + w.writes.length);
}

console.log('\n' + (bad ? '❌ ' + bad + ' failure(s)' : '✅ all green'));
process.exit(bad ? 1 : 0);
