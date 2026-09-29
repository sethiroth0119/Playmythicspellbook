/* mapforge.pill.js — the door between a mini-game screen and its Athena world.

   index.html's render() calls sync(App.screen) after every draw. When the
   screen's gameId() has a LIVE world (world_maps.live, sql/092) a small pill
   appears in the corner: "🌍 Enter world" for everyone, and for admins
   "⚒ Edit map" (or "⚒ Build a map" on a screen that has no world yet), which
   opens the editor already tagged with that game. This is how a world is
   connected to a mini-game without touching the mini-game's own code: the
   screen id IS the game key, on both sides.

   ⚠ FREE ON THE COMMON PATH. render() runs off the sprite ticker, so sync()
     compares the screen key and returns; the live index is ONE query
     (select game where live) cached for the session and refreshed by the
     editor when a map goes live or stops being live.
   ⚠ The pill lives outside #app: a re-render cannot destroy it, and it never
     reads the app's DOM. Nothing here touches Profile/Cloud/App — the bridge
     hands over the screen, the admin flag and the game names.
   ⚠ Play mode mounts the LIVE world through the same engine.mount() a game
     would use, in its own full-screen overlay, and disposes it on exit. */

import { mountWorld } from './mapforge.engine.js';
import { gameId } from './mapforge.format.js';
import { liveGames } from './mapforge.api.js';
import { isAdmin, miniGames } from './mapforge.bridge.js';

// Screens where a pill would be in the way of something that must not be
// covered (sign-in, onboarding, a battle in progress, the admin panels).
const QUIET = new Set(['', 'authgate', 'onboarding', 'battle', 'battleimmediate', 'vsscreen', 'matchmaking', 'spectator', 'pricingadmin', 'starterpick', 'usermgmt', 'ultimateadmin', 'forge', 'sprites', 'replayviewer']);

let cur = null;            // gameId of the screen last synced
let liveSet = null;        // Set of game keys that have a live world (null = not loaded yet)
let loading = null;        // in-flight liveGames() promise
let pill = null;           // the pill element
let overlay = null;        // the play overlay element
let mounted = null;        // the engine handle while playing

function label(k) {
  try { const g = miniGames().find(x => gameId(x.key || x.id) === k); return g ? g.name : k; } catch (e) { return k; }
}
function toast(m, ms) {
  try { const b = window.MythicBridge; if (b && b.toast) { b.toast(m, ms); return; } } catch (e) {}
  try { console.log('[athena]', m); } catch (e) {}
}

function ensureCss() {
  if (document.getElementById('athena-pill-css')) return;
  const s = document.createElement('style'); s.id = 'athena-pill-css';
  s.textContent = `
#athena-pill{position:fixed;left:14px;bottom:14px;z-index:9000;display:flex;gap:6px;pointer-events:none}
#athena-pill.off,#athena-pill button.off{display:none!important}
#athena-pill button{pointer-events:auto;font:700 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.04em;color:#1a1206;background:linear-gradient(180deg,#e7c757,#d4af37);border:1px solid #f0d77a;border-radius:20px;padding:9px 13px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.45)}
#athena-pill button.ap-edit{background:linear-gradient(180deg,#2a2f3f,#171b27);color:#e7c757;border-color:rgba(212,175,55,.5)}
#athena-pill button:hover{filter:brightness(1.08)}
#athena-play{position:fixed;inset:0;z-index:10000;background:#05070c}
#athena-play .ap-host{position:absolute;inset:0}
#athena-play .ap-hud{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(180deg,rgba(0,0,0,.55),transparent);color:#e8e2d0;font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none}
#athena-play .ap-hud b{font-family:Cinzel,Georgia,serif;color:#e7c757;letter-spacing:.08em}
#athena-play .ap-hud span{opacity:.8}
#athena-play .ap-hud button{pointer-events:auto;margin-left:auto;font:700 12px/1 system-ui,sans-serif;color:#1a1206;background:linear-gradient(180deg,#e7c757,#d4af37);border:1px solid #f0d77a;border-radius:16px;padding:8px 12px;cursor:pointer}
#athena-play .ap-hud button.ap-x{background:#2a2f3f;color:#e8e2d0;border-color:rgba(255,255,255,.2);margin-left:6px}
#athena-play .ap-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e7c757;font:600 15px system-ui,sans-serif;letter-spacing:.1em}
@media (max-width:600px){#athena-pill{left:8px;bottom:8px}#athena-pill button{padding:8px 10px;font-size:11px}}`;
  document.head.appendChild(s);
}

