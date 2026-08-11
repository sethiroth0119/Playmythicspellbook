/* ══════════════════════════════════════════════════════════════════════════
   ⛺ THE CAMP BUNKHOUSE — the floor.  (resonance-card-training.md §5, step 4)
   ──────────────────────────────────────────────────────────────────────────
       Camp version:  Bunkhouse — 2 cards, 1 room type, 8,000 🔥
   It WORKS WITH NO CITY. That is the whole reason it exists: a player who has
   never opened the city screen still has a door into directed training, so
   the House is convenience rather than a gate (doc §2, §9).

   🔴 NO CITY MEANS NO REST QUALITY. §6's coupling reads city Food coverage,
   city Morale and city Security. A camp has none of those, so the Bunkhouse
   trains at restQuality = 1.0 — the plain 14/hr, no tier multiplier, two beds,
   one room at a time. It is not "better than a starving city" by accident:
   the city sells BREADTH (20 beds, six rooms at once, 150%) and charges
   upkeep for it. Two beds is the floor and the floor is honest.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `App`, `showToast`, `render`,
   `spendGems`, `OP_COLLECT_CD_MS` and `OP_ACCRUAL_CAP_H` are top-level `const`
   / function declarations in index.html and are NOT on window. They arrive
   through `window.MythicHouseBridge`, which index.html builds by hand. If the
   bridge is missing this module renders nothing and breaks nothing.
   ══════════════════════════════════════════════════════════════════════════ */
import * as H from './house.core.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const BUILD_COST = H.BUNKHOUSE.cinderDoc;      // 8,000 🔥, the doc's own figure
const SPEC = H.BUNKHOUSE;
// See settle(): the camp floor sits between the city's worst (0.50) and best (1.00).
const CAMP_REST_QUALITY = 0.75;

function B() { try { return window.MythicHouseBridge || null; } catch (e) { return null; } }
function model() { try { return (window.MythicResonance && typeof window.MythicResonance.add === 'function') ? window.MythicResonance : null; } catch (e) { return null; } }

/* ── state, on the Profile ─────────────────────────────────────────────
   `Profile.bunkhouse = { built: 1, house: { billets, lastAt, lastCollect } }`
   ⚠ saveProfile() stringifies the WHOLE Profile, but the LOADER is a field
     whitelist (index.html ~66333). A field that is written and not whitelisted
     is saved and silently dropped on every reload — this file has shipped that
     exact bug for sideDeck, archonDeck and salvage. `bunkhouse` is added to
     that whitelist in the same change as this module. */
function state() {
  const b = B(); if (!b || !b.Profile) return null;
  const P = b.Profile;
  if (!P.bunkhouse || typeof P.bunkhouse !== 'object') P.bunkhouse = { built: 0, house: null };
  if (!P.bunkhouse.house || !Array.isArray(P.bunkhouse.house.billets)) P.bunkhouse.house = H.loadHouse(P.bunkhouse.house);
  return P.bunkhouse;
}
function persist() {
  const st = state(); if (!st) return;
  st.house = Object.assign(H.saveHouse(st.house) || { billets: [], lastAt: Date.now(), lastCollect: 0 });
  try { B().saveProfile(); } catch (e) {}
  // Re-inflate so the live object keeps its float precision after the round-trip.
  st.house = H.loadHouse(st.house);
}
/* 🔑 Same key rule as the city half: /src/resonance/index.js stores a spread
   under 'u:<cardId>' / 'h:<heroId>', matching Profile.units / Profile.heroes
   and index.html's `_rezKey`. `window.cityCardCollection()` is the accessor
   both halves read, so both map it identically. */
export function cardKey(c) {
  if (!c || !c.id) return null;
  return (c.type === 'Hero' ? 'h:' : 'u:') + c.id;
}
function coreCtx() {
  const b = B() || {};
  return {
    resonance: model(),
    cardById: (id) => (CARD_CACHE.find(c => c.id === id) || null),
    cardKey,
    source: 'bunkhouse',          // an ALLOWED_SOURCES value in the model
    collectCdMs: b.collectCdMs, accrualCapH: b.accrualCapH,
  };
}

