/* 📦 STORAGE — the Warehouse office and the player-to-player capacity market.
   ---------------------------------------------------------------------------
   A Warehouse operation raises its owner's resource ceiling by
   storageBase + workers * storagePerWorker (600 + 260/worker in OPS_ECON) and
   had NO screen of its own: you founded it and a number silently changed.
   This is that screen, plus the market that lets an owner rent the spare out
   and a player who keeps hitting STASH FULL buy ceiling without founding a
   280,000 Cinder operation.

   🔴 THE GLOBALS TRAP. `Profile`, `Operations`, `Cloud` and friends are
   top-level `const` in index.html — LEXICAL bindings, not properties of
   `window`. An ES module cannot see them and `window.Profile` is undefined.
   Everything this file needs arrives through window.StorageBridge, which
   index.html hands over explicitly. Never reach for a bare global here.

   ⚠ GUARDED. sql/043 may not be applied. Every server call returns null rather
   than throwing, the office still shows real local capacity, and the market
   says so plainly instead of looking broken. CLAUDE.md: the app MUST work
   before the tables exist. */

const B = () => (typeof window !== 'undefined' && window.StorageBridge) || null;
const esc = (s) => { const b = B(); try { return b.escapeHtml(String(s == null ? '' : s)); } catch (e) { return ''; } };
const toast = (m, ms) => { try { B().showToast(m, ms || 3200); } catch (e) {} };
const num = (n) => { try { return (n | 0).toLocaleString(); } catch (e) { return String(n | 0); } };

/* ── capacity maths ──────────────────────────────────────────────────────────
   Kept here rather than in index.html so the office, the market and the
   ceiling all read ONE definition. index.html's _warehouseCapacity() calls
   ownUnits() for exactly that reason — two copies of this sum would drift the
   moment OPS_ECON is retuned. */
export function warehouses() {
  const b = B(); if (!b) return [];
  try {
    const seen = {}, out = [];
    for (const o of (b.operations() || [])) {
      if (!o || o.op_type !== 'warehouse' || seen[o.id]) continue;
      seen[o.id] = 1;
      out.push(o);
    }
    return out;
  } catch (e) { return []; }
}

export function unitsOf(op) {
  const b = B(); if (!b || !op) return 0;
  try {
    const e = b.opEcon('warehouse'); if (!e) return 0;
    return (e.storageBase | 0) + Math.max(0, op.workers | 0) * (e.storagePerWorker | 0);
  } catch (e) { return 0; }
}

export function ownUnits() {
  let n = 0; for (const o of warehouses()) n += unitsOf(o); return n;
}

/* Units this player has PROMISED to others. Subtracted from their own ceiling —
   renting out capacity you are still using would be selling the same shelf
   twice, which is the one thing that makes the market dishonest. */
let _state = { listings: [], asOwner: [], asRenter: [], loaded: false, available: null };
export function committedUnits() {
  try {
    let n = 0;
    for (const r of _state.asOwner) if (r && r.status === 'active') n += (r.units | 0);
    return n;
  } catch (e) { return 0; }
}
export function hiredUnits() {
  try {
    let n = 0;
    for (const r of _state.asRenter) if (r && r.status === 'active') n += (r.units | 0);
    return n;
  } catch (e) { return 0; }
}
/* What index.html adds to the resource ceiling: what you own, minus what you
   rented out, plus what you rented in. */
export function effectiveUnits() {
  return Math.max(0, ownUnits() - committedUnits() + hiredUnits());
}

/* ── server, all guarded ─────────────────────────────────────────────────── */
function sb() { try { return B().client(); } catch (e) { return null; } }

export async function refresh() {
  const c = sb(); const b = B();
  if (!c || !b) { _state.available = false; return null; }
  try {
    const uid = b.userId(); if (!uid) { _state.available = false; return null; }
    const [ls, mine] = await Promise.all([
      c.from('storage_listings').select('*').eq('active', true).order('price_per_day', { ascending: true }).limit(60),
      c.from('storage_rentals').select('*').eq('status', 'active').limit(200),
    ]);
    if (ls && ls.error) { _state.available = false; return null; }
    _state.available = true;
    _state.listings = (ls && ls.data) || [];
    const rows = (mine && !mine.error && mine.data) || [];
    _state.asOwner = rows.filter((r) => r && r.owner_id === uid);
    _state.asRenter = rows.filter((r) => r && r.renter_id === uid);
    _state.loaded = true;
    return _state;
  } catch (e) { _state.available = false; return null; }
}

