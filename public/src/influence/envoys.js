/* ============================================================================
   🎖 INFLUENCE — envoys: who turns up, what they carry, and what happens.
   ============================================================================
   Two halves, kept apart on purpose:

     ROLL     — `rollEncounter(ctx)` builds a plain data object describing a
                visitor and their offer. It reads state; it changes nothing.
     RESOLVE  — `resolve*(ctx, enc)` actually moves the player's property.

   🔴 WHY THE SPLIT. The modal renders the roll and the player then sits on it
   for as long as they like. If the roll had already paid out, a player could
   open the modal, collect resources elsewhere in the game, and the numbers on
   screen would describe a world that no longer exists. Worse for the case this
   feature was specified around: the stash-space check would have been made
   against a stash that has since changed. So resolve() re-reads headroom at
   the moment of the click and is the ONLY thing that pays.

   🔴 EVERY ctx CALL IS OPTIONAL. ctx is built from window.MythicInfluenceBridge
   (index.html's hand-over — the globals trap, CLAUDE.md). If a bridge method is
   missing the encounter degrades to something harmless rather than throwing
   into the render pipeline: no pool → no card offers, no resource accessors →
   no supply drops.
   ============================================================================ */

import * as M from './model.js';

/* 🔴 THE REFUSAL LINE IS VERBATIM AND MUST STAY THAT WAY. It is the exact
   wording the feature was specified with, it is the only thing the player sees
   when a drop is declined, and it is what makes the refusal read as the envoy
   shrugging rather than as the game eating a reward. Do not "improve" it. */
export const NO_SPACE_LINE = 'You do not have enough space maybe next time.';

/* Flavour. Deliberately data, not string-concatenation buried in the renderer,
   so the tone can be retuned without touching a payout path. */
const FIRST = ['Vessa', 'Korrin', 'Dael', 'Mirek', 'Saffi', 'Torvald', 'Ny', 'Ashra', 'Bellamy', 'Ivo',
               'Rook', 'Calla', 'Serge', 'Tamsin', 'Odalys', 'Grix', 'Weyl', 'Juno', 'Marn', 'Sable'];
const LAST  = ['of the Long Road', 'Ninefingers', 'the Quiet', 'Ashwalker', 'of Vault Six', 'Coldiron',
               'the Unsigned', 'of Hollow Reach', 'Bramble', 'Saltborn', 'the Lantern', 'of Kiln Street'];

const TITLES = {
  cinder:  ['Foundation Courier', 'Tithe-Bearer', 'Reserve Factor', 'Settlement Broker'],
  gift:    ['Archive Runner', 'Wandering Scribe', 'Relic Pedlar', 'Pattern Keeper'],
  recruit: ['Freelance Operator', 'Drifter', 'Contract Blade', 'Unaffiliated Survivor'],
  supply:  ['Convoy Master', 'Supply Adjutant', 'Caravan Warden', 'Depot Runner'],
};

const LINES = {
  cinder: [
    'Word of your camp reached the Reserve. They sent your cut.',
    'You are being talked about. Talk pays, apparently.',
    'The Foundation settles its favours in Cinder. Here is yours.',
  ],
  gift: [
    'I carry patterns, not goods. This one should be yours.',
    'The archive owed you. I am the archive’s way of paying.',
    'Somebody thought you should have this. They did not leave a name.',
  ],
  recruit: [
    'I heard what you are building. I would rather build it than fight it.',
    'No banner, no corp, no debts. Just me, and I am asking.',
    'You have room and standing. I have neither. Let us fix one of those.',
  ],
  supply: [
    'Convoy came through light, but it came through. Where do you want it?',
    'The Reserve routed a share your way. Sign for it and it is yours.',
    'Everything on this cart is spoken for. It is spoken for by you.',
  ],
};

function pick(arr, rng) {
  const r = (typeof rng === 'function') ? rng : Math.random;
  if (!arr || !arr.length) return null;
  return arr[Math.floor(r() * arr.length)];
}

