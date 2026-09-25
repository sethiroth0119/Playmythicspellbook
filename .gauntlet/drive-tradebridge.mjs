/* 🤝 GUILD TRADE — THE BRIDGE HALF, EXECUTED.
   _synckcheck.mjs only proves index.html PARSES. The thing that matters here is
   arithmetic: an escrow that debits a player must return exactly what it took,
   and must never take a partial side. So the shipped helpers are LIFTED OUT OF
   index.html BY NAME and run against a stub Profile — no copy of the logic
   lives in this file, so a regression in index.html fails this driver.

   node .gauntlet/drive-tradebridge.mjs                                       */
import fs from 'node:fs';

const SRC = fs.readFileSync('public/index.html', 'utf8');

// Pull `function NAME(...) { ... }` out of the file by brace-matching. Anchored
// at column 0 so it can only ever match a top-level declaration.
function lift(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function not found in index.html: ' + name);
  const open = SRC.indexOf('{', at);
  let d = 0, i = open;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) { i++; break; } }
  }
  return SRC.slice(at + 1, i);
}

const NAMES = ['_jbTradeMeta', '_jbTradeHave', '_jbTradeMove', '_jbTradeClean',
               '_jbTradeTake', '_jbTradeGive', '_jbTradeAdopt', '_jbTradeSqlMissing'];
const body = NAMES.map(lift).join('\n');

let bad = 0;
const chk = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ↳ ' + extra : ''));
  if (!ok) bad++;
};

// ── the stub world. Only what the lifted code actually reaches for. ─────────
function mkEnv(profile, deckNeed) {
  const Profile = profile;
  const env = {
    Profile,
    Corp: { vault: [], tradeOffers: [] },
    saveProfile: () => { env.saves++; },
    _ensureResources: () => (Profile.salvage = Profile.salvage || {}),
    _jbDeckNeed: () => (deckNeed || {}),
    _jbItemMeta: (id) => ({ name: 'Item ' + id, icon: '🧰' }),
    _meta: (id) => ({ name: 'Res ' + id, icon: '📦' }),
    _resolveAnyCardById: (id) => ({ name: 'Card ' + id, icon: '🃏' }),
    _gemsTaxExempt: (fn) => { env.taxExempt++; fn(); },
    getCardArt: () => null,
    saves: 0, taxExempt: 0,
  };
  const api = new Function('Profile', 'Corp', 'saveProfile', '_ensureResources', '_jbDeckNeed',
    '_jbItemMeta', '_meta', '_resolveAnyCardById', '_gemsTaxExempt', 'getCardArt',
    body + '\nreturn { _jbTradeHave, _jbTradeMove, _jbTradeClean, _jbTradeTake, _jbTradeGive, _jbTradeAdopt, _jbTradeSqlMissing };')
    (env.Profile, env.Corp, env.saveProfile, env._ensureResources, env._jbDeckNeed,
     env._jbItemMeta, env._meta, env._resolveAnyCardById, env._gemsTaxExempt, env.getCardArt);
  return { env, api };
}
const snap = (p) => JSON.stringify({
  cards: p.cardCollection || {}, items: p.itemInventory || {}, res: p.salvage || {}, gems: p.gems | 0,
});

// ── 1. deck-locked copies are not offerable ────────────────────────────────
{
  const { api } = mkEnv({ cardCollection: { c1: 5 }, itemInventory: {}, salvage: {}, gems: 0 }, { c1: 3 });
  chk('a card with 5 held and 3 deck-locked offers 2', api._jbTradeHave('card', 'c1') === 2, String(api._jbTradeHave('card', 'c1')));
  chk('a card the player does not own offers 0', api._jbTradeHave('card', 'nope') === 0);
}

