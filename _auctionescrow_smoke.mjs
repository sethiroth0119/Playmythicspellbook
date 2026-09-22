/* 🔒 AUCTION ESCROW MOVES TO THE SERVER (sql/193_auction_escrow.sql, 2026-09-22).

   The finding: cloud auction bids "self-escrowed" in Profile.lockedGems, and
   the release loop was keyed to CardMarket.myBids, which lived only in memory.
   loadForge does not restore lockedGems, so a RELOAD dropped the lock — the
   bidder could spend the "locked" Cinder and still win, and the settlement
   `Profile.gems = Math.max(0, gems - bid)` let the winner pay less than the
   bid while the seller collected all of it. Restoring the lock client-side
   alone would strand the funds after an outbid. Owner decision: server escrow.

   This file drives the REAL client functions out of public/index.html
   (tools/gamedev/headless loadEngine — one engine per player, so each has its
   own Profile) against SERVER, a JS model of the SQL arithmetic in sql/193:
   debit on bid (only the difference when raising), refund of the previous high
   bidder in the same call, settle → claim once / seller paid once from escrow,
   sync → refunds holds that stopped being the high bid and reports the rest.
   The SQL itself was run against PostgreSQL 16 with the LIVE cml_guard while
   this was written; this smoke pins the client half and the arithmetic, and
   cross-checks that every RPC the client calls exists in the migration.

     0. the migration: tables, RLS, grants, verify query; client ⇄ SQL names
     1. pre-fix reproduction on the fallback path (RPC missing): reload frees
        the lock and the winner pays LESS than the bid — the reported bug, kept
        to prove the fallback is still today's behaviour and nothing more
     2. server path: a reload cannot free escrowed funds; the held amount is
        rebuilt from the server
     3. outbid refunds exactly once, and the outbid player's wallet catches up
     4. the winner pays the full bid, gets the card once; the seller is paid
        once, even when the winner never comes back
     5. cancelled / no-winner refunds
     6. adoption is tax-exempt (the spend watcher does not bill it again)

   Run: node _auctionescrow_smoke.mjs      (AE_FILE=<html> to run another copy) */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadEngine, INDEX, ROOT } from './tools/gamedev/headless.mjs';
import { join } from 'node:path';

let fails = 0, passes = 0;
const ok = (c, m, x) => {
  console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x));
  if (c) passes++; else fails++;
};
const FILE = process.env.AE_FILE || INDEX;   // AE_FILE=<html> runs another copy (e.g. the pre-fix one)
const SRC = readFileSync(FILE, 'utf8');
const SQL = readFileSync(join(ROOT, 'sql', '193_auction_escrow.sql'), 'utf8');

