/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — the cloud half: player-to-player lots and the corp ranch.
   ----------------------------------------------------------------------------
   Everything here talks to Supabase THROUGH host.cloud, which index.html hands
   over on the bridge (the globals trap: `Cloud`, `Corp`, `Profile` are lexical
   and invisible here). Every call is guarded: no client, not signed in, no
   corp, a missing table (sql/038 not applied yet) — each degrades to a plain
   `{ ok: false, why }` the panel can print, never a throw and never a hang.

   ⚖ MONEY NEVER MOVES HERE. A bid is escrowed and a hammer paid by the
   SECURITY DEFINER functions in sql/038; this file only asks. The animal is
   client data (see the migration header) — the farm hands it over before
   posting and takes it back if the post fails.

   🤝 THE RANCH is one jsonb row per corporation with a version. The pure
   simulation below runs on whichever member opens it; the save carries the
   version it read, and a 'stale' answer means someone else saved first — we
   re-read and try once more. Feed, stock and claims are ledger rows the
   server appends from the entries we send with the save.
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ECON, animalDef } from './farm.data.js';
import { defaultName, rngFor } from './farm.events.js';

const H = 3600000;
const err = (why, extra) => Object.assign({ ok: false, why }, extra || {});
const ERR_TEXT = {
  not_signed_in: 'sign in to use the ring', bad_animal: 'that beast cannot be listed', min_bid_500: 'minimum bid is 500 Cinder',
  max_3_open_lots: 'you already have 3 lots open', no_such_lot: 'that lot is gone', closed: 'that lot has closed', own_lot: 'that is your own lot',
  already_high: 'you are already the high bidder', min_bid: 'bid too low', insufficient: 'not enough Cinder', still_open: 'the lot is still open',
  already_claimed: 'already claimed', not_yours: 'not yours to claim', not_a_member: 'you are not in that corporation', stale: 'someone else saved first',
  bad_state: 'bad ranch state',
};
const textOf = (e, extra) => { const t = ERR_TEXT[e] || e || 'unknown error'; return extra && extra.min ? `${t} (min ${Number(extra.min).toLocaleString()})` : t; };
const missingTable = (m) => /farm_lots|farm_ranch|PGRST205|does not exist|schema cache|function .* does not exist/i.test(String(m || ''));

function cloudOf(host) { const c = host && host.cloud; return (c && typeof c.rpc === 'function') ? c : null; }
async function rpc(host, name, args) {
  const c = cloudOf(host);
  if (!c) return err('cloud is not available');
  if (!c.ready()) return err('sign in to use this');
  try {
    const r = await c.rpc(name, args || {});
    if (r && r.error) return err(missingTable(r.error.message) ? 'the ring is not set up on the server yet (sql/038)' : (r.error.message || 'server error'));
    const d = r ? r.data : null;
    if (d && typeof d === 'object' && d.ok === false) return err(textOf(d.error, d), d);
    return { ok: true, data: d };
  } catch (e) { return err(String(e && e.message || e)); }
}

/* ── Player lots ─────────────────────────────────────────────────────────── */
export const lots = {
  async listOpen(host) {
    const c = cloudOf(host); if (!c || !c.ready()) return { ok: false, why: 'sign in to see the ring', rows: [] };
    try {
      const r = await c.select('farm_lots', { cols: 'id,seller_id,seller_name,animal,min_bid,current_bid,high_bidder,ends_at,status,claimed,created_at', eq: { status: 'open' }, order: ['ends_at', true], limit: 40 });
      if (r && r.error) return { ok: false, why: missingTable(r.error.message) ? 'the ring is not set up on the server yet (sql/038)' : r.error.message, rows: [] };
      return { ok: true, rows: r.data || [] };
    } catch (e) { return { ok: false, why: String(e && e.message || e), rows: [] }; }
  },
  async mine(host) {
    const c = cloudOf(host); if (!c || !c.ready()) return { ok: false, rows: [] };
    try {
      const me = c.userId();
      const a = await c.select('farm_lots', { cols: 'id,seller_id,seller_name,animal,min_bid,current_bid,high_bidder,ends_at,status,claimed,created_at', eq: { seller_id: me }, order: ['created_at', false], limit: 20 });
      const b = await c.select('farm_lots', { cols: 'id,seller_id,seller_name,animal,min_bid,current_bid,high_bidder,ends_at,status,claimed,created_at', eq: { high_bidder: me }, order: ['created_at', false], limit: 20 });
      const rows = [].concat((a && a.data) || [], (b && b.data) || []).filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
      return { ok: true, rows };
    } catch (e) { return { ok: false, rows: [] }; }
  },
  async bids(host, lotId) {
    const c = cloudOf(host); if (!c || !c.ready()) return [];
    try { const r = await c.select('farm_lot_bids', { cols: 'bidder_name,amount,created_at', eq: { lot_id: lotId }, order: ['created_at', false], limit: 12 }); return (r && r.data) || []; } catch (e) { return []; }
  },
  post: (host, animal, minBid, hours) => rpc(host, 'farm_lot_post', { p_animal: animal, p_min_bid: minBid | 0, p_hours: hours | 0, p_seller_name: cloudOf(host) ? cloudOf(host).userName() : null }),
  bid: (host, lotId, amount) => rpc(host, 'farm_lot_bid', { p_lot: lotId, p_amount: amount | 0, p_bidder_name: cloudOf(host) ? cloudOf(host).userName() : null }),
  settle: (host, lotId) => rpc(host, 'farm_lot_settle', { p_lot: lotId }),
  claim: (host, lotId) => rpc(host, 'farm_lot_claim', { p_lot: lotId }),
};