// ── 2. take is ALL-OR-NOTHING ──────────────────────────────────────────────
{
  const p = { cardCollection: { c1: 5 }, itemInventory: { i1: 2 }, salvage: { metal: 10 }, gems: 0 };
  const { api } = mkEnv(p, { c1: 3 });
  const before = snap(p);
  const ok = api._jbTradeTake([
    { kind: 'resource', id: 'metal', qty: 4 },
    { kind: 'item', id: 'i1', qty: 99 },     // more than held — the whole side must fail
  ]);
  chk('a side the player cannot fully cover is refused', ok === false);
  chk('…and NOTHING was debited (a partial take would just lose the goods)', snap(p) === before, snap(p));
}

// ── 3. conservation: take then give returns the exact starting inventory ────
{
  const p = { cardCollection: { c1: 5 }, itemInventory: { i1: 2 }, salvage: { metal: 10 }, gems: 0 };
  const { api } = mkEnv(p, { c1: 3 });
  const before = snap(p);
  const side = [{ kind: 'resource', id: 'metal', qty: 7 },
                { kind: 'card', id: 'c1', qty: 2 },
                { kind: 'item', id: 'i1', qty: 2 }];
  chk('a side the player fully covers is taken', api._jbTradeTake(side) === true);
  chk('…the resource dropped by exactly the amount escrowed', (p.salvage.metal | 0) === 3, String(p.salvage.metal));
  chk('…the card dropped to the deck-locked floor', (p.cardCollection.c1 | 0) === 3, String(p.cardCollection.c1));
  chk('…an emptied item stack is removed, not left at 0',
    !Object.prototype.hasOwnProperty.call(p.itemInventory, 'i1'), JSON.stringify(p.itemInventory));
  api._jbTradeGive(side);
  chk('a refund restores the inventory EXACTLY — nothing created, nothing lost',
    snap(p) === before, snap(p) + ' vs ' + before);
}

// ── 4. the escrow cannot be over-drawn by asking twice ─────────────────────
{
  const p = { cardCollection: {}, itemInventory: {}, salvage: { metal: 5 }, gems: 0 };
  const { api } = mkEnv(p, {});
  api._jbTradeTake([{ kind: 'resource', id: 'metal', qty: 5 }]);
  const second = api._jbTradeTake([{ kind: 'resource', id: 'metal', qty: 1 }]);
  chk('a second escrow beyond the stack is refused', second === false);
  chk('…and the balance is 0, never negative', (p.salvage.metal | 0) === 0, String(p.salvage.metal));
}

// ── 5. clean() collapses a duplicate line rather than double-counting ──────
{
  const { api } = mkEnv({ cardCollection: {}, itemInventory: {}, salvage: {}, gems: 0 }, {});
  const out = api._jbTradeClean([
    { kind: 'resource', id: 'metal', qty: 3 },
    { kind: 'resource', id: 'metal', qty: 9 },   // duplicate — one line survives
    { kind: 'wheels',   id: 'car',   qty: 1 },   // not a tradeable kind
    { kind: 'item',     id: 'i1',    qty: 0 },   // zero
    { kind: 'item',     id: 'i2',    qty: -4 },  // negative
    { kind: 'item',     id: '',      qty: 2 },   // no id
  ]);
  chk('only real, positive, uniquely-keyed lines survive', out.length === 1 && out[0].id === 'metal' && out[0].qty === 3,
    JSON.stringify(out));
  /* 🔴 THIS ASSERTION USED TO DEMAND `big.length === 20`, and it was wrong —
     it guarded a `.slice(0, 20)` that was DELIBERATELY REMOVED from
     _jbTradeClean, with the reason written above the return statement:
     silently trimming a 25-line side meant the player was debited and escrowed
     for 20 lines while the other five vanished with no message, so the trade
     screen's totals described goods that never moved. Trimming to fit a cap is
     data loss wearing a validation costume.
     The real contract is two-part, and both halves are asserted here:
       · _jbTradeClean does NOT trim — it hands back everything valid, so the
         caller can see the true size and refuse the WHOLE offer;
       · the caller refuses an oversized side outright, BEFORE anything is
         taken (public/index.html: `give.length > 20 || want.length > 20`).
     The server cap in sql/048 (_ct_norm raises on a 21st line) stays the
     authority; the client's job is to fail loudly and early, not to reshape. */
  const big = api._jbTradeClean(Array.from({ length: 40 }, (_, i) => ({ kind: 'resource', id: 'r' + i, qty: 1 })));
  chk('_jbTradeClean does NOT silently trim an oversized side — it returns all 40',
    big.length === 40, String(big.length));
  const guard = fs.readFileSync('D:/game-deploy/public/index.html', 'utf8')
    .includes("if (give.length > 20 || want.length > 20) { showToast('⚠ At most 20 lines per side — nothing was sent.'");
  chk('…and the CALLER refuses the whole offer before anything is debited', guard,
    guard ? 'guard present' : 'THE 20-LINE GUARD IS GONE — an oversized offer would reach the server');
}