/* The camp has no economy tick, so accrual is pure wall clock through the
   same watermark the city House uses — `settle()` pays Date.now() - lastAt
   once and moves the watermark, so opening the panel ten times pays once. */
export function settle() {
  const st = state(); if (!st || !st.built) return null;
  const b = B() || {};
  /* 🏕 THE CAMP RESTS AT 0.75, NOT 1.0. A hard-coded 1.0 made the Bunkhouse the
     fastest trainer in the game outside a flawless city: 14.00/hr here against
     the city Tier 1's 11.55/hr in a genuinely well-fed district. That inverts
     the design — the House is meant to be the convenience the city buys you,
     and the camp is meant to be the floor you always have. 0.75 sits above the
     city's 0.50 worst case and below its 1.00 best, so a working city is always
     worth building and a camp-only player is never locked out. */
  return H.settle(st.house, { tierRate: SPEC.rate, restQuality: CAMP_REST_QUALITY, accrualCapH: b.accrualCapH, perHour: H.RES_PER_HOUR });
}

let CARD_CACHE = [];
async function loadCards() {
  try { CARD_CACHE = (typeof window.cityCardCollection === 'function' ? await window.cityCardCollection() : []) || []; }
  catch (e) { CARD_CACHE = []; }
  return CARD_CACHE;
}
function freeCards() {
  const b = B(); const P = (b && b.Profile) || {};
  const busy = new Set(Object.keys(P.cityCards || {}));
  const st = state();
  for (const x of ((st && st.house && st.house.billets) || [])) busy.add(x.card);
  return CARD_CACHE.filter(c => !busy.has(c.id));
}