export async function listForHire(opId, units, pricePerDay) {
  const c = sb(); const b = B();
  if (!c || !b) return { ok: false, reason: 'offline' };
  try {
    const uid = b.userId(); if (!uid) return { ok: false, reason: 'not_signed_in' };
    const row = {
      owner_id: uid, op_id: String(opId),
      owner_name: String(b.displayName() || 'A keeper').slice(0, 40),
      units_offered: Math.max(0, units | 0),
      price_per_day: Math.max(0, pricePerDay | 0),
      active: (units | 0) > 0,
      updated_at: new Date().toISOString(),
    };
    const r = await c.from('storage_listings').upsert(row, { onConflict: 'owner_id,op_id' }).select();
    if (r && r.error) return { ok: false, reason: 'server', detail: r.error.message };
    await refresh();
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'offline' }; }
}

export async function hire(listingId, units, days, paid) {
  const c = sb(); if (!c) return { ok: false, reason: 'offline' };
  try {
    const r = await c.rpc('storage_hire', {
      p_listing: listingId, p_units: units | 0, p_days: days | 0, p_paid: paid | 0,
    });
    if (r && r.error) return { ok: false, reason: 'server', detail: r.error.message };
    const d = r && r.data;
    if (d && d.ok) await refresh();
    return d || { ok: false, reason: 'server' };
  } catch (e) { return { ok: false, reason: 'offline' }; }
}

export async function cancel(rentalId) {
  const c = sb(); if (!c) return { ok: false, reason: 'offline' };
  try {
    const r = await c.rpc('storage_cancel', { p_rental: rentalId });
    if (r && r.error) return { ok: false, reason: 'server' };
    const d = r && r.data;
    if (d && d.ok) await refresh();
    return d || { ok: false, reason: 'server' };
  } catch (e) { return { ok: false, reason: 'offline' }; }
}

/* ── shell ───────────────────────────────────────────────────────────────── */
const SHELL = 'position:fixed;inset:0;z-index:2147483400;background:rgba(6,4,12,.82);'
  + 'backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:1.1rem';
const CARD = 'max-width:620px;width:100%;max-height:86vh;overflow:auto;'
  + 'background:linear-gradient(180deg,rgba(18,14,26,.99),rgba(11,9,16,.99));'
  + 'border:1px solid rgba(212,175,55,.5);border-radius:14px;padding:1.1rem 1.2rem;box-shadow:0 18px 60px rgba(0,0,0,.7)';
const H = 'font-family:Cinzel,serif;font-weight:800;font-size:1.05rem;color:#ffe6b0;letter-spacing:.05em';
const RULE = '<div style="height:1px;background:linear-gradient(90deg,rgba(212,175,55,.55),transparent);margin:.5rem 0 .8rem"></div>';
const BTN = 'cursor:pointer;padding:.5rem 1rem;border-radius:8px;font-family:inherit;font-weight:700;'
  + 'border:1px solid rgba(212,175,55,.5);background:rgba(212,175,55,.12);color:#ffcf5a';
const BTN2 = 'cursor:pointer;padding:.5rem 1rem;border-radius:8px;font-family:inherit;font-weight:700;'
  + 'border:1px solid rgba(150,150,170,.3);background:rgba(0,0,0,.25);color:#cfd8e6';

function shell(id, inner) {
  const old = document.getElementById(id); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = id; ov.style.cssText = SHELL;
  ov.innerHTML = '<div style="' + CARD + '">' + inner + '</div>';
  ov.addEventListener('click', (ev) => {
    if (ev.target === ov || (ev.target.dataset && ev.target.dataset.close === '1')) ov.remove();
  });
  document.body.appendChild(ov);
  return ov;
}

