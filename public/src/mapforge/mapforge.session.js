/* mapforge.session.js — a map ENTERED from a game menu.

   Asked for: "the map can be turned into a button on the game's menu; if it
   is multiplayer it is a player hub where players come and talk through prox
   chat and typed chat; if it is an interaction, what kind — entering a
   building takes the player to a menu, a dialogue pulls a guide from the
   Forge."

   enter(mapId) mounts the map full-screen in first person (mapforge.engine)
   and layers the menu's behaviour on top, read from map.menu:

     mode 'hub'      — everyone who opens the button meets in ONE room:
                       positions ride a Supabase realtime channel
                       (athena:<mapId>, broadcast 'pos' ≤ 4 Hz), each peer is a
                       figure with a name over it, typed chat is a 'chat'
                       broadcast, and proximity VOICE is WebRTC peer-to-peer
                       signalled over the same channel ('rtc'), volume falling
                       off linearly to silence at VOICE_RANGE metres — the same
                       design Camp Heights' voice uses, re-homed here without
                       touching it.
     mode 'interact' — single player. Walking into a Zone marker, or pressing
                       E beside any object that carries an interaction, runs
                       it: open a menu screen / a hub, or play a Forge guide.
                       The map's own default (map.menu.kind/target/guide) is
                       what a Zone without its own interaction does.

   🔴 THE GLOBALS TRAP. Everything from the game arrives through the bridge:
      the Supabase client, the player's id and name, openScreen / openHub /
      playGuide. No bridge ⇒ interactions toast and multiplayer is off; the
      map still walks. Nothing here writes game state. */

import { mountWorld } from './mapforge.engine.js';
import { bridge, supabase, userId, displayName, avatarPick, setAvatarPick } from './mapforge.bridge.js';
import { createAvatar, resolveCharacter, castOf } from './mapforge.avatar.js';
import { PROP_BY_ID } from './mapforge.props.js';

const VOICE_RANGE = 16;        // metres — silent beyond
const POS_HZ = 4;
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let S = null;

