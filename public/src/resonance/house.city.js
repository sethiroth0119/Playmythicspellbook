/* ══════════════════════════════════════════════════════════════════════════
   🛏 THE CITY RESTING HOUSE — mount + UI.   (resonance-card-training.md §5-§6)
   ──────────────────────────────────────────────────────────────────────────
   This is the half that touches the city. It owns:
     · the per-tile billet state (rides the tile's own save object)
     · the live accrual hook off economyTick
     · the absence catch-up, on one shared watermark with the live hook
     · the whole Manage-Billets dialog, including the rest-quality readout
   It owns NO rules. Rooms, tiers, rest quality and accrual are house.core.js;
   the 510/252 budget belongs to the Resonance model and is reached only
   through `ctx.resonance`.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `vitals`, `wellbeing`
   and `MythicCityBridge` are top-level `const` inside node-city/index.html's
   module script. They are NOT on window. Every one of them arrives here in
   the `ctx` object that index.html builds by hand — nothing in this file may
   reach for a bare global, and a missing ctx field must degrade, never throw.
   ══════════════════════════════════════════════════════════════════════════ */
import * as H from './house.core.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let CTX = null;                 // what index.html handed over
let OPEN_KEY = null;            // tile key whose dialog is open

/* ── the Resonance model seam ───────────────────────────────────────────
   ⚠ THE OTHER BUILDER OWNS THIS. Path B (battle-earned Resonance) and the
   card model ship BEFORE the House (doc §10: "Ship step 2 before step 5"),
   so at the moment this file was written the model did not exist yet. It is
   therefore resolved LATE and by DUCK TYPE, every call, from whichever of
   these the page ends up exposing:
        window.MythicResonance   (assumed name)
        ctx.resonance            (handed over explicitly by index.html)
   The assumed contract is exactly three calls and is documented in
   .cityloop/_r8/house.NOTES.md so the coordinator can reconcile:
        add(card, stat, amount) -> number actually granted (0 when capped)
        get(card)               -> { hp, atk, mag, def, res, spd }
        reset(card)             -> void
   With no model present the House still runs: Resonance accrues as `pend`
   and the collect button says, in words, that the model is not loaded. It
   does NOT invent a spread, and it does NOT cap anything — a House that
   quietly kept its own budget would be a second, divergent ceiling. */
function model() {
  try { if (CTX && CTX.resonance && typeof CTX.resonance.add === 'function') return CTX.resonance; } catch (e) {}
  try { if (window.MythicResonance && typeof window.MythicResonance.add === 'function') return window.MythicResonance; } catch (e) {}
  /* 🔴 THE CITY IS AN IFRAME. /src/resonance/index.js is loaded by the GAME
     page, not by node-city/index.html, so `window.MythicResonance` does not
     exist in this document — the model lives one frame up, and reaches the
     profile from there through window.MythicBridge.resonanceGet/Set. In
     'parent' bridge mode the parent is same-origin and readable; in
     'message'/'standalone' mode this throws or returns undefined and the House
     correctly reports "model not loaded" and keeps accruing into `pend`
     instead of inventing a spread. */
  try {
    const P = window.parent;
    if (P && P !== window && P.MythicResonance && typeof P.MythicResonance.add === 'function') return P.MythicResonance;
  } catch (e) {}
  return null;
}
/* 🔑 THE KEY. /src/resonance/index.js stores a spread under `'u:<cardId>'` or
   `'h:<heroId>'` — the same identity `Profile.units` / `Profile.heroes` use, and
   the same string index.html's `_rezKey(unit)` builds for a unit in battle. The
   city's collection rows come from `MythicCityBridge.fetchCards()`, whose
   `type` is 'Hero' for a hero card and something else for everything else, so
   the mapping is one line — but it belongs HERE, not in house.core.js, because
   it is a property of the model + this collection, not of a House. */
export function cardKey(c) {
  if (!c || !c.id) return null;
  return (c.type === 'Hero' ? 'h:' : 'u:') + c.id;
}
function ctxForCore() {
  return {
    resonance: model(),
    cardById: CTX && CTX.cardById,
    cardKey,
    source: 'house',
    collectCdMs: CTX ? CTX.collectCdMs : undefined,
    accrualCapH: CTX ? CTX.accrualCapH : undefined,
  };
}