/* ── the server model: sql/193, statement for statement where money moves ── */
function makeServer() {
  const S = {
    wallets: {}, listings: {}, escrow: {}, ledger: [], wref: new Set(), missing: false, calls: [],
  };
  const key = (l, b) => l + '|' + b;
  const bal = (u) => ({ cinder: S.wallets[u] | 0, aza: 0, wallet_seq: 0 });
  const held = (l, b) => S.ledger.filter((r) => r.listing_id === l && r.bidder_id === b).reduce((s, r) => s + r.amount, 0);
  // _ae_wallet_move: ref already moved → no-op; a debit needs cover
  const move = (u, d, ref) => {
    if (ref && S.wref.has(u + '|' + ref)) return S.wallets[u] | 0;
    if (d < 0 && (S.wallets[u] | 0) < -d) return null;
    S.wallets[u] = (S.wallets[u] | 0) + d; if (ref) S.wref.add(u + '|' + ref); return S.wallets[u];
  };
  const pos = (l, b) => S.ledger.filter((r) => r.listing_id === l && r.bidder_id === b).length;
  const refund = (l, b) => {
    const e = S.escrow[key(l, b)];
    if (!e || e.status !== 'held') return 0;
    const h = held(l, b);
    if (h > 0) { const ref = 'ae:refund:' + l + ':' + b + ':' + pos(l, b); move(b, h, ref); S.ledger.push({ listing_id: l, bidder_id: b, kind: 'refund', amount: -h, ref }); }
    e.status = 'refunded'; return Math.max(h, 0);
  };
  const payout = (l, caller) => {
    const L = S.listings[l]; const e = Object.values(S.escrow).find((x) => x.listing_id === l && x.status === 'won');
    if (!e || e.paid || !L || L.seller_id !== caller) return 0;
    const h = held(l, e.bidder_id);
    if (L.paid_out) { S.ledger.push({ listing_id: l, bidder_id: e.bidder_id, kind: 'settle', amount: -h }); e.status = 'settled'; e.paid = true; return 0; }
    move(L.seller_id, h, 'ae:settle:' + l);
    S.ledger.push({ listing_id: l, bidder_id: e.bidder_id, kind: 'settle', amount: -h });
    e.status = 'settled'; e.paid = true; L.paid_out = true; return h;
  };
  const minBid = (L) => (L.current_bid | 0) <= 0 ? Math.max(L.starting_bid || 5, 1) : L.current_bid + Math.max(5, Math.ceil(L.current_bid * 0.05));
  const open = (L) => L.status === 'open' && !(L.ends_at && Date.parse(L.ends_at) <= Date.now());
  const hold = (u, L, amount, name) => {
    const e0 = S.escrow[key(L.id, u)];
    const mine = (e0 && e0.status === 'held') ? held(L.id, u) : 0;
    const need = amount - mine; const ref = 'ae:hold:' + L.id + ':' + u + ':' + pos(L.id, u);
    if (move(u, -need, ref) == null) return { ok: false, error: 'insufficient', need, ...bal(u) };
    S.escrow[key(L.id, u)] = Object.assign(e0 || { listing_id: L.id, bidder_id: u }, { seller_id: L.seller_id, status: 'held' });
    if (need) S.ledger.push({ listing_id: L.id, bidder_id: u, kind: 'hold', amount: need, ref });
    return { need };
  };
  const RPC = {
    auction_escrow_bid(u, { p_listing, p_amount, p_bidder_name }) {
      const L = S.listings[p_listing];
      if (!L) return { ok: false, error: 'no_such_listing' };
      if (!open(L)) return { ok: false, error: 'closed' };
      if (L.seller_id === u) return { ok: false, error: 'own_listing' };
      const min = minBid(L);
      if (!(p_amount >= min)) return { ok: false, error: 'min_bid', min };
      const h = hold(u, L, p_amount); if (h.ok === false) return h;
      const prev = L.current_bidder_id;
      if (prev && prev !== u) refund(L.id, prev);
      Object.assign(L, { current_bid: p_amount, current_bidder_id: u, current_bidder_name: p_bidder_name || 'Bidder' });
      return { ok: true, current_bid: p_amount, held: p_amount, charged: h.need, ...bal(u) };
    },
    auction_escrow_buy_now(u, { p_listing }) {
      const L = S.listings[p_listing];
      if (!L || !open(L)) return { ok: false, error: 'closed' };
      const price = L.buy_now_price | 0; if (!price) return { ok: false, error: 'no_buy_now' };
      const h = hold(u, L, price); if (h.ok === false) return h;
      for (const e of Object.values(S.escrow)) if (e.listing_id === L.id && e.bidder_id !== u && e.status === 'held') refund(L.id, e.bidder_id);
      Object.assign(L, { status: 'sold', buyer_id: u, current_bid: price, current_bidder_id: u });
      Object.assign(S.escrow[key(L.id, u)], { status: 'won', claimed: true });
      return { ok: true, claim: true, paid: price, charged: h.need, listing: { ...L }, ...bal(u) };
    },
    auction_escrow_settle(u, { p_listing }) {
      const L = S.listings[p_listing]; if (!L) return { ok: false, error: 'no_such_listing' };
      if (L.status === 'open') {
        if (Date.parse(L.ends_at) > Date.now()) return { ok: false, error: 'still_open' };
        const win = L.current_bidder_id;
        if (u !== L.seller_id && u !== win) return { ok: false, error: 'not_yours' };
        if (!win || (L.current_bid | 0) <= 0) {
          for (const e of Object.values(S.escrow)) if (e.listing_id === L.id && e.status === 'held') refund(L.id, e.bidder_id);
          return { ok: true, status: 'no_bids', ...bal(u) };
        }
        const e = S.escrow[key(L.id, win)];
        if (!e || e.status !== 'held' || held(L.id, win) !== L.current_bid) {
          const r = refund(L.id, win); return { ok: false, error: 'no_escrow', refunded: r, ...bal(u) };
        }
        for (const x of Object.values(S.escrow)) if (x.listing_id === L.id && x.bidder_id !== win && x.status === 'held') refund(L.id, x.bidder_id);
        Object.assign(L, { status: 'sold', buyer_id: win }); e.status = 'won';
      }
      if (L.status !== 'sold') return { ok: true, status: L.status, ...bal(u) };
      const e = Object.values(S.escrow).find((x) => x.listing_id === L.id && (x.status === 'won' || x.status === 'settled'));
      if (!e) return { ok: false, error: 'no_escrow', refunded: 0, ...bal(u) };
      const paid = u === L.seller_id ? payout(L.id, u) : 0;
      let claim = false; if (u === e.bidder_id && !e.claimed) { e.claimed = true; claim = true; }
      return { ok: true, status: 'sold', paid, claim, amount: L.current_bid, listing: claim ? { ...L } : null, ...bal(u) };
    },
    auction_escrow_sync(u) {
      let refunded = 0, paid = 0; const holds = {}, refunds = {}, claims = [], recent = {};
      for (const e of Object.values(S.escrow).filter((x) => x.bidder_id === u && x.status === 'held')) {
        const L = S.listings[e.listing_id];
        if (L && L.status === 'open' && L.current_bidder_id === u) holds[e.listing_id] = { amount: held(e.listing_id, u), currency: 'cinders' };
        else if (L && L.status === 'sold' && L.buyer_id === u) e.status = 'won';
        else { const a = refund(e.listing_id, u); refunded += a; refunds[e.listing_id] = a; }
      }
      for (const e of Object.values(S.escrow).filter((x) => x.seller_id === u && x.status === 'won' && !x.paid)) paid += payout(e.listing_id, u);
      for (const e of Object.values(S.escrow).filter((x) => x.bidder_id === u && (x.status === 'won' || x.status === 'settled') && !x.claimed)) {
        e.claimed = true; if (S.listings[e.listing_id]) claims.push({ ...S.listings[e.listing_id] });
      }
      for (const e of Object.values(S.escrow)) if (e.bidder_id === u && e.status !== 'held') recent[e.listing_id] = e.status;
      return { ok: true, refunded, refunds, recent, paid, holds, claims, ...bal(u) };
    },
  };
  /* the table, for the legacy (RPC-missing) path and the fetch's reads */
  function from(uid, tbl) {
    const st = { op: 'select', patch: null, f: [] };
    const rows = () => Object.values(S.listings).filter((r) => st.f.every(([k, op, v]) => op === 'eq' ? r[k] === v : (r[k] | 0) < v));
    const exec = () => {
      if (tbl !== 'card_market_listings') return { data: [], error: null };
      if (st.op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, st.patch)); return { data: hit.map((r) => ({ ...r })), error: null }; }
      if (st.op === 'delete') { const hit = rows(); hit.forEach((r) => delete S.listings[r.id]); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      return { data: rows().map((r) => ({ ...r })), error: null };
    };
    const q = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k, v) { st.f.push([k, 'eq', v]); return q; }, lt(k, v) { st.f.push([k, 'lt', v]); return q; },
      update(p) { st.op = 'update'; st.patch = p; return q; }, delete() { st.op = 'delete'; return q; },
      insert(r) { const id = 'L' + Object.keys(S.listings).length; S.listings[id] = { id, ...r }; return Promise.resolve({ error: null }); },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return q;
  }
  S.client = (uidFn) => ({
    auth: {},
    from: (t) => from(uidFn(), t),
    rpc: (name, args) => {
      S.calls.push(name);
      // PostgREST's real shape for an absent function — message first, code second
      if (S.missing || !RPC[name]) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name + '(p_listing) in the schema cache' } });
      return Promise.resolve({ data: JSON.parse(JSON.stringify(RPC[name](uidFn(), args || {}))), error: null });
    },
  });
  S.list = (id, seller, o = {}) => {
    S.listings[id] = { id, seller_id: seller, seller_name: 'Seller', kind: 'card', card_id: 'cc_' + id, card_json: { id: 'cc_' + id, name: 'Card ' + id },
      listing_type: 'auction', currency: 'cinders', price: 10, starting_bid: 10, current_bid: 0, current_bidder_id: null,
      buy_now_price: o.buyNow || null, bid_history: [], ends_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'open', paid_out: false, created_at: new Date().toISOString() };
    return S.listings[id];
  };
  S.expire = (id) => { S.listings[id].ends_at = new Date(Date.now() - 1000).toISOString(); };
  S.held = held;
  return S;
}

