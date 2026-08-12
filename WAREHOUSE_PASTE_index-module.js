// ═══════════════════════════════════════════════════════════════════════════
// 🚚 STORAGE WAREHOUSE — the paste-in module for public/index.html
//
// This file is NOT loaded by anything and is NOT deployed (it lives outside
// ./public on purpose). It exists so the handoff does not ask anyone to go
// fishing for 323 lines inside a 215,000-line file.
//
// WHERE IT GOES — public/index.html, immediately BEFORE this unique line:
//
//     // Run a real economy action posted by the app.
//
// which sits just after _dwellingClose() ends (~line 78143 on this branch).
// The warehouse module is the direct sibling of the Dwelling module.
//
// Paste everything BELOW this header. Verify after pasting with:
//     node _synckcheck.mjs     →  ALL CLEAN
//     node _harness.js         →  ALL CHECKS PASSED
//
// See WAREHOUSE_HANDOFF.md §3 for the other three insertions (the camp route
// option, the camp panel + binding, and the city pill / house panel).
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 🚚 STORAGE WAREHOUSE — player-owned warehouses, rented bays, node-level
// delivery (public/warehouse/, migration 20260812000000_warehouse_storage.sql).
//
// Other live players rent a numbered BAY in your warehouse and ship resources
// to it out of their city, house or camp. A step van pulls up on the apron and
// you walk the crates in first-person, under a real weight limit, into the
// renter's bay. Overlaid full-screen like the Dwelling, and bridged the same
// way — except the bridge here is ONE generic rpc envelope, because every price,
// weight, capacity and ETA lives in Postgres and the client only ever asks.
//
// ⚠ Everything that moves Cinder/Aza or capacity happens inside the wh_* rpcs,
//   in the same transaction as the grant. The whitelist below is the only
//   surface the iframe can reach.
// ═══════════════════════════════════════════════════════════════════════════
let _whFrame = null, _whMsgHandler = null;
const WH_RPC_ALLOW = {
  wh_config: 1, wh_my_warehouse: 1, wh_warehouse_json: 1, wh_directory: 1,
  wh_buy_unit: 1, wh_upgrade_tier: 1, wh_buy_lifter: 1, wh_rent_unit: 1,
  wh_my_rentals: 1, wh_send_shipment: 1, wh_store_crate: 1, wh_withdraw: 1,
  wh_cancel_shipment: 1,
};
// 📦 One shared truth about how long a delivery takes, said in the words the
// design promises. Hours come from the SERVER (wh_send_shipment computes them
// from the origin node's real level); this is only how we say it.
const WH_ETA_BLURB = 'Delivery takes <strong>up to 72 hours based on the node level</strong> '
  + 'of where you are sending from — the higher the node, the faster the run. '
  + '<strong>Free cities always take 72 hours.</strong>';