function notReady(what) {
  return '<div style="font-size:.82rem;color:#e0c070;border:1px solid rgba(212,175,55,.28);'
    + 'background:rgba(212,175,55,.07);border-radius:8px;padding:.6rem .7rem;margin-bottom:.8rem">'
    + '⚠ ' + esc(what) + ' needs the storage market tables (sql/043). Until they are applied '
    + 'your own capacity below is exact — only hiring is unavailable.</div>';
}

/* ── the Warehouse office (the left-nav target) ──────────────────────────── */
export async function openOffice() {
  const b = B(); if (!b) return;
  await refresh();
  const whs = warehouses();
  const own = ownUnits(), out = committedUnits(), inn = hiredUnits();
  const used = (() => { try { return b.resourceUnits() | 0; } catch (e) { return 0; } })();
  const ceil = (() => { try { return b.resourceCap() | 0; } catch (e) { return 0; } })();
  const pct = ceil > 0 ? Math.min(100, Math.round((used / ceil) * 100)) : 0;

  const rows = whs.length ? whs.map((o) => {
    const lst = _state.listings.find((l) => l && l.op_id === String(o.id) && l.owner_id === b.userId());
    return '<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .6rem;border-radius:8px;'
      + 'border:1px solid rgba(212,175,55,.18);background:rgba(0,0,0,.25);margin-bottom:6px">'
      + '<span style="flex:1;color:#ffe6b0;font-weight:700;font-size:.9rem">📦 Warehouse'
        + '<span style="color:#9aa0a6;font-weight:400;font-size:.76rem"> · ' + num(o.workers | 0) + ' staff</span></span>'
      + '<span style="font-size:.8rem;color:#8fe3a0">+' + num(unitsOf(o)) + '</span>'
      + '<button data-list="' + esc(o.id) + '" style="' + BTN2 + ';padding:.3rem .6rem;font-size:.72rem">'
        + (lst ? 'Offer: ' + num(lst.units_offered) + ' @ ' + num(lst.price_per_day) + '🔥/d' : 'Rent out') + '</button>'
      + '</div>';
  }).join('') : '<div style="font-size:.84rem;color:#9aa0a6;margin-bottom:.6rem">'
      + 'You do not own a Warehouse yet. Found one in Just Business → Operations to raise your ceiling.</div>';

  const rented = _state.asRenter.filter((r) => r.status === 'active');
  const rentedBlock = rented.length
    ? '<div style="' + H + ';font-size:.86rem;margin-top:.9rem">Hired from other keepers</div>' + RULE
      + rented.map((r) => '<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem .6rem;'
        + 'border-radius:8px;border:1px solid rgba(120,200,255,.2);background:rgba(0,0,0,.22);margin-bottom:5px">'
        + '<span style="flex:1;font-size:.82rem;color:#cfe6ff">+' + num(r.units) + ' units · ' + num(r.days) + 'd</span>'
        + '<button data-drop="' + esc(r.id) + '" style="' + BTN2 + ';padding:.28rem .55rem;font-size:.7rem">End</button>'
        + '</div>').join('')
    : '';

  const ov = shell('wh-office',
    '<div style="' + H + '">📦 Warehouse Office</div>' + RULE
    + (_state.available === false ? notReady('The capacity market') : '')
    + '<div style="display:flex;gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:120px;border:1px solid rgba(212,175,55,.22);border-radius:8px;padding:.5rem .6rem">'
        + '<div style="font-size:.68rem;color:#9aa0a6;letter-spacing:.08em">YOUR CEILING</div>'
        + '<div style="font-size:1.05rem;color:#ffcf5a;font-weight:800">' + num(ceil) + '</div></div>'
      + '<div style="flex:1;min-width:120px;border:1px solid rgba(212,175,55,.22);border-radius:8px;padding:.5rem .6rem">'
        + '<div style="font-size:.68rem;color:#9aa0a6;letter-spacing:.08em">STORED</div>'
        + '<div style="font-size:1.05rem;color:' + (pct >= 95 ? '#ff9a8a' : '#8fe3a0') + ';font-weight:800">'
        + num(used) + ' <span style="font-size:.72rem;color:#9aa0a6">(' + pct + '%)</span></div></div>'
    + '</div>'
    + '<div style="font-size:.76rem;color:#9aa0a6;margin-bottom:.7rem">'
      + 'From your warehouses <b style="color:#8fe3a0">+' + num(own) + '</b>'
      + (out ? ' · rented out <b style="color:#ff9a8a">−' + num(out) + '</b>' : '')
      + (inn ? ' · hired in <b style="color:#cfe6ff">+' + num(inn) + '</b>' : '')
    + '</div>'
    + '<div style="' + H + ';font-size:.86rem">Your warehouses</div>' + RULE + rows
    + rentedBlock
    + '<div style="display:flex;justify-content:space-between;gap:.5rem;margin-top:1rem">'
      + '<button id="wh-market" style="' + BTN + '">🏙 Hire storage from players</button>'
      + '<button data-close="1" style="' + BTN2 + '">Close</button>'
    + '</div>');

  ov.addEventListener('click', async (ev) => {
    const mk = ev.target.closest && ev.target.closest('#wh-market');
    if (mk) { ov.remove(); openMarket(); return; }
    const li = ev.target.closest && ev.target.closest('[data-list]');
    if (li) { ov.remove(); openRentOut(li.getAttribute('data-list')); return; }
    const dr = ev.target.closest && ev.target.closest('[data-drop]');
    if (dr) {
      const ok = await B().confirm('End this rental? You lose the hired ceiling immediately and the Cinder is not refunded.');
      if (!ok) return;
      const r = await cancel(dr.getAttribute('data-drop'));
      toast(r && r.ok ? '📦 Rental ended.' : '📦 Could not end that rental.');
      ov.remove(); openOffice();
    }
  });
}

