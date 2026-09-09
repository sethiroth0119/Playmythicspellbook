/* ════════════════════════════════════════════════════════════════════════════
   🐄 HOMESTEAD FARM — module entry point. Registers window.MythicFarm.
   ----------------------------------------------------------------------------
   A 3D animal-farm simulation: build pens and stations with Cinder +
   resources, buy stock, keep the troughs full, collect eggs / milk / wool /
   feathers / manure from living animals, slaughter grown stock for meat and
   hide, refine at the Tannery / Spinning Shed / Kitchen — and now keep it
   alive: every animal has health, weight, age and a name; guards defend
   against raids and predators; seasons, weather, the town's demand, crates
   for the Exchange, hired Farmers, and the Athena Editor for the look.
   NEW feature, so it lives OUTSIDE index.html (CLAUDE.md).

   🔴 THE GLOBALS TRAP. `Profile`, `getRes`, `addRes`, `spendGems`, `RESOURCES`
   are top-level `const` / function declarations in index.html — global
   LEXICAL bindings, NOT properties of `window`. This module reads NOTHING by
   itself: index.html hands over window.MythicFarmBridge, and without it the
   module registers, stays inert and warns once. window.MythicTerroir is the
   one exception, and only because terroir.js is itself a module that
   publishes on window (module → window is the direction that works).

   ⚠ Everything is wrapped so a failure inside the farm can never take the
   game down. The farm is a feature; the game is the product.
   ════════════════════════════════════════════════════════════════════════════ */

import { FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, FARM_LOOKS, animalDef, buildingDef, buildingCostAt, auditCatalog } from './farm.data.js';
import * as S from './farm.state.js';
import { createScene } from './farm.scene.js';
import { FARM_CSS, renderShell, renderLedger, renderHomestead, renderLivestock, renderJournal, renderAthena, renderMarket, renderRanch } from './farm.render.js';
import { lots as cloudLots, ranch as cloudRanch } from './farm.cloud.js';

function makeHost() {
  const B = (typeof window !== 'undefined') ? window.MythicFarmBridge : null;
  if (!B) return null;
  const FALLBACK = { name: 'Unknown', icon: '📦', color: '#cfd6e4', known: false };
  const metaOf = (id) => {
    try {
      const r = (B.resources || []).find(x => x && x.id === id);
      return r ? { name: r.name, icon: r.icon, color: r.color, known: true } : Object.assign({}, FALLBACK, { name: id });
    } catch (e) { return Object.assign({}, FALLBACK, { name: id }); }
  };
  return {
    gems: () => { try { return B.gems() | 0; } catch (e) { return 0; } },
    getRes: (id) => { try { return B.getRes(id) | 0; } catch (e) { return 0; } },
    resMeta: metaOf,
    resourceIds: () => { try { return (B.resources || []).map(r => r && r.id).filter(Boolean); } catch (e) { return []; } },
    spendGems: (n) => { try { return !!B.spendGems(n); } catch (e) { return false; } },
    addGems: (n) => { try { B.addGems(n); } catch (e) {} },
    spendRes: (id, n) => { try { return !!B.spendRes(id, n); } catch (e) { return false; } },
    addRes: (id, n) => { try { B.addRes(id, n); } catch (e) {} },
    refundRes: (id, n) => { try { (B.refundRes || B.addRes)(id, n); } catch (e) {} },
    state: () => { try { return B.farmState(); } catch (e) { return {}; } },
    setState: (s) => { try { return B.setFarmState(s) !== false; } catch (e) { return false; } },
    save: () => { try { return B.save() !== false; } catch (e) { return false; } },
    toast: (m, ms) => { try { B.toast(m, ms); } catch (e) {} },
    confirm: (m) => { try { return Promise.resolve(B.confirm(m)); } catch (e) { return Promise.resolve(false); } },
    back: () => { try { B.back(); } catch (e) {} },
    // 👷 Reconstruction workforce, 🏴 rival camps, 🗺 terroir — all absent-tolerant.
    farmers: () => { try { return B.farmers ? (B.farmers() | 0) : 0; } catch (e) { return 0; } },
    builders: () => { try { return B.builders ? (B.builders() | 0) : 0; } catch (e) { return 0; } },
    bestRig: () => { try { return B.bestRig ? (B.bestRig() || null) : null; } catch (e) { return null; } },
    rivals: () => { try { return B.rivals ? (B.rivals() || []) : []; } catch (e) { return []; } },
    terroirTier: (resId) => {
      try {
        const T = window.MythicTerroir; if (!T || typeof T.terroir !== 'function') return null;
        const t = T.terroir(); return (t && t.tiers && t.tiers[resId]) || null;
      } catch (e) { return null; }
    },
    collectCdMs: (B.collectCdMs | 0) || 6 * 3600000,
    accrualCapH: (B.accrualCapH | 0) || 36,
    isAdmin: () => { try { return !!(B.isAdmin && B.isAdmin()); } catch (e) { return false; } },
    // 🌐 The cloud seam (player lots, corp ranch). Absent on an older bridge → the tabs say so.
    cloud: (B.cloud && typeof B.cloud.rpc === 'function') ? {
      ready: () => { try { return !!B.cloud.ready(); } catch (e) { return false; } },
      userId: () => { try { return B.cloud.userId(); } catch (e) { return null; } },
      userName: () => { try { return B.cloud.userName() || 'Farmer'; } catch (e) { return 'Farmer'; } },
      corp: () => { try { return B.cloud.corp(); } catch (e) { return null; } },
      rpc: (n, a) => B.cloud.rpc(n, a),
      select: (tb, o) => B.cloud.select(tb, o),
    } : null,
  };
}

