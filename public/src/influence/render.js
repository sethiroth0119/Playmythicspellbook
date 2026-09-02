/* ============================================================================
   🎖 INFLUENCE — every pixel of the envoy modal.
   ============================================================================
   Owns markup and styles, owns NO state and moves NO property. index.js hands
   it a view object and a handler bag; it hands back a mounted DOM node. That
   is the whole contract, and it is what lets the payout logic be tested with
   no browser at all.

   🔴 IT INJECTS ITS OWN CSS. Reusing index.html's `.modal-backdrop` /
   `.unit-modal` would look right today and break silently the day those
   classes are retuned for something else — a module that lives outside
   index.html cannot depend on index.html's private class names. The palette
   below deliberately MATCHES the game's (Cinzel headings, #d4af37 gold, the
   dark plate) so it reads as the same product; it just does not borrow the
   selectors.
   ============================================================================ */

import { NO_SPACE_LINE } from './envoys.js';
import { formatEta } from './model.js';

const STYLE_ID = 'mif-styles';
const ROOT_ID = 'mif-backdrop';

/* Fallback only. The live palette comes through the bridge (`rarityMeta`) so
   there is exactly one definition of what "epic purple" is — these values are
   what the modal falls back to if the bridge is absent, and they are copied
   from RARITIES in index.html. */