function envoyIdentity(kind, rng) {
  return {
    name: pick(FIRST, rng) + ' ' + pick(LAST, rng),
    title: pick(TITLES[kind] || TITLES.cinder, rng),
    line: pick(LINES[kind] || LINES.cinder, rng),
  };
}

/* ── Encounter mix ──────────────────────────────────────────────────────────
   Recruits get commoner as standing rises: an unaffiliated operator walking
   into a nobody's camp and asking to join is the one outcome that should feel
   earned. Everything else holds roughly steady so the feature does not become
   a single-outcome slot machine at the top of the ladder. */
export function encounterWeights(s) {
  s = Math.max(0, Math.min(1, Number(s) || 0));
  return { cinder: 30, gift: 28, recruit: 22 + 18 * s, supply: 20 };
}

function rollKind(s, rng, allowed) {
  const r = (typeof rng === 'function') ? rng : Math.random;
  const w = encounterWeights(s);
  const keys = Object.keys(w).filter((k) => allowed[k]);
  if (!keys.length) return 'cinder';
  let total = 0;
  for (const k of keys) total += w[k];
  let p = r() * total;
  for (const k of keys) { p -= w[k]; if (p <= 0) return k; }
  return keys[keys.length - 1];
}

/* ── Card selection ─────────────────────────────────────────────────────────
   Roll a rarity from the standing table, then find a card at it. When the pool
   has nothing at that rarity we walk DOWN first and only then up: handing a
   player a mythic because the pool happened to be thin at epic would make the
   rarity roll a lie in the player's favour, which is the direction that
   quietly wrecks an economy.

   ⚠ Custom cards are PREFERRED, per the spec ("from the custom cards created").
     The built-in catalogue is the fallback, not the default — but it IS a
     fallback, because a camp with no custom cards published must still get
     offers rather than an empty modal. */
export function pickCard(pool, s, rng, filter) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const usable = pool.filter((e) => e && e.card && e.card.id && (!filter || filter(e)));
  if (!usable.length) return null;
  const custom = usable.filter((e) => e.custom);
  const from = custom.length ? custom : usable;

  const byRarity = {};
  for (const e of from) {
    const rid = String((e.card.rarity || 'common')).toLowerCase();
    (byRarity[rid] = byRarity[rid] || []).push(e);
  }
  const want = M.rollRarity(s, rng);
  const idx = M.RARITY_ORDER.indexOf(want);
  const order = [want];
  for (let i = idx - 1; i >= 0; i--) order.push(M.RARITY_ORDER[i]);
  for (let i = idx + 1; i < M.RARITY_ORDER.length; i++) order.push(M.RARITY_ORDER[i]);
  for (const rid of order) {
    const bucket = byRarity[rid];
    if (bucket && bucket.length) return { entry: pick(bucket, rng), rolledRarity: want, gotRarity: rid };
  }
  return null;
}

/* ── The roll ───────────────────────────────────────────────────────────────
   Returns a plain object. Never throws, never pays. */