function player(S, uid, gems) {
  const e = loadEngine({ file: FILE });
  const run = (s) => vm.runInContext(s, e.sandbox);
  e.sandbox.__mk = S.client;
  run(`initCloud = () => true;
       Profile.cloud.signedIn = true; Profile.cloud.userId = '${uid}'; Profile.cloud.ownerUserId = '${uid}';
       Profile.cloud.displayName = '${uid}';
       Cloud.client = __mk(() => Profile.cloud.userId);
       saveProgressCloud = () => Promise.resolve();   // the cloud write is not under test here
       _serverMirrorCredit = () => {}; _serverMirrorCharge = () => {};
       _gemsTaxExempt(() => { Profile.gems = ${gems}; });`);
  S.wallets[uid] = gems;
  const J = (s) => { const t = run('JSON.stringify(' + s + ')'); return t === undefined ? undefined : JSON.parse(t); };
  const listingFor = (id) => run(`(CardMarket.open.find(l => l.id === '${id}') || null)`);
  const cards = () => run(`Object.keys(Profile.cardCollection || {}).filter(k => k.startsWith('cc_bought_')).length`);
  // "reload": the soft lock and the in-memory maps are exactly what a reload loses
  const reload = () => run(`saveProfile(); delete Profile.lockedGems; CardMarket.myBids = {}; CardMarket.escrowHeld = {}; loadForge();`);
  return { e, run, J, listingFor, cards, reload, uid };
}