/* ── rent your spare out ─────────────────────────────────────────────────── */
export function openRentOut(opId) {
  const op = warehouses().find((o) => String(o.id) === String(opId));
  if (!op) { toast('📦 That warehouse is no longer yours.'); return; }
  const cap = unitsOf(op);
  const cur = _state.listings.find((l) => l && l.op_id === String(opId));
  const ov = shell('wh-rentout',
    '<div style="' + H + '">📦 Rent out spare capacity</div>' + RULE
    + '<div style="font-size:.82rem;color:#cfd8e6;margin-bottom:.8rem">'
      + 'This warehouse holds <b style="color:#8fe3a0">' + num(cap) + '</b> units. Anything you offer is '
      + 'taken OFF your own ceiling while it is hired — you cannot rent out shelf space you are standing on.</div>'
    + '<label style="display:block;font-size:.74rem;color:#9aa0a6;letter-spacing:.06em;margin-bottom:.25rem">UNITS TO OFFER</label>'
    + '<input id="wh-units" type="number" min="0" max="' + cap + '" value="' + (cur ? (cur.units_offered | 0) : Math.floor(cap / 2)) + '" '
      + 'style="width:100%;padding:.5rem .6rem;border-radius:8px;border:1px solid rgba(212,175,55,.3);'
      + 'background:rgba(0,0,0,.35);color:#ffe6b0;font-family:inherit;margin-bottom:.7rem">'
    + '<label style="display:block;font-size:.74rem;color:#9aa0a6;letter-spacing:.06em;margin-bottom:.25rem">PRICE — CINDER PER DAY (whole listing)</label>'
    + '<input id="wh-price" type="number" min="0" value="' + (cur ? (cur.price_per_day | 0) : 250) + '" '
      + 'style="width:100%;padding:.5rem .6rem;border-radius:8px;border:1px solid rgba(212,175,55,.3);'
      + 'background:rgba(0,0,0,.35);color:#ffe6b0;font-family:inherit;margin-bottom:1rem">'
    + '<div style="display:flex;justify-content:flex-end;gap:.5rem">'
      + (cur ? '<button id="wh-pull" style="' + BTN2 + '">Withdraw offer</button>' : '')
      + '<button data-close="1" style="' + BTN2 + '">Cancel</button>'
      + '<button id="wh-save" style="' + BTN + '">Publish offer</button>'
    + '</div>');

  ov.addEventListener('click', async (ev) => {
    if (ev.target.id === 'wh-pull') {
      const r = await listForHire(opId, 0, 0);
      toast(r.ok ? '📦 Offer withdrawn.' : '📦 Could not withdraw — the market is offline.');
      ov.remove(); openOffice(); return;
    }
    if (ev.target.id === 'wh-save') {
      const u = Math.max(0, parseInt(document.getElementById('wh-units').value, 10) || 0);
      const p = Math.max(0, parseInt(document.getElementById('wh-price').value, 10) || 0);
      if (u > cap) { toast('📦 You cannot offer more than this warehouse holds (' + num(cap) + ').'); return; }
      const r = await listForHire(opId, u, p);
      toast(r.ok ? '📦 Offer published to the city.'
                 : (r.reason === 'offline' ? '📦 The market is offline — sql/043 is not applied yet.'
                                           : '📦 Could not publish that offer.'));
      ov.remove(); openOffice();
    }
  });
}