export function isActive() { return !!S; }
export function current() { return S; }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(m, ms) { try { const b = bridge(); if (b && b.toast) { b.toast(m, ms || 3200); return; } } catch (e) {} try { console.log('[athena]', m); } catch (e) {} }
function ensureCss() {
  if (document.getElementById('athena-session-css')) return;
  const st = document.createElement('style'); st.id = 'athena-session-css';
  st.textContent = [
    '#athena-session{position:fixed;inset:0;z-index:8900;background:#05060a;color:#e8e2d0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '#athena-session .as-host{position:absolute;inset:0}',
    '#athena-session .as-host canvas{display:block;width:100%;height:100%}',
    '#athena-session .as-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e7c757;letter-spacing:.14em;text-transform:uppercase;font-size:14px;background:#05060a}',
    '#athena-session .as-hud{position:absolute;top:10px;left:10px;right:10px;display:flex;align-items:center;gap:8px;pointer-events:none}',
    '#athena-session .as-hud>*{pointer-events:auto}',
    '#athena-session .as-hud b{background:rgba(11,13,20,.8);border:1px solid rgba(212,175,55,.35);border-radius:6px;padding:6px 10px;color:#ffe9a8;font-size:13px}',
    '#athena-session .as-hud span.h{background:rgba(11,13,20,.7);border:1px solid rgba(212,175,55,.2);border-radius:6px;padding:6px 10px;color:#cfc7ad;font-size:11.5px}',
    '#athena-session .as-hud .sp{flex:1;pointer-events:none}',
    '#athena-session button{cursor:pointer;background:rgba(11,13,20,.85);border:1px solid rgba(212,175,55,.4);color:#e8e2d0;border-radius:6px;padding:6px 10px;font:inherit;font-size:12px}',
    '#athena-session button:hover{border-color:#d4af37;color:#ffe9a8}',
    '#athena-session button.on{background:rgba(95,211,138,.18);border-color:#5fd38a;color:#bff5d2}',
    '#athena-session .as-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);background:rgba(11,13,20,.85);border:1px solid #d4af37;border-radius:8px;padding:8px 14px;color:#ffe9a8;font-size:13px;display:none;pointer-events:none}',
    '#athena-session .as-prompt.on{display:block}',
    '#athena-session .as-prompt kbd{font:12px ui-monospace,monospace;background:#0a0c12;border:1px solid rgba(212,175,55,.4);border-radius:4px;padding:1px 6px;margin-right:6px}',
    '#athena-session .as-ret{position:absolute;left:50%;top:50%;width:6px;height:6px;border-radius:50%;background:rgba(212,175,55,.9);transform:translate(-50%,-50%);pointer-events:none}',
    '#athena-session .as-chat{position:absolute;left:10px;bottom:10px;width:min(360px,60vw);display:flex;flex-direction:column;gap:4px}',
    '#athena-session .as-chat .log{max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;padding:6px;background:rgba(11,13,20,.6);border:1px solid rgba(212,175,55,.2);border-radius:8px;font-size:12.5px}',
    '#athena-session .as-chat .log div b{color:#ffe9a8;margin-right:4px}',
    '#athena-session .as-chat .log div.sys{color:#9a937f;font-style:italic}',
    '#athena-session .as-chat input{background:rgba(11,13,20,.85);border:1px solid rgba(212,175,55,.35);border-radius:6px;padding:7px 9px;color:#e8e2d0;font:inherit;font-size:12.5px;outline:none}',
    '#athena-session .as-chat input:focus{border-color:#d4af37}',
    '#athena-session .as-peers{position:absolute;right:10px;bottom:10px;background:rgba(11,13,20,.7);border:1px solid rgba(212,175,55,.2);border-radius:8px;padding:6px 10px;font-size:11.5px;color:#cfc7ad;max-width:220px}',
    '#athena-session .as-peers b{color:#ffe9a8}',
    '#athena-session .as-cast{position:absolute;right:10px;bottom:44px}',
    '#athena-session .as-cast>button{background:rgba(11,13,20,.78);border:1px solid rgba(212,175,55,.28);color:#ffe9a8;border-radius:8px;padding:5px 10px;font-size:11.5px;cursor:pointer}',
    '#athena-session .as-cast-menu{position:absolute;right:0;bottom:32px;background:rgba(11,13,20,.94);border:1px solid rgba(212,175,55,.28);border-radius:8px;padding:6px;min-width:170px;display:flex;flex-direction:column;gap:4px}',
    '#athena-session .as-cast-menu button{background:transparent;border:1px solid transparent;color:#cfc7ad;text-align:left;border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer}',
    '#athena-session .as-cast-menu button:hover{border-color:rgba(212,175,55,.35);color:#ffe9a8}',
    '#athena-session .as-cast-menu button.on{color:#ffe9a8;border-color:rgba(212,175,55,.55)}',
    '#athena-session .as-cast-menu p{margin:4px 2px 0;font-size:10.5px;line-height:1.35;color:#8f897a}',
  ].join('\n');
  document.head.appendChild(st);
}