export function rollEncounter(ctx) {
  ctx = ctx || {};
  const rng = ctx.rng || Math.random;
  const level = Math.max(1, ctx.level | 0 || 1);
  const s = Math.max(0, Math.min(1, Number(ctx.standing) || 0));

  const pool = (typeof ctx.cardPool === 'function' ? ctx.cardPool() : []) || [];
  const hasUnits = pool.some((e) => e && e.kind === 'unit');
  const canSupply = typeof ctx.resourceHeadroom === 'function' && typeof ctx.addRes === 'function';

  // An outcome the game cannot actually deliver is never offered. This is why
  // a player with no custom cards and no catalogue still gets a working modal
  // instead of an envoy holding nothing.
  const allowed = { cinder: true, gift: pool.length > 0, recruit: hasUnits, supply: canSupply };
  const kind = rollKind(s, rng, allowed);
  const enc = { kind, level, standing: s, at: Date.now(), envoy: envoyIdentity(kind, rng) };

  if (kind === 'cinder') {
    enc.cinder = M.rollCinder(level, s, rng);
    enc.band = M.cinderBand(level);
    return enc;
  }

  if (kind === 'gift') {
    // Everything the pool holds except units-that-want-to-join, which are the
    // recruit branch's business: spells, traps, weather, locations, walls — and
    // units too, as a straight gift rather than a person.
    const got = pickCard(pool, s, rng, null);
    if (!got) { enc.kind = 'cinder'; enc.cinder = M.rollCinder(level, s, rng); enc.band = M.cinderBand(level); return enc; }
    enc.card = got.entry.card;
    enc.cardKind = got.entry.kind;
    enc.rarity = String(got.entry.card.rarity || 'common').toLowerCase();
    enc.rolledRarity = got.rolledRarity;
    return enc;
  }

  if (kind === 'recruit') {
    const got = pickCard(pool, s, rng, (e) => e.kind === 'unit');
    if (!got) { enc.kind = 'cinder'; enc.cinder = M.rollCinder(level, s, rng); enc.band = M.cinderBand(level); return enc; }
    enc.card = got.entry.card;
    enc.cardKind = 'unit';
    enc.rarity = String(got.entry.card.rarity || 'common').toLowerCase();
    enc.rolledRarity = got.rolledRarity;
    // 💰 What the player market says this unit is worth today — NOT a number
    //    this feature invents. See ctx.cardMarketValue in index.js.
    enc.value = Math.max(1, (typeof ctx.cardMarketValue === 'function' ? ctx.cardMarketValue(enc.card) : 0) | 0);
    enc.owned = (typeof ctx.ownedCount === 'function' ? ctx.ownedCount(enc.card.id) : 0) | 0;
    return enc;
  }

  // supply
  const list = (typeof ctx.resources === 'function' ? ctx.resources() : []) || [];
  const kinds = Math.min(Math.max(1, list.length), M.resourceKindCount(level));
  const bag = list.slice();
  const grants = [];
  for (let i = 0; i < kinds && bag.length; i++) {
    const idx = Math.floor(rng() * bag.length);
    const r = bag.splice(idx, 1)[0];
    if (!r || !r.id) continue;
    grants.push({ id: r.id, name: r.name || r.id, icon: r.icon || '📦', qty: M.rollResourceQty(level, s, rng) });
  }
  enc.grants = grants;
  enc.total = grants.reduce((a, g) => a + g.qty, 0);
  enc.space = spaceFor(ctx, enc.total);
  return enc;
}

/* Headroom, read fresh. `free: Infinity` is what the game's own
   cityResourceHeadroom returns when no ceiling is known — never treat that as
   "no room". */
export function spaceFor(ctx, total) {
  let h = { cap: 0, units: 0, free: Infinity };
  try {
    if (ctx && typeof ctx.resourceHeadroom === 'function') h = ctx.resourceHeadroom() || h;
  } catch (e) {}
  const free = (h.free === Infinity || h.free == null) ? Infinity : Math.max(0, h.free | 0);
  return { cap: h.cap | 0, units: h.units | 0, free, enough: free >= (total | 0) };
}

/* ── Resolution ─────────────────────────────────────────────────────────────
   Each returns { ok, xp, toast?, dialog? }. `dialog` is the envoy SPEAKING —
   the renderer prints it in the envoy's own voice rather than as a toast,
   because the refusal case is a moment in the fiction, not an error. */

export function resolveCinder(ctx, enc) {
  const n = Math.max(0, Math.min(M.CINDER_CEILING, (enc && enc.cinder) | 0));
  if (!n) return { ok: false, xp: 0 };
  const paid = (typeof ctx.addCinder === 'function') ? ctx.addCinder(n) : false;
  if (!paid) return { ok: false, xp: 0, toast: '⚠ The tribute could not be banked. Nothing was taken.' };
  return { ok: true, xp: M.XP_FOR.cinder, cinder: n, toast: '🔥 +' + n.toLocaleString() + ' Cinder from ' + enc.envoy.name + '.' };
}