/* ── which tiles are Houses ─────────────────────────────────────────── */
export const HOUSE_TYPE = 'resthouse';
function houseTiles() {
  const out = [];
  if (!CTX || !CTX.game || !CTX.game.tiles) return out;
  for (const [k, t] of Object.entries(CTX.game.tiles)) if (t && t.type === HOUSE_TYPE) out.push([k, t]);
  return out;
}
function specOf(t) { return H.tierSpec(t ? t.lvl : 1); }
/* 🏗 IS THIS HOUSE STILL A HOLE IN THE GROUND?
   A Resting House under construction (`t.bld.k === 0`) has no beds, no roof and
   no card asleep in it, and it must accrue exactly ZERO — otherwise a player
   who orders a 24-hour Tier 3 House starts earning Resonance from a foundation
   pad, which is the same class of bug as a construction site paying rent.
   ⚠ AN UPGRADING HOUSE (k = 1) IS NOT A SITE. It is a standing, working
     building at its current tier whose `lvl` simply has not moved yet — it
     keeps its billets and keeps accruing at the tier it actually reached.
     That asymmetry is the entire point of the k flag; testing `t.bld` alone
     here would silently stop a live House the moment its owner upgraded it.
   🔴 THE GLOBALS TRAP. `bldSite` is a top-level `const` inside node-city's
      module script and is invisible from here, so index.html hands it over as
      `ctx.isSite` at mount. The fallback reads the record's own shape, which
      keeps this correct (and unit-testable with a bare tile object) if a
      future ctx forgets the field — never a bare global, never window.game. */
function isSite(t) {
  try { if (CTX && typeof CTX.isSite === 'function') return !!CTX.isSite(t); } catch (e) {}
  return !!(t && t.bld && t.bld.k === 0);
}
/* The billet store lives ON THE TILE, so it is written by the city's own
   serialize() and read by its loadState() — no second save file, no second
   failure mode. `loadHouse` is absent-tolerant by construction. */
function houseOf(t) {
  if (!t) return null;
  if (!t.house || !Array.isArray(t.house.billets)) t.house = H.loadHouse(t.house);
  return t.house;
}

/* ⭐ REST QUALITY, from the REAL city. Three live reads, no cache:
     food     — game.cov.pct.food, the coverage function's own output
     morale   — wellbeing.morale / 100 (morale is NOT a `vitals` key; it lives
                in wellbeing, see index.html:17026)
     security — vitals.security / 100
   Every one is optional: a city that has not ticked yet reads 0 and the
   House correctly runs at the floor rather than throwing. */
export function restInputs() {
  const g = (CTX && CTX.game) || {};
  const cov = (g.cov && g.cov.pct) || {};
  const vit = (CTX && CTX.vitals) || {};
  const wb = (CTX && CTX.wellbeing) || {};
  return { food: +cov.food || 0, morale: (+wb.morale || 0) / 100, security: (+vit.security || 0) / 100 };
}
export function restNow() { return H.restBreakdown(restInputs()); }

/* ── the economy hook ───────────────────────────────────────────────────
   Called once per economyTick from index.html with the tick's own dtMin, so
   the House advances on exactly the clock the rest of the city advances on
   (and therefore also advances correctly under __nc.step(), which is the only
   way any of this is testable without waiting six real hours). */
export function tick(dtMin) {
  if (!CTX) return;
  const rq = restNow().quality;
  for (const [, t] of houseTiles()) {
    if (t.damaged) continue;                       // a damaged building is offline, city-wide rule
    if (isSite(t)) continue;                       // 🏗 and an unbuilt one does not exist yet
    const spec = specOf(t);
    H.tick(houseOf(t), dtMin, {
      tierRate: spec.rate, restQuality: rq,
      accrualCapH: CTX.accrualCapH, perHour: H.RES_PER_HOUR,
    });
  }
}

/* ── absence catch-up ───────────────────────────────────────────────────
   Runs once, after loadState. Uses the SAME watermark the live tick moves,
   so it can never pay for time the tick already paid for — reload five times
   and the second through fifth settle 0. Rest quality is the city's state AS
   LOADED, which is the honest answer: your city was as you left it. It also
   means feeding the city the second you get back cannot retroactively
   improve the rate you earned while away. */