/* ── the city market: hire from other players ────────────────────────────── */
export async function openMarket() {
  const b = B(); if (!b) return;
  await refresh();
  const uid = b.userId();
  const mine = (l) => l && l.owner_id === uid;
  const open = _state.listings.filter((l) => l && !mine(l) && (l.units_offered | 0) > 0);

  const rows = open.length ? open.map((l) =>
    '<div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .65rem;border-radius:8px;'
      + 'border:1px solid rgba(212,175,55,.2);background:rgba(0,0,0,.25);margin-bottom:6px">'
    + '<div style="flex:1">'
      + '<div style="color:#ffe6b0;font-weight:700;font-size:.88rem">' + esc(l.owner_name || 'A keeper') + '</div>'
      + '<div style="font-size:.72rem;color:#9aa0a6">up to ' + num(l.units_offered) + ' units</div>'
    + '</div>'
    + '<div style="font-size:.8rem;color:#ffcf5a;white-space:nowrap">' + num(l.price_per_day) + ' 🔥/day</div>'
    + '<button data-hire="' + esc(l.id) + '" style="' + BTN + ';padding:.32rem .7rem;font-size:.75rem">Hire</button>'
    + '</div>').join('')
    : '<div style="font-size:.84rem;color:#9aa0a6">No keeper is offering space right now. '
      + 'If you own a Warehouse you could be the first — the Office has a “Rent out” button.</div>';

  const ov = shell('wh-market',
    '<div style="' + H + '">🏙 Storage for hire</div>' + RULE
    + (_state.available === false ? notReady('This market') : '')
    + '<div style="font-size:.8rem;color:#cfd8e6;margin-bottom:.8rem">'
      + 'Other players rent out spare warehouse space. Hired units raise your resource ceiling '
      + 'for as long as the agreement runs — the fastest answer to STASH FULL that does not cost '
      + 'you 280,000 🔥 for a warehouse of your own.</div>'
    + rows
    + '<div style="display:flex;justify-content:space-between;gap:.5rem;margin-top:1rem">'
      + '<button id="wh-back" style="' + BTN2 + '">← Office</button>'
      + '<button data-close="1" style="' + BTN2 + '">Close</button>'
    + '</div>');

  ov.addEventListener('click', (ev) => {
    if (ev.target.id === 'wh-back') { ov.remove(); openOffice(); return; }
    const h = ev.target.closest && ev.target.closest('[data-hire]');
    if (h) { const l = open.find((x) => String(x.id) === h.getAttribute('data-hire')); if (l) { ov.remove(); openHire(l); } }
  });
}