/* ── enter ── */
export async function enter(mapId, opts) {
  opts = opts || {};
  if (S) exit();
  ensureCss();
  const ov = document.createElement('div'); ov.id = 'athena-session';
  ov.innerHTML = '<div class="as-host"></div><div class="as-load">Loading world…</div>' +
    '<div class="as-hud"><b id="as-title">World</b><span class="h" id="as-hint">click to look · WASD move · Shift run · Space jump · Esc releases the mouse</span><span class="sp"></span><button id="as-voice" style="display:none">🎤 Voice</button><button id="as-exit">✕ Leave</button></div>' +
    '<div class="as-ret"></div><div class="as-prompt" id="as-prompt"></div>';
  document.body.appendChild(ov);
  const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  S = { id: mapId, ov, g: null, menu: null, prevOverflow, keys: {}, prompt: null, inZone: new Set(), hub: null, lastPos: 0, on: [] };
  const onKey = (e) => {
    if (!S) return;
    const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape' && !document.pointerLockElement && !typing) { exit(); return; }
    if (typing) { if (e.key === 'Escape') t.blur(); return; }
    if ((e.key === 'e' || e.key === 'E') && S.prompt) { e.preventDefault(); try { S.g && S.g.player && S.g.player.interact(); } catch (x) {} runAction(S.prompt.act, S.prompt.obj); }
    if ((e.key === 'Enter' || e.key === 't' || e.key === 'T') && S.hub && S.hub.input) { e.preventDefault(); try { if (document.pointerLockElement) document.exitPointerLock(); } catch (x) {} S.hub.input.focus(); }
  };
  window.addEventListener('keydown', onKey, true); S.on.push(() => window.removeEventListener('keydown', onKey, true));
  ov.querySelector('#as-exit').onclick = () => exit();
  try {
    const host = ov.querySelector('.as-host');
    const g = await mountWorld(host, { id: mapId, source: opts.source || 'cloud', mode: 'fps', markers: false, onMissing: () => toast('That world could not be loaded.', 3600) });
    if (!S || S.ov !== ov) { try { g.stop(); } catch (e) {} return null; }
    S.g = g; S.menu = (g.map && g.map.menu) || {};
    const ld = ov.querySelector('.as-load'); if (ld) ld.remove();
    ov.querySelector('#as-title').textContent = (S.menu.label || g.map.name || 'World');
    if (g.view === 'top') { const h = ov.querySelector('#as-hint'); if (h) h.textContent = 'WASD move · Shift run · E interact · Esc leaves'; }
    if (S.menu.mode === 'hub') startHub();
    g.on('frame', (dt) => { try { frame(dt); } catch (e) {} });
    return S;
  } catch (e) {
    toast('Could not open the world: ' + ((e && e.message) || e), 4000);
    exit();
    return null;
  }
}

export function exit() {
  if (!S) return;
  const s = S; S = null;
  try { stopHub(s); } catch (e) {}
  try { if (s.g) s.g.stop(); } catch (e) {}
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  s.on.forEach(f => { try { f(); } catch (e) {} });
  try { s.ov.remove(); } catch (e) {}
  document.body.style.overflow = s.prevOverflow;
}

/* ── interactions ── */
function actOf(o, menu) {
  if (o.act && o.act.kind && o.act.kind !== 'none') return o.act;
  if (o.t === 'zone' && menu && menu.mode === 'interact') {
    if (menu.kind === 'dialog' && menu.guide) return { kind: 'guide', guide: menu.guide, prompt: 'Talk' };
    if (menu.target) return { kind: 'screen', target: menu.target, prompt: 'Enter' };
  }
  return null;
}
function labelOf(o) { return o.n || (PROP_BY_ID[o.t] || {}).label || (o.t === 'glb' ? 'Building' : o.t); }
function reachOf(o) { return o.t === 'zone' ? 5 * (o.s ? o.s[0] : 1) + 0.6 : 3.2 * Math.max(1, o.s ? Math.max(o.s[0], o.s[2]) : 1); }
function frame(dt) {
  const s = S; if (!s || !s.g || !s.g.player) return;
  const p = s.g.player.pos, objs = s.g.map.objects;
  let best = null, bd = 1e9;
  for (const o of objs) {
    const act = actOf(o, s.menu); if (!act) continue;
    const dx = o.p[0] - p.x, dz = o.p[2] - p.z, d = Math.hypot(dx, dz), reach = reachOf(o);
    if (o.t === 'zone') {
      const inside = d <= reach;
      if (inside && !s.inZone.has(o.id)) { s.inZone.add(o.id); if (act.auto !== false) { runAction(act, o); continue; } }
      if (!inside) s.inZone.delete(o.id);
    }
    if (d <= reach && d < bd) { bd = d; best = { act, obj: o }; }
  }
  const el = s.ov.querySelector('#as-prompt');
  if (best && (best.obj.t !== 'zone' || best.act.auto === false)) {
    s.prompt = best;
    el.innerHTML = '<kbd>E</kbd>' + esc(best.act.prompt || (best.act.kind === 'guide' ? 'Talk' : 'Enter')) + ' · ' + esc(labelOf(best.obj));
    el.classList.add('on');
  } else { s.prompt = null; el.classList.remove('on'); }
  if (s.hub) hubFrame(dt);
}
function runAction(act, o) {
  const b = bridge();
  if (!act) return;
  if (act.kind === 'guide') {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
    if (b && b.playGuide && b.playGuide(act.guide)) return;
    toast('That guide is not available.', 3000); return;
  }
  if (act.kind === 'hub') { exit(); if (b && b.openHub) b.openHub(act.hub || act.target || 'main'); return; }
  if (act.kind === 'screen') { exit(); if (b && b.openScreen && b.openScreen(act.target)) return; toast('That menu could not be opened.', 3000); return; }
}

