/* mapforge.showroom.js — every mini-game's MODELS as game scenes (round 18).

   Woods Fishing, the Prince Portfolios auction block, Black River extraction
   and Node City each let the admin point their assets at .glb files — four
   admin panels, four Forge fields. MythicBridge.slots (index.html) lists
   them all as SLOTS; this module turns each game into a "showroom" map: one
   🧩 slot per asset laid out on pedestals, grouped in folders, showing the
   model it points at today. Replace a slot with a model from the Library
   (a cloud file, a project model, a URL) and scale or turn it; Save writes
   the URL, scale and yaw back through the bridge into the SAME field the
   game's own panel writes, so both keep working; ★ Set live publishes the
   catalogue to every player. List slots (boats, cars per rarity, species
   models) end with a "· new" slot — replace it to append an entry; restore
   a filled slot to its 🧩 stand-in to delete the entry.

   Only .glb references travel: a built-in prop or an embedded (in-map)
   model dropped on a slot is reported and skipped — upload it to the cloud
   first (Library → ☁ Upload). Reads the game only through the bridge. */

import { slotKey } from './mapforge.format.js';

export const SHOWROOM_PREFIX = 'models-';
/* Bridge keys ('species/pike/+', 'Rare/0', 'farm@2') → Athena slot keys, which
   `slotKey` limits to [a-z0-9_.-]: '/' → '.', '+' → 'new', '@' → '_lv'. The
   game description keeps the bridge key; objects carry the encoded one. */