/* ── 0. the migration ────────────────────────────────────────────────────── */
console.log('0. sql/193: tables, RLS, grants, verify; the client calls only what it defines');
{
  for (const t of ['auction_escrow', 'auction_escrow_ledger']) {
    ok(new RegExp(`create table if not exists public\\.${t}\\b`).test(SQL), `creates ${t} (idempotent)`);
    ok(new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(SQL), `${t} has RLS on`);
  }
  ok(/for select to authenticated using \(bidder_id = auth\.uid\(\)\)/.test(SQL), 'a bidder reads only their own escrow rows');
  ok((SQL.match(/with check \(false\)/g) || []).length >= 4, 'no client insert/update policy');
  const rpcs = ['auction_escrow_bid', 'auction_escrow_buy_now', 'auction_escrow_settle', 'auction_escrow_sync'];
  for (const f of rpcs) {
    ok(new RegExp(`create or replace function public\\.${f}\\(`).test(SQL) && new RegExp(`grant execute on function public\\.${f}\\(`).test(SQL), `${f} defined + granted`);
    ok(SRC.includes(`'${f}'`), `client calls ${f}`);
  }
  const called = [...SRC.matchAll(/_cmEscrowRpc\('([a-z_]+)'/g)].map((m) => m[1]);
  ok(called.length >= 4 && called.every((f) => rpcs.includes(f)), 'every _cmEscrowRpc name exists in sql/193', called.join(','));
  for (const h of ['_ae_wallet_move', '_ae_refund', '_ae_payout', '_ae_held', '_ae_balances']) {
    ok(new RegExp(`revoke all on function public\\.${h}\\([^)]*\\) from public, anon, authenticated`).test(SQL), `helper ${h} revoked from clients`);
  }
  ok(!/update public\.auction_escrow_ledger/i.test(SQL), 'the escrow ledger is never UPDATEd (held = sum(amount))');
  ok(/security definer set search_path = public/.test(SQL), 'definer functions pin search_path');
  ok(/\n-- ── 4\. Verify[\s\S]*select[\s\S]*pg_policies[\s\S]*;\s*$/.test(SQL), 'ends with a verify query');
}

/* ── 1. fallback path = today's behaviour, including the reported bug ─────── */
console.log('1. RPC missing (SQL not applied): the old self-escrow runs — and loses the lock on reload');
{
  const S = makeServer(); S.missing = true;
  S.list('A1', 'sel', {});
  const a = player(S, 'ua', 1000);
  await a.run('cardMarketFetch()');
  const okBid = await a.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'A1'), 300)`);
  ok(okBid === true && a.J('Profile.lockedGems')['A1'] === 300 && a.J('CardMarket.myBids')['A1'] === 300, 'falls back: soft lock + myBids, as before', JSON.stringify(a.J('Profile.lockedGems')));
  ok(a.J('CardMarket._escrowMissing') === true, 'the missing RPC is remembered (no retry storm)');
  ok(a.run('getAvailableGems()') === 700, 'before reload: 300 of 1000 locked');
  a.reload();
  ok(a.run('getAvailableGems()') === 1000, 'PRE-FIX BUG REPRODUCED: after a reload the lock is gone (all 1000 spendable)', a.run('getAvailableGems()'));
  a.run(`spendGems(900, 'test')`);
  S.expire('A1');
  await a.run('cardMarketFetch()');
  ok(a.run('Profile.gems') === 0 && a.cards() === 1, 'PRE-FIX BUG REPRODUCED: won a 300 bid while holding 100 → paid 100 (Math.max clamp)', a.run('Profile.gems'));
}

/* ── 2. server path: reload cannot free escrowed funds ────────────────────── */
console.log('2. server escrow: a reload cannot free the bid');
const S = makeServer();
S.list('L1', 'sel'); S.list('L2', 'sel'); S.list('L3', 'sel', { buyNow: 250 });
const A = player(S, 'ua', 1000), B = player(S, 'ub', 1000), SEL = player(S, 'sel', 0);
{
  await A.run('cardMarketFetch()');
  const r = await A.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L1'), 300)`);
  ok(r === true && S.calls.includes('auction_escrow_bid'), 'the bid went through auction_escrow_bid');
  ok(S.wallets.ua === 700 && S.held('L1', 'ua') === 300, 'server: 300 moved from the wallet into escrow', S.wallets.ua);
  ok(A.run('Profile.gems') === 700, 'client adopted the server balance', A.run('Profile.gems'));
  ok(!A.J('Profile.lockedGems') || !A.J('Profile.lockedGems')['L1'], 'no soft lock was taken (nothing for a reload to lose)');
  ok(!A.J('CardMarket.myBids') || !A.J('CardMarket.myBids')['L1'], 'myBids is not used on the server path');
  A.reload();
  ok(A.run('getAvailableGems()') === 700, 'after reload: still only 700 spendable', A.run('getAvailableGems()'));
  ok(A.run(`spendGems(900, 'test')`) === false, 'spending the escrowed Cinder is refused');
  await A.run('cardMarketFetch()');
  ok(A.J('CardMarket.escrowHeld')['L1'] === 300, 'the held 300 is rebuilt from the server after the reload', JSON.stringify(A.J('CardMarket.escrowHeld')));
}