/* ── the hub: presence, chat, voice ── */
function startHub() {
  const s = S, c = supabase(), me = userId();
  const chatOn = s.menu.chatText !== false, voiceOn = s.menu.chatVoice !== false;
  /* `pick` is the character I am wearing, read once from the profile: the
      choice is ACCOUNT-WIDE, so it is the same in every hub, and it is carried
      on my position packets so everyone else can draw me as it. */
  const hub = s.hub = { ch: null, peers: new Map(), figures: new Map(), input: null, log: null, voice: { on: false, stream: null, pcs: new Map() }, lastVol: 0, pick: avatarPick() || '' };
  if (chatOn) {
    const box = document.createElement('div'); box.className = 'as-chat';
    box.innerHTML = '<div class="log" id="as-log"><div class="sys">' + (c ? 'You are in the hub — press Enter to type, T to talk.' : 'Sign in to see and talk to other players here.') + '</div></div><input id="as-input" maxlength="240" placeholder="Say something… (Enter)">';
    s.ov.appendChild(box);
    hub.log = box.querySelector('#as-log'); hub.input = box.querySelector('#as-input');
    hub.input.onkeydown = (e) => { if (e.key === 'Enter') { const t = hub.input.value.trim(); hub.input.value = ''; if (t) sendChat(t); hub.input.blur(); e.preventDefault(); } e.stopPropagation(); };
  }
  const peersEl = document.createElement('div'); peersEl.className = 'as-peers'; peersEl.id = 'as-peers'; peersEl.innerHTML = '<b>1</b> here'; s.ov.appendChild(peersEl);
  buildCastPicker(s);
  if (!c || !me) return;
  try {
    hub.ch = c.channel('athena:' + s.id, { config: { broadcast: { self: false }, presence: { key: me } } })
      .on('broadcast', { event: 'pos' }, (m) => onPos(m && m.payload))
      .on('broadcast', { event: 'chat' }, (m) => onChat(m && m.payload))
      .on('broadcast', { event: 'rtc' }, (m) => onRtc(m && m.payload))
      .on('presence', { event: 'sync' }, () => presenceSync())
      .on('presence', { event: 'leave' }, () => presenceSync())
      .subscribe(async (st) => { if (st === 'SUBSCRIBED') { try { await hub.ch.track({ uid: me, name: displayName(), at: Date.now() }); } catch (e) {} } });
  } catch (e) { hub.ch = null; }
  if (voiceOn) {
    const vb = s.ov.querySelector('#as-voice'); vb.style.display = '';
    vb.onclick = () => toggleVoice();
  }
}
/* 🧍 THE CHARACTER PICKER.
   ───────────────────────────────────────────────────────────────────────────
   Only appears when the map's author actually offered a choice — one character
   is not a wardrobe, and a button that opens a list of one is noise. The pick
   is written to the profile (account-wide) and then BROADCAST IMMEDIATELY by
   clearing `lastKey`, which is what makes everyone else in the room rebuild
   this player as the new character on their next packet.
   ⚠ THE OWN VIEW IS HONEST ABOUT WHEN IT UPDATES. A hub mounts in first
     person, where your own character is deliberately not drawn, so changing it
     is instantly visible TO EVERYONE ELSE and not to you. On a third-person or
     top-down map your own model is rebuilt when you next enter — swapping a
     model inside a live AnimationMixer is a lot of machinery for something
     that happens when a player opens a menu — and the line below says so
     rather than leaving them wondering. */
