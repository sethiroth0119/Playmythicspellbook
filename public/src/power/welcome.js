/* ════════════════════════════════════════════════════════════════════════════
   🗼 THE HIGHWAY CONNECTION NOTICE — telling the player the pole is there.
   ----------------------------------------------------------------------------
   THE GAP THIS FILLS, AND ONLY THIS. Almost everything the brief asks for
   already ships in lines.js: the Grid Connector stands on the north-west verge
   by the highway from the first frame, costs nothing, is never gated out of the
   scene, injects unconditionally (`seeds: true`), and is a conductor whether or
   not a cable ever reaches it. It is also STRUCTURALLY undeletable — it is not
   a `game.tiles` entry and it is not a member of the removable `cells` set;
   `conductors()` re-adds its cell on every call. There is no code path, player
   action or save round-trip that can remove it, which is a stronger guarantee
   than "protected against deletion".

   What was missing was that NOBODY IS TOLD. The only text describing the
   connector lives in the power-line tool's own hint bar, which appears once the
   tool is already armed — so the explanation is behind the action it exists to
   explain. A player who never presses 🗼 Lines never learns that their city is
   connected to anything.

   ⚠ ONE-TIME, AND KEYED PER PLAYER. Shown on the first entry to a city and
     never again; the flag is namespaced by the same owner id the city save uses
     so two accounts on one browser do not eat each other's first run. Same
     mechanism and storage discipline as node-city's own `nc_ctrlhint_seen`.

   ⚠ IT NEVER BLOCKS. The notice is a corner card, not a modal: a player who
     wants to build immediately is not made to dismiss anything, and a failure
     anywhere in here cannot stop the city loading — every entry point is
     wrapped and the whole module is optional by construction.

   ── THE GLOBALS TRAP ────────────────────────────────────────────────────────
   `game`, `scene`, `toast`, `mode` are top-level bindings in node-city's module
   script and invisible here. This file reads NOTHING from the host: it takes
   what it needs through the same `ctx` hand-over lines.js uses, and every use
   is optional-chained so an older host that hands over less still boots.
   ════════════════════════════════════════════════════════════════════════════ */

const KEY_BASE = 'nc_power_intro_v1';

let shown = false;
let el = null;

function keyFor(ctx) {
  let who = null;
  try { who = (ctx && typeof ctx.ownerId === 'function') ? ctx.ownerId() : null; } catch (e) {}
  if (!who) {
    /* The city save's own namespacing, reused rather than reinvented — see
       MythicCityBridge.localKey(). An unknown owner falls back to the bare key,
       which is the same answer the save takes in the same situation. */
    try {
      const b = (typeof window !== 'undefined') && window.MythicCityBridge;
      if (b && typeof b.localKey === 'function') {
        const k = String(b.localKey() || '');
        const i = k.indexOf(':');
        if (i > 0) who = k.slice(i + 1);
      }
    } catch (e) {}
  }
  return who ? (KEY_BASE + ':' + who) : KEY_BASE;
}

function seen(ctx) {
  try { return localStorage.getItem(keyFor(ctx)) === '1'; } catch (e) { return false; }
}
function markSeen(ctx) {
  try { localStorage.setItem(keyFor(ctx), '1'); } catch (e) {}
}

export function dismiss() {
  try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
  el = null;
}

/* Rendered into the host document so it sits with the rest of node-city's HUD
   and inherits its font. Styles are inline and scoped to this node — a
   stylesheet would be a second thing to keep in step with the HUD's palette. */
function build(doc, onBuildLine) {
  const card = doc.createElement('div');
  card.id = 'npw-intro';
  card.setAttribute('style', [
    'position:fixed', 'left:14px', 'bottom:96px', 'z-index:60',
    'max-width:min(340px,86vw)', 'padding:13px 15px',
    'background:linear-gradient(180deg,rgba(26,20,8,.97),rgba(12,9,4,.98))',
    'border:1px solid rgba(212,175,55,.55)', 'border-radius:6px',
    'box-shadow:0 14px 40px rgba(0,0,0,.7)', 'color:#e8e0d0',
    'font-family:inherit', 'font-size:13px', 'line-height:1.45',
  ].join(';'));
  card.innerHTML =
      '<div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">'
    +   '<span style="font-size:17px">🗼</span>'
    +   '<b style="color:#ffcf5a;letter-spacing:.06em">HIGHWAY CONNECTION</b>'
    + '</div>'
    + '<div style="color:#7CFFB2;font-weight:700;font-size:12px;margin-bottom:6px">'
    +   'Starter Power Pole — FREE</div>'
    + '<div style="color:#cdc0a4">Your settlement is connected to the regional electrical grid. '
    +   'Drag power lines from the pole on the north-west verge to generators, turbines, '
    +   'substations and other electrical buildings to start your network.</div>'
    + '<div style="display:flex;gap:7px;margin-top:10px">'
    +   '<button type="button" data-npw="build" style="flex:1;cursor:pointer;border-radius:4px;'
    +     'padding:.42rem .7rem;border:1px solid #d4af37;color:#1a1206;font-weight:800;'
    +     'font-family:inherit;background:linear-gradient(180deg,#caa23e,#7a5a18)">Build Power Line</button>'
    +   '<button type="button" data-npw="close" style="cursor:pointer;border-radius:4px;'
    +     'padding:.42rem .7rem;border:1px solid rgba(212,175,55,.4);color:#e8e0d0;'
    +     'font-family:inherit;background:rgba(60,50,20,.35)">Later</button>'
    + '</div>';
  card.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('[data-npw]') : null;
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const what = b.getAttribute('data-npw');
    dismiss();
    if (what === 'build') { try { onBuildLine && onBuildLine(); } catch (e) {} }
  });
  return card;
}

/* Call once per city entry. Returns true if the notice was actually put up. */
export function maybeShow(ctx, onBuildLine) {
  try {
    if (shown) return false;
    const doc = (ctx && ctx.doc) || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return false;
    if (seen(ctx)) return false;
    shown = true;
    markSeen(ctx);
    el = build(doc, onBuildLine);
    doc.body.appendChild(el);
    return true;
  } catch (e) { return false; }
}

/* Test seam. The driver must be able to ask "would a first-time player see
   this?" without clearing a real player's storage by hand, and to re-run the
   first-entry case more than once in a session. */
export function _reset(ctx) {
  shown = false;
  dismiss();
  try { localStorage.removeItem(keyFor(ctx)); } catch (e) {}
}
export function _seen(ctx) { return seen(ctx); }