/* ── The corp ranch ───────────────────────────────────────────────────────── */
export function ranchEnsure(st) {
  st = (st && typeof st === 'object') ? st : {};
  if (!Array.isArray(st.animals)) st.animals = [];
  st.feed = Math.max(0, Number(st.feed) || 0);
  st.simAt = Number(st.simAt) || Date.now();
  if (!st.accrual || typeof st.accrual !== 'object') st.accrual = {};
  if (typeof st.seq !== 'number') st.seq = 1;
  if (!Array.isArray(st.log)) st.log = [];
  st.animals = st.animals.filter(a => a && animalDef(a.sp) && FARM_ECON.ranch.species.indexOf(a.sp) >= 0).map(a => ({ id: a.id | 0, sp: a.sp, name: String(a.name || '').slice(0, 24), grownH: Math.max(0, Number(a.grownH) || 0), by: String(a.by || '') }));
  return st;
}
/* Pure. Grazing at COMMON rate, no seasons (a corp spans many camps), no health. */
export function ranchSimulate(st, now) {
  now = now || Date.now();
  const hours = Math.max(0, (now - st.simAt) / H);
  if (hours <= 0 || !st.animals.length) { if (hours > 0) st.simAt = now; return st; }
  st.simAt = now;
  const draw = st.animals.reduce((d, a) => d + FARM_ECON.animals[a.sp].feedPerH * FARM_ECON.grazeDiscount, 0);
  const fedH = draw > 0 ? Math.min(hours, st.feed / draw) : hours;
  if (fedH <= 0) return st;
  st.feed = Math.max(0, st.feed - fedH * draw);
  st.animals.forEach(a => {
    const e = FARM_ECON.animals[a.sp];
    const adultH = Math.max(0, fedH - Math.max(0, e.growH - a.grownH));
    a.grownH += fedH;
    if (adultH <= 0) return;
    const y = FARM_ECON.yieldsPerH[a.sp] || {};
    Object.keys(y).forEach(r => { st.accrual[r] = (st.accrual[r] || 0) + y[r] * adultH; });
  });
  return st;
}
export function ranchView(st, meta) {
  const now = Date.now();
  const draw = st.animals.reduce((d, a) => d + FARM_ECON.animals[a.sp].feedPerH * FARM_ECON.grazeDiscount, 0);
  const pending = {}; Object.keys(st.accrual).forEach(r => { const n = Math.floor(st.accrual[r]); if (n > 0) pending[r] = n; });
  const share = (meta && meta.all_feed > 0) ? Math.min(1, (meta.my_feed || 0) / meta.all_feed) : (st.animals.length ? 0 : 0);
  const mine = {}; Object.keys(pending).forEach(r => { const n = Math.floor(pending[r] * share); if (n > 0) mine[r] = n; });
  return {
    herd: st.animals.map(a => Object.assign({}, a, { adult: a.grownH >= FARM_ECON.animals[a.sp].growH })),
    feed: Math.floor(st.feed), troughCap: FARM_ECON.ranch.troughCap, capacity: FARM_ECON.ranch.capacity,
    hoursLeft: draw > 0 ? st.feed / draw : Infinity, pending, share, mine, now,
  };
}
export const ranch = {
  async get(host) {
    const c = cloudOf(host); const corp = c && c.corp();
    if (!c || !c.ready()) return err('sign in to see the ranch');
    if (!corp) return err('join a corporation to ranch together');
    const r = await rpc(host, 'farm_ranch_get', { p_corp: corp.id });
    if (!r.ok) return r;
    const d = r.data || {};
    // Simulated for DISPLAY only (in memory): the pool the panel shows is what a
    // claim would find. Saves happen through apply(), which re-reads and re-runs.
    return { ok: true, corp, state: ranchSimulate(ranchEnsure(d.state), Date.now()), version: d.version | 0, meta: { my_feed: d.my_feed | 0, all_feed: d.all_feed | 0, ledger: d.ledger || [] } };
  },
  /* Apply `mutate(state)` → entries, then save with the version; retry once on 'stale'. */
  async apply(host, mutate) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const g = await ranch.get(host); if (!g.ok) return g;
      const st = ranchSimulate(g.state, Date.now());
      const entries = [];
      const m = mutate(st, entries, g); if (m && m.ok === false) return m;
      const r = await rpc(host, 'farm_ranch_save', { p_corp: g.corp.id, p_state: st, p_version: g.version, p_entries: entries, p_user_name: cloudOf(host).userName() });
      if (r.ok) return Object.assign({ ok: true, state: st, version: r.data && r.data.version }, m || {});
      if (r.why !== textOf('stale')) return r;
    }
    return err('someone else saved first — try again');
  },
  feed(host, units) {
    units = Math.max(1, units | 0);
    return ranch.apply(host, (st, entries) => {
      const free = Math.floor(FARM_ECON.ranch.troughCap - st.feed);
      const take = Math.min(units, free, host.getRes('animalFeed'));
      if (take <= 0) return err(free <= 0 ? 'the ranch trough is full' : 'no Animal Feed in your stash');
      if (!host.spendRes('animalFeed', take)) return err('could not take the feed');
      st.feed += take; entries.push({ kind: 'feed', resource: 'animalFeed', amount: take });
      st.log.unshift({ t: Date.now(), text: `${cloudOf(host).userName()} added ${take} feed.` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, added: take, undo: () => host.refundRes('animalFeed', take) };
    }).then(r => { if (!r.ok && r.undo) r.undo(); return r; });
  },
  stock(host, sp) {
    const e = FARM_ECON.animals[sp]; if (!e || FARM_ECON.ranch.species.indexOf(sp) < 0) return Promise.resolve(err('the ranch keeps sheep, goats and cows'));
    return ranch.apply(host, (st, entries) => {
      if (st.animals.length >= FARM_ECON.ranch.capacity) return err('the ranch is full');
      if (!host.spendGems(e.cinder)) return err('not enough Cinder');
      const a = { id: st.seq++, sp, name: defaultName(sp, st.seq * 7 + 3), grownH: 0, by: cloudOf(host).userName() };
      st.animals.push(a); entries.push({ kind: 'stock', resource: sp, amount: e.cinder });
      st.log.unshift({ t: Date.now(), text: `${a.by} brought ${a.name} the ${animalDef(sp).name.toLowerCase()} to the ranch.` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, name: a.name, undo: () => host.addGems(e.cinder) };
    }).then(r => { if (!r.ok && r.undo) r.undo(); return r; });
  },
  claim(host) {
    return ranch.apply(host, (st, entries, g) => {
      const v = ranchView(st, g.meta);
      const keys = Object.keys(v.mine);
      if (!keys.length) return err(v.share > 0 ? 'nothing to claim yet' : 'add feed first — your share is what you fed');
      const got = {};
      keys.forEach(r => { const before = host.getRes(r); host.addRes(r, v.mine[r]); const landed = Math.max(0, host.getRes(r) - before); if (landed > 0) { got[r] = landed; st.accrual[r] = Math.max(0, st.accrual[r] - landed); entries.push({ kind: 'claim', resource: r, amount: landed }); } });
      st.log.unshift({ t: Date.now(), text: `${cloudOf(host).userName()} claimed ${Object.keys(got).map(k => got[k] + ' ' + k).join(', ') || 'nothing'}.` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, got };
    });
  },
  butcher(host, animalId) {
    return ranch.apply(host, (st, entries, g) => {
      const a = st.animals.find(x => x.id === (animalId | 0)); if (!a) return err('no such animal');
      if (a.grownH < FARM_ECON.animals[a.sp].growH) return err(a.name + ' is not grown');
      const v = ranchView(st, g.meta); if (!(v.share > 0)) return err('feed the ranch before you cull it');
      const table = FARM_ECON.slaughter[a.sp]; const got = {};
      Object.keys(table).forEach(r => { const n = Math.max(1, Math.floor(table[r] * v.share)); const before = host.getRes(r); host.addRes(r, n); const landed = Math.max(0, host.getRes(r) - before); if (landed > 0) { got[r] = landed; entries.push({ kind: 'claim', resource: r, amount: landed }); } });
      st.animals = st.animals.filter(x => x !== a);
      st.log.unshift({ t: Date.now(), text: `${cloudOf(host).userName()} sent ${a.name} to the block (${Math.round(v.share * 100)}% share).` }); st.log.length = Math.min(st.log.length, 20);
      return { ok: true, got };
    });
  },
};