function buildCastPicker(s) {
  let cast = [];
  try { cast = castOf((s.g.map && s.g.map.player) || {}); } catch (e) { cast = []; }
  if (!cast || cast.length < 2) return;
  const wrap = document.createElement('div');
  wrap.className = 'as-cast'; wrap.id = 'as-cast';
  const label = (c, i) => c.label || (c.isDefault ? 'Default' : 'Character ' + (i + 1));
  const own = (s.hub && s.hub.pick) || '';
  wrap.innerHTML = '<button id="as-cast-btn" title="Choose your character">🧍 Character</button>' +
    '<div class="as-cast-menu" id="as-cast-menu" hidden>' +
      cast.map((c, i) => '<button data-cast="' + esc(c.a) + '"' + ((own ? c.a === own : !!c.isDefault) ? ' class="on"' : '') + '>' + esc(label(c, i)) + '</button>').join('') +
      '<p>Everyone in the hub sees this straight away. Your own view updates next time you enter.</p>' +
    '</div>';
  s.ov.appendChild(wrap);
  const btn = wrap.querySelector('#as-cast-btn'), menu = wrap.querySelector('#as-cast-menu');
  btn.onclick = () => { menu.hidden = !menu.hidden; };
  wrap.querySelectorAll('[data-cast]').forEach(b => {
    b.onclick = () => {
      const id = b.getAttribute('data-cast') || '';
      if (!s.hub) return;
      s.hub.pick = id;
      try { setAvatarPick(id); } catch (e) {}
      /* Force the next position packet even if the player has not moved —
         otherwise nobody learns about the change until they walk. */
      s.hub.lastKey = null;
      wrap.querySelectorAll('[data-cast]').forEach(x => x.classList.toggle('on', x === b));
      menu.hidden = true;
    };
  });
}
function stopHub(s) {
  const hub = s.hub; if (!hub) return;
  try { voiceOff(hub); } catch (e) {}
  try { if (hub.ch) { hub.ch.untrack && hub.ch.untrack(); hub.ch.unsubscribe(); } } catch (e) {}
  hub.figures.forEach(f => { try { s.g.scene.remove(f.group); } catch (e) {} if (f.av) { try { f.av.dispose(); } catch (e) {} } });
  s.hub = null;
}
function presenceSync() {
  const s = S; if (!s || !s.hub || !s.hub.ch) return;
  let n = 0; try { const st = s.hub.ch.presenceState() || {}; n = Object.keys(st).length; } catch (e) {}
  const el = s.ov.querySelector('#as-peers'); if (el) el.innerHTML = '<b>' + Math.max(1, n) + '</b> here';
  /* peers that left drop their figure */
  try {
    const st = s.hub.ch.presenceState() || {};
    s.hub.peers.forEach((p, uid) => { if (!st[uid]) removePeer(uid); });
  } catch (e) {}
}
function hubFrame(dt) {
  const s = S, hub = s.hub, g = s.g, now = performance.now();
  /* my position, ≤ 4 Hz and only when it changed */
  if (hub.ch && now - s.lastPos > 1000 / POS_HZ) {
    const p = g.player.pos, yaw = g.player.yaw;
    const key = [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), yaw.toFixed(2)].join(',');
    /* `m` is the character I am wearing — an ASSET ID, so it is a short string
       on a packet that already exists rather than a second channel. A peer
       resolves it against THIS map's cast, so an id this map does not offer
       simply falls back to the author's default on their screen. */
    if (key !== hub.lastKey) { hub.lastKey = key; s.lastPos = now; try { hub.ch.send({ type: 'broadcast', event: 'pos', payload: { uid: userId(), name: displayName(), x: p.x, y: p.y, z: p.z, yaw, m: hub.pick || '', t: Date.now() } }); } catch (e) {} }
  }
  /* peers glide to their last reported spot */
  hub.figures.forEach((f, uid) => {
    const p = hub.peers.get(uid); if (!p) return;
    const was = f.group.position.x + f.group.position.z;
    f.group.position.lerp(f.target, Math.min(1, dt * 8));
    f.group.rotation.y += (p.yaw - f.group.rotation.y) * Math.min(1, dt * 8);
    if (f.name) f.name.quaternion.copy(g.camera.quaternion);
    /* 🚶 WALK OR STAND, DERIVED — a peer never tells us which. Positions arrive
       at 4 Hz and only when they change, so the honest signal is whether this
       figure is still closing on its last reported spot. The decay keeps a
       character walking through the gap between two packets instead of
       flickering between clips four times a second. */
    if (f.av) {
      const now = f.group.position.x + f.group.position.z;
      f.moved = Math.abs(now - was) > 0.004 ? 0.25 : Math.max(0, f.moved - dt);
      figureSkin(f);
      try { f.av.update(dt, f.group.position, f.group.rotation.y, f.moved > 0 ? 'walk' : 'idle'); } catch (e) {}
    }
  });
  if (hub.voice.on && now - hub.lastVol > 400) { hub.lastVol = now; voiceTick(); }
}
function onPos(p) {
  const s = S; if (!s || !s.hub || !p || !p.uid || p.uid === userId()) return;
  const hub = s.hub;
  hub.peers.set(p.uid, p);
  let f = hub.figures.get(p.uid);
  /* Someone who changed character mid-session is torn down and rebuilt — the
     alternative is swapping a model inside a live mixer, which is a great deal
     of machinery for something that happens when a player opens a menu. */
  if (f && (f.pick || '') !== (p.m || '')) { removeFigure(uid_of(p), f); f = null; }
  if (!f) { f = makeFigure(p.name || 'Player', p.m || ''); hub.figures.set(p.uid, f); s.g.scene.add(f.group); f.group.position.set(p.x, p.y, p.z); }
  f.target.set(p.x, p.y, p.z);
}
/* The id off a payload, so the rebuild path above reads the same way as every
   other caller rather than reaching into the packet twice. */