const CSS = `
#bunkhouse{margin:1rem 0 0;padding:1rem 1.2rem;background:rgba(0,0,0,.42);
  border:1px solid rgba(212,175,55,.28);border-radius:12px;}
#bunkhouse h3{font-family:'Cinzel',serif;color:#ffd166;font-size:1rem;letter-spacing:.06em;margin:0 0 .2rem;}
#bunkhouse .bh-sub{color:#bfae87;font-size:.76rem;line-height:1.45;margin-bottom:.7rem;}
#bunkhouse .bh-stat{display:flex;gap:1.1rem;flex-wrap:wrap;color:#bfae87;font-size:.76rem;margin-bottom:.7rem;}
#bunkhouse .bh-stat b{color:#e2eaff;font-family:'Roboto Mono',monospace;}
#bunkhouse .bh-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.45rem;margin-bottom:.7rem;}
#bunkhouse .bh-room{padding:.45rem .55rem;border:1px solid rgba(212,175,55,.22);border-radius:8px;
  background:rgba(0,0,0,.3);cursor:pointer;color:#e2eaff;font-size:.78rem;text-align:left;}
#bunkhouse .bh-room[disabled]{opacity:.38;cursor:not-allowed;}
#bunkhouse .bh-room.on{border-color:#ffd166;box-shadow:0 0 0 1px rgba(255,209,102,.35);}
#bunkhouse .bh-room span{display:block;color:#bfae87;font-size:.68rem;}
#bunkhouse .bh-bed{display:flex;justify-content:space-between;align-items:center;gap:.6rem;
  padding:.4rem .55rem;border-top:1px solid rgba(255,255,255,.07);font-size:.8rem;color:#e2eaff;}
#bunkhouse .bh-bed b{color:#ffd166;font-family:'Roboto Mono',monospace;}
#bunkhouse button.bh-act{padding:.4rem .8rem;border-radius:7px;border:1px solid rgba(212,175,55,.5);
  background:rgba(212,175,55,.14);color:#ffd166;font-family:'Cinzel',serif;font-size:.8rem;cursor:pointer;}
#bunkhouse button.bh-act[disabled]{opacity:.4;cursor:not-allowed;}
#bunkhouse .bh-note{color:#8f8570;font-size:.7rem;margin-top:.6rem;line-height:1.4;}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  const s = document.createElement('style'); s.id = 'bunkhouse-css'; s.textContent = CSS; document.head.appendChild(s);
}

function html() {
  const b = B(), st = state();
  const gems = (b.Profile.gems | 0);
  if (!st.built) {
    return '<h3>⛺ BUNKHOUSE</h3>' +
      '<div class="bh-sub">Two bunks and one training room. Cards billeted here accrue <b>Resonance</b> — ' +
      H.RES_PER_HOUR + ' an hour each, into whichever stat the room trains. No city required, ever. ' +
      'A Resting House in a Node City does the same thing for twenty cards at once, and its rate rides on how well that city is fed.</div>' +
      '<div class="bh-stat"><span>🛏 Beds <b>' + SPEC.capacity + '</b></span><span>🚪 Rooms at once <b>' + SPEC.rooms + '</b></span>' +
      '<span>✨ Rate <b>' + H.RES_PER_HOUR + '/hr</b></span><span>⏳ Cap <b>' + b.accrualCapH + 'h</b></span></div>' +
      '<button class="bh-act" id="bh-build"' + (gems < BUILD_COST ? ' disabled' : '') + '>🔨 Raise the Bunkhouse — ' +
      BUILD_COST.toLocaleString() + ' 🔥' + (gems < BUILD_COST ? ' (you have ' + gems.toLocaleString() + ')' : '') + '</button>';
  }
  const h = st.house;
  const used = H.distinctRooms(h);
  const M = model();
  const cd = H.collectReadyIn(h, b.collectCdMs);
  const pend = h.billets.reduce((s, x) => s + Math.floor(x.pend || 0), 0);
  return '<h3>⛺ BUNKHOUSE</h3>' +
    '<div class="bh-sub">' + H.RES_PER_HOUR + ' Resonance per hour, per card, into the room they sleep in. ' +
    'No rest-quality modifier here — a camp has no district to feed. ' +
    'What a Node City buys you is <b>breadth</b>: twenty beds and six rooms at once.</div>' +
    '<div class="bh-stat"><span>🛏 Beds <b>' + h.billets.length + ' / ' + SPEC.capacity + '</b></span>' +
      '<span>🚪 Rooms at once <b>' + used.size + ' / ' + SPEC.rooms + '</b></span>' +
      '<span>✨ Rate <b>' + H.RES_PER_HOUR + '/hr</b></span>' +
      '<span>⏳ Cap <b>' + b.accrualCapH + 'h</b></span></div>' +
    '<div class="bh-rooms">' + H.ROOMS.map(r => {
      const why = H.billetBlock(h, SPEC, r.id);
      return '<button class="bh-room' + (used.has(r.id) ? ' on' : '') + '" data-bhroom="' + r.id + '"' +
        (why ? ' disabled title="' + esc(why) + '"' : '') + '>' + r.ico + ' ' + esc(r.name) +
        '<span>→ ' + r.stat.toUpperCase() + '</span></button>';
    }).join('') + '</div>' +
    h.billets.map(x => {
      const c = CARD_CACHE.find(y => y.id === x.card);
      const room = H.roomById(x.room);
      const spread = H.spreadOf(coreCtx(), x.card);
      return '<div class="bh-bed"><span>🃏 ' + esc(c ? c.name : x.card) + ' — ' + room.ico + ' ' + esc(room.name) +
        (spread ? ' · ' + room.stat.toUpperCase() + ' ' + (spread[room.stat] | 0) : '') + '</span>' +
        '<span><b>+' + Math.floor(x.pend || 0) + ' ✨</b>' + (x.capped ? ' <i style="color:#e07a5f;font-size:.7rem">36h CAP</i>' : '') +
        ' <button class="bh-act" data-bhwake="' + esc(x.card) + '">Wake</button></span></div>';
    }).join('') +
    '<div style="margin-top:.7rem"><button class="bh-act" id="bh-collect"' +
      ((!M || cd > 0 || pend <= 0) ? ' disabled' : '') + '>' +
      (!M ? '✨ Resonance model not loaded' : cd > 0 ? '✨ Collect in ' + H.fmtLeft(cd)
          : pend <= 0 ? '✨ Nothing banked yet' : '✨ Collect ' + pend + ' Resonance') + '</button></div>' +
    '<div class="bh-note">Settles every ' + Math.round((b.collectCdMs || 0) / 3600000) + 'h · unattended accrual caps at ' +
      b.accrualCapH + 'h — the same idle clock this game already runs its operations on.' +
      (M ? '' : ' Resonance is still accruing and is not lost.') + '</div>';
}

function paint(root) {
  root.innerHTML = html();
  const b = B(), st = state();
  const rerender = () => { persist(); paint(root); };
  const build = root.querySelector('#bh-build');
  if (build) build.onclick = async () => {
    if (!(await b.gcConfirm('Raise the Bunkhouse for ' + BUILD_COST.toLocaleString() + ' 🔥 Cinder?'))) return;
    if (!b.spendGems(BUILD_COST)) { b.showToast('Not enough Cinder.', 2600); return; }
    st.built = 1; st.house = H.newHouse();
    b.showToast('⛺ The Bunkhouse is up. Two bunks, one room — put a card to bed.', 4200);
    rerender();
  };
  root.querySelectorAll('[data-bhroom]').forEach(el => { el.onclick = () => pick(root, el.dataset.bhroom); });
  root.querySelectorAll('[data-bhwake]').forEach(el => { el.onclick = () => {
    const x = H.unbillet(st.house, el.dataset.bhwake);
    if (!x) return;
    try { window.cityCardAssign(x.card, false); } catch (e) {}
    const lost = Math.floor(x.pend || 0);
    b.showToast(lost > 0 ? '⛺ Woken — ⚠ ' + lost + ' uncollected Resonance left behind.' : '⛺ Woken and back in your collection.', 3800);
    rerender();
  }; });
  const col = root.querySelector('#bh-collect');
  if (col) col.onclick = () => {
    const r = H.collect(st.house, coreCtx());
    if (!r.ok) { b.showToast(r.reason === 'cooldown' ? '✨ ' + H.fmtLeft(r.cdLeft) + ' until the Bunkhouse settles.' : '✨ Nothing to bank.', 3000); return; }
    let msg = '✨ Banked ' + r.granted + ' Resonance.';
    if (r.wasted > 0) msg += ' ' + r.wasted + ' had nowhere to go — ' + r.rows.filter(x => x.wasted > 0).map(x => x.name).join(', ') +
      ' sits at the Resonance ceiling, which no House can lift.';
    b.showToast(msg, 5200);
    rerender();
  };
}

/* The card chooser. Deliberately a plain list built here rather than a reach
   into the game's own picker — that picker is a top-level function in
   index.html and invisible to a module (the globals trap again). */
function pick(root, roomId) {
  const b = B(), st = state();
  const why = H.billetBlock(st.house, SPEC, roomId);
  if (why) { b.showToast(why, 3200); return; }
  const room = H.roomById(roomId);
  const pool = freeCards();
  const old = document.getElementById('bh-pick'); if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'bh-pick';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(6,4,10,.82);display:flex;align-items:center;justify-content:center';
  el.innerHTML = '<div style="width:min(420px,92vw);max-height:80vh;overflow:auto;background:#100c1b;border:1px solid rgba(212,175,55,.4);border-radius:12px;padding:1rem 1.2rem">' +
    '<h3 style="font-family:\'Cinzel\',serif;color:#ffd166;font-size:.95rem;margin:0 0 .6rem">' + room.ico + ' ' + esc(room.name) + ' → ' + room.stat.toUpperCase() + '</h3>' +
    (pool.length ? pool.slice(0, 200).map(c => '<button data-pick="' + esc(c.id) + '" style="display:block;width:100%;text-align:left;margin-bottom:.35rem;padding:.45rem .6rem;background:#181227;border:1px solid rgba(212,175,55,.2);border-radius:7px;color:#e2eaff;font-size:.82rem;cursor:pointer">' +
        esc(c.name) + '<span style="display:block;color:#bfae87;font-size:.68rem">' + esc(c.type) + ' · ⚡' + (c.power | 0) + '</span></button>').join('')
      : '<div style="color:#bfae87;font-size:.8rem">No unassigned cards. Every card you own is already in a deck, a socket or a bed.</div>') +
    '<button id="bh-pick-x" class="bh-act" style="margin-top:.5rem">Close</button></div>';
  document.body.appendChild(el);
  el.onclick = (ev) => {
    if (ev.target === el || ev.target.id === 'bh-pick-x') { el.remove(); return; }
    const btn = ev.target.closest('[data-pick]'); if (!btn) return;
    const id = btn.dataset.pick;
    const err = H.billet(st.house, id, roomId, SPEC);
    el.remove();
    if (err) { b.showToast(err, 3200); return; }
    try { window.cityCardAssign(id, true); } catch (e) {}
    const c = CARD_CACHE.find(y => y.id === id);
    b.showToast('⛺ ' + ((c && c.name) || id) + ' turns in — training ' + room.stat.toUpperCase() + '.', 4000);
    persist(); paint(root);
  };
}

/* ── the mount ─────────────────────────────────────────────────────────
   index.html calls this at the tail of renderCamp() with the screen root.
   Everything below is defensive: no bridge, no panel; a throw here must
   never take the Camp screen down with it. */
export async function mountInto(root) {
  const b = B(); if (!b || !b.Profile || !root) return;
  ensureCss();
  let host = root.querySelector('#bunkhouse');
  if (!host) { host = document.createElement('div'); host.id = 'bunkhouse'; root.appendChild(host); }
  const st = state();
  settle();                                   // pay the absence before painting
  if (st.built) persist();
  await loadCards();
  paint(host);
}

/* 🪟 THE OVERLAY MOUNT — and why it exists.
   mountInto() appends the panel to renderCamp()'s output. That output is still
   built and still in the DOM, but on the CURRENT camp it is covered: opening
   the Camp screen also mounts `#base-builder-frame`, a full-viewport iframe at
   z-index 2147483300 (index.html ~79788), and the bunker React app inside it
   is what the player actually sees. A panel underneath that is not a feature.
   So the Bunkhouse can also be opened as a body-level overlay ABOVE the
   bunker, using the seam the bunker already has for exactly this — "a bunker
   room invoked a REAL system; modals render in the parent at a higher z-index
   than the iframe" (the base:action handler). One `postMessage` from any
   bunker room or HUD button opens it. */
export async function openOverlay() {
  const b = B(); if (!b || !b.Profile) return;
  ensureCss();
  const old = document.getElementById('bh-overlay'); if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'bh-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483400;background:rgba(6,4,10,.86);' +
                     'display:flex;align-items:center;justify-content:center;overflow:auto;padding:2rem 1rem';
  const inner = document.createElement('div');
  inner.style.cssText = 'width:min(640px,94vw);max-height:88vh;overflow:auto';
  const host = document.createElement('div'); host.id = 'bunkhouse';
  const close = document.createElement('button');
  close.className = 'bh-act'; close.textContent = 'Close'; close.style.marginTop = '.7rem';
  close.onclick = () => el.remove();
  inner.appendChild(host); inner.appendChild(close);
  el.appendChild(inner);
  el.addEventListener('click', (ev) => { if (ev.target === el) el.remove(); });
  document.body.appendChild(el);
  await mountInto(inner);
}

export function api() {
  return { core: H, SPEC, BUILD_COST, state, settle, mountInto, openOverlay, freeCards,
           _cards: () => CARD_CACHE, _ctx: coreCtx };
}
try { window.MythicBunkhouse = api(); } catch (e) {}
