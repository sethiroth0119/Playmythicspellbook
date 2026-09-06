/* ═══════════════════════════════════════════════════════════════════════════
   bazaar.render.js — the Bazaar overlay: Browse / Sell / Earnings.

   Self-contained overlay (like City Hall), not a screen in App.screen, so
   index.html needs to know one function: open(). Styles are inline for the
   same reason — this module must not depend on a class existing in a 215k-line
   stylesheet that predates it.

   ⚠ THE COPY ON THIS SCREEN IS PART OF THE FEATURE. It is real money: the
   player is told the fee, the hold window, and that we are the merchant of
   record BEFORE they act, not in a terms page. Do not trim these lines to
   make the UI tidier.
   ═══════════════════════════════════════════════════════════════════════════ */
import { bridge, esc, usd, centsFromInput } from './bazaar.bridge.js';
import * as api from './bazaar.api.js';

export const Bazaar = {
  open: false, tab: 'browse', loading: false,
  cfg: null, listings: [], mine: [], earn: null, waiting: [],
  error: null, notSetup: false, busy: false,
};

const $ = (id) => document.getElementById(id);

export async function refresh() {
  Bazaar.loading = true; paint();
  try {
    Bazaar.cfg = Bazaar.cfg || await api.config();
    const me = bridge().userId();
    const b = await api.browse(80);
    if (b.error === 'not_setup') { Bazaar.notSetup = true; }
    else if (b.error) { Bazaar.error = b.error; }
    else {
      Bazaar.notSetup = false; Bazaar.error = null;
      const rows = b.data || [];
      Bazaar.listings = rows.filter(r => r.seller_id !== me);
      Bazaar.mine = rows.filter(r => r.seller_id === me);
    }
    const e = await api.earnings();
    Bazaar.earn = e && !e.error ? e : null;
    const w = await api.unclaimed();
    Bazaar.waiting = (w && w.data) || [];
  } catch (e) { Bazaar.error = String(e && e.message || e); }
  Bazaar.loading = false; paint();
}

export function open() {
  if (Bazaar.open) return;
  Bazaar.open = true;
  let el = $('bazaar-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bazaar-overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(6,8,12,0.94);' +
      'overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:inherit;color:#e8e6e0';
    document.body.appendChild(el);
  }
  el.style.display = 'block';
  paint();
  refresh();
}

export function close() {
  Bazaar.open = false;
  const el = $('bazaar-overlay');
  if (el) el.style.display = 'none';
  try { bridge().render(); } catch (e) {}
}

function tabBtn(id, label) {
  const on = Bazaar.tab === id;
  return '<button data-bz-tab="' + id + '" style="flex:1;padding:0.7rem 0.4rem;border:0;cursor:pointer;' +
    'background:' + (on ? '#2a4a35' : 'transparent') + ';color:' + (on ? '#a0e0a0' : '#8a8a84') + ';' +
    'border-bottom:2px solid ' + (on ? '#a0e0a0' : 'transparent') + ';font-weight:600">' + esc(label) + '</button>';
}

function feeLine() {
  const bps = (Bazaar.cfg && Bazaar.cfg.feeBps) != null ? Bazaar.cfg.feeBps : 1000;
  const days = (Bazaar.cfg && Bazaar.cfg.holdDays) != null ? Bazaar.cfg.holdDays : 7;
  return 'The Bazaar keeps <strong>' + (bps / 100).toFixed(bps % 100 ? 2 : 0) + '%</strong> of each sale. ' +
    'Your share is held for <strong>' + days + ' day' + (days === 1 ? '' : 's') +
    '</strong> after the sale before it can be withdrawn — that window is what lets a ' +
    'disputed or fraudulent purchase be reversed without chasing your bank account.';
}