// ── 6. adopting the server's wallet answer ─────────────────────────────────
{
  const p = { cardCollection: {}, itemInventory: {}, salvage: {}, gems: 9999, walletSeqProgress: 4 };
  const { env, api } = mkEnv(p, {});
  api._jbTradeAdopt({ id: 'x', cinder: 7500, wallet_seq: 9 });
  chk('the balance the RPC returned is adopted verbatim', p.gems === 7500, String(p.gems));
  chk('…through _gemsTaxExempt, so the poll watcher cannot tax a server write', env.taxExempt === 1);
  chk('…and the debit counter moves with it (a missed seq un-spends the money next boot)',
    p.walletSeqProgress === 9, String(p.walletSeqProgress));
  api._jbTradeAdopt({ id: 'y' });                       // no Cinder leg on this trade
  chk('a trade with no Cinder leg leaves the balance alone', p.gems === 7500 && p.walletSeqProgress === 9);
  api._jbTradeAdopt(null);
  chk('a null RPC answer does not produce NaN', p.gems === 7500);

  // A trade that PAYS the caller: the debit answer is adopted, then the credit
  // leg is ADDED on top. Adopting a post-credit balance instead would drop an
  // unmirrored local gain — see the note in corp_trade_accept.
  const q = { cardCollection: {}, itemInventory: {}, salvage: {}, gems: 1000, walletSeqProgress: 1 };
  const two = mkEnv(q, {});
  two.api._jbTradeAdopt({ ok: true, cinder: 700, wallet_seq: 2, credit_cinder: 500 });
  chk('paid 500 after paying 300: 1000 → 700 (adopted) → 1,200 (credited)', q.gems === 1200, String(q.gems));
  // A refund-only answer (cancel) carries no balance at all.
  two.api._jbTradeAdopt({ ok: true, credit_cinder: 250 });
  chk('a cancel refund is added, never adopted', q.gems === 1450 && q.walletSeqProgress === 2, q.gems + '/' + q.walletSeqProgress);
}

// ── 7. "table is missing" is distinguishable from "no trades" ──────────────
{
  const { api } = mkEnv({ cardCollection: {}, itemInventory: {}, salvage: {}, gems: 0 }, {});
  chk('a PostgREST missing-table error is recognised',
    api._jbTradeSqlMissing({ code: 'PGRST205', message: "Could not find the table 'public.corp_trade_offers'" }) === true);
  chk('a missing-function error is recognised', api._jbTradeSqlMissing({ code: 'PGRST202', message: 'schema cache' }) === true);
  chk('an ordinary refusal is NOT mistaken for a missing table',
    api._jbTradeSqlMissing({ message: 'not enough Cinder' }) === false);
}

console.log(bad === 0 ? '\n=== TRADE BRIDGE: ALL PASS ===' : '\n=== TRADE BRIDGE: ' + bad + ' FAILED ===');
process.exit(bad === 0 ? 0 : 1);