let LAST_OFFLINE = null;
export function awaySummary() { return LAST_OFFLINE; }
export function settleOffline() {
  if (!CTX) return null;
  const rq = restNow().quality;
  let total = 0, away = 0, capped = false;
  for (const [, t] of houseTiles()) {
    if (t.damaged) continue;
    /* 🏗 Same skip as the live tick, and it matters MORE here: settle() pays
       for an absence, so a House ordered just before the player closed the tab
       would bank up to the whole 36-hour cap for a building that was a
       foundation pad the entire time. The watermark is untouched by the skip,
       so it settles honestly from the moment it finishes. */
    if (isSite(t)) continue;
    const spec = specOf(t);
    const r = H.settle(houseOf(t), {
      tierRate: spec.rate, restQuality: rq,
      accrualCapH: CTX.accrualCapH, perHour: H.RES_PER_HOUR,
    });
    if (r) { total += r.gained; away = Math.max(away, r.awayMs || 0); capped = capped || !!r.awayCapped; }
  }
  /* 🧾 Stashed for the "While you were away" panel. Resonance is not a city
     resource, so it never reaches rep.gained — without this the panel printed
     "Nothing was produced" over an absence that trained 64.4 Resonance. */
  LAST_OFFLINE = { resonance: total, cards: billetedIds().length, capped: capped, at: Date.now() };
  if (total > 0.5 && CTX.toast) {
    CTX.toast('🛏 The House trained while you were away — ' + Math.floor(total) + ' Resonance banked' +
      (capped ? ' (capped at ' + CTX.accrualCapH + 'h — collect more often to lose nothing)' : '') + '.', 'good');
  }
  return { total, away, capped };
}

/* Cards that are asleep in a House. index.html folds this into
   assignedCardIds() so a billeted card cannot also be socketed or decked. */
export function billetedIds() {
  const s = new Set();
  for (const [, t] of houseTiles()) for (const b of houseOf(t).billets) s.add(b.card);
  return s;
}

/* Save/load hooks, called from the city's own serialize()/loadState(). */
export function saveTile(t) { return t && t.house ? H.saveHouse(t.house) : null; }
export function loadTile(t, raw) { if (t && raw) t.house = H.loadHouse(raw); }

/* 🧨 Demolishing a House with cards asleep in it must not swallow them. The
   cards go back to the collection and any whole Resonance already earned is
   banked first (force-collect, ignoring the 6h gate — the building is gone,
   there is no later). */
export function onDemolish(t) {
  if (!t || t.type !== HOUSE_TYPE || !t.house) return;
  const h = houseOf(t);
  if (!h.billets.length) return;
  const res = H.collect(h, ctxForCore(), true);
  for (const b of h.billets.slice()) {
    try { if (CTX.assignCard) CTX.assignCard(b.card, false); } catch (e) {}
  }
  h.billets.length = 0;
  if (CTX.toast) CTX.toast('🛏 The House came down — ' + res.granted + ' Resonance banked, sleepers returned to your collection.',
    res.granted > 0 ? 'good' : undefined);
}

/* ── one-line summary for the map tooltip ──────────────────────────────
   The tooltip is where a player who has NOT opened the dossier meets the
   coupling. It always names the multiplier and, when the city is dragging it
   down, what is dragging it. */
export function tipLine(t) {
  if (!t || t.type !== HOUSE_TYPE) return '';
  const spec = specOf(t), h = houseOf(t), rb = restNow();
  const rate = H.billetRate(spec, rb.quality, H.RES_PER_HOUR).perHour;
  let s = '🛏 ' + h.billets.length + ' / ' + spec.capacity + ' resting · ' +
    H.distinctRooms(h).size + ' / ' + spec.rooms + ' rooms<br>' +
    '✨ ' + rate.toFixed(1) + ' Resonance/hr each <span class="' + (rb.quality < 0.99 ? '' : 'hl') + '">(rest ×' + rb.quality.toFixed(2) + ')</span><br>';
  if (rb.worst) s += '<span class="dmg">' + rb.worst.ico + ' ' + rb.worst.label + ' ' +
    Math.round(rb.worst.val * 100) + '% — costing ' + (rb.worst.lost * H.RES_PER_HOUR * spec.rate).toFixed(1) + ' Resonance/hr</span><br>';
  return s;
}

/* ══ THE DIALOG ══════════════════════════════════════════════════════════
   Its own overlay rather than a fourth dossier tab: billeting is a list of
   six rooms with a card picker inside each, which does not fit the dossier's
   two-column pane and would push the round-7 layout past the fold at 1280.
   z-index 46 — above #cardpicker (45), which it opens, and above the dossier
   (44), which opens it. Same rule the r7 comment at index.html:146 sets out. */