function uid_of(p) { return p && p.uid; }
/* 🔴 THE CHARACTER HAS TO BE DISPOSED WITH THE FIGURE. It is a second group in
   the scene with its own AnimationMixer; removing only the placeholder leaves a
   character standing where somebody used to be, animating forever. */
function removeFigure(uid, f) {
  const s = S; if (!s || !f) return;
  try { s.g.scene.remove(f.group); } catch (e) {}
  if (f.av) { try { f.av.dispose(); } catch (e) {} }
  s.hub.figures.delete(uid);
}
function removePeer(uid) {
  const s = S; if (!s || !s.hub) return;
  const f = s.hub.figures.get(uid); if (f) removeFigure(uid, f);
  s.hub.peers.delete(uid);
  closePc(s.hub, uid);
}
/* 🧍 A PERSON IN THE HUB, WEARING THE CHARACTER THEY CHOSE.
   ───────────────────────────────────────────────────────────────────────────
   🔴 THIS USED TO BE A BLUE CYLINDER WITH A SPHERE ON TOP, FOR EVERYONE. The
   map author could set a character and it applied to their OWN avatar only —
   so you could build a hub, dress it, walk in, and find every other person in
   the room drawn as a capsule. In first person (the view a hub mounts in) your
   own model is deliberately not drawn either, so an `fps` hub was capsules and
   nothing else. The character was real; nobody could see anybody wearing it.

   Now the peer's chosen character is loaded through the SAME world asset cache
   the local avatar uses, so two people wearing the same one share a single
   loaded template rather than fetching it twice.

   ⚠ THE CAPSULE STAYS, as the fallback, and that is not laziness. A peer whose
     model is still downloading, whose choice this map does not offer, or whose
     file 404s must STILL BE VISIBLE: they are standing there, they are audible
     on proximity voice, and a person you can hear and walk into but cannot see
     is a worse bug than a plain shape. So the body is built either way and the
     model, when it arrives, replaces it. */
