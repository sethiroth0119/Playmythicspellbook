/* ============================================================================
   src/trader/membership.js — TRADER MEMBERSHIPS            (piece: trader)

   Marketplace listing CAPACITY, bought with AZA. Every player has 15 slots for
   free and never needs to buy anything to take part in the economy; a
   membership only raises the ceiling on how many things you can have listed at
   once.

   ── WHAT THIS FILE IS NOT ─────────────────────────────────────────────────
   It is NOT the limit. `sql/053_trader_memberships.sql` installs BEFORE INSERT
   triggers on card_market_listings / resource_listings / boe_market_listings,
   and those are what actually stop the 16th listing. This file renders the
   numbers and asks the server for them. A cap enforced here would be a
   suggestion: the client writes those tables on its own JWT (index.html
   ~57387, ~57057 are plain `.insert(row)` calls), so anything checked here can
   be skipped by not running it.
   The practical consequence, and the reason it is worth stating: this file may
   be wrong about the count without anything being exploitable. It is a
   courtesy that happens to agree with the database.

   ── THE GLOBALS TRAP ──────────────────────────────────────────────────────
   `Profile`, `Cloud` and `App` are top-level `const` in index.html — lexical
   bindings, NOT properties of `window` — so this module cannot see them no
   matter how it asks. index.html hands over exactly what is needed through
   `window.MythicTraderHost` before loading this file. Nothing below reaches for
   a bare global, and every host call is optional-chained so a missing bridge
   degrades to "free tier, 15 slots" rather than throwing inside a render.

   ── PRICES LIVE IN THE DATABASE ───────────────────────────────────────────
   `TIERS` below is a FALLBACK for rendering before the catalogue arrives (and
   offline). The authority is `trader_membership_tiers`, and
   `trader_buy_membership()` charges from that table — never from a number this
   file sent. A client that lies about the price is charged the real one.
   ========================================================================== */

const FREE_SLOTS = 15;

/* Mirror of the seeded catalogue. Order is the upgrade path. */
export const TIERS = [
  { id: 'survivor',     name: 'Survivor Trader',     slots: 15,  aza: 0,   blurb: 'Every survivor can trade. Free, forever.' },
  { id: 'street',       name: 'Street Trader',       slots: 35,  aza: 9,   blurb: 'For players beginning to trade regularly.' },
  { id: 'merchant',     name: 'Merchant',            slots: 55,  aza: 19,  blurb: 'For established traders, collectors and smaller player businesses.' },
  { id: 'professional', name: 'Professional Trader', slots: 80,  aza: 35,  blurb: 'For players actively buying, selling, crafting and moving resources.' },
  { id: 'company',      name: 'Trade Company',       slots: 140, aza: 69,  blurb: 'For large player businesses and significant inventories.' },
  { id: 'tycoon',       name: 'Market Tycoon',       slots: 300, aza: 125, blurb: 'The highest Marketplace membership.' },
];

const host = () => (typeof window !== 'undefined' ? window.MythicTraderHost : null) || {};
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Last known truth from the server, plus whether we have ever heard from it.
   `known:false` is rendered differently from "15 free" — a player on a 300-slot
   membership must never be shown 15/300 for the second before the RPC lands and
   conclude they lost what they paid for. */
const state = { known: false, tier: 'survivor', name: 'Survivor Trader',
                slots: FREE_SLOTS, used: 0, remaining: FREE_SLOTS, fetching: null, at: 0 };

export function snapshot() { return Object.assign({}, state); }
export function tierById(id) { return TIERS.find((t) => t.id === id) || TIERS[0]; }

/* Ask the server. Coalesced — the Marketplace re-renders often and each render
   asking again would be a request per frame. 20s is short enough that posting a
   listing in another tab shows up quickly and long enough to not be chatty. */