const CSS = `
#housemod{position:absolute;inset:0;background:rgba(8,6,12,.78);z-index:46;display:flex;
  align-items:center;justify-content:center;backdrop-filter:blur(3px);}
#housemod .hmbox{width:min(560px,94vw);max-height:86vh;overflow-y:auto;background:var(--panel-solid);
  border:1px solid var(--edge);border-radius:12px;padding:16px 18px;}
#housemod h3{font-size:14px;color:var(--gold);margin:0 0 2px;letter-spacing:.06em;}
#housemod .hmsub{font-size:10.5px;color:var(--mist);margin-bottom:10px;}
#housemod .hmq{border:1px solid var(--edge);border-radius:9px;padding:9px 11px;margin-bottom:10px;background:#12101f;}
#housemod .hmq .qtop{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}
#housemod .hmq .qval{font-size:19px;color:var(--gold);font-variant-numeric:tabular-nums;}
#housemod .hmq .qval.low{color:#e07a5f;}
#housemod .hmq .qlab{font-size:10px;letter-spacing:.09em;color:var(--mist);text-transform:uppercase;}
#housemod .qbar{height:6px;border-radius:3px;background:#221c33;margin:7px 0 8px;overflow:hidden;}
#housemod .qbar i{display:block;height:100%;background:linear-gradient(90deg,#8c5a2b,#d4af37);}
#housemod .qrow{display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:var(--bone);}
#housemod .qrow .qn{color:var(--mist);}
#housemod .qrow .qg{font-variant-numeric:tabular-nums;}
#housemod .qrow.bad .qg{color:#e07a5f;}
#housemod .qfix{font-size:11px;color:#e07a5f;margin-top:6px;line-height:1.35;}
#housemod .hmstat{display:flex;gap:14px;font-size:11px;color:var(--mist);margin-bottom:10px;flex-wrap:wrap;}
#housemod .hmstat b{color:var(--bone);font-variant-numeric:tabular-nums;}
#housemod .room{border:1px solid var(--edge);border-radius:9px;padding:8px 10px;margin-bottom:7px;}
#housemod .room.locked{opacity:.45;}
#housemod .rhead{display:flex;justify-content:space-between;align-items:center;gap:8px;}
#housemod .rname{font-size:12.5px;color:var(--bone);}
#housemod .rstat{font-size:10px;color:var(--gold);letter-spacing:.08em;}
#housemod .rflav{font-size:10px;color:var(--mist);margin-top:1px;}
#housemod .bed{display:flex;justify-content:space-between;align-items:center;gap:8px;
  font-size:11.5px;padding:4px 0 3px;border-top:1px solid rgba(255,255,255,.06);margin-top:5px;}
#housemod .bed .bn{color:var(--bone);}
#housemod .bed .bp{color:var(--gold);font-variant-numeric:tabular-nums;font-size:11px;}
#housemod .bed .bcap{color:#e07a5f;font-size:10px;}
#housemod .hbtn2{background:#1a1530;border:1px solid var(--edge);border-radius:6px;color:var(--bone);
  font-size:10.5px;padding:3px 8px;cursor:pointer;}
#housemod .hbtn2:hover:not(:disabled){border-color:var(--gold);}
#housemod .hbtn2:disabled{opacity:.4;cursor:default;}
#housemod .hmfoot{display:flex;gap:8px;margin-top:12px;}
#housemod .hmfoot .pbtn{margin-top:0;flex:1;}
#housemod .hmnote{font-size:10.5px;color:var(--mist);margin-top:8px;line-height:1.4;}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  try { const s = document.createElement('style'); s.id = 'house-css'; s.textContent = CSS; document.head.appendChild(s); } catch (e) {}
}

function tierName(n) { return ['Bunkhouse', 'Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'][n] || ('Tier ' + n); }

function roomsHtml(k, t) {
  const spec = specOf(t), h = houseOf(t), rb = restNow();
  const used = H.distinctRooms(h);
  const perHr = H.billetRate(spec, rb.quality, H.RES_PER_HOUR).perHour;
  const M = model();
  return H.ROOMS.map(r => {
    const beds = h.billets.filter(b => b.room === r.id);
    const roomLocked = !beds.length && used.size >= spec.rooms;
    const full = h.billets.length >= spec.capacity;
    const why = H.billetBlock(h, spec, r.id);
    return '<div class="room' + (roomLocked ? ' locked' : '') + '">' +
      '<div class="rhead"><div><span class="rname">' + r.ico + ' ' + esc(r.name) + '</span> ' +
        '<span class="rstat">→ ' + r.stat.toUpperCase() + '</span>' +
        '<div class="rflav">' + esc(r.flavour) + '</div></div>' +
        '<button class="hbtn2" data-hact="billet" data-room="' + r.id + '"' + (why ? ' disabled title="' + esc(why) + '"' : '') + '>+ Billet</button>' +
      '</div>' +
      beds.map(b => {
        const c = (CTX.cardById && CTX.cardById(b.card)) || null;
        const spread = H.spreadOf(ctxForCore(), b.card);
        const have = spread ? (+spread[r.stat] || 0) : null;
        return '<div class="bed"><span class="bn">🃏 ' + esc(c ? c.name : b.card) +
          (have != null ? ' <span class="rstat">' + r.stat.toUpperCase() + ' ' + have + '</span>' : '') + '</span>' +
          '<span><span class="bp">+' + Math.floor(b.pend || 0) + ' ✨</span>' +
          (b.capped ? ' <span class="bcap">36h CAP</span>' : '') +
          ' <button class="hbtn2" data-hact="wake" data-card="' + esc(b.card) + '">Wake</button></span></div>';
      }).join('') +
      (beds.length ? '' : (full ? '' : '')) +
      '</div>';
  }).join('') + (spec.reflection ? reflectionHtml(t) : '');
}

function reflectionHtml(t) {
  const h = houseOf(t);
  return '<div class="room"><div class="rhead"><div>' +
    '<span class="rname">' + REFL.ico + ' ' + REFL.name + '</span> <span class="rstat">FREE RESET</span>' +
    '<div class="rflav">' + esc(REFL.flavour) + ' Wipes a spread so it can be rebuilt — it costs nothing, on purpose.</div>' +
    '</div></div>' +
    (h.billets.length
      ? h.billets.map(b => {
          const c = (CTX.cardById && CTX.cardById(b.card)) || null;
          return '<div class="bed"><span class="bn">🃏 ' + esc(c ? c.name : b.card) + '</span>' +
            '<button class="hbtn2" data-hact="reflect" data-card="' + esc(b.card) + '">🪞 Reset spread</button></div>';
        }).join('')
      : '<div class="bed"><span class="bn" style="color:var(--mist)">Billet a card to reset it.</span></div>') +
    '</div>';
}
const REFL = H.REFLECTION_HALL;

function qualityHtml() {
  const rb = restNow();
  const pct = (rb.quality - rb.floor) / (rb.max - rb.floor);
  return '<div class="hmq">' +
    '<div class="qtop"><span class="qlab">⭐ Rest quality — how well this city sleeps</span>' +
      '<span class="qval' + (rb.quality < 0.8 ? ' low' : '') + '">×' + rb.quality.toFixed(2) + '</span></div>' +
    '<div class="qbar"><i style="width:' + Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%"></i></div>' +
    '<div class="qrow"><span class="qn">Floor — every House gets this</span><span class="qg">+' + rb.floor.toFixed(2) + '</span></div>' +
    rb.rows.map(r => '<div class="qrow' + (r.lost > 0.02 ? ' bad' : '') + '">' +
      '<span class="qn">' + r.ico + ' ' + esc(r.label) + ' <b>' + Math.round(r.val * 100) + '%</b> × ' + r.w.toFixed(2) + '</span>' +
      '<span class="qg">+' + r.gain.toFixed(3) + (r.lost > 0.02 ? '  <span style="opacity:.7">(−' + r.lost.toFixed(3) + ')</span>' : '') + '</span></div>').join('') +
    (rb.worst ? '<div class="qfix">⚠ ' + rb.worst.ico + ' ' + esc(rb.worst.fix) + '</div>' : '') +
    '</div>';
}

function render(k) {
  const t = CTX.game.tiles[k];
  const box = document.getElementById('housemod');
  if (!t || t.type !== HOUSE_TYPE) { if (box) box.remove(); OPEN_KEY = null; return; }
  const spec = specOf(t), h = houseOf(t), rb = restNow();
  const M = model();
  const cd = H.collectReadyIn(h, CTX.collectCdMs);
  const pend = h.billets.reduce((s, b) => s + Math.floor(b.pend || 0), 0);
  const perHr = H.billetRate(spec, rb.quality, H.RES_PER_HOUR).perHour;
  const html =
    '<div class="hmbox">' +
      '<h3>🛏 RESTING HOUSE — ' + tierName(spec.tier) + '</h3>' +
      '<div class="hmsub">Cards rest here and accrue Resonance into the room\'s stat. ' +
        'Tier buys <b>beds and speed</b> — never a higher ceiling.</div>' +
      qualityHtml() +
      '<div class="hmstat">' +
        '<span>🛏 Beds <b>' + h.billets.length + ' / ' + spec.capacity + '</b></span>' +
        '<span>🚪 Rooms at once <b>' + H.distinctRooms(h).size + ' / ' + spec.rooms + '</b></span>' +
        '<span>✨ Rate <b>' + perHr.toFixed(1) + '/hr</b> <span style="opacity:.7">(' + H.RES_PER_HOUR +
          ' × ' + spec.rate.toFixed(2) + ' tier × ' + rb.quality.toFixed(2) + ' rest)</span></span>' +
        '<span>⏳ Cap <b>' + CTX.accrualCapH + 'h</b></span>' +
      '</div>' +
      roomsHtml(k, t) +
      '<div class="hmfoot">' +
        '<button class="pbtn" id="hm-collect"' + ((pend <= 0 || cd > 0 || !M) ? ' disabled' : '') + '>' +
          (!M ? '✨ Resonance model not loaded'
              : cd > 0 ? '✨ Collect in ' + H.fmtLeft(cd)
              : pend <= 0 ? (h.billets.length ? '✨ Nothing banked yet — they have just turned in' : '✨ Nobody is resting here')
              : '✨ Collect ' + pend + ' Resonance') + '</button>' +
        '<button class="pbtn" id="hm-close">Close</button>' +
      '</div>' +
      '<div class="hmnote">Collection every ' + Math.round((CTX.collectCdMs || 0) / 3600000) + 'h · unattended accrual caps at ' +
        CTX.accrualCapH + 'h — the same idle clock the game\'s operations run on.' +
        (M ? '' : ' <b>Resonance is accruing and is not lost</b>; it banks the moment the card model is present.') +
      '</div>' +
    '</div>';
  if (box) { box.innerHTML = html; return; }
  const el = document.createElement('div');
  el.id = 'housemod'; el.innerHTML = html;
  (document.getElementById('wrap') || document.body).appendChild(el);
  el.addEventListener('click', onClick);
}

async function onClick(ev) {
  const k = OPEN_KEY; if (!k || !CTX) return;
  const t = CTX.game.tiles[k]; if (!t) return;
  const box = document.getElementById('housemod');
  if (ev.target === box || ev.target.id === 'hm-close') { close(); return; }
  const h = houseOf(t), spec = specOf(t);
  const btn = ev.target.closest('[data-hact]');
  if (btn) {
    const act = btn.dataset.hact;
    if (act === 'billet') {
      const roomId = btn.dataset.room;
      const why = H.billetBlock(h, spec, roomId);
      if (why) { CTX.toast(why, 'bad'); return; }
      const room = H.roomById(roomId);
      /* 🛏 UNITS ONLY. This read `c.type !== 'Structure'`, which offered the
         player Heroes, Kalons, Spells, Equipment, Artifacts and Relics as well
         — everything in the collection bar one type. A House trains a fighter's
         stat line (ATK/MAG/DEF/RES/SPD/HP); a Spell has no stat line to raise
         and an Artifact is not something that sleeps, so those were offers the
         room could never honour.
         ⚠ The list is already restricted to cards the player OWNS and has not
           assigned elsewhere — openCardPicker draws from freeCards(), which is
           CARDS minus assignedCardIds(). This filter narrows the TYPE and
           nothing else; ownership was never the missing half. */
      CTX.openCardPicker('Billet a unit in the ' + room.name + ' → ' + room.stat.toUpperCase(),
        c => c.type === 'Unit',
        (c) => {
          const err = H.billet(h, c.id, roomId, spec);
          if (err) { CTX.toast(err, 'bad'); return; }
          try { CTX.assignCard(c.id, true); } catch (e) {}
          CTX.toast('🛏 ' + c.name + ' bedded down in the ' + room.name + ' — training ' + room.stat.toUpperCase() + '.', 'good');
          CTX.saveSoon(); render(k);
        },
        // Says what was actually looked at. "No unassigned cards" would be a
        // statement about the whole collection from a dialog that only read one
        // type of it — see openCardPicker's note on the default.
        'No free units. Every unit you own is already billeted, socketed or in a deck.');
      return;
    }
    if (act === 'wake') {
      const b = H.unbillet(h, btn.dataset.card);
      if (b) {
        try { CTX.assignCard(b.card, false); } catch (e) {}
        const lost = Math.floor(b.pend || 0);
        CTX.toast('🛏 Woken and returned to your collection.' +
          (lost > 0 ? ' ⚠ ' + lost + ' uncollected Resonance was left behind — collect before waking.' : ''),
          lost > 0 ? 'bad' : 'good');
        CTX.saveSoon(); render(k);
      }
      return;
    }
    if (act === 'reflect') {
      if (!H.canReflect(spec)) { CTX.toast('The Reflection Hall opens at Tier 4.', 'bad'); return; }
      const id = btn.dataset.card;
      const c = (CTX.cardById && CTX.cardById(id)) || { id, name: id };
      const ok = CTX.confirm ? await CTX.confirm('🪞 Reset ' + (c.name || id) + '\'s entire Resonance spread? It costs nothing and can be re-trained.') : true;
      if (!ok) return;
      const err = H.reflect(ctxForCore(), id);
      CTX.toast(err === 'nomodel' ? '🪞 The Resonance model is not loaded — nothing to reset yet.'
              : err ? '🪞 Reset failed.'
              : '🪞 ' + (c.name || id) + '\'s spread is wiped clean. Train it into something else.',
              err ? 'bad' : 'good');
      CTX.saveSoon(); render(k);
      return;
    }
  }
  if (ev.target.id === 'hm-collect') {
    const res = H.collect(h, ctxForCore());
    if (!res.ok) {
      CTX.toast(res.reason === 'cooldown' ? '✨ The House settles every ' + Math.round((CTX.collectCdMs || 0) / 3600000) + 'h — ' + H.fmtLeft(res.cdLeft) + ' to go.'
              : res.reason === 'nomodel' ? '✨ The Resonance card model is not loaded — nothing to bank into yet.'
              : '✨ Nobody is resting here.', 'bad');
      return;
    }
    let msg = '✨ Banked ' + res.granted + ' Resonance across ' + res.rows.length + ' card' + (res.rows.length === 1 ? '' : 's') + '.';
    /* 🔴 THE CEILING, MADE VISIBLE. When the model refuses Resonance because a
       card is full, say so in the same breath. A Tier 4 House that silently
       swallowed the surplus would look identical to one that raised the cap. */
    if (res.wasted > 0) {
      const full = res.rows.filter(r => r.wasted > 0).map(r => r.name);
      msg += ' ' + res.wasted + ' had nowhere to go — ' + full.join(', ') + ' ' + (full.length === 1 ? 'is' : 'are') +
             ' at the Resonance ceiling. No House, at any tier, can lift it.';
    }
    CTX.toast(msg, 'good');
    CTX.saveSoon(); render(k);
  }
}

export function close() {
  const box = document.getElementById('housemod'); if (box) box.remove();
  OPEN_KEY = null;
}
export function open(k) {
  if (!CTX) return;
  const t = CTX.game.tiles[k]; if (!t || t.type !== HOUSE_TYPE) return;
  ensureCss(); OPEN_KEY = k; render(k);
}
export function refresh() { if (OPEN_KEY) render(OPEN_KEY); }

/* ── mount ─────────────────────────────────────────────────────────────
   index.html calls this ONCE from boot() with a hand-built ctx. Everything
   the module can see of the legacy page is in that object; see the globals
   trap note at the top of this file. */
export function mount(ctx) {
  CTX = ctx || {};
  ensureCss();
  const warn = H.assertIdleContract(CTX);
  if (warn) try { console.warn('[House]', warn); } catch (e) {}
  const api = {
    core: H, tick, settleOffline, awaySummary, billetedIds, saveTile, loadTile, onDemolish,
    tipLine, open, close, refresh, restNow, restInputs, houseOf,
    specOf, HOUSE_TYPE, TIERS: H.TIERS, ROOMS: H.ROOMS,
    // 🔬 test seam — the driver needs to move the clock without waiting 36h.
    _ctx: () => CTX, _core: () => ctxForCore(), _isSite: isSite,
  };
  try { window.MythicHouse = api; } catch (e) {}
  return api;
}