function makeFigure(name, pickId) {
  const THREE = S.g.THREE;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7fb8ff, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 1.1, 10), mat); body.position.y = 0.85; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf1d6b3, roughness: 0.8 })); head.position.y = 1.65; group.add(head);
  /* the name, on a canvas sprite that always faces the camera */
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d'); ctx.font = '700 28px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(11,13,20,.7)'; ctx.fillRect(0, 8, 256, 48); ctx.fillStyle = '#ffe9a8'; ctx.fillText(String(name).slice(0, 18), 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  nameSprite.scale.set(1.8, 0.45, 1); nameSprite.position.y = 2.15; group.add(nameSprite);

  /* The character, if this map can resolve one for that choice. createAvatar
     adds its own group to the scene and drives its own transform, so it is
     kept BESIDE the placeholder group rather than inside it — nesting would
     apply the position twice. */
  const f = { group, target: new THREE.Vector3(), name: nameSprite, av: null, pick: pickId || '', body, head, moved: 0 };
  try {
    const pl = (S.g.map && S.g.map.player) || {};
    const spec = resolveCharacter(pl, pickId);
    if (spec) {
      const av = createAvatar(THREE, { world: S.g.world, scene: S.g.scene,
        player: { model: spec, anim: pl.anim || {}, animFiles: pl.animFiles || [] } });
      av.setVisible(true);
      f.av = av;
    }
  } catch (e) { f.av = null; }
  return f;
}
/* Hide the placeholder only once the real character is actually on screen —
   `ready` flips when the model has loaded, so a slow download shows a capsule
   rather than a hole where a person is standing. */
function figureSkin(f) {
  const on = !!(f.av && f.av.ready);
  if (f.body) f.body.visible = !on;
  if (f.head) f.head.visible = !on;
}
function sendChat(text) {
  const s = S; if (!s || !s.hub) return;
  const p = { uid: userId(), name: displayName(), text: String(text).slice(0, 240), t: Date.now() };
  appendChat(p, true);
  try { if (s.hub.ch) s.hub.ch.send({ type: 'broadcast', event: 'chat', payload: p }); } catch (e) {}
}
function onChat(p) { if (!p || !p.text) return; appendChat(p, false); }
function appendChat(p, mine) {
  const s = S; if (!s || !s.hub || !s.hub.log) return;
  const d = document.createElement('div'); d.innerHTML = '<b>' + esc(p.name || 'Player') + (mine ? ' (you)' : '') + '</b>' + esc(p.text);
  s.hub.log.appendChild(d); while (s.hub.log.children.length > 60) s.hub.log.removeChild(s.hub.log.firstChild);
  s.hub.log.scrollTop = s.hub.log.scrollHeight;
}