let _warned = false;
function host() {
  const h = makeHost();
  if (!h && !_warned) {
    _warned = true;
    try { console.warn('[farm] window.MythicFarmBridge is absent — the farm is inert. index.html must hand the module its capabilities (the globals trap).'); } catch (e) {}
  }
  return h;
}

const fmtGot = (h, got) => Object.keys(got || {}).map(k => { const m = h.resMeta(k); return `${m.icon} ${got[k]} ${m.name}`; }).join(', ');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── Mount ─────────────────────────────────────────────────────────────────── */
let _mounted = null;

function ensureCss() {
  if (document.getElementById('farm-css')) return;
  const st = document.createElement('style'); st.id = 'farm-css'; st.textContent = FARM_CSS; document.head.appendChild(st);
}

function mount(rootEl) {
  const h = host();
  if (!h || !rootEl) return false;
  unmount();
  ensureCss();
  const missing = auditCatalog(h.resourceIds());
  if (missing.length) { try { console.warn('[farm] ledger is missing ids the farm pays out: ' + missing.join(', ')); } catch (e) {} }

  rootEl.innerHTML = renderShell();
  const m = _mounted = { root: rootEl, scene: null, tab: 'homestead', focus: null, tick: 0, busy: false, ui: { cut: 'balanced', carrier: FARM_ECON.transport.defaultCarrier, escort: 0, renaming: null }, bannerShown: false, cloud: { loading: false, lots: [], mine: [], why: null, userId: null, at: 0 }, ranch: null };
  const stage = rootEl.querySelector('[data-farm="stage"]');

  const paint = () => {
    if (_mounted !== m) return;
    try {
      const s = S.ensureState(h);
      const view = S.summary(h, s);
      const led = rootEl.querySelector('[data-farm="ledger"]'); if (led) led.innerHTML = renderLedger(h, view);
      const title = rootEl.querySelector('[data-farm="title"]'); if (title) title.textContent = '🐄 ' + (view.look.name || 'Homestead Farm');
      const panel = rootEl.querySelector('[data-farm="panel"]');
      if (panel) {
        panel.innerHTML = m.tab === 'livestock' ? renderLivestock(h, s, view, m.focus, m.ui)
          : m.tab === 'journal' ? renderJournal(h, s, view)
          : m.tab === 'athena' ? renderAthena(h, s, view)
          : m.tab === 'market' ? renderMarket(h, s, view, m.ui, m.cloud)
          : m.tab === 'ranch' ? renderRanch(h, view, m.ranch)
          : renderHomestead(h, s, view, m.focus, m.ui);
        if (m.ui.renaming) {
          const row = panel.querySelector(`.farm-beast[data-aid="${m.ui.renaming}"] .nm`);
          const a = S.animalById(s, m.ui.renaming);
          if (row && a) row.innerHTML = `<input class="farm-input" data-frename="${a.id}" maxlength="24" value="${esc(a.name)}" style="width:130px"><button class="farm-btn tiny primary" data-fact="rename-save" data-id="${a.id}">Save</button><button class="farm-btn tiny" data-fact="rename-cancel">✕</button>`;
          const inp = row && row.querySelector('input'); if (inp) { setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) {} }, 0); }
        }
      }
      rootEl.querySelectorAll('.farm-tab').forEach(t => t.classList.toggle('is-active', t.getAttribute('data-id') === m.tab));
      if (m.scene) m.scene.update(view);
      if (!m.bannerShown && view.recentEvents.length && stage) {
        m.bannerShown = true;
        const ev = view.recentEvents[0];
        const b = document.createElement('div'); b.className = 'farm-banner'; b.textContent = `${ev.icon} While you were away: ${ev.text}`; stage.appendChild(b);
        setTimeout(() => { try { b.remove(); } catch (e) {} }, 12000);
      }
      if (m.focus) { const el = panel && panel.querySelector(`[data-fid="${m.focus}"]`); if (el && m.scrollTo) { try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} m.scrollTo = false; } }
    } catch (e) { try { console.warn('[farm] paint failed:', e); } catch (x) {} }
  };
  m.paint = paint;
  const loadLots = async () => {
    if (_mounted !== m) return;
    m.cloud.loading = true; paint();
    try {
      m.cloud.userId = h.cloud ? h.cloud.userId() : null;
      const open = await cloudLots.listOpen(h); const mine = await cloudLots.mine(h);
      m.cloud.lots = open.rows || []; m.cloud.mine = mine.rows || []; m.cloud.why = open.ok ? null : open.why; m.cloud.at = Date.now();
    } catch (e) { m.cloud.why = 'could not reach the ring'; }
    m.cloud.loading = false; if (_mounted === m) paint();
  };
  const loadRanch = async () => {
    if (_mounted !== m) return;
    m.ranch = null; paint();
    try { m.ranch = await cloudRanch.get(h); } catch (e) { m.ranch = { ok: false, why: 'could not reach the ranch' }; }
    if (_mounted === m) paint();
  };

  // 👷 Farmers tend the troughs as you walk in.
  try { const s = S.ensureState(h); const r = S.tend(h, s); if (r.ok && r.moved) h.toast(`👷 Your Farmers topped up the troughs with ${r.moved} feed.`, 3000); } catch (e) {}

  createScene(stage, {
    onSelect: (kind, id) => {
      if (_mounted !== m) return;
      m.focus = id; m.scrollTo = true;
      m.tab = (kind === 'animal') ? 'livestock' : 'homestead';
      paint();
    },
  }).then(scene => {
    if (_mounted !== m) { try { scene.destroy(); } catch (e) {} return; }
    m.scene = scene;
    if (scene.mode === '2d') { const hint = rootEl.querySelector('.farm-hint'); if (hint) hint.textContent = '2D view (3D engine unavailable) · tap a building or animal'; }
    paint();
  }).catch(() => {});

  /* ⏱ Periodic refresh (feed drains, cooldowns tick). Skipped while the player
     is typing — the e2e caught a half-typed homestead name being wiped by a
     repaint that landed between keystrokes. */
  m.tick = setInterval(() => {
    if (!rootEl.isConnected || _mounted !== m) { unmount(m); return; }
    const ae = document.activeElement;
    if (m.ui.renaming || (ae && rootEl.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName))) return;
    paint();
  }, 20000);

  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('keydown', onKey);
  m.onClick = onClick; m.onChange = onChange; m.onKey = onKey;
  paint();
  return true;

  function onChange(e) {
    const t = e.target;
    if (!t || _mounted !== m) return;
    if (t.getAttribute('data-fsel') === 'cut') { m.ui.cut = t.value; paint(); return; }
    if (t.getAttribute('data-fsel') === 'carrier') { m.ui.carrier = t.value; paint(); return; }
    if (t.getAttribute('data-fsel') === 'escort') { m.ui.escort = t.value | 0; paint(); return; }
    const roof = t.getAttribute('data-froof');
    if (roof) { const s = S.ensureState(h); const r = S.setLook(h, s, { roofs: { [roof]: t.value } }); if (!r.ok) h.toast('Could not save the roof colour.', 2500); paint(); }
  }
  function onKey(e) {
    if (_mounted !== m) return;
    const t = e.target;
    if (e.key === 'Enter' && t && t.getAttribute('data-frename')) { e.preventDefault(); doRename(t.getAttribute('data-frename'), t.value); }
    if (e.key === 'Enter' && t && t.getAttribute('data-fname')) { e.preventDefault(); doName(t.value); }
    if (e.key === 'Escape' && m.ui.renaming) { m.ui.renaming = null; paint(); }
  }
  function doRename(id, value) {
    const s = S.ensureState(h); const r = S.rename(h, s, id | 0, value);
    m.ui.renaming = null;
    h.toast(r.ok ? `🏷 Renamed to ${r.name}.` : `Rename: ${r.why}`, 2500); paint();
  }
  function doName(value) {
    const s = S.ensureState(h); const r = S.setLook(h, s, { name: String(value || '').replace(/[<>]/g, '').trim() });
    h.toast(r.ok ? '🏷 Homestead renamed.' : 'Could not save the name.', 2500); paint();
  }

  async function onClick(e) {
    const t = e.target.closest && e.target.closest('[data-fact]');
    if (!t || _mounted !== m || m.busy) return;
    const act = t.getAttribute('data-fact'), id = t.getAttribute('data-id'), n = parseInt(t.getAttribute('data-n') || '1', 10) || 1;
    e.preventDefault();
    m.busy = true;
    try {
      const s = S.ensureState(h);
      let r;
      switch (act) {
        case 'back': h.back(); return;
        case 'tab': m.tab = id; m.focus = null; m.ui.renaming = null; if (id === 'market' && Date.now() - m.cloud.at > 15000) loadLots(); if (id === 'ranch') loadRanch(); break;
        case 'build': {
          const def = buildingDef(id); if (!def) break;
          r = S.build(h, s, id);
          if (r.ok) { h.toast(`🏗 Broke ground on the ${def.name} — ready in ${Math.max(1, Math.round((r.readyAt - Date.now()) / 60000))} min. Rush it with Cinder or hire Builders.`, 4000); m.focus = id; if (m.scene && m.scene.select) m.scene.select({ kind: 'building', id }); }
          else h.toast(`Cannot build: ${why(h, r)}`, 3600);
          break;
        }
        case 'upgrade': { const def = buildingDef(id); if (!def) break; r = S.upgrade(h, s, id); h.toast(r.ok ? (r.pendingLevel ? `🏗 Crews are raising ${def.name} to level ${r.pendingLevel}. It keeps working meanwhile.` : `⬆ ${def.name} is now level ${r.level}.`) : `Cannot upgrade: ${why(h, r)}`, 3400); break; }
        case 'rush': { const def = buildingDef(id); if (!def) break; r = S.rush(h, s, id); h.toast(r.ok ? `⚡ ${def.name} finished for 🔥${(r.cost | 0).toLocaleString()}.` : `Rush: ${why(h, r)}`, 3200); break; }
        case 'repair': { const def = buildingDef(id); if (!def) break; r = S.repair(h, s, id); h.toast(r.ok ? `🔨 ${def.name} repaired.` : `Repair: ${why(h, r)}`, 3200); break; }
        case 'buy': {
          const a = animalDef(id); if (!a) break;
          r = S.buyAnimal(h, s, id, n, m.ui.carrier, m.ui.escort);
          if (r.ok) m.ui.escort = 0;
          h.toast(r.ok ? `🚚 ${r.shipped} ${r.shipped === 1 ? a.name.toLowerCase() : a.plural.toLowerCase()} ordered. ${r.carrier} is on the road — ETA ${Math.max(1, Math.round((r.arriveAt - Date.now()) / 60000))} min${r.fee ? ', haulage 🔥' + r.fee.toLocaleString() : ''}.` : `Cannot order: ${why(h, r)}`, 4200);
          break;
        }
        case 'feed': { r = S.fillTrough(h, s, id, 1e9); h.toast(r.ok ? `🌾 Added ${r.added} Animal Feed to the trough.` : `Trough: ${why(h, r)}`, 3000); break; }
        case 'collect': {
          r = S.collect(h, s, id);
          if (r.ok) h.toast(`🧺 Collected ${fmtGot(h, r.got)}.${r.clipped ? ' Stash full — the rest waits in the pen.' : ''}`, 4200);
          else if (r.why === 'cooldown') h.toast('🧺 Not yet — pens are collected once per cooldown.', 2600);
          else h.toast(`Collect: ${why(h, r)}`, 3000);
          break;
        }
        case 'slaughter': {
          const a = animalDef(id); if (!a) break;
          if (n > 1) { const ok = await h.confirm(`Send ${n} grown ${a.plural.toLowerCase()} to the block (${FARM_ECON.cuts[m.ui.cut].label.toLowerCase()})? This cannot be undone.`); if (!ok) break; }
          r = S.slaughter(h, s, { sp: id, n }, m.ui.cut);
          h.toast(r.ok ? `🔪 ${r.taken} ${r.taken === 1 ? a.name : a.plural} → ${fmtGot(h, r.got)}.${r.stories.length ? ' ' + r.stories.join(' ') : ''}${r.clipped ? ' ⚠ Stash full — part of the yield was lost.' : ''}` : `Butcher: ${why(h, r)}`, 5000);
          break;
        }
        case 'slaughter-one': {
          const a = S.animalById(s, id | 0); if (!a) break;
          const d = animalDef(a.sp);
          const prize = S.prizeIds(s).has(a.id);
          const ok = await h.confirm(`Send ${a.name} the ${d.name.toLowerCase()}${prize ? ' — your PRIZE beast —' : ''} to the block (${FARM_ECON.cuts[m.ui.cut].label.toLowerCase()})?`);
          if (!ok) break;
          r = S.slaughter(h, s, { ids: [a.id] }, m.ui.cut);
          h.toast(r.ok ? `🔪 ${a.name} → ${fmtGot(h, r.got)}.${r.stories.length ? ' ' + r.stories.join(' ') : ''}` : `Butcher: ${why(h, r)}`, 5000);
          break;
        }
        case 'treat': { const a = S.animalById(s, id | 0); if (!a) break; r = S.treat(h, s, a.id); h.toast(r.ok ? (r.cured ? `💊 ${a.name} is cured of ${FARM_ECON.disease.kinds[r.cured].label.toLowerCase()} (${Math.round(r.health)} health).` : `💊 ${a.name} is at ${Math.round(r.health)} health.`) : `Treat: ${why(h, r)}`, 3000); break; }
        case 'crate': {
          const a = S.animalById(s, id | 0); if (!a) break;
          const ok = await h.confirm(`Crate ${a.name} for the Exchange? You get 1 Livestock crate; the animal leaves the farm.`); if (!ok) break;
          r = S.crate(h, s, a.id); h.toast(r.ok ? `📦 ${a.name} crated. Sell the crate on the Resource Exchange.` : `Crate: ${why(h, r)}`, 3600); break;
        }
        case 'uncrate': { const a = animalDef(id); if (!a) break; r = S.uncrate(h, s, id); h.toast(r.ok ? `📦 ${r.name} the ${a.name.toLowerCase()} came out of the crate, half grown.` : `Uncrate: ${why(h, r)}`, 3600); break; }
        case 'craft': { const rk = t.getAttribute('data-recipe'); r = S.craft(h, s, id, rk, n); h.toast(r.ok ? `⚙ ${r.batches}× → ${fmtGot(h, r.got)}.${r.clipped ? ' ⚠ Stash full — output was clipped.' : ''}` : `Cannot craft: ${why(h, r)}`, 3600); break; }
        case 'deliver': { r = S.deliverDemand(h, s); h.toast(r.ok ? `🚚 Delivered. The town paid ${fmtGot(h, r.got)}. ${r.left} left today.` : `Town: ${why(h, r)}`, 3600); break; }
        case 'rename': m.ui.renaming = id | 0; break;
        case 'consign': {
          const a = S.animalById(s, id | 0); if (!a) break;
          const ok = await h.confirm(`Walk ${a.name} into the Sale Ring? The regulars bid in goods and the hammer falls in ${FARM_ECON.auction.lotMinutes} minutes. No taking it back.`); if (!ok) break;
          r = S.consign(h, s, a.id);
          if (r.ok) { m.tab = 'market'; loadLots(); h.toast(`🏛 ${a.name} is in the ring. Athena: “${r.timeline.athena}”`, 4200); } else h.toast(`Ring: ${why(h, r)}`, 3400);
          break;
        }
        case 'p2p-post': {
          const a = S.animalById(s, id | 0); if (!a) break;
          if (!h.cloud || !h.cloud.ready()) { h.toast('Sign in to list stock for other players.', 3000); break; }
          const value = S.animalValue(s, a); const minBid = Math.max(FARM_ECON.auction.p2p.minBid, Math.round(value * 0.5 / 100) * 100);
          const ok = await h.confirm(`List ${a.name} for other players? Minimum bid 🔥${minBid.toLocaleString()} (half its value), 24 hours. The beast leaves your farm now and comes back only if nobody bids.`); if (!ok) break;
          const took = S.takeAnimalForLot(h, s, a.id); if (!took.ok) { h.toast(`List: ${took.why}`, 3000); break; }
          const animal = took.animal; delete animal.away; delete animal.ill; delete animal.illSince; delete animal.hungry;
          const pr = await cloudLots.post(h, animal, minBid, 24);
          if (pr.ok) { h.toast(`🌐 ${a.name} is listed. Bids settle on the server.`, 3600); m.tab = 'market'; loadLots(); }
          else { S.returnAnimal(h, s, animal); h.toast(`List: ${pr.why}`, 4000); }
          break;
        }
        case 'p2p-refresh': loadLots(); break;
        case 'p2p-bid': {
          const inp = rootEl.querySelector(`[data-fbidamt="${id}"]`); const amt = parseInt(inp ? inp.value : '0', 10) | 0;
          const ok = await h.confirm(`Bid 🔥${amt.toLocaleString()}? It is held in escrow and returned if you are outbid.`); if (!ok) break;
          const br = await cloudLots.bid(h, id, amt);
          h.toast(br.ok ? `🔨 Bid placed: 🔥${amt.toLocaleString()}.` : `Bid: ${br.why}`, 3400);
          /* ⚠ No local spendGems here. The RPC already debited the canonical
             wallet; a client-side spend would be mirrored to wallet_charge and
             debit the bid TWICE. The chip catches up on the next wallet sync. */
          loadLots(); break;
        }
        case 'p2p-settle': { const sr = await cloudLots.settle(h, id); h.toast(sr.ok ? `⚖ Settled: ${sr.data && sr.data.status}${sr.data && sr.data.net ? ' · seller paid 🔥' + Number(sr.data.net).toLocaleString() : ''}.` : `Settle: ${sr.why}`, 3400); loadLots(); break; }
        case 'p2p-claim': {
          const cr = await cloudLots.claim(h, id);
          if (!cr.ok) { h.toast(`Claim: ${cr.why}`, 3400); loadLots(); break; }
          const animal = cr.data && cr.data.animal;
          const rr = S.returnAnimal(h, s, animal || {});
          h.toast(rr.ok ? (rr.held ? `🚧 ${rr.animal.name} is waiting at the gate — make room in the pen.` : `🚪 ${rr.animal.name} is home.`) : `Claimed, but: ${rr.why}`, 3600);
          loadLots(); break;
        }
        case 'contract-accept': { r = S.acceptContract(h, s, id | 0); h.toast(r.ok ? '📜 Contract signed. The clock is running.' : `Contract: ${why(h, r)}`, 3000); break; }
        case 'contract-deliver': { r = S.deliverContract(h, s, id | 0); h.toast(r.ok ? `🚚 Delivered. The town paid ${fmtGot(h, r.got)}. Reputation ${r.rep >= 0 ? '+' : ''}${r.rep}.` : `Contract: ${why(h, r)}`, 4000); break; }
        case 'ranch-refresh': loadRanch(); break;
        case 'ranch-feed': { const rr = await cloudRanch.feed(h, n); h.toast(rr.ok ? `🌾 Added ${rr.added} feed to the ranch.` : `Ranch: ${rr.why}`, 3000); loadRanch(); break; }
        case 'ranch-stock': { const a = animalDef(id); const rr = await cloudRanch.stock(h, id); h.toast(rr.ok ? `${a.emoji} ${rr.name} joins the ranch.` : `Ranch: ${rr.why}`, 3000); loadRanch(); break; }
        case 'ranch-claim': { const rr = await cloudRanch.claim(h); h.toast(rr.ok ? `🧺 Claimed ${fmtGot(h, rr.got)}.` : `Ranch: ${rr.why}`, 3400); loadRanch(); break; }
        case 'ranch-butcher': { const ok = await h.confirm('Send this ranch animal to the block? Your cut follows your feed share.'); if (!ok) break; const rr = await cloudRanch.butcher(h, id | 0); h.toast(rr.ok ? `🔪 Your cut: ${fmtGot(h, rr.got)}.` : `Ranch: ${rr.why}`, 3400); loadRanch(); break; }
        case 'rename-save': { const inp = rootEl.querySelector(`[data-frename="${id}"]`); doRename(id, inp ? inp.value : ''); return; }
        case 'rename-cancel': m.ui.renaming = null; break;
        case 'look-ground': S.setLook(h, s, { ground: id }); break;
        case 'look-sky': S.setLook(h, s, { sky: id }); break;
        case 'look-decor': S.setLook(h, s, { decor: { [id]: !s.look.decor[id] } }); break;
        case 'look-roof-reset': S.setLook(h, s, { roofs: { [id]: null } }); break;
        case 'look-name': { const inp = rootEl.querySelector('[data-fname]'); doName(inp ? inp.value : ''); return; }
        default: return;
      }
    } catch (err) { try { console.warn('[farm] action failed:', err); } catch (x) {} }
    finally { m.busy = false; paint(); }
  }
}