/* ── 3. outbid refunds exactly once ──────────────────────────────────────── */
console.log('3. outbid: refunded once, in the outbidder\'s transaction; the outbid wallet catches up');
{
  await B.run('cardMarketFetch()');
  const r = await B.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L1'), 400)`);
  ok(r === true && S.wallets.ub === 600, 'B escrowed 400', S.wallets.ub);
  ok(S.wallets.ua === 1000, 'A refunded on the server in the same call', S.wallets.ua);
  await A.run('cardMarketFetch()');
  ok(A.run('Profile.gems') === 1000, 'A\'s client catches up on its next fetch (recent: refunded)', A.run('Profile.gems'));
  ok(!A.J('CardMarket.escrowHeld')['L1'], 'nothing shown as held any more');
  await A.run('cardMarketFetch()'); await A.run('cardMarketFetch()');
  const refunds = S.ledger.filter((x) => x.listing_id === 'L1' && x.bidder_id === 'ua' && x.kind === 'refund').length;
  ok(S.wallets.ua === 1000 && A.run('Profile.gems') === 1000 && refunds === 1, 'two more fetches: still exactly one refund', `${S.wallets.ua}/${refunds}`);
  const r2 = await B.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L1'), 500)`);
  ok(r2 === true && S.wallets.ub === 500 && S.held('L1', 'ub') === 500, 'raising your own bid pays only the difference', S.wallets.ub);
}