function card(r, mine) {
  return '<div style="border:1px solid #2a2f38;border-radius:10px;padding:0.85rem;margin:0.5rem 0;background:#12161d">' +
    '<div style="display:flex;justify-content:space-between;gap:0.6rem;align-items:flex-start">' +
      '<div style="min-width:0">' +
        '<div style="font-weight:700;color:#f0ede6">' + esc(r.title) + '</div>' +
        '<div style="font-size:0.8rem;color:#8a8a84;margin-top:0.15rem">' +
          esc(r.kind === 'item' ? 'Held item' : 'Card') + ' · ' + esc(r.seller_name || 'Survivor') + '</div>' +
        (r.blurb ? '<div style="font-size:0.85rem;color:#b6b2aa;margin-top:0.35rem">' + esc(r.blurb) + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right;flex:none">' +
        '<div style="font-weight:800;color:#a0e0a0;font-size:1.05rem">' + usd(r.price_cents) + '</div>' +
        (mine
          ? '<button data-bz-cancel="' + esc(r.id) + '" style="margin-top:0.4rem;padding:0.35rem 0.7rem;border-radius:7px;border:1px solid #5a3a3a;background:#241a1a;color:#e0a0a0;cursor:pointer">Cancel</button>'
          : '<button data-bz-buy="' + esc(r.id) + '" style="margin-top:0.4rem;padding:0.35rem 0.9rem;border-radius:7px;border:0;background:#2f6b45;color:#eaffea;font-weight:700;cursor:pointer">Buy</button>') +
      '</div>' +
    '</div></div>';
}

function browseTab() {
  if (!Bazaar.listings.length) {
    return '<p style="color:#8a8a84;text-align:center;padding:2rem 1rem">Nothing is for sale right now.</p>';
  }
  return Bazaar.listings.map(r => card(r, false)).join('');
}

function sellTab() {
  const inv = bridge().bazaarInventory() || [];
  let h = '<div style="background:#161b12;border:1px solid #2f3a25;border-radius:10px;padding:0.8rem;font-size:0.85rem;color:#c8d0bc;margin-bottom:0.8rem">' +
    feeLine() +
    '<br><br>Mythic Spellbook is the seller of record and processes the payment. ' +
    'You are paid out to the Stripe account you connect in the Cashout Vault — ' +
    'we never see your bank details.</div>';
  if (Bazaar.mine.length) {
    h += '<div style="font-weight:700;margin:0.6rem 0 0.2rem;color:#c8c4bc">Your listings</div>' +
      Bazaar.mine.map(r => card(r, true)).join('');
  }
  h += '<div style="font-weight:700;margin:1rem 0 0.2rem;color:#c8c4bc">List something</div>';
  if (!inv.length) {
    h += '<p style="color:#8a8a84">You have nothing listable. Only cards and held items you actually own can be listed.</p>';
    return h;
  }
  h += '<div style="max-height:22rem;overflow-y:auto">' + inv.map(it =>
    '<div style="display:flex;gap:0.5rem;align-items:center;border:1px solid #2a2f38;border-radius:9px;padding:0.55rem;margin:0.35rem 0;background:#12161d">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600">' + esc(it.title) + '</div>' +
        '<div style="font-size:0.78rem;color:#8a8a84">' + esc(it.kind === 'item' ? 'Held item' : 'Card') + '</div>' +
      '</div>' +
      '<input data-bz-price="' + esc(it.uid) + '" inputmode="decimal" placeholder="$0.00" ' +
        'style="width:5.5rem;padding:0.4rem;border-radius:7px;border:1px solid #3a4048;background:#0d1016;color:#e8e6e0">' +
      '<button data-bz-list="' + esc(it.uid) + '" style="padding:0.42rem 0.8rem;border-radius:7px;border:0;background:#2f6b45;color:#eaffea;font-weight:700;cursor:pointer">List</button>' +
    '</div>').join('') + '</div>';
  return h;
}

function earnTab() {
  const e = Bazaar.earn;
  if (!e) return '<p style="color:#8a8a84;padding:1rem">Sign in to see your Bazaar earnings.</p>';
  let h = '<div style="display:flex;gap:0.5rem;text-align:center;margin-bottom:0.8rem">' +
    ['available_cents,Available,#a0e0a0', 'pending_cents,On hold,#d8c07a', 'total_cents,Total,#9fd8ff']
      .map(spec => { const [k, label, col] = spec.split(',');
        return '<div style="flex:1;background:#12161d;border:1px solid #2a2f38;border-radius:10px;padding:0.7rem">' +
          '<div style="font-size:1.15rem;font-weight:800;color:' + col + '">' + usd(e[k]) + '</div>' +
          '<div style="font-size:0.75rem;color:#8a8a84">' + label + '</div></div>'; }).join('') +
    '</div>';

  h += '<div style="font-size:0.85rem;color:#b6b2aa;line-height:1.5;margin-bottom:0.8rem">' + feeLine() + '</div>';

  // The three states a seller can be in, each with the ONE action that
  // advances it. A disabled button with no explanation is what makes payout
  // screens feel broken, so every refusal below says what to do instead.
  if (!e.connected) {
    h += '<p style="color:#d8c07a">Connect a Stripe account in the <strong>Cashout Vault</strong> before you can withdraw.</p>';
  } else if (!e.payout_ready) {
    h += '<p style="color:#d8c07a">Stripe has not finished verifying your account yet. Reopen onboarding from the Cashout Vault to complete it.</p>';
  } else if (!e.payouts_enabled) {
    h += '<p style="color:#8a8a84">Withdrawals are not switched on for this deployment yet. Your balance keeps accruing.</p>';
  } else if ((e.available_cents | 0) <= 0) {
    h += '<p style="color:#8a8a84">Nothing available to withdraw yet.</p>';
  } else {
    h += '<button id="bz-payout" style="width:100%;padding:0.8rem;border-radius:9px;border:0;background:#2f6b45;color:#eaffea;font-weight:800;font-size:1rem;cursor:pointer">' +
      'Withdraw ' + usd(e.available_cents) + ' to Stripe</button>';
  }
  return h;
}

function waitingBanner() {
  if (!Bazaar.waiting.length) return '';
  return '<div style="background:#1a2233;border:1px solid #35507a;border-radius:10px;padding:0.7rem;margin-bottom:0.7rem">' +
    '<div style="font-weight:700;color:#9fd8ff;margin-bottom:0.35rem">' + Bazaar.waiting.length +
      ' purchase' + (Bazaar.waiting.length === 1 ? '' : 's') + ' waiting to collect</div>' +
    Bazaar.waiting.map(w =>
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-top:0.3rem">' +
        '<span>' + esc(w.title) + '</span>' +
        '<button data-bz-claim="' + esc(w.order_id) + '" style="padding:0.3rem 0.75rem;border-radius:7px;border:0;background:#35507a;color:#e8f2ff;font-weight:700;cursor:pointer">Collect</button>' +
      '</div>').join('') + '</div>';
}

export function paint() {
  const el = $('bazaar-overlay');
  if (!el || !Bazaar.open) return;
  let body;
  if (Bazaar.notSetup) {
    body = '<p style="color:#8a8a84;padding:1.5rem;text-align:center">The Bazaar is not set up on this deployment yet.</p>';
  } else if (Bazaar.loading && !Bazaar.listings.length && !Bazaar.earn) {
    body = '<p style="color:#8a8a84;padding:2rem;text-align:center">Loading…</p>';
  } else {
    body = Bazaar.tab === 'browse' ? browseTab() : Bazaar.tab === 'sell' ? sellTab() : earnTab();
  }
  el.innerHTML =
    '<div style="max-width:720px;margin:0 auto;padding:1rem 1rem 4rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.7rem">' +
        '<h2 style="margin:0;font-size:1.4rem;color:#a0e0a0">💵 The Bazaar</h2>' +
        '<button id="bz-close" style="padding:0.4rem 0.9rem;border-radius:8px;border:1px solid #3a4048;background:#161a20;color:#c8c4bc;cursor:pointer">Close</button>' +
      '</div>' +
      '<div style="font-size:0.82rem;color:#8a8a84;margin-bottom:0.7rem">Player-to-player sales for real money.</div>' +
      waitingBanner() +
      '<div style="display:flex;border-bottom:1px solid #2a2f38;margin-bottom:0.6rem">' +
        tabBtn('browse', 'Browse') + tabBtn('sell', 'Sell') + tabBtn('earnings', 'Earnings') +
      '</div>' +
      (Bazaar.error ? '<div style="color:#e0a0a0;padding:0.5rem">' + esc(Bazaar.error) + '</div>' : '') +
      body +
    '</div>';
  wire(el);
}

function wire(el) {
  const c = $('bz-close'); if (c) c.onclick = close;
  el.querySelectorAll('[data-bz-tab]').forEach(b => {
    b.onclick = () => { Bazaar.tab = b.getAttribute('data-bz-tab'); paint(); };
  });
  el.querySelectorAll('[data-bz-buy]').forEach(b => { b.onclick = () => doBuy(b.getAttribute('data-bz-buy')); });
  el.querySelectorAll('[data-bz-cancel]').forEach(b => { b.onclick = () => doCancel(b.getAttribute('data-bz-cancel')); });
  el.querySelectorAll('[data-bz-list]').forEach(b => { b.onclick = () => doList(b.getAttribute('data-bz-list')); });
  el.querySelectorAll('[data-bz-claim]').forEach(b => { b.onclick = () => doClaim(b.getAttribute('data-bz-claim')); });
  const p = $('bz-payout'); if (p) p.onclick = doPayout;
}

// ── Actions ────────────────────────────────────────────────────────────────
async function doBuy(id) {
  if (Bazaar.busy) return;
  const r = (Bazaar.listings || []).find(x => x.id === id);
  if (!r) return;
  const ok = await bridge().confirm(
    'Buy "' + r.title + '" for ' + usd(r.price_cents) + ' in real money?\n\n' +
    'You will be taken to Stripe to pay. Mythic Spellbook is the seller of record.');
  if (!ok) return;
  Bazaar.busy = true;
  try {
    const j = await api.checkout(id);
    if (j && j.url) { bridge().toast('↪ Redirecting to Stripe…', 4000); window.location.href = j.url; return; }
    bridge().toast('⚠ ' + (j && (j.hint || j.error) || 'Could not start checkout.'), 5200);
  } finally { Bazaar.busy = false; }
}

async function doCancel(id) {
  if (Bazaar.busy) return;
  if (!await bridge().confirm('Cancel this listing? The item comes back to you.')) return;
  Bazaar.busy = true;
  try {
    const r = await api.cancel(id);
    if (r.error) { bridge().toast('⚠ ' + r.error, 4200); return; }
    // 🔁 UNWIND THE ESCROW — the item left the player when they listed it, so
    // cancelling MUST put it back.
    // ⚠ RESTORE, NOT GRANT. bazaarGrant mints a NEW card id (that is correct
    //   for a buyer receiving a copy) — using it here would return the seller
    //   a differently-identified card and strand the original id's slot. The
    //   seller gets back exactly what was taken, under its own uid.
    const row = (Bazaar.mine || []).find(x => x.id === id);
    if (row) bridge().bazaarRestore({ uid: row.item_uid, kind: row.kind });
    bridge().toast('Listing cancelled — the item is back in your collection.', 3600);
    await refresh();
  } finally { Bazaar.busy = false; }
}

async function doList(uid) {
  if (Bazaar.busy) return;
  const inv = bridge().bazaarInventory() || [];
  const item = inv.find(i => i.uid === uid);
  const input = document.querySelector('[data-bz-price="' + uid.replace(/"/g, '') + '"]');
  const cents = centsFromInput(input && input.value);
  if (!item) return;
  if (cents == null) { bridge().toast('Enter a price like 4.99.', 3200); return; }

  const bps = (Bazaar.cfg && Bazaar.cfg.feeBps) != null ? Bazaar.cfg.feeBps : 1000;
  const fee = Math.floor((cents * bps) / 10000);
  const ok = await bridge().confirm(
    'List "' + item.title + '" for ' + usd(cents) + '?\n\n' +
    'You receive ' + usd(cents - fee) + ' after the ' + (bps / 100).toFixed(bps % 100 ? 2 : 0) + '% Bazaar fee.\n' +
    'The item leaves your collection now and goes to the buyer when it sells.');
  if (!ok) return;

  Bazaar.busy = true;
  try {
    // 📦 ESCROW FIRST, ROW SECOND — always, and put it back if the row fails.
    // The reverse order lets a network blip leave a listing for an item the
    // seller still holds, which on a real-money market is a sold-twice bug.
    if (!bridge().bazaarEscrow(item)) { bridge().toast('⚠ Could not escrow that item.', 4000); return; }
    const r = await api.list(item, cents);
    if (r.error) {
      bridge().bazaarRestore(item);
      bridge().toast('⚠ ' + (r.error === 'not_setup' ? 'The Bazaar is not set up on this deployment.' : r.error), 5000);
      return;
    }
    bridge().toast('Listed "' + item.title + '" for ' + usd(cents) + '.', 3600);
    await refresh();
  } finally { Bazaar.busy = false; }
}

async function doClaim(orderId) {
  if (Bazaar.busy) return;
  Bazaar.busy = true;
  try {
    const r = await api.claim(orderId);
    if (r.error) { bridge().toast('⚠ ' + r.error, 4200); return; }
    const p = r.data || {};
    if (!bridge().bazaarGrant(p)) { bridge().toast('⚠ Collected, but the item could not be added — reload and try again.', 6000); return; }
    bridge().toast('Collected "' + (p.title || 'your purchase') + '".', 3600);
    await refresh();
  } finally { Bazaar.busy = false; }
}

async function doPayout() {
  if (Bazaar.busy) return;
  const e = Bazaar.earn; if (!e) return;
  const cents = e.available_cents | 0;
  if (!(cents > 0)) return;
  if (!await bridge().confirm('Withdraw ' + usd(cents) + ' to your connected Stripe account?')) return;
  Bazaar.busy = true;
  try {
    const j = await api.payout(cents);
    if (j && j.ok) { bridge().toast('✅ ' + usd(cents) + ' sent to your Stripe account.', 5200); await refresh(); return; }
    bridge().toast('⚠ ' + ((j && (j.hint || j.detail || j.error)) || 'Withdrawal failed.'), 6000);
    await refresh();
  } finally { Bazaar.busy = false; }
}

// 🔙 The buyer's return leg from Stripe. index.html sends the whole query
// string; we only act on our own marker so this is safe to call always.
export async function handleReturn(search) {
  try {
    const q = new URLSearchParams(search || '');
    if (!q.get('bazaar_paid')) return false;
    const sid = q.get('sid');
    if (!sid) return false;
    const j = await api.confirm(sid);
    if (j && j.ok) {
      bridge().toast('✅ Purchase complete — open the Bazaar to collect your item.', 6000);
      return true;
    }
    // Not fatal: the webhook credits the sale independently, so the item is
    // still coming. Say that rather than implying the money was lost.
    bridge().toast('Payment received. If your item is not there yet, reopen the Bazaar in a minute.', 6000);
    return true;
  } catch (e) { return false; }
}