export function encodeKey(k) { return slotKey(String(k).toLowerCase().replace(/\//g, '.').replace(/\+/g, 'new').replace(/@/g, '_lv')); }
const SPACING = 4, PER_ROW = 8, ROW_GAP = 6;

function bridge() { try { return (window.MythicBridge && window.MythicBridge.slots) || null; } catch (e) { return null; } }
function uid(p) { return (p || 'o') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
const COLORS = ['#4aa3ff', '#5fd38a', '#d4af37', '#ff9f43', '#b07cff', '#ff6b83'];

export function listGames() { const b = bridge(); try { return (b && b.games()) || []; } catch (e) { return []; } }
export function gameDesc(id) { return listGames().find(g => g.id === id) || null; }

/* game → Athena map */
export function buildShowroom(g) {
  if (!g) return null;
  const groups = g.groups || [];
  const total = groups.reduce((n, gr) => n + gr.slots.length, 0);
  const rows = groups.reduce((n, gr) => n + Math.ceil(gr.slots.length / PER_ROW), 0);
  const w = Math.max(24, (PER_ROW + 1) * SPACING), d = Math.max(24, rows * SPACING + groups.length * ROW_GAP + 8);
  const n = Math.ceil(Math.max(w, d) / 2) + 2, cell = 2, verts = (n + 1) * (n + 1);
  const assets = [], assetByUrl = {};
  const asset = (url, label) => { if (assetByUrl[url]) return assetByUrl[url]; const a = { id: uid('a_sr_'), label: (label || url.split('/').pop() || 'Model').replace(/\.(glb|gltf)$/i, '').slice(0, 60), url }; assets.push(a); assetByUrl[url] = a; return a; };
  const folders = [], objects = [];
  let z = -d / 2 + 4;
  groups.forEach((gr, gi) => {
    const fid = 'f_sr_' + gr.id; folders.push({ id: fid, name: gr.label, parent: null, open: true, vis: true, lock: false });
    gr.slots.forEach((s, i) => {
      const x = -((Math.min(gr.slots.length, PER_ROW) - 1) * SPACING) / 2 + (i % PER_ROW) * SPACING, zz = z + Math.floor(i / PER_ROW) * SPACING;
      const ek = encodeKey(s.k);
      const base = { id: 'o_sr_' + ek.replace(/[^A-Za-z0-9_-]+/g, '_'), k: ek, n: s.label, p: [x, 0, zz], g: true, f: fid };
      if (s.url) { const a = asset(s.url, s.name || s.label); objects.push(Object.assign(base, { t: 'glb', a: a.id, r: [0, +s.rotY || 0, 0], s: [+s.scale || 1, +s.scale || 1, +s.scale || 1] })); }
      else objects.push(Object.assign(base, { t: 'slot', c: s.add ? '#5fd38a' : COLORS[gi % COLORS.length], r: [0, 0, 0], s: [1, 1, 1] }));
    });
    z += Math.ceil(gr.slots.length / PER_ROW) * SPACING + ROW_GAP;
  });
  return {
    v: 1, id: uid('map_'), name: g.label + ' · models', description: 'Showroom: one slot per ' + g.label + ' asset (' + total + '). Replace a slot with a model from the Library, scale and turn it, Save → the game uses it; ★ Set live publishes to every player.',
    game: SHOWROOM_PREFIX + g.id,
    terrain: { n, cell, heights: new Array(verts).fill(0), paint: new Array(verts).fill(6) },
    water: { on: false, level: -1, color: '#2e6f9e', opacity: 0.78, wave: 0.12, speed: 1 },
    env: { preset: 'day', shadows: true, weather: 'none' },
    assets, folders, objects,
    scene: { ground: true, water: false, sky: true },
    meta: { created: Date.now(), updated: Date.now(), author: 'Showroom' },
  };
}

/* Athena map → what to write. { sets:[{k,url,scale,rotY,name}], clears:[k], skipped:[{k,why}] } */
export function diffShowroom(map, g) {
  const sets = [], clears = [], skipped = [];
  if (!map || !g) return { sets, clears, skipped };
  const byK = {}; (map.objects || []).forEach(o => { if (o.k) byK[o.k] = o; });
  g.groups.forEach(gr => gr.slots.forEach(s => {
    const o = byK[encodeKey(s.k)];
    if (!o) { if (s.url) clears.push(s.k); return; }
    if (o.t === 'glb') {
      const a = (map.assets || []).find(x => x.id === o.a);
      if (!a || !a.url) { skipped.push({ k: s.k, why: 'embedded model — upload it to the cloud first' }); return; }
      const scale = +(o.s && o.s[0]) || 1, rotY = +(o.r && o.r[1]) || 0;
      if (s.add || a.url !== s.url || Math.abs(scale - (+s.scale || 1)) > 1e-6 || Math.abs(rotY - (+s.rotY || 0)) > 1e-6) sets.push({ k: s.k, url: a.url, scale, rotY, name: a.label });
      return;
    }
    if (o.t === 'slot') { if (s.url) clears.push(s.k); return; }
    skipped.push({ k: s.k, why: 'built-in prop "' + o.t + '" — games need a .glb' });
  }));
  // list entries: clear from the highest index down so earlier indices stay valid
  const idx = (k) => { const m = /\/(\d+)$/.exec(k); return m ? +m[1] : -1; };
  clears.sort((a, b) => idx(b) - idx(a));
  return { sets, clears, skipped };
}

export function applyDiff(gameId, diff) {
  const b = bridge(); if (!b) return { ok: false, error: 'no bridge' };
  if (b.canWrite && !b.canWrite()) return { ok: false, error: 'admin-only' };
  let n = 0;
  diff.clears.forEach(k => { try { if (b.clear(gameId, k)) n++; } catch (e) {} });
  diff.sets.forEach(s => { try { if (b.set(gameId, s.k, s)) n++; } catch (e) {} });
  return { ok: true, n };
}

export const lastWrite = { game: null, diff: null, published: false, at: 0 };
async function onAthena(e) {
  const d = e && e.detail; if (!d || !d.game || d.game.indexOf(SHOWROOM_PREFIX) !== 0 || !d.map) return;
  const gid = d.game.slice(SHOWROOM_PREFIX.length); const g = gameDesc(gid); if (!g) return;
  const diff = diffShowroom(d.map, g); const r = applyDiff(gid, diff);
  lastWrite.game = gid; lastWrite.diff = diff; lastWrite.at = Date.now(); lastWrite.published = false;
  const B = window.MythicBridge; const toast = (m) => { try { if (B && B.toast) B.toast(m); } catch (x) {} };
  if (!r.ok) { toast('Model slots not written: ' + r.error); return; }
  if (diff.skipped.length) toast('⚠ ' + diff.skipped.length + ' slot(s) skipped: ' + diff.skipped.map(s => s.why).filter((v, i, a) => a.indexOf(v) === i).join('; '));
  if (e.type === 'athena:live') { try { const b = bridge(); const ok = b.publish ? await b.publish() : false; lastWrite.published = !!ok; toast(ok ? '🎮 ' + g.label + ' models published — every player gets them.' : '🎮 ' + g.label + ' models saved on this device (cloud offline).'); } catch (x) { toast('Publish failed: ' + ((x && x.message) || x)); } }
  else if (r.n) toast('🎮 ' + g.label + ': ' + r.n + ' model slot(s) updated.');
}

let _registered = new Set();
export function registerAll() {
  const A = window.AthenaEngine || window.MythicMapForge; if (!A || !A.games) return 0;
  let n = 0;
  listGames().forEach(g => {
    const id = SHOWROOM_PREFIX + g.id; if (_registered.has(id)) return;
    A.games.register({ id, label: g.label + ' · models', icon: g.icon || '🎮',
      describe: 'Showroom of every ' + g.label + ' model slot. Replace a slot with a model, Save; ★ Set live publishes to all players. A "· new" slot appends an entry; restoring a slot deletes its entry.',
      slots: g.groups.flatMap(gr => gr.slots.map(s => ({ k: encodeKey(s.k), label: s.label, icon: s.icon || '🧩' }))),
      build: () => buildShowroom(gameDesc(g.id) || g) });
    _registered.add(id); n++;
  });
  return n;
}
export function open(gameId) { try { const A = window.AthenaEngine || window.MythicMapForge; if (!A || !A.open) return false; registerAll(); A.open({ game: SHOWROOM_PREFIX + gameId }); return true; } catch (e) { return false; } }
/* A tiny chooser (the admin button): which mini-game's models to open. */
export function pick() {
  registerAll(); const games = listGames();
  if (!games.length) { try { window.MythicBridge.toast('No mini-game model slots are available (sign in as admin in the game).'); } catch (e) {} return null; }
  const old = document.getElementById('mf-showrooms'); if (old) old.remove();
  const el = document.createElement('div'); el.id = 'mf-showrooms';
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483200;background:rgba(6,8,14,.72);display:flex;align-items:center;justify-content:center;font:13px system-ui,sans-serif;color:#e8e2d0';
  el.innerHTML = '<div style="background:#12151f;border:1px solid #d4af37;border-radius:12px;padding:16px 18px;min-width:320px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.7)"><div style="font-weight:800;letter-spacing:.14em;color:#e7c757;font-size:11px;margin-bottom:10px">🎮 MINI-GAME MODELS</div>'
    + games.map(g => { const n = g.groups.reduce((a, gr) => a + gr.slots.filter(s => !s.add).length, 0), filled = g.groups.reduce((a, gr) => a + gr.slots.filter(s => s.url).length, 0); return '<button data-g="' + g.id + '" style="display:flex;width:100%;align-items:center;gap:10px;background:#171b27;border:1px solid rgba(212,175,55,.22);border-radius:8px;padding:8px 10px;color:#e8e2d0;cursor:pointer;margin-bottom:6px;text-align:left;font:inherit"><span style="font-size:20px">' + (g.icon || '🎮') + '</span><span style="flex:1"><b>' + g.label + '</b><br><small style="color:#9a937f">' + n + ' slots · ' + filled + ' with a model</small></span><span>›</span></button>'; }).join('')
    + '<button data-close style="margin-top:4px;width:100%;background:none;border:1px solid rgba(212,175,55,.22);border-radius:8px;padding:6px;color:#9a937f;cursor:pointer;font:inherit">Cancel</button></div>';
  document.body.appendChild(el);
  el.querySelectorAll('button[data-g]').forEach(b => b.onclick = () => { el.remove(); open(b.dataset.g); });
  el.querySelector('[data-close]').onclick = () => el.remove();
  el.onclick = (ev) => { if (ev.target === el) el.remove(); };
  return el;
}
try { ['athena:saved', 'athena:live'].forEach(t => window.addEventListener(t, onAthena)); } catch (e) {}
try { registerAll(); setTimeout(registerAll, 1500); setTimeout(registerAll, 6000); } catch (e) {}