/* ── 4. winner pays the full bid; seller paid once ───────────────────────── */
console.log('4. settlement: full bid, one card, one payout');
{
  S.expire('L1');
  B.run(`spendGems(400, 'spend everything else')`);   // B cannot touch the escrow; this spends the rest
  S.wallets.ub -= 400;                                 // …and the spend watcher mirrors it to the canonical wallet
  await B.run('cardMarketFetch()');
  ok(B.cards() === 1, 'the winner gets the card', B.cards());
  ok(S.wallets.ub === 100 && B.run('Profile.gems') === 100 && S.held('L1', 'ub') === 500, 'the winner paid the full 500 bid although they spent everything else', `${S.wallets.ub}/${B.run('Profile.gems')}/${S.held('L1', 'ub')}`);
  await B.run('cardMarketFetch()');
  ok(B.cards() === 1, 'a second fetch grants no second card');
  await SEL.run('cardMarketFetch()');
  ok(S.wallets.sel === 500 && SEL.run('Profile.gems') === 500, 'the seller is paid the full 500 from escrow', `${S.wallets.sel}/${SEL.run('Profile.gems')}`);
  await SEL.run('cardMarketFetch()');
  ok(S.wallets.sel === 500 && SEL.run('Profile.gems') === 500, 'a second fetch pays nothing more (no legacy addGems on top)', SEL.run('Profile.gems'));
  ok(S.held('L1', 'ub') === 0, 'escrow emptied into the payout');
  // the winner never comes back: the seller settles
  await A.run('cardMarketFetch()');
  await A.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L2'), 50)`);
  S.expire('L2');
  await SEL.run('cardMarketFetch()');
  ok(S.wallets.sel === 550 && SEL.run('Profile.gems') === 550, 'seller paid although the winner has not returned', S.wallets.sel);
  await A.run('cardMarketFetch()');
  ok(A.cards() === 1 && A.run('Profile.gems') === 950, 'the winner receives the card on their next fetch, paid exactly 50', `${A.cards()}/${A.run('Profile.gems')}`);
  ok(S.wallets.ua + S.wallets.ub + S.wallets.sel + 400 === 2000, 'no Cinder created or lost (server wallets + B\'s 400 spend = 2000)', S.wallets.ua + S.wallets.ub + S.wallets.sel);
}

/* ── 5. cancelled / no winner / buy now ──────────────────────────────────── */
console.log('5. refunds when there is no winner');
{
  await A.run('cardMarketFetch()');
  await A.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L3'), 20)`);
  ok(S.wallets.ua === 930 && A.run('Profile.gems') === 930, 'A holds 20 on L3');
  S.listings.L3.status = 'cancelled';                      // the seller pulled it (direct write)
  await A.run('cardMarketFetch()');
  ok(S.wallets.ua === 950 && A.run('Profile.gems') === 950, 'listing gone → the hold comes back', A.run('Profile.gems'));
  S.list('L4', 'sel'); S.expire('L4');
  const st = await SEL.run(`_cmEscrowRpc('auction_escrow_settle', { p_listing: 'L4' })`);
  ok(st.ok && st.status === 'no_bids', 'ended with no bids → no_bids (the card goes back client-side)');
  S.list('L5', 'sel', { buyNow: 60 });
  await A.run('cardMarketFetch()');
  await A.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L5'), 10)`);
  await B.run('cardMarketFetch()');
  const bn = await B.run(`cardMarketBuyNow(CardMarket.open.find(l => l.id === 'L5'))`);
  ok(bn === true && S.wallets.ub === 40 && B.run('Profile.gems') === 40 && B.cards() === 2, 'Buy Now charges the price and grants the card', `${S.wallets.ub}/${B.run('Profile.gems')}/${B.cards()}`);
  await A.run('cardMarketFetch()');
  ok(S.wallets.ua === 950 && A.run('Profile.gems') === 950, 'the standing bidder is refunded by the Buy Now', A.run('Profile.gems'));
}

/* ── 6. tax-exempt adoption ──────────────────────────────────────────────── */
console.log('6. adopting a server balance is not billed as a spend');
{
  S.list('L6', 'sel');
  await A.run('cardMarketFetch()');
  await A.run(`cardMarketBid(CardMarket.open.find(l => l.id === 'L6'), 100)`);
  ok(A.run('Profile.gems') === 850 && A.run('_gemsWatchLast') === 850, 'the spend watcher is re-baselined (no 2% bill, no second mirrored debit)', A.run('_gemsWatchLast'));
  ok(/_cmEscrowAdopt[\s\S]{0,400}_gemsTaxExempt/.test(SRC), '_cmEscrowAdopt writes through _gemsTaxExempt');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