function _whReady() {
  try { return !!(typeof initCloud === 'function' && initCloud() && Cloud && Cloud.ready && Cloud.client && Profile.cloud && Profile.cloud.signedIn); }
  catch (e) { return false; }
}
// Every server call from this module — and from the iframe — funnels through
// here. Returns null when the SQL is not applied yet so callers can degrade.
async function _whRpc(fn, args) {
  if (!WH_RPC_ALLOW[fn]) return null;
  if (!_whReady()) return null;
  try {
    const res = await Cloud.client.rpc(fn, args || {});
    if (res.error) {
      // Migration not applied → say so ONCE rather than spamming the console.
      if (!App._whSqlWarned && /does not exist|schema cache/i.test(res.error.message || '')) {
        App._whSqlWarned = true;
        console.log('🚚 Warehouse SQL not applied yet — run supabase/migrations/20260812000000_warehouse_storage.sql');
      }
      return null;
    }
    return res.data;
  } catch (e) { return null; }
}
function _whMyName() {
  try { return (Profile.cloud && Profile.cloud.displayName) || Profile.name || 'A player'; } catch (e) { return 'A player'; }
}
function _whWallet() {
  return { cinder: (typeof getCinders === 'function' ? getCinders() : (Profile.gems | 0)), aza: (Profile.sovereigns | 0) };
}
// ── 📋 rentals cache — decides which label the camp/city/house button wears ──
// "Buy storage from player" when they rent nothing, "Send to your storage"
// when they do. Cached for a minute so a render never blocks on the network.
let _whRentals = null, _whRentalsAt = 0;
async function _whFetchRentals(force) {
  if (!force && _whRentals && Date.now() - _whRentalsAt < 60000) return _whRentals;
  const rows = await _whRpc('wh_my_rentals', {});
  if (rows) { _whRentals = Array.isArray(rows) ? rows : []; _whRentalsAt = Date.now(); }
  return _whRentals || [];
}
function _whIsRenting() { return !!(_whRentals && _whRentals.length); }
// The button every origin screen shows. `kind` is 'city' | 'house' | 'camp' —
// the three places the design says a player can send from.
function _whSendButtonHtml(kind, nodeId, label, style) {
  const renting = _whIsRenting();
  const txt = renting ? '📦 Send to your storage' : '🛒 Buy storage from player';
  return '<button class="wh-send-btn" data-wh-kind="' + escapeHtml(kind) + '"'
    + ' data-wh-node="' + escapeHtml(nodeId || '') + '"'
    + ' data-wh-label="' + escapeHtml(label || '') + '"'
    + ' style="' + (style || 'padding:0.5rem 1.1rem;background:rgba(255,209,102,0.18);color:#ffd166;border:1px solid rgba(255,209,102,0.55);border-radius:7px;cursor:pointer;font-family:\'Cinzel\',serif;font-size:0.82rem;letter-spacing:0.05em')
    + '">' + txt + '</button>';
}
// Wire every _whSendButtonHtml inside `root`. Safe to call on any container.
function _whBindSendButtons(root) {
  try {
    (root || document).querySelectorAll('.wh-send-btn').forEach(b => {
      if (b._whBound) return; b._whBound = true;
      b.onclick = () => {
        const kind = b.getAttribute('data-wh-kind') || 'camp';
        const node = b.getAttribute('data-wh-node') || null;
        const label = b.getAttribute('data-wh-label') || '';
        if (_whIsRenting()) _whOpenSendModal(kind, node, label);
        else _whOpenDirectory(kind, node, label);
      };
    });
  } catch (e) {}
}
// Refresh the rentals cache in the background, then repaint any buttons that
// are already on screen so the label flips without a re-render.
function _whRefreshButtons(root) {
  _whFetchRentals(true).then(() => {
    try {
      (root || document).querySelectorAll('.wh-send-btn').forEach(b => {
        b.textContent = _whIsRenting() ? '📦 Send to your storage' : '🛒 Buy storage from player';
      });
    } catch (e) {}
  });
}
function _whModal(id, title, sub, body, footHtml) {
  const old = document.getElementById(id); if (old) old.remove();
  const root = document.createElement('div');
  root.id = id;
  root.style.cssText = 'position:fixed;inset:0;z-index:9460;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center, rgba(8,4,20,0.65) 0%, rgba(2,1,8,0.92) 100%);backdrop-filter:blur(4px);animation:helpFadeIn 0.22s ease-out';
  root.innerHTML = `
    <div style="max-width:720px;width:94vw;max-height:86vh;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(28,22,52,0.96),rgba(12,8,28,0.98));border:1px solid rgba(212,175,55,0.5);border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,0.7);font-family:'Inter','Roboto',sans-serif">
      <div style="display:flex;justify-content:space-between;align-items:baseline;padding:1.1rem 1.4rem 0.5rem">
        <div>
          <h2 style="font-family:'Cinzel',serif;color:#ffd166;font-size:1.3rem;letter-spacing:0.06em;margin:0">${title}</h2>
          <div style="color:#bfae87;font-size:0.82rem;margin-top:0.25rem">${sub}</div>
        </div>
        <button class="wh-x" style="padding:0.4rem 0.85rem;background:rgba(255,255,255,0.06);color:#bfae87;border:1px solid rgba(212,175,55,0.3);border-radius:7px;cursor:pointer;font-family:'Cinzel',serif;font-size:0.78rem;letter-spacing:0.04em">✕ CLOSE</button>
      </div>
      <div class="wh-body" style="flex:1;overflow-y:auto;padding:0.4rem 1.4rem 1rem;color:#e2eaff;font-size:0.86rem;line-height:1.6">${body}</div>
      <div class="wh-foot" style="display:flex;gap:0.5rem;justify-content:flex-end;padding:0.8rem 1.4rem;border-top:1px solid rgba(212,175,55,0.2)">${footHtml || ''}</div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('.wh-x').onclick = () => root.remove();
  root.onclick = (ev) => { if (ev.target === root) root.remove(); };
  return root;
}
// ── 🛒 "Buy storage from player" — the rental market ────────────────────────
async function _whOpenDirectory(kind, nodeId, label) {
  const rows = await _whRpc('wh_directory', {});
  if (!rows) { showToast('🚚 The storage network is offline — try again once you are signed in.', 3600); return; }
  const cfgRow = await _whRpc('wh_config', {});
  const perDay = (cfgRow && cfgRow.rent_cinder_per_day) || 1200;
  const open = (rows || []).filter(r => (r.free_units | 0) > 0);
  const body = open.length
    ? `<div style="background:rgba(255,209,102,0.09);border:1px solid rgba(255,209,102,0.3);border-radius:9px;padding:0.65rem 0.8rem;color:#ffd166;margin-bottom:0.8rem">${WH_ETA_BLURB}</div>`
      + open.map(r => `
        <div style="display:flex;align-items:center;gap:0.9rem;padding:0.75rem 0.9rem;margin-bottom:0.55rem;background:rgba(0,0,0,0.35);border:1px solid rgba(212,175,55,0.28);border-radius:10px">
          <div style="flex:1">
            <div style="color:#e2eaff;font-weight:600">🏗 ${escapeHtml(r.owner_name || 'A player')}'s warehouse</div>
            <div style="color:#bfae87;font-size:0.78rem">Tier ${r.tier} · <strong style="color:#7ce8a8">${r.free_units}</strong> free ${r.free_units === 1 ? 'bay' : 'bays'} · ${r.my_units | 0} already yours</div>
          </div>
          <button class="wh-rent" data-id="${escapeHtml(r.id)}" style="padding:0.45rem 0.9rem;background:rgba(255,209,102,0.18);color:#ffd166;border:1px solid rgba(255,209,102,0.55);border-radius:7px;cursor:pointer;font-family:'Cinzel',serif;font-size:0.8rem">🔥 ${(perDay * 7).toLocaleString()} / 7 days</button>
        </div>`).join('')
    : '<p style="color:#bfae87">No player has a free storage bay right now. Warehouses open new bays as their owners upgrade — check back, or build your own from the Camp.</p>';
  const root = _whModal('wh-directory', '🛒 Buy storage from a player',
    'Rent a numbered bay in another player\'s warehouse, then ship to it.', body,
    '<button class="wh-mine" style="padding:0.5rem 1.1rem;background:rgba(196,168,255,0.22);color:#c4a8ff;border:1px solid rgba(196,168,255,0.55);border-radius:7px;cursor:pointer;font-family:\'Cinzel\',serif;font-size:0.82rem">🏗 My own warehouse →</button>');
  root.querySelector('.wh-mine').onclick = () => { root.remove(); _whOpen(); };
  root.querySelectorAll('.wh-rent').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Renting…';
    const r = await _whRpc('wh_rent_unit', { p_warehouse_id: b.dataset.id, p_days: 7, p_name: _whMyName() });
    if (!r || r.ok === false) {
      b.disabled = false;
      showToast('❌ ' + _whReason(r), 4000);
      return;
    }
    try { if (typeof walletFetchProgress === 'function') walletFetchProgress(); } catch (e) {}
    if (r.wallet) { _gemsTaxExempt(() => { Profile.gems = r.wallet.cinder | 0; }); Profile.sovereigns = r.wallet.aza | 0; try { saveProfile(); } catch (e) {} }
    root.remove();
    await _whFetchRentals(true);
    showToast('🔑 Rented Bay ' + r.bay_no + ' for ' + r.days + ' days. ' + WH_ETA_BLURB.replace(/<[^>]+>/g, ''), 6000);
    _whOpenSendModal(kind, nodeId, label);
    try { if (typeof render === 'function') render(); } catch (e) {}
  });
}
function _whReason(r) {
  const m = {
    insufficient: 'Not enough ' + ((r && r.currency === 'aza') ? 'Aza' : 'Cinder') + '.',
    no_free_unit: 'That warehouse has no free bay left.',
    own_warehouse: 'That is your own warehouse — you cannot rent from yourself.',
    closed: 'That warehouse is not taking renters.',
    not_your_unit: 'That bay is not yours.',
    empty_payload: 'Pick at least one resource to send.',
    bad_origin: 'That is not a valid place to send from.',
    tier_cap: 'That warehouse cannot hold any more bays.',
    not_signed_in: 'Sign in to use player storage.',
  };
  return (r && m[r.reason]) || (r && r.reason) || 'The storage network did not answer.';
}
// ── 📦 "Send to my storage unit" — pick a bay, pick resources, ship it ──────
async function _whOpenSendModal(kind, nodeId, label) {
  const rentals = await _whFetchRentals(true);
  if (!rentals.length) { _whOpenDirectory(kind, nodeId, label); return; }
  const S = (typeof _ensureResources === 'function') ? _ensureResources() : (Profile.salvage || {});
  const have = (typeof RESOURCES !== 'undefined' ? RESOURCES : []).filter(r => (S[r.id] | 0) > 0);
  const kindLabel = { city: 'city', house: 'home', camp: 'camp' }[kind] || 'camp';
  const bayOpts = rentals.map(r => `<option value="${escapeHtml(r.unit_id)}">Bay ${r.bay_no} — ${escapeHtml(r.owner_name || 'a player')}'s warehouse (${Math.round(r.used_kg)}/${r.capacity_kg} kg)</option>`).join('');
  const body = `
    <div style="background:rgba(255,209,102,0.09);border:1px solid rgba(255,209,102,0.3);border-radius:9px;padding:0.65rem 0.8rem;color:#ffd166;margin-bottom:0.9rem">${WH_ETA_BLURB}</div>
    <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.9rem">
      <span style="color:#bfae87;font-size:0.8rem">Deliver to</span>
      <select id="wh-bay" style="flex:1;padding:0.45rem 0.6rem;background:rgba(0,0,0,0.45);color:#e2eaff;border:1px solid rgba(212,175,55,0.35);border-radius:7px;font-family:inherit">${bayOpts}</select>
    </div>
    ${have.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.5rem">
      ${have.map(r => `
        <div style="display:flex;align-items:center;gap:0.55rem;padding:0.5rem 0.65rem;background:rgba(0,0,0,0.35);border:1px solid rgba(212,175,55,0.22);border-radius:9px">
          <span style="font-size:1.15rem">${r.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="color:#e2eaff;font-size:0.82rem">${escapeHtml(r.name)}</div>
            <div style="color:#bfae87;font-size:0.72rem;font-family:'Roboto Mono',monospace">have ${(S[r.id] | 0).toLocaleString()}</div>
          </div>
          <input class="wh-qty" data-res="${escapeHtml(r.id)}" type="number" min="0" max="${S[r.id] | 0}" value="0"
            style="width:74px;padding:0.32rem 0.4rem;background:rgba(0,0,0,0.5);color:#ffd166;border:1px solid rgba(212,175,55,0.35);border-radius:6px;font-family:'Roboto Mono',monospace;text-align:right">
        </div>`).join('')}
      </div>`
    : '<p style="color:#bfae87">You have nothing in your salvage ledger to send yet.</p>'}`;
  const root = _whModal('wh-send', '🚚 Send to my storage unit',
    'Shipping from your ' + kindLabel + (label ? ' — ' + escapeHtml(label) : ''), body,
    '<button class="wh-go" style="padding:0.5rem 1.2rem;background:rgba(255,209,102,0.2);color:#ffd166;border:1px solid rgba(255,209,102,0.6);border-radius:7px;cursor:pointer;font-family:\'Cinzel\',serif;font-size:0.86rem;letter-spacing:0.05em">🚚 Send to my storage unit</button>');
  root.querySelector('.wh-go').onclick = async () => {
    const payload = {};
    root.querySelectorAll('.wh-qty').forEach(i => {
      const n = Math.max(0, Math.floor(+i.value || 0));
      if (n > 0) payload[i.dataset.res] = Math.min(n, S[i.dataset.res] | 0);
    });
    if (!Object.keys(payload).length) { showToast('Pick at least one resource to send.', 2600); return; }
    const btn = root.querySelector('.wh-go'); btn.disabled = true; btn.textContent = 'Dispatching…';
    const r = await _whRpc('wh_send_shipment', {
      p_unit_id: (root.querySelector('#wh-bay') || {}).value,
      p_origin_kind: kind, p_node_id: nodeId || null,
      p_origin_label: label || null, p_payload: payload, p_name: _whMyName(),
    });
    if (!r || r.ok === false) { btn.disabled = false; btn.textContent = '🚚 Send to my storage unit'; showToast('❌ ' + _whReason(r), 4200); return; }
    // ESCROW: the goods leave the local salvage ledger the moment the server
    // accepts the shipment, so they exist in exactly one place at a time.
    try {
      const L = (typeof _ensureResources === 'function') ? _ensureResources() : Profile.salvage;
      Object.keys(r.payload || payload).forEach(id => { L[id] = Math.max(0, (L[id] | 0) - ((r.payload || payload)[id] | 0)); });
      if (typeof saveProfile === 'function') saveProfile();
    } catch (e) {}
    root.remove();
    _whDeliveryNotice(r);
    try { if (typeof render === 'function') render(); } catch (e) {}
  };
}
// The message the design asks for, with the SERVER's real numbers in it.
function _whDeliveryNotice(r) {
  const eta = new Date(r.eta_at);
  const body = `
    <div style="background:rgba(255,209,102,0.09);border:1px solid rgba(255,209,102,0.3);border-radius:9px;padding:0.7rem 0.85rem;color:#ffd166;margin-bottom:0.9rem">${WH_ETA_BLURB}</div>
    <p style="margin-bottom:0.7rem">Your load is on the road to <strong style="color:#ffd166">Bay ${r.bay_no}</strong>
      in ${escapeHtml(r.owner_name || 'the')} warehouse — <strong>${(+r.weight_kg).toLocaleString()} kg</strong>
      across <strong>${r.crates_total}</strong> ${r.crates_total === 1 ? 'crate' : 'crates'}.</p>
    <div style="display:flex;gap:0.9rem;flex-wrap:wrap;font-family:'Roboto Mono',monospace;font-size:0.82rem">
      <span style="color:#bfae87">Origin</span>
      <strong style="color:${r.free_city ? '#ff8a8a' : '#7ce8a8'}">${r.free_city ? 'FREE CITY' : 'NODE LV ' + r.node_level}</strong>
      <span style="color:#bfae87">Transit</span><strong style="color:#ffd166">${r.eta_hours} hours</strong>
      <span style="color:#bfae87">Arrives</span><strong style="color:#ffd166">${eta.toLocaleString()}</strong>
    </div>
    <p style="margin-top:0.9rem;color:#bfae87">${r.free_city
      ? 'This came out of a free city, so it takes the full 72 hours no matter what. Ship from a claimed, upgraded District Node to cut the run down — a LV 10 node lands in 6 hours.'
      : 'A higher node level would land it sooner still — LV 10 runs take 6 hours.'}</p>`;
  _whModal('wh-sent', '🚚 On the road', 'The truck will pull up at the warehouse when it lands', body,
    '<button class="wh-x2" style="padding:0.5rem 1.1rem;background:rgba(255,209,102,0.2);color:#ffd166;border:1px solid rgba(255,209,102,0.6);border-radius:7px;cursor:pointer;font-family:\'Cinzel\',serif;font-size:0.84rem">Got it</button>')
    .querySelector('.wh-x2').onclick = () => { const m = document.getElementById('wh-sent'); if (m) m.remove(); };
}
// ── 🏗 the warehouse itself — first-person, overlaid like the Dwelling ──────
async function _whOpen() {
  if (document.getElementById('wh-overlay')) return;
  const state = await _whRpc('wh_my_warehouse', { p_name: _whMyName(), p_node_id: (Profile.campNodeId || null) });
  if (!state) {
    showToast('🚚 Player storage is not switched on yet — apply supabase/migrations/20260812000000_warehouse_storage.sql.', 5200);
    return;
  }
  const ov = document.createElement('div');
  ov.id = 'wh-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483400;background:#0b0910';
  const fr = document.createElement('iframe');
  fr.id = 'wh-frame';
  fr.src = 'warehouse/index.html?v=1';
  fr.setAttribute('title', 'Storage Warehouse');
  fr.style.cssText = 'width:100%;height:100%;border:0;background:#0b0910';
  ov.appendChild(fr);
  document.body.appendChild(ov);
  _whFrame = fr;
  // 🎯 Hand the iframe keyboard focus so WASD works without a stray click on
  // the host first — the same trap the Dwelling hit.
  try {
    fr.addEventListener('load', () => { try { fr.contentWindow.focus(); } catch (e) {} });
    setTimeout(() => { try { fr.contentWindow.focus(); } catch (e) {} }, 140);
  } catch (e) {}
  const push = () => {
    try {
      const cw = _whFrame && _whFrame.contentWindow; if (!cw) return;
      const w = _whWallet();
      cw.postMessage({ type: 'wh:state', state: state, wallet: w,
        me: { id: (Profile.cloud && Profile.cloud.userId) || null, name: _whMyName() } }, '*');
    } catch (e) {}
  };
  _whMsgHandler = async (e) => {
    try {
      const d = e && e.data; if (!d || typeof d !== 'object') return;
      const cw = _whFrame && _whFrame.contentWindow; if (!cw) return;
      if (d.type === 'wh:ready') { push(); return; }
      if (d.type === 'wh:exit') { _whClose(); return; }
      if (d.type === 'wh:rpc') {
        // Whitelist first — the iframe never gets to name an arbitrary rpc.
        if (!WH_RPC_ALLOW[d.fn]) { cw.postMessage({ type: 'wh:rpcResult', reqId: d.reqId, ok: false, error: 'blocked' }, '*'); return; }
        const data = await _whRpc(d.fn, d.args || {});
        // Any rpc that spends returns the fresh balances — mirror them into the
        // local wallet so the rest of the game agrees with the server.
        try {
          const wal = data && (data.wallet || (data.warehouse && data.wallet));
          if (wal) { _gemsTaxExempt(() => { Profile.gems = wal.cinder | 0; }); Profile.sovereigns = wal.aza | 0; saveProfile(); }
        } catch (er) {}
        cw.postMessage({ type: 'wh:rpcResult', reqId: d.reqId, ok: !!data, data: data, error: data ? null : 'rpc_failed' }, '*');
      }
    } catch (er) {}
  };
  window.addEventListener('message', _whMsgHandler);
  fr.onload = push;
}
function _whClose() {
  try { if (_whMsgHandler) { window.removeEventListener('message', _whMsgHandler); _whMsgHandler = null; } } catch (e) {}
  const ov = document.getElementById('wh-overlay'); if (ov) ov.remove();
  _whFrame = null;
  try { if (typeof render === 'function') render(); } catch (e) {}
}
try {
  window.__mg = window.__mg || {};
  window.__mg.warehouse = { open: _whOpen, send: _whOpenSendModal, market: _whOpenDirectory,
                            rentals: _whFetchRentals, renting: _whIsRenting };
} catch (e) {}