export function resolveGift(ctx, enc) {
  if (!enc || !enc.card) return { ok: false, xp: 0 };
  const got = (typeof ctx.grantCard === 'function') ? ctx.grantCard(enc.card.id) : false;
  if (!got) return { ok: false, xp: 0, toast: '⚠ That card could not be added to your collection.' };
  return { ok: true, xp: M.XP_FOR.gift, toast: '🃏 ' + (enc.card.name || 'A card') + ' added to your collection.' };
}

export function acceptRecruit(ctx, enc) {
  if (!enc || !enc.card) return { ok: false, xp: 0 };
  const got = (typeof ctx.grantCard === 'function') ? ctx.grantCard(enc.card.id) : false;
  if (!got) return { ok: false, xp: 0, toast: '⚠ They could not be added to your collection.' };
  return {
    ok: true, xp: M.XP_FOR.recruitAccept,
    dialog: 'Then I am yours. Point me at something.',
    toast: '🤝 ' + (enc.card.name || 'A survivor') + ' joined your camp.',
  };
}

/* 🔴 SELLING DOES NOT MINT THE CARD FIRST. An earlier shape of this granted the
   card and then sold it back, which is one crash away from a player holding a
   free unit — and it would have written two ledger entries for one event. The
   recruit is never in the collection; they simply walk somewhere else and leave
   the fee. */
export function sellRecruit(ctx, enc) {
  if (!enc || !enc.card) return { ok: false, xp: 0 };
  const n = Math.max(1, (enc.value | 0));
  const paid = (typeof ctx.addCinder === 'function') ? ctx.addCinder(n) : false;
  if (!paid) return { ok: false, xp: 0, toast: '⚠ The sale could not be banked. They are still waiting.' };
  return {
    ok: true, xp: M.XP_FOR.recruitSell, cinder: n,
    dialog: 'Fair enough. Somebody else will want me.',
    toast: '🔥 +' + n.toLocaleString() + ' Cinder — ' + (enc.card.name || 'the recruit') + ' signed elsewhere.',
  };
}

/* 📦 THE ONE THE SPEC IS ACTUALLY ABOUT.
   Space is re-checked HERE, against the live stash, and a short stash means the
   player gets NOTHING — not a clamped partial delivery. addRes() silently
   swallows anything over the cap, so a partial delivery would look like a
   successful one while quietly destroying the remainder; refusing outright is
   the honest outcome and the one the envoy has a line for. */
export function resolveSupply(ctx, enc) {
  if (!enc || !Array.isArray(enc.grants) || !enc.grants.length) return { ok: false, xp: 0 };
  const total = enc.grants.reduce((a, g) => a + (g.qty | 0), 0);
  const space = spaceFor(ctx, total);
  enc.space = space;
  if (!space.enough) {
    return {
      ok: false, refused: true, xp: M.XP_FOR.supplyRefused,
      dialog: NO_SPACE_LINE,
      toast: '📦 The convoy moved on — your stash is full (' + space.free.toLocaleString() + ' free, ' + total.toLocaleString() + ' needed).',
    };
  }
  for (const g of enc.grants) {
    try { ctx.addRes(g.id, g.qty | 0); } catch (e) {}
  }
  try { if (typeof ctx.save === 'function') ctx.save(); } catch (e) {}
  return {
    ok: true, xp: M.XP_FOR.supply, delivered: total,
    dialog: 'Unloaded. Sign here.',
    toast: '📦 ' + enc.grants.map((g) => g.icon + ' ' + g.qty.toLocaleString()).join('  ') + ' delivered.',
  };
}

export function dismiss() {
  return { ok: true, xp: M.XP_FOR.dismissed, toast: '🚪 You sent them on their way.' };
}