function make() {
  ensureCss();
  /* ⚠ Visibility is a CLASS, not the `hidden` attribute. index.html styles
     `button` and `div` with their own display values, and any author rule
     beats the UA's [hidden]{display:none} — so a hidden attribute here showed
     both buttons to every player on every screen. */
  pill = document.createElement('div'); pill.id = 'athena-pill'; pill.classList.add('off');
  pill.innerHTML = '<button class="ap-enter" type="button">🌍 Enter world</button><button class="ap-edit" type="button">⚒ Edit map</button>';
  pill.querySelector('.ap-enter').onclick = () => play(cur);
  pill.querySelector('.ap-edit').onclick = () => edit(cur);
  document.body.appendChild(pill);
}

function draw() {
  if (!pill) make();
  const editorOpen = !!document.getElementById('mf-root');
  const has = !!(liveSet && cur && liveSet.has(cur));
  const admin = isAdmin();
  if (!cur || QUIET.has(cur) || editorOpen || overlay || (!has && !admin)) { pill.classList.add('off'); return; }
  pill.classList.remove('off');
  const enter = pill.querySelector('.ap-enter'), ed = pill.querySelector('.ap-edit');
  enter.classList.toggle('off', !has); enter.title = 'Walk the ' + label(cur) + ' world';
  ed.classList.toggle('off', !admin); ed.textContent = has ? '⚒ Edit map' : '⚒ Build a map';
  ed.title = (has ? 'Open the live world for ' : 'Build a world for ') + label(cur) + ' in Athena Engine';
}

/* Reload the live index (one select) and redraw. The editor calls this after
   ★ Set live / Unset live so the pill on that screen updates without a reload. */
export function refreshLive() {
  loading = liveGames().then(r => { liveSet = new Set((r.games || []).map(gameId)); return liveSet; })
    .catch(() => { liveSet = liveSet || new Set(); return liveSet; })
    .finally(() => { loading = null; draw(); });
  return loading;
}

/* Called from render(). Cheap when nothing changed. */
export function sync(screen) {
  const k = gameId(screen || '');
  if (k === cur && liveSet) return;
  cur = k;
  if (!liveSet && !loading) refreshLive(); else draw();
}
export function hide() { if (pill) pill.classList.add('off'); }

/* Admin: open the editor on this game's live world (or a fresh one tagged
   with it). Goes through window.AthenaEngine.open so this file never imports
   the editor — the editor imports refreshLive from here. */
export function edit(k) {
  closePlay();
  hide();   // the editor is full-screen; it calls refreshLive() on close, which redraws
  try { const A = window.AthenaEngine; if (A && A.open) A.open({ game: k || cur }); } catch (e) {}
}

/* Everyone: walk the live world in a full-screen overlay. */
export async function play(k) {
  k = gameId(k || cur); if (!k) return;
  if (overlay) closePlay();
  ensureCss();
  overlay = document.createElement('div'); overlay.id = 'athena-play';
  overlay.innerHTML = '<div class="ap-host"></div><div class="ap-load">LOADING WORLD…</div><div class="ap-hud"><b>' + esc(label(k)) + '</b><span>click to look · WASD to move · Space to jump · Esc to release the mouse</span>' + (isAdmin() ? '<button class="ap-ed" type="button">⚒ Edit map</button>' : '') + '<button class="ap-x" type="button">✕ Exit</button></div>';
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  overlay._restore = () => { document.body.style.overflow = prevOverflow; };
  overlay.querySelector('.ap-x').onclick = () => closePlay();
  const edBtn = overlay.querySelector('.ap-ed'); if (edBtn) edBtn.onclick = () => edit(k);
  const onKey = (e) => { if (e.key === 'Escape' && !document.pointerLockElement) closePlay(); };
  window.addEventListener('keydown', onKey); overlay._onKey = onKey;
  draw();
  try {
    const host = overlay.querySelector('.ap-host');
    const g = await mountWorld(host, {
      game: k, mode: 'fps', markers: false,
      onMissing: () => { toast('No world is live for ' + label(k) + ' yet.', 3200); },
    });
    if (!overlay) { try { g.stop(); } catch (e) {} return; }   // exited while loading
    mounted = g;
    const ld = overlay.querySelector('.ap-load'); if (ld) ld.remove();
  } catch (e) {
    try { console.warn('[athena] play failed', e); } catch (_) {}
    toast('Could not open the world: ' + ((e && e.message) || e), 4000);
    closePlay();
  }
}

export function closePlay() {
  if (mounted) { try { mounted.stop(); } catch (e) {} mounted = null; }
  if (overlay) {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
    try { window.removeEventListener('keydown', overlay._onKey); } catch (e) {}
    try { overlay._restore && overlay._restore(); } catch (e) {}
    overlay.remove(); overlay = null;
  }
  draw();
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