export async function refresh(force) {
  const h = host();
  if (!h.rpc) return snapshot();
  if (!force && state.fetching) return state.fetching;
  if (!force && state.known && (Date.now() - state.at) < 20000) return snapshot();
  const p = (async () => {
    try {
      const j = await h.rpc('trader_membership_status', {});
      if (j && j.ok) {
        state.known = true; state.at = Date.now();
        state.tier = j.tier || 'survivor';
        state.name = j.name || tierById(state.tier).name;
        state.slots = Math.max(1, j.slots | 0);
        state.used = Math.max(0, j.used | 0);
        state.remaining = Math.max(0, j.remaining | 0);
      }
    } catch (e) { /* offline / table not installed — keep the last known values */ }
    state.fetching = null;
    return snapshot();
  })();
  state.fetching = p;
  return p;
}

/* True when the player cannot post another listing. Used to show the "capacity
   reached" panel BEFORE they fill in a form the database is going to refuse. */
export function isFull() { return state.known && state.used >= state.slots; }

export function nextTier() {
  return TIERS.find((t) => t.slots > state.slots) || null;
}

/* ── the Marketplace header ──────────────────────────────────────────────── */
export function capacityHtml() {
  const s = state;
  const pct = Math.max(0, Math.min(100, Math.round((s.used / Math.max(1, s.slots)) * 100)));
  const full = isFull();
  const near = !full && pct >= 80;
  const bar = full ? '#ff7a6a' : (near ? '#ffc24d' : '#7CFFB2');
  const up = nextTier();
  if (!s.known) {
    return '<div class="tm-cap tm-cap-wait"><span class="tm-cap-k">Marketplace</span>'
         + '<span class="tm-cap-v">checking your listing capacity…</span></div>';
  }
  return ''
    + '<div class="tm-cap' + (full ? ' is-full' : '') + '">'
    +   '<div class="tm-cap-row">'
    +     '<div class="tm-cap-col"><span class="tm-cap-k">Active Listings</span>'
    +       '<b class="tm-cap-v" style="color:' + bar + '">' + s.used + ' / ' + s.slots + '</b></div>'
    +     '<div class="tm-cap-col"><span class="tm-cap-k">Membership</span>'
    +       '<b class="tm-cap-v">' + esc(s.name) + '</b></div>'
    +     '<div class="tm-cap-col"><span class="tm-cap-k">Remaining Slots</span>'
    +       '<b class="tm-cap-v" style="color:' + bar + '">' + s.remaining + '</b></div>'
    +   '</div>'
    +   '<div class="tm-bar"><i style="width:' + pct + '%;background:' + bar + '"></i></div>'
    +   (full
        ? '<div class="tm-full">'
          + '<b>MARKETPLACE CAPACITY REACHED</b>'
          + '<span>You currently have ' + s.used + ' / ' + s.slots + ' active listings. '
          + 'Remove or sell an existing listing to create another, or increase your '
          + 'Trader Membership capacity.</span></div>'
        : '')
    +   '<div class="tm-cap-acts">'
    +     '<button type="button" class="tm-btn" data-tm-manage>Manage Listings</button>'
    +     (up ? '<button type="button" class="tm-btn tm-btn-up" data-tm-shop>'
                + (full ? 'View Memberships' : 'Upgrade Trader Membership') + '</button>' : '')
    +   '</div>'
    + '</div>';
}