export function openHire(l) {
  const b = B();
  const maxU = l.units_offered | 0;
  const ov = shell('wh-hire',
    '<div style="' + H + '">📦 Hire from ' + esc(l.owner_name || 'a keeper') + '</div>' + RULE
    + '<label style="display:block;font-size:.74rem;color:#9aa0a6;margin-bottom:.25rem">UNITS (max ' + num(maxU) + ')</label>'
    + '<input id="hi-u" type="number" min="1" max="' + maxU + '" value="' + Math.min(maxU, 500) + '" '
      + 'style="width:100%;padding:.5rem .6rem;border-radius:8px;border:1px solid rgba(212,175,55,.3);'
      + 'background:rgba(0,0,0,.35);color:#ffe6b0;font-family:inherit;margin-bottom:.7rem">'
    + '<label style="display:block;font-size:.74rem;color:#9aa0a6;margin-bottom:.25rem">DAYS (1–90)</label>'
    + '<input id="hi-d" type="number" min="1" max="90" value="7" '
      + 'style="width:100%;padding:.5rem .6rem;border-radius:8px;border:1px solid rgba(212,175,55,.3);'
      + 'background:rgba(0,0,0,.35);color:#ffe6b0;font-family:inherit;margin-bottom:.6rem">'
    + '<div id="hi-cost" style="font-size:.84rem;color:#ffcf5a;margin-bottom:1rem"></div>'
    + '<div style="display:flex;justify-content:flex-end;gap:.5rem">'
      + '<button data-close="1" style="' + BTN2 + '">Cancel</button>'
      + '<button id="hi-go" style="' + BTN + '">Confirm hire</button>'
    + '</div>');

  const price = l.price_per_day | 0;
  const cost = () => Math.max(0, price * Math.max(1, parseInt(document.getElementById('hi-d').value, 10) || 1));
  const paint = () => {
    const c = cost(); let have = 0;
    try { have = b.gems() | 0; } catch (e) {}
    document.getElementById('hi-cost').innerHTML =
      'Total <b>' + num(c) + ' 🔥</b> · you hold ' + num(have) + ' 🔥'
      + (c > have ? ' <span style="color:#ff9a8a">— not enough</span>' : '');
  };
  paint();
  ov.addEventListener('input', paint);
  ov.addEventListener('click', async (ev) => {
    if (ev.target.id !== 'hi-go') return;
    const u = Math.max(1, parseInt(document.getElementById('hi-u').value, 10) || 1);
    const d = Math.max(1, Math.min(90, parseInt(document.getElementById('hi-d').value, 10) || 1));
    const c = Math.max(0, price * d);
    if (u > maxU) { toast('📦 That is more than this keeper is offering.'); return; }
    let have = 0; try { have = b.gems() | 0; } catch (e) {}
    if (c > have) { toast('📦 Not enough Cinder for that term.'); return; }

    /* ⚠ ORDER MATTERS. The server call goes FIRST and the Cinder is spent only
       once it returns ok. Spending first and then discovering the units were
       taken by someone else a moment ago would burn the player's Cinder for
       nothing — and since Cinder is client-side there is no server refund to
       fall back on. Reserve, then pay. */
    const r = await hire(l.id, u, d, c);
    if (!r || !r.ok) {
      const why = r && r.reason;
      toast(why === 'not_enough_units' ? '📦 Someone hired that space first — ' + num((r && r.available) | 0) + ' units left.'
          : why === 'own_listing' ? '📦 That is your own listing.'
          : why === 'withdrawn' ? '📦 That offer was just withdrawn.'
          : why === 'offline' ? '📦 The market is offline — sql/043 is not applied yet.'
          : '📦 Could not complete that hire.', 4200);
      return;
    }
    try { b.spendGems(c, 'storage hire'); } catch (e) {}
    toast('📦 Hired ' + num(u) + ' units for ' + d + ' day(s). Your ceiling is up.', 4200);
    ov.remove(); openOffice();
  });
}

/* ── registration ────────────────────────────────────────────────────────── */
const API = {
  openOffice, openMarket, openRentOut, refresh,
  ownUnits, hiredUnits, committedUnits, effectiveUnits, unitsOf, warehouses,
  listForHire, hire, cancel,
};
try {
  window.MythicStorage = API;
  // Probe surface, same convention as __mg.weaponSmith.
  window.__mg = window.__mg || {}; window.__mg.storage = API;
} catch (e) {}
export default API;