/* ── proximity voice — WebRTC over the same channel ── */
async function toggleVoice() {
  const s = S; if (!s || !s.hub) return;
  const hub = s.hub, btn = s.ov.querySelector('#as-voice');
  if (hub.voice.on) { voiceOff(hub); btn.classList.remove('on'); btn.textContent = '🎤 Voice'; return; }
  if (!hub.ch) { toast('Sign in to use voice chat.', 3000); return; }
  try {
    hub.voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch (e) { toast('Microphone not available: ' + ((e && e.message) || e), 3600); return; }
  hub.voice.on = true; btn.classList.add('on'); btn.textContent = '🎤 Voice ON';
  toast('Voice on — players within ' + VOICE_RANGE + ' m can hear you.', 3200);
  voiceTick();
}
function voiceOff(hub) {
  hub.voice.on = false;
  hub.voice.pcs.forEach((_, uid) => closePc(hub, uid));
  if (hub.voice.stream) { try { hub.voice.stream.getTracks().forEach(t => t.stop()); } catch (e) {} hub.voice.stream = null; }
}
function distTo(uid) { const s = S; const p = s.hub.peers.get(uid); if (!p) return 1e9; const me = s.g.player.pos; return Math.hypot(me.x - p.x, me.y - p.y, me.z - p.z); }
function voiceTick() {
  const s = S; if (!s || !s.hub || !s.hub.voice.on) return;
  const hub = s.hub, me = userId();
  hub.peers.forEach((p, uid) => {
    const d = distTo(uid), inRange = d <= VOICE_RANGE, have = hub.voice.pcs.has(uid);
    if (!inRange) { if (have) closePc(hub, uid); return; }
    if (have) { const pc = hub.voice.pcs.get(uid); if (pc.audio) pc.audio.volume = Math.max(0, 1 - d / VOICE_RANGE); return; }
    if (String(me) < String(uid)) createOffer(uid);
  });
}
function newPc(hub, uid) {
  const pc = new RTCPeerConnection(ICE);
  const rec = { pc, audio: null };
  if (hub.voice.stream) hub.voice.stream.getTracks().forEach(t => pc.addTrack(t, hub.voice.stream));
  pc.onicecandidate = (e) => { if (e.candidate) sendRtc(uid, { candidate: e.candidate }); };
  pc.ontrack = (e) => {
    if (!rec.audio) { rec.audio = document.createElement('audio'); rec.audio.autoplay = true; rec.audio.style.display = 'none'; S && S.ov.appendChild(rec.audio); }
    rec.audio.srcObject = e.streams[0];
    rec.audio.volume = Math.max(0, 1 - distTo(uid) / VOICE_RANGE);
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePc(hub, uid); };
  hub.voice.pcs.set(uid, rec);
  return rec;
}
function closePc(hub, uid) {
  const rec = hub.voice.pcs.get(uid); if (!rec) return;
  try { rec.pc.close(); } catch (e) {}
  if (rec.audio) { try { rec.audio.srcObject = null; rec.audio.remove(); } catch (e) {} }
  hub.voice.pcs.delete(uid);
}
function sendRtc(to, body) { const s = S; if (!s || !s.hub || !s.hub.ch) return; try { s.hub.ch.send({ type: 'broadcast', event: 'rtc', payload: Object.assign({ from: userId(), to }, body) }); } catch (e) {} }
async function createOffer(uid) {
  const hub = S.hub, rec = newPc(hub, uid);
  try { const offer = await rec.pc.createOffer(); await rec.pc.setLocalDescription(offer); sendRtc(uid, { sdp: rec.pc.localDescription }); } catch (e) { closePc(hub, uid); }
}
async function onRtc(p) {
  const s = S; if (!s || !s.hub || !p || p.to !== userId() || !p.from) return;
  const hub = s.hub;
  if (!hub.voice.on) return;                       // not listening: ignore offers
  let rec = hub.voice.pcs.get(p.from);
  try {
    if (p.sdp) {
      if (p.sdp.type === 'offer') {
        if (!rec) rec = newPc(hub, p.from);
        await rec.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
        const ans = await rec.pc.createAnswer(); await rec.pc.setLocalDescription(ans);
        sendRtc(p.from, { sdp: rec.pc.localDescription });
      } else if (rec) await rec.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
    } else if (p.candidate && rec) await rec.pc.addIceCandidate(new RTCIceCandidate(p.candidate));
  } catch (e) {}
}