/* ── the Vendor Shop section ─────────────────────────────────────────────── */
export function shopHtml() {
  const s = state;
  const aza = (host().aza && host().aza()) | 0;
  const rows = TIERS.map((t) => {
    const owned = s.known && t.slots <= s.slots;
    const isCurrent = s.known && t.id === s.tier;
    const free = t.aza === 0;
    const afford = aza >= t.aza;
    let act;
    if (isCurrent) act = '<span class="tm-own">✓ Current membership</span>';
    else if (owned) act = '<span class="tm-own tm-own-dim">Included</span>';
    else if (free) act = '<span class="tm-own tm-own-dim">Free for everyone</span>';
    else act = '<button type="button" class="tm-buy" data-tm-buy="' + t.id + '"'
             + (afford ? '' : ' disabled')
             + ' title="' + (afford ? 'Upgrade to ' + esc(t.name) : 'You need ' + t.aza + ' AZA') + '">'
             + '🪙 ' + t.aza + ' AZA</button>';
    return '<div class="tm-tier' + (isCurrent ? ' is-current' : '') + '">'
      + '<div class="tm-tier-h"><b>' + esc(t.name) + '</b>'
      + '<span class="tm-slots">' + t.slots + ' Listings</span></div>'
      + '<div class="tm-blurb">' + esc(t.blurb) + '</div>'
      + '<div class="tm-act">' + act + '</div></div>';
  }).join('');
  return ''
    + '<div class="tm-shop">'
    +   '<div class="tm-shop-h">TRADER MEMBERSHIPS</div>'
    +   '<div class="tm-shop-sub">Build your business. Expand your reach.</div>'
    +   '<div class="tm-shop-copy">Every survivor can trade, but serious merchants need room to '
    +     'move inventory. Trader Membership Cards increase the number of cards, resources, '
    +     'equipment and other goods you can list at once on the player Marketplace.</div>'
    +   '<div class="tm-note">Capacity only — memberships do not change your prices, your '
    +     'placement, the Marketplace fee, or what you can find. A free trader sells at exactly '
    +     'the same price as a Market Tycoon.</div>'
    +   '<div class="tm-tiers">' + rows + '</div>'
    + '</div>';
}

/* ── buying ──────────────────────────────────────────────────────────────── */
export async function buy(tierId) {
  const h = host();
  const t = tierById(tierId);
  if (!h.rpc) { h.toast && h.toast('⚠ Sign in to buy a Trader Membership.'); return false; }
  if (h.confirm) {
    const okGo = await h.confirm('Upgrade to ' + t.name + ' for ' + t.aza + ' AZA?<br>'
      + 'Your Marketplace capacity becomes <b>' + t.slots + ' active listings</b>. '
      + 'Existing listings are untouched.');
    if (!okGo) return false;
  }
  let j = null;
  try { j = await h.rpc('trader_buy_membership', { p_tier: tierId }); }
  catch (e) { j = null; }
  if (!j || !j.ok) {
    const err = (j && j.error) || 'failed';
    /* Named, because "purchase failed" for four different reasons is how a
       player concludes they were charged and got nothing. */
    const msg = err === 'insufficient_aza'  ? '⚠ Not enough AZA — ' + t.name + ' costs ' + t.aza + '.'
              : err === 'not_an_upgrade'    ? '⚠ That is not an upgrade — you already have ' + ((j && j.slots) | 0) + ' slots.'
              : err === 'not_authenticated' ? '⚠ Sign in to buy a Trader Membership.'
              : err === 'unknown_tier'      ? '⚠ That membership no longer exists.'
              : '⚠ Could not complete that purchase.';
    h.toast && h.toast(msg, 4200);
    return false;
  }
  /* ADOPT the server's numbers — never compute them here. The RPC charged from
     the price in its own table and returned the balance that resulted, which is
     the same rule the AZA checkout follows. */
  state.known = true; state.at = Date.now();
  state.tier = j.tier; state.name = j.name;
  state.slots = j.slots | 0; state.used = j.used | 0;
  state.remaining = Math.max(0, state.slots - state.used);
  if (typeof j.aza === 'number' && h.setAza) h.setAza(j.aza);
  h.toast && h.toast('✓ ' + j.name + ' — your Marketplace capacity is now '
    + state.slots + ' active listings.', 4600);
  h.render && h.render();
  return true;
}

/* ── one delegated listener for both surfaces ────────────────────────────── */
let wired = false;
export function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-tm-buy],[data-tm-shop],[data-tm-manage]') : null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const h = host();
    if (t.hasAttribute('data-tm-buy')) { buy(t.getAttribute('data-tm-buy')); return; }
    if (t.hasAttribute('data-tm-shop')) { h.openShop && h.openShop(); return; }
    if (t.hasAttribute('data-tm-manage')) { h.openListings && h.openListings(); return; }
  }, true);
}

const api = { TIERS, FREE_SLOTS, snapshot, refresh, isFull, nextTier, capacityHtml,
              shopHtml, buy, wire, tierById };
try { if (typeof window !== 'undefined') { window.MythicTrader = api; wire(); } } catch (e) {}
export default api;