function why(h, r) {
  if (!r) return 'unknown';
  if (r.why === 'short' && r.shortfall) return 'short by ' + Object.keys(r.shortfall).map(k => k === 'cinder' ? `🔥${r.shortfall[k]} Cinder` : `${h.resMeta(k).icon}${r.shortfall[k]} ${h.resMeta(k).name}`).join(', ');
  return r.why || 'unknown';
}

function unmount(which) {
  const m = which || _mounted;
  if (!m) return;
  if (_mounted === m) _mounted = null;
  try { clearInterval(m.tick); } catch (e) {}
  try { if (m.scene) m.scene.destroy(); } catch (e) {}
  try { if (m.onClick) m.root.removeEventListener('click', m.onClick); if (m.onChange) m.root.removeEventListener('change', m.onChange); if (m.onKey) m.root.removeEventListener('keydown', m.onKey); } catch (e) {}
}

const withHost = (fn) => { const h = host(); return h ? fn(h, S.ensureState(h)) : { ok: false, why: 'no bridge' }; };
const api = {
  FARM_ECON, FARM_ANIMALS, FARM_BUILDINGS, FARM_LOOKS, animalDef, buildingDef, buildingCostAt, auditCatalog,
  ready: () => !!makeHost(),
  mount, unmount,
  refresh: () => { try { if (_mounted && _mounted.paint) _mounted.paint(); } catch (e) {} },
  state: () => { const h = host(); return h ? S.ensureState(h) : { buildings: {}, animals: [] }; },
  summary: () => { const h = host(); return h ? S.summary(h, S.ensureState(h)) : null; },
  build: (id) => withHost((h, s) => S.build(h, s, id)),
  upgrade: (id) => withHost((h, s) => S.upgrade(h, s, id)),
  repair: (id) => withHost((h, s) => S.repair(h, s, id)),
  buyAnimal: (sp, n, carrier) => withHost((h, s) => S.buyAnimal(h, s, sp, n, carrier)),
  rush: (id) => withHost((h, s) => S.rush(h, s, id)),
  carriers: () => { const h = host(); return h ? S.carriersFor(h) : []; },
  debugShift: (ms) => withHost((h, s) => S.debugShift(h, s, ms)),
  consign: (id) => withHost((h, s) => S.consign(h, s, id)),
  acceptContract: (id) => withHost((h, s) => S.acceptContract(h, s, id)),
  deliverContract: (id) => withHost((h, s) => S.deliverContract(h, s, id)),
  returnAnimal: (a) => withHost((h, s) => S.returnAnimal(h, s, a)),
  cloud: { lots: cloudLots, ranch: cloudRanch },
  /* 🚪 Kitchen door — for operations and the node city (index.html reads these). */
  available: (id) => { const h = host(); return h ? S.available(h, S.ensureState(h), id) : 0; },
  pending: () => { const h = host(); return h ? S.pendingAll(h, S.ensureState(h)) : {}; },
  drawAccrual: (id, n, who) => withHost((h, s) => S.drawAccrual(h, s, id, n, who)),
  fillTrough: (id, n) => withHost((h, s) => S.fillTrough(h, s, id, n)),
  collect: (id) => withHost((h, s) => S.collect(h, s, id)),
  slaughter: (sel, cut) => withHost((h, s) => S.slaughter(h, s, typeof sel === 'string' ? { sp: sel, n: 1 } : sel, cut)),
  craft: (id, rk, n) => withHost((h, s) => S.craft(h, s, id, rk, n)),
  treat: (id) => withHost((h, s) => S.treat(h, s, id)),
  rename: (id, nm) => withHost((h, s) => S.rename(h, s, id, nm)),
  crate: (id) => withHost((h, s) => S.crate(h, s, id)),
  uncrate: (sp) => withHost((h, s) => S.uncrate(h, s, sp)),
  deliverDemand: () => withHost((h, s) => S.deliverDemand(h, s)),
  setLook: (patch) => withHost((h, s) => S.setLook(h, s, patch)),
  tend: () => withHost((h, s) => S.tend(h, s)),
  /* 🏆 For a future corp / community contest: lifetime harvest numbers. */
  harvestScore: () => { try { const s = api.state(); return { meat: s.stats.meat | 0, slaughtered: s.stats.slaughtered | 0, births: s.stats.births | 0, raidsRepelled: s.stats.raidsRepelled | 0 }; } catch (e) { return null; } },
  _state: S,
};

try { if (typeof window !== 'undefined') window.MythicFarm = api; } catch (e) {}
export default api;