const RARITY_FALLBACK = {
  common: { name: 'Common', color: '#9aa0a6' }, uncommon: { name: 'Uncommon', color: '#5eb37a' },
  rare: { name: 'Rare', color: '#5a9bd4' }, epic: { name: 'Epic', color: '#a070d9' },
  legendary: { name: 'Legendary', color: '#d4af37' }, mythic: { name: 'Mythic', color: '#e85d3c' },
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function n(v) { return (Math.max(0, v | 0)).toLocaleString(); }

export function injectStyles() {
  try {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
#${ROOT_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  padding:1rem;background:rgba(4,6,12,0.82);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.mif-card{width:min(560px,100%);max-height:92vh;overflow:auto;background:linear-gradient(160deg,#141a26,#0b0e16);
  border:1px solid rgba(212,175,55,0.45);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,0.75);
  color:#e8dcc4;font-size:0.92rem;line-height:1.5}
.mif-head{display:flex;align-items:flex-start;gap:0.7rem;padding:0.9rem 1rem 0.7rem;border-bottom:1px solid rgba(212,175,55,0.22)}
.mif-title{flex:1;min-width:0}
.mif-title h3{margin:0;font-family:'Cinzel',serif;color:#e6b455;font-size:1.05rem;letter-spacing:0.08em;text-transform:uppercase}
.mif-sub{color:#8fa0b8;font-size:0.78rem;margin-top:2px}
.mif-x{flex:none;background:none;border:1px solid rgba(255,255,255,0.16);color:#9fb4d8;border-radius:6px;
  width:28px;height:28px;line-height:1;cursor:pointer;font-size:1rem}
.mif-x:hover{border-color:#e6b455;color:#e6b455}
.mif-meters{display:flex;flex-wrap:wrap;gap:0.5rem;padding:0.7rem 1rem;border-bottom:1px solid rgba(255,255,255,0.07)}
.mif-meter{flex:1 1 130px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:7px;padding:0.4rem 0.55rem}
.mif-meter b{display:block;color:#cbd5e8;font-size:0.86rem;font-weight:700}
.mif-meter span{display:block;color:#8fa0b8;font-size:0.7rem;letter-spacing:0.05em;text-transform:uppercase}
.mif-bar{height:6px;border-radius:3px;background:#1a2230;overflow:hidden;margin-top:0.45rem}
.mif-bar>i{display:block;height:100%;background:linear-gradient(90deg,#d4af37,#ffe08a)}
.mif-body{padding:0.95rem 1rem}
.mif-envoy{display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.85rem}
.mif-face{flex:none;width:56px;height:56px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  font-size:1.7rem;background:radial-gradient(circle at 40% 30%,#2b3546,#141a26);border:1px solid rgba(255,255,255,0.14)}
.mif-who b{color:#e8dcc4;font-size:0.95rem}
.mif-who i{display:block;color:#8fa0b8;font-style:normal;font-size:0.76rem;letter-spacing:0.05em;text-transform:uppercase}
.mif-say{margin:0.55rem 0 0;padding:0.55rem 0.75rem;border-left:3px solid #d4af37;background:rgba(212,175,55,0.07);
  color:#e0d6bd;font-style:italic;border-radius:0 6px 6px 0}
.mif-say.mif-refused{border-left-color:#e0556a;background:rgba(224,85,106,0.09);color:#ffc6cf;font-style:normal;font-weight:600}
.mif-offer{border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.75rem;background:rgba(255,255,255,0.03)}
.mif-prize{display:flex;align-items:center;gap:0.6rem}
.mif-art{flex:none;width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.16);background:#0b0e16}
.mif-glyph{flex:none;width:64px;height:64px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-size:2rem;border:1px solid rgba(255,255,255,0.16);background:#0b0e16}
.mif-cinder{font-family:'Cinzel',serif;font-size:1.9rem;color:#ffcf6b;text-shadow:0 0 18px rgba(255,207,107,0.35)}
.mif-pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:0.7rem;letter-spacing:0.06em;
  text-transform:uppercase;border:1px solid currentColor}
.mif-res{display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.55rem}
.mif-res>span{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;
  background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.11)}
.mif-space{margin-top:0.6rem;font-size:0.78rem;color:#8fa0b8}
.mif-space.bad{color:#ff9aa8}
.mif-acts{display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:flex-end;padding:0.85rem 1rem;border-top:1px solid rgba(255,255,255,0.08)}
.mif-btn{padding:0.55rem 1.1rem;border-radius:7px;font-family:inherit;font-size:0.85rem;letter-spacing:0.05em;
  cursor:pointer;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.05);color:#cbd5e8}
.mif-btn:hover{border-color:#9fb4d8;color:#fff}
.mif-btn.gold{border-color:#d4af37;background:linear-gradient(180deg,#d4af37,rgba(0,0,0,0.35));color:#0a0606;font-weight:700}
.mif-btn.green{border-color:#5fae7a;color:#9ad17a}
.mif-btn.green:hover{background:rgba(95,174,122,0.14)}
.mif-btn:disabled{opacity:0.45;cursor:not-allowed}
.mif-foot{padding:0 1rem 0.9rem;color:#6f8099;font-size:0.72rem}
.mif-empty{padding:1.6rem 1rem;text-align:center;color:#8fa0b8}
@media (max-width:520px){.mif-acts{justify-content:stretch}.mif-acts .mif-btn{flex:1 1 auto}}`;
    document.head.appendChild(el);
  } catch (e) {}
}

function rarityOf(view, id) {
  const key = String(id || 'common').toLowerCase();
  try {
    if (view && typeof view.rarityMeta === 'function') {
      const m = view.rarityMeta(key);
      if (m && m.color) return m;
    }
  } catch (e) {}
  return RARITY_FALLBACK[key] || RARITY_FALLBACK.common;
}

function headHtml(view) {
  const lm = view.levelMeta || { icon: '🎖', name: 'Unknown' };
  const p = view.progress || { pct: 0, need: 0, next: null, floored: false };
  const pctBadge = Math.round((view.standing || 0) * 100);
  const waiting = view.ready | 0;
  return '' +
    '<div class="mif-head">' +
      '<div class="mif-title">' +
        '<h3>' + esc(lm.icon) + ' Influence — ' + esc(lm.name) + '</h3>' +
        '<div class="mif-sub">Level ' + (view.level | 0) + ' · standing ' + pctBadge + '%' +
          (waiting > 1 ? ' · ' + waiting + ' envoys waiting' : '') + '</div>' +
      '</div>' +
      '<button class="mif-x" id="mif-x" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="mif-meters">' +
      '<div class="mif-meter"><span>Node</span><b>' + esc((view.nodeTier && view.nodeTier.name) || 'Free') + '</b>' +
        '<div class="mif-bar"><i style="width:' + Math.round((view.parts.node || 0) * 100) + '%"></i></div></div>' +
      '<div class="mif-meter"><span>Reserve rep</span><b>' + esc((view.repRank && view.repRank.icon) || '🎒') + ' ' + n(view.repPoints) + '</b>' +
        '<div class="mif-bar"><i style="width:' + Math.round((view.parts.rep || 0) * 100) + '%"></i></div></div>' +
      '<div class="mif-meter"><span>' + (p.next ? 'To ' + esc(p.next.name) : 'Ladder') + '</span>' +
        '<b>' + (p.next ? n(p.need) + ' XP' : 'Maxed') + '</b>' +
        '<div class="mif-bar"><i style="width:' + (p.next ? p.pct : 100) + '%"></i></div></div>' +
    '</div>';
}

function cardArtHtml(view, card) {
  let art = null;
  try { if (view && typeof view.cardArt === 'function') art = view.cardArt(card.id); } catch (e) {}
  if (art) return '<img class="mif-art" src="' + esc(art) + '" alt="">';
  const glyph = (card && (card.icon || card.emoji)) || '🃏';
  return '<div class="mif-glyph">' + esc(glyph) + '</div>';
}

function cardBlockHtml(view, card, kind) {
  const r = rarityOf(view, card.rarity);
  const stats = card.stats || null;
  const line = stats
    ? ['❤ ' + (stats.hp | 0), '⚔ ' + (stats.atk | 0), '🛡 ' + (stats.def | 0), '⚡ ' + (stats.spd | 0)].join('  ')
    : (card.text ? String(card.text).slice(0, 120) : '');
  return '' +
    '<div class="mif-prize">' + cardArtHtml(view, card) +
      '<div style="min-width:0">' +
        '<div style="font-weight:700;color:#e8dcc4">' + esc(card.name || 'Unnamed card') + '</div>' +
        '<div style="margin:3px 0 4px"><span class="mif-pill" style="color:' + esc(r.color) + '">' + esc(r.name) + '</span> ' +
          '<span style="color:#8fa0b8;font-size:0.76rem;text-transform:capitalize">' + esc(kind || card.type || 'card') + '</span>' +
          (card.cost != null ? ' <span style="color:#8fa0b8;font-size:0.76rem">· cost ' + (card.cost | 0) + '</span>' : '') + '</div>' +
        (line ? '<div style="color:#9fb4d8;font-size:0.78rem">' + esc(line) + '</div>' : '') +
      '</div>' +
    '</div>';
}

function offerHtml(view) {
  const enc = view.enc;
  if (!enc) return '';
  /* 📬 The envoy arrived with a card this client cannot show — an empty card
     catalogue (Forge.useCustomOnlyPool with nothing published, or the catalog
     fetch has not landed). They are NOT spent: the server still holds them, and
     this panel exists so the player is told that instead of being shown an
     empty gate while an envoy quietly vanished. */
  if (enc.kind === 'unavailable') {
    return '<div class="mif-offer">' +
      '<div class="mif-prize"><div class="mif-glyph">' + (enc.srvKind === 'recruit' ? '🧍' : '🃏') + '</div>' +
        '<div><div style="font-weight:700;color:#e8dcc4">' +
          (enc.srvKind === 'recruit' ? 'A survivor wants to join' : 'A card was set aside for you') +
          (enc.rarity ? ' <span class="mif-pill" style="color:' + esc(rarityOf(view, enc.rarity).color) + '">' + esc(rarityOf(view, enc.rarity).name) + '</span>' : '') +
        '</div>' +
        '<div style="color:#9fb4d8;font-size:0.78rem;margin-top:4px">Your card catalogue is empty on this device, so there is nothing to hand you yet. Sign in, or wait for the catalogue to load, and they will still be here.</div>' +
        '</div></div>' +
      '<div class="mif-space">⏳ They stay at the gate until you can receive them — closing this does not send them away.</div>' +
    '</div>';
  }
  if (enc.kind === 'cinder') {
    return '<div class="mif-offer"><div class="mif-prize">' +
      '<div class="mif-glyph">🔥</div>' +
      '<div><div class="mif-cinder">' + n(enc.cinder) + '</div>' +
      '<div style="color:#8fa0b8;font-size:0.78rem">Cinder · Level ' + (enc.level | 0) + ' pays ' +
        n(enc.band && enc.band.lo) + '–' + n(enc.band && enc.band.hi) + '</div></div>' +
      '</div></div>';
  }
  if (enc.kind === 'gift') {
    return '<div class="mif-offer">' + cardBlockHtml(view, enc.card, enc.cardKind) + '</div>';
  }
  if (enc.kind === 'recruit') {
    /* The price shown is the one that will actually be PAID — already clamped
       to the server's per-rarity ceiling. Showing the raw DVS figure and then
       paying a fraction of it would read as the game short-changing you, so
       when the clamp bites we say so instead of hiding it. */
    const capped = enc.valueRaw != null && (enc.valueRaw | 0) > (enc.value | 0);
    return '<div class="mif-offer">' + cardBlockHtml(view, enc.card, 'unit') +
      '<div class="mif-space">💰 Sells for <strong style="color:#ffcf6b">' + n(enc.value) + ' 🔥</strong>' +
      (capped ? ' <span title="Market says ' + n(enc.valueRaw) + ', but a ' + esc(enc.rarity) +
                ' recruit is capped at ' + n(enc.saleCap) + '">(market ' + n(enc.valueRaw) + ', capped)</span>' : '') +
      (enc.owned ? ' · you already hold ' + (enc.owned | 0) : '') + '</div></div>';
  }
  // supply
  const bad = !(enc.space && enc.space.enough);
  const free = (enc.space && enc.space.free === Infinity) ? '∞' : n(enc.space && enc.space.free);
  return '<div class="mif-offer">' +
    '<div class="mif-res">' + (enc.grants || []).map((g) =>
      '<span>' + esc(g.icon) + ' <strong>' + n(g.qty) + '</strong> ' + esc(g.name) + '</span>').join('') + '</div>' +
    '<div class="mif-space' + (bad ? ' bad' : '') + '">📦 ' + n(enc.total) + ' units · stash has ' + free + ' free' +
      (bad ? ' — not enough room' : '') + '</div>' +
  '</div>';
}

function actionsHtml(view) {
  const enc = view.enc;
  const res = view.result;
  // While an RPC is in flight every button is inert. The server is what decides
  // the payout, so a second click before it answers would either double-resolve
  // or resolve against an encounter that is already gone.
  const dis = view.busy ? ' disabled' : '';
  if (res) {
    const more = (view.ready | 0) > 0;
    return '<div class="mif-acts">' +
      (more ? '<button class="mif-btn gold" id="mif-next">Next envoy (' + (view.ready | 0) + ')</button>' : '') +
      '<button class="mif-btn" id="mif-close">Close</button></div>';
  }
  if (!enc) return '<div class="mif-acts"><button class="mif-btn" id="mif-close">Close</button></div>';
  if (enc.kind === 'unavailable') {
    // Leaving is the DEFAULT and the safe one; sending them away is the only
    // action that spends the envoy, so it is the secondary button.
    return '<div class="mif-acts">' +
      '<button class="mif-btn" id="mif-decline"' + dis + '>Send them away</button>' +
      '<button class="mif-btn gold" id="mif-wait">Leave them waiting</button></div>';
  }
  if (enc.kind === 'cinder') {
    return '<div class="mif-acts"><button class="mif-btn gold" id="mif-take"' + dis + '>' + (view.busy ? 'Settling…' : 'Take the tribute') + '</button></div>';
  }
  if (enc.kind === 'gift') {
    return '<div class="mif-acts"><button class="mif-btn gold" id="mif-take"' + dis + '>' + (view.busy ? 'Settling…' : 'Take the card') + '</button></div>';
  }
  if (enc.kind === 'recruit') {
    return '<div class="mif-acts">' +
      '<button class="mif-btn" id="mif-decline"' + dis + '>Turn them away</button>' +
      '<button class="mif-btn" id="mif-sell"' + dis + '>Sell for ' + n(enc.value) + ' 🔥</button>' +
      '<button class="mif-btn green" id="mif-accept"' + dis + '>Accept — join camp</button></div>';
  }
  // 📦 The accept button stays ENABLED on a full stash. Disabling it would hide
  //    the refusal behind a greyed-out control; the player is meant to hear the
  //    envoy say it, which is the whole point of the specified line.
  return '<div class="mif-acts">' +
    '<button class="mif-btn" id="mif-decline"' + dis + '>Wave them off</button>' +
    '<button class="mif-btn gold" id="mif-take"' + dis + '>' + (view.busy ? 'Settling…' : 'Take the delivery') + '</button></div>';
}

function bodyHtml(view) {
  const enc = view.enc;
  const res = view.result;
  if (!enc) {
    const eta = view.nextMs > 0 ? formatEta(view.nextMs) : '';
    return '<div class="mif-empty">🚪 No one is at the gate.' +
      (eta ? '<div style="margin-top:6px;font-size:0.82rem">Next envoy in about ' + esc(eta) + '.</div>' : '') +
      '<div style="margin-top:10px;font-size:0.78rem;color:#6f8099">Standing draws them in — raise your node tier, your Reserve rep, or your Influence level and they arrive richer.</div></div>';
  }
  const face = enc.kind === 'unavailable' ? '📬'
             : enc.kind === 'supply' ? '🚚' : enc.kind === 'recruit' ? '🧍' : enc.kind === 'gift' ? '📜' : '🪙';
  const say = res && res.dialog ? res.dialog : enc.envoy.line;
  const refused = !!(res && res.refused);
  return '<div class="mif-body">' +
    '<div class="mif-envoy"><div class="mif-face">' + face + '</div>' +
      '<div class="mif-who"><b>' + esc(enc.envoy.name) + '</b><i>' + esc(enc.envoy.title) + '</i>' +
      '<p class="mif-say' + (refused ? ' mif-refused' : '') + '">' + esc(say) + '</p></div></div>' +
    /* The offer stays on screen after resolving, deliberately. On a win it is
       the prize the player just took; on a refused convoy it is exactly what
       they missed and by how much, which is the difference between a refusal
       that reads as information and one that reads as the game eating a
       reward. */
    offerHtml(view) +
    (res && res.toast ? '<div class="mif-space">' + esc(res.toast) + '</div>' : '') +
  '</div>';
}

/* Mount (or re-render in place). Returns nothing; index.js keeps the state. */
export function mount(view, handlers) {
  if (typeof document === 'undefined') return;
  injectStyles();
  handlers = handlers || {};
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => { if (e.target === root && handlers.onClose) handlers.onClose(); });
  }
  root.innerHTML = '<div class="mif-card" role="dialog" aria-modal="true">' +
    headHtml(view) + bodyHtml(view) + actionsHtml(view) +
    '<div class="mif-foot">' + (view.mode === 'local'
      ? '⚠ Offline — envoys can still bring cards and supplies, but Cinder tributes need the Foundation on the line. Sign in to receive them.'
      : 'Envoys arrive at your camp on their own. Rarity follows your node tier, your Influence level and your Foundation Reserve rep.') + '</div>' +
  '</div>';

  const on = (id, fn) => { const el = document.getElementById(id); if (el && fn) el.onclick = fn; };
  on('mif-x', handlers.onClose);
  on('mif-close', handlers.onClose);
  on('mif-take', handlers.onTake);
  on('mif-accept', handlers.onAccept);
  on('mif-sell', handlers.onSell);
  on('mif-decline', handlers.onDecline);
  on('mif-next', handlers.onNext);
  on('mif-wait', handlers.onWait);
}

export function unmount() {
  try { const r = document.getElementById(ROOT_ID); if (r) r.remove(); } catch (e) {}
}

export function isOpen() {
  try { return !!document.getElementById(ROOT_ID); } catch (e) { return false; }
}

/* Re-exported so index.js never has to restate the specified wording. */
export { NO_SPACE_LINE };
