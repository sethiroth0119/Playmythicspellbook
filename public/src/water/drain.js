/* ════════════════════════════════════════════════════════════════════════════
   🌊 THE SEA DRAIN — the sewer's sea-only endpoint, and the tool that puts one
   in the water.
   ----------------------------------------------------------------------------
   network.js is the graph and knows nothing about a pointer, a mesh or a price;
   it holds the drain cells in a Set beside the pipes and folds them into the
   SAME per-component sewer solve the Sewer Outfall already feeds. THIS file is
   the DOM/THREE half — the button, the claim on the shared pointer arbiter, the
   refusal, the money and the headwall you can see — which is what keeps
   network.js importable from node and therefore what keeps the sewer testable.

   ── 🔴 THE ONE RULE, AND WHO OWNS IT ───────────────────────────────────────
   A drain may stand ONLY in open water, and "is this open water" is answered by
   exactly one call:

       window.MythicOcean.isSea(worldX, worldZ, margin)

   That is the predicate /src/ocean exports, that node-city's perimeterScenery
   and /src/wild already consult, and that is derived from the LATCHED city id
   through MythicWater.endowment().sea.shoreAt — not from a shoreline this file
   worked out. There is no coastline arithmetic in this module. The only
   coordinate work below is the frame conversion node-city itself does
   everywhere (`world = tile − HALF + 0.5`), written on two adjacent lines the
   way /src/ocean writes it, and it is not a second opinion about anything.

   ⚠ ABSENT ⇒ REFUSE, NEVER GUESS. If /src/ocean did not draw, isSea answers
     false for every point by its own design ("a module that did not draw the sea
     must not be able to delete the outskirts"), and this tool says so in one
     sentence and places nothing. A guessed waterline would put a drain on a
     beach the player can SEE is dry, and it would report success forever — this
     project's most-repeated failure, and the reason /src/ocean itself refuses
     rather than guessing in the other direction.

   ── 🔴 WHY THE DRAIN IS NOT A `BUILDINGS` ROW ──────────────────────────────
   Because there is no wet tile to put it on, and there cannot be one. Measured
   over 24 city ids × 24 rows against endowment.js's own shoreXAt(): the
   waterline sits at world x 13.753 … 14.349, while the plate's last column is
   world +11.5 and its edge is +12. `WATER.sea.inset` holds the coast off the
   plate deliberately, so that it cannot run over perimeterScenery's ring road.
   Every tile in every city is dry land.

   So a drain stands in the APRON — cells east of the plate, picked with
   node-city's `cellFromEvent(ev, pad)`, which is "a PICKER, not a permission"
   in that function's own words. tryPlace() opens with `if (!inGrid(x, z) …)
   return;` and stays untouched by this round: nothing here writes `game.tiles`,
   so none of the ~200 plate-bounded walks, zoning's fill bounds, agentTick, the
   road maintenance cap, dropTileMesh or serialize() can be surprised by a cell
   they were never written to expect. /src/power's Grid Connector is the shipped
   precedent for exactly this shape — an off-plate terminal that a dragged
   network reaches, owned and drawn by the module that put it there.
   ⚠ WHICH MEANS THE MESH IS THIS FILE'S JOB. There is no buildMesh arm because
     there is no BUILDINGS row; the documented degrade path is that a drain the
     module could not draw is a drain the module refuses to sell (see place()).
     `structures()` reports the group so a driver can measure the bounding box
     rather than believe a comment.

   ── 🖱 ONE CLAIM ON ONE ARBITER ────────────────────────────────────────────
   Sixth claimant on /src/netdrag/rig.js (zoning, netdrag, roadclass,
   water-mains, power-lines, and this). No document listeners are written here
   and none may be: rig.js exists because pairwise tool exclusion is N² and every
   missing edge is a silent bug — "the worst class of UI bug: the player blames
   themselves".
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

const D = () => WATER.sewer.drain;

let host = null, api = null, T = null, scene = null;
let GRID = 24, HALF = 12;
let group = null;                       // one THREE.Group holding every headwall
const built = new Map();                // "x,z" -> THREE.Group
let MAT = null;

let armed = false, busy = false, ctrlWas = null;
let barBtn = null, hint = null;
let TOOLS = null, TOK = null, PREV = null;

/* ── FRAME CONVERSION ───────────────────────────────────────────────────────
   node-city maps a cell to the world as `world = cell − HALF + 0.5`. Both
   directions on adjacent lines, exactly as /src/ocean writes them, because this
   is the one place this module crosses between the two frames. */
const wx = (x) => x - HALF + 0.5;
const wz = (z) => z - HALF + 0.5;

const K = (x, z) => (x | 0) + ',' + (z | 0);
const money = (n) => Math.round(n).toLocaleString();
function say(m, k) { try { if (host && typeof host.toast === 'function') host.toast(m, k || 'good'); } catch (e) {} }
function warn(m) { try { console.warn('[water/drain] ' + m); } catch (e) {} }

/* ════════════════════════════════════════════════════════════════════════════
   THE RULE — asked of /src/ocean, and of nothing else.
   ════════════════════════════════════════════════════════════════════════════ */
function oceanApi() {
  try { return (typeof window !== 'undefined' && window.MythicOcean) || null; } catch (e) { return null; }
}
export function isSeaCell(x, z) {
  const O = oceanApi();
  if (!O || typeof O.isSea !== 'function') return false;
  try { return !!O.isSea(wx(x), wz(z), D().margin); } catch (e) { return false; }
}

/* The apron the pointer and the pipe run are allowed to reach into. Not the
   rule — isSeaCell is the rule — only how far out either is permitted to look.
   See WATER.sewer.drain.apron for the measurement that fixed it at 3. */
export function apron() { return Math.max(0, D().apron | 0); }

/* The westernmost apron column of this row that isSeaCell accepts, so a refusal
   can name a cell the rule would then say yes to rather than quote a rule.
   Derived by ASKING the predicate, never by inverting a coastline. */
function firstSeaColumn(z) {
  const A = apron();
  for (let x = GRID; x <= GRID - 1 + A; x++) if (isSeaCell(x, z)) return x;
  return -1;
}

/* 🔴 THE REFUSAL NAMES THE WATER AND POINTS AT THE LAYER. "Cannot place here" is
   indistinguishable from a bug — /src/water's siteRefusal says so in as many
   words and this is the same contract, for the endpoint that has the strictest
   rule in the whole subsystem. Returns null when the cell is legal. */
export function refusalAt(x, z) {
  const O = oceanApi();
  if (!O || typeof O.isSea !== 'function') {
    return '🌊 The ocean layer is not loaded in this build, so nothing here can prove a cell is water — ' +
           'and a Sea Drain guessed onto a beach would report success for ever. Nothing was placed.';
  }
  try {
    const st = typeof O.stats === 'function' ? O.stats() : null;
    if (st && !st.built) {
      return '🌊 The ocean did not draw in this city' + (st.refused ? ' (no ' + st.refused + ')' : '') +
             ', so there is no water to drain into. A Sea Drain has to stand in the sea.';
    }
  } catch (e) {}
  if (isSeaCell(x, z)) return null;
  const col = firstSeaColumn(z);
  return '🌊 A Sea Drain stands IN the ocean — this cell is dry land. ' +
    (col >= 0 ? 'On this row the water starts at x=' + col + ': drag the shoreline east until the ghost turns green. '
              : 'Drag east, past the city edge, until the ghost turns green. ') +
    'The 🚰 Pipes layer draws the run that has to reach it — the drain does nothing until a main touches it.';
}

/* ════════════════════════════════════════════════════════════════════════════
   THE STRUCTURE — one Group per drain, in one parent Group.
   ----------------------------------------------------------------------------
   Materials are module-level and shared: a coastline of drains must not be a
   material each, which is the same constraint every overlay in this project
   states from the other side. Box and Cylinder geometries carry their own
   normals, so the constant-normal rule the hand-built buffers here need
   (preview.js, ocean, the overlays) does not apply — that rule is about
   BufferGeometry written by hand, and none is written here.
   ════════════════════════════════════════════════════════════════════════════ */
function mats() {
  if (MAT) return MAT;
  MAT = {
    conc:  new T.MeshStandardMaterial({ color: 0x8d8f93, roughness: 0.92, metalness: 0.02 }),
    dark:  new T.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.78, metalness: 0.15 }),
    steel: new T.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.52, metalness: 0.55 }),
    warn:  new T.MeshStandardMaterial({ color: 0xd8a53a, roughness: 0.6,  metalness: 0.1 }),
    foam:  new T.MeshStandardMaterial({ color: 0xcfe9f2, roughness: 0.95, metalness: 0.0,
                                        transparent: true, opacity: 0.55 }),
  };
  return MAT;
}

/* A stilted headwall: a concrete deck on four piles, a discharge mouth facing
   OUT to sea, a rail and a lamp post. The silhouette has to read from the air as
   "the city's waste leaves here", because that is the only instruction this
   feature gives — the same argument /src/power's connector makes for its own. */
function buildStructure(x, z) {
  const M = mats();
  const g = new T.Group();
  const S = D().size, Y = D().deckY;

  const deck = new T.Mesh(new T.BoxGeometry(S, 0.07, S * 0.82), M.conc);
  deck.position.set(0, Y, 0);
  g.add(deck);

  const pile = new T.BoxGeometry(0.075, Y + 0.30, 0.075);
  for (const px of [-S * 0.40, S * 0.40]) for (const pz of [-S * 0.32, S * 0.32]) {
    const m = new T.Mesh(pile, M.dark);
    m.position.set(px, (Y + 0.30) / 2 - 0.30, pz);
    g.add(m);
  }

  /* The discharge mouth points EAST — away from the city, into the water. A
     drain that appeared to spill back onto the plate would be the picture
     contradicting the rule. */
  const mouth = new T.Mesh(new T.CylinderGeometry(0.13, 0.15, 0.34, 10), M.dark);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(S * 0.44, Y - 0.06, 0);
  g.add(mouth);
  const splash = new T.Mesh(new T.CircleGeometry(0.28, 14), M.foam);
  splash.rotation.x = -Math.PI / 2;
  splash.position.set(S * 0.72, 0.042, 0);      // just above OCEAN.extent.y (0.035)
  g.add(splash);

  // the inlet culvert, facing the city, where the main arrives
  const inlet = new T.Mesh(new T.BoxGeometry(0.16, 0.20, 0.30), M.conc);
  inlet.position.set(-S * 0.46, Y - 0.02, 0);
  g.add(inlet);

  // rail + lamp, so the thing has a scale the eye can read at this camera
  const railGeo = new T.BoxGeometry(S, 0.028, 0.028);
  for (const rz of [-S * 0.40, S * 0.40]) {
    const r = new T.Mesh(railGeo, M.steel);
    r.position.set(0, Y + 0.20, rz);
    g.add(r);
  }
  const post = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.42, 6), M.steel);
  post.position.set(-S * 0.30, Y + 0.21, S * 0.30);
  g.add(post);
  const lamp = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), M.warn);
  lamp.position.set(-S * 0.30, Y + 0.44, S * 0.30);
  g.add(lamp);

  g.position.set(wx(x), 0, wz(z));
  g.name = 'sea-drain-' + K(x, z);
  /* No shadows. The drain stands 2–3 units past the plate's east edge, outside
     SHADOW_SPAN — the same argument /src/ocean's mesh makes: a shadow pass paid
     for and never seen. */
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

/* Bring the drawn structures into line with the graph. Called after every edit
   and after a load; idempotent, so a caller cannot double-build. */
export function syncMeshes() {
  if (!T || !group || !api) return 0;
  const want = new Set(api.Net.drainKeys());
  for (const [k, g] of built) {
    if (want.has(k)) continue;
    try { group.remove(g); g.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); } catch (e) {}
    built.delete(k);
  }
  for (const k of want) {
    if (built.has(k)) continue;
    const p = k.split(','), x = +p[0], z = +p[1];
    if (!isFinite(x) || !isFinite(z)) continue;
    try { const g = buildStructure(x, z); group.add(g); built.set(k, g); } catch (e) { warn('mesh: ' + (e && e.message)); }
  }
  return built.size;
}

/* What a driver measures instead of trusting this file's comments: the parent
   group, the child count, and the world bounding box of one drain. */
export function structures() {
  const out = { group, count: built.size, boxes: {} };
  if (!T || !group) return out;
  for (const [k, g] of built) {
    try {
      const b = new T.Box3().setFromObject(g);
      const s = new T.Vector3(); b.getSize(s);
      out.boxes[k] = { children: g.children.length,
                       min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z],
                       size: [s.x, s.y, s.z] };
    } catch (e) {}
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PRICE — the host's own scaler, or nothing.
   ⚠ NEVER GUESSED. `WATER.sewer.drain.cost` is on node-city's 2..600 shelf and
     the ×100 lives in the host's single scaleCost(). Reading it raw quotes 100×
     low and looks entirely correct — /src/streets records that failure and
     netui.js already refuses rather than laying free pipe. Same refusal here.
   ════════════════════════════════════════════════════════════════════════════ */
export function price() {
  try { if (host && typeof host.scaleCinder === 'function') return host.scaleCinder(D().cost) | 0; } catch (e) {}
  return null;
}

/* ════════════════════════════════════════════════════════════════════════════
   PLACE / LIFT — one awaited charge, one lock across it, one line said after.
   ════════════════════════════════════════════════════════════════════════════ */
export async function place(x, z) {
  if (busy) return { ok: false, why: 'busy' };
  const k = K(x, z);
  if (api.Net.hasDrain(k)) return { ok: false, why: 'A Sea Drain already stands here.' };
  const why = refusalAt(x, z);
  if (why) return { ok: false, why };
  /* 🔴 THE DEGRADE PATH, STATED AS A REFUSAL. With no THREE handed over there is
     no structure to build, and an invisible thing on a real cell that the player
     paid for is the exact defect a missing buildMesh arm produces. So it is not
     sold. */
  if (!T || !group) return { ok: false, why: '🌊 This build cannot draw a Sea Drain, so it will not sell you one.' };
  const p = price();
  if (p == null) {
    return { ok: false, why: '🌊 The Sea Drain price is unavailable in this build, so nothing was placed. ' +
                             '(The city did not hand /src/water its cost scaler.)' };
  }
  busy = true;
  try {
    let paid = false;
    try { paid = typeof host.payCost === 'function' ? await host.payCost({ cinder: p }) : false; }
    catch (e) { paid = false; }
    if (!paid) return { ok: false, why: '🌊 Cannot afford a Sea Drain (' + money(p) + ' 🔥).' };
    api.Net.addDrain([k]);
    syncMeshes();
    after();
    return { ok: true, k, cost: p };
  } finally { busy = false; paintBtn(); }
}

export function lift(x, z) {
  const k = K(x, z);
  const n = api.Net.removeDrain([k]);
  if (n) { syncMeshes(); after(); }
  return n;
}

function after() {
  try { if (typeof host.saveSoon === 'function') host.saveSoon(); } catch (e) {}
  try { if (api && api.onEdit) api.onEdit(); } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   THE TOOL — one claim on rig.js, and the shared preview.
   ════════════════════════════════════════════════════════════════════════════ */
function pick(ev) {
  try {
    if (typeof host.cellFromEvent === 'function') return host.cellFromEvent(ev, apron());
    /* An older node-city with no apron picker cannot point past the plate, so
       the tool can only ever refuse. Say so once at mount rather than let the
       player hunt for a cell that cannot be picked — see claimPointer(). */
    if (typeof host.tileFromEvent === 'function') return host.tileFromEvent(ev);
  } catch (e) {}
  return null;
}

function hot(ev) {
  const canvas = host && host.canvas;
  if (!armed || !canvas || ev.target !== canvas) return false;
  /* 🛟 The belt to rig.js's braces, verbatim from /src/power/lines.js: against a
     host with no mode hook the arbiter's bindMode half cannot fire, and then the
     player holding a building must win — they are holding it. */
  try { if (typeof host.mode === 'function' && host.mode() === 'place') return false; } catch (e) {}
  return true;
}

function holdControls() {
  if (ctrlWas === null && host && host.controls) { ctrlWas = host.controls.enabled; host.controls.enabled = false; }
}
function releaseControls() {
  if (ctrlWas !== null && host && host.controls) { host.controls.enabled = ctrlWas; }
  ctrlWas = null;
}

function preview(cell, ev) {
  if (!PREV) return;
  if (!cell) { PREV.hide(); return; }
  const ok = !refusalAt(cell.x, cell.z);
  PREV.show([{ x: cell.x, z: cell.z, state: ok ? 'ok' : 'blocked' }]);
  const p = price();
  PREV.label(ok ? '🌊 Sea Drain' + (p != null ? ' · ' + money(p) + ' 🔥' : '')
                : '🌊 Not water',
             ok ? null : 'A drain has to stand in the sea', ev);
}

function onDown(ev) {
  if (busy || !hot(ev) || (ev.button !== 0 && ev.button !== 2)) return;
  const c = pick(ev);
  if (!c) return;
  ev.preventDefault(); ev.stopPropagation();
  holdControls();
  if (ev.button === 2) {
    const n = lift(c.x, c.z);
    say(n ? '🧽 Took out the Sea Drain at ' + K(c.x, c.z) + '. No refund — the headwall is poured.'
          : '🌊 There is no Sea Drain on that cell.', n ? 'good' : 'bad');
    releaseControls();
    preview(c, ev);
    return;
  }
  place(c.x, c.z).then(r => {
    releaseControls();
    if (!r) return;
    if (!r.ok) { if (r.why && r.why !== 'busy') say(r.why, 'bad'); return; }
    const live = api.netState && api.netState();
    const attached = live && live.sewage && live.sewage.outfalls.some(o => o.k === r.k && o.live);
    say('🌊 Sea Drain built in the water · ' + money(r.cost) + ' 🔥.' +
        (attached ? ' It is on your mains.' : ' Now run 🚰 Pipes east to it — it treats nothing until a main touches it.'),
        'good');
    preview(null, null);
  });
}

function onMove(ev) {
  if (!hot(ev)) return;
  const c = pick(ev);
  preview(c, ev);
}
function onUp(ev) { if (hot(ev)) { releaseControls(); } }
function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }
function onKey(ev) {
  if (!armed) return;
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (ev.key === 'Escape') { arm(false); ev.stopPropagation(); }
}

export function arm(v) {
  const want = v == null ? true : !!v;
  if (want === armed) { paintBtn(); return armed; }
  if (want) {
    if (!TOK) { say('🌊 The shared map tool is not loaded in this build, so a Sea Drain cannot be placed by hand.', 'bad'); return false; }
    if (!TOK.arm()) return armed;          // the arbiter decides, not this file
    armed = true;
    let held = false;
    try { held = typeof host.mode === 'function' && host.mode() === 'place'; } catch (e) {}
    try { if (typeof host.setMode === 'function') host.setMode('inspect'); } catch (e) {}
    if (held) say('🌊 Sea Drain tool armed — the building you were holding was put back.', 'good');
    showHint(true);
  } else {
    armed = false;
    releaseControls();
    preview(null, null);
    showHint(false);
    try { if (TOK) TOK.disarm(); } catch (e) {}
  }
  paintBtn();
  return armed;
}
export function isArmed() { return armed; }

/* 🔴 A SILENT STAND-DOWN IS THE BUG, NOT THE FIX (rig.js says so in as many
   words). The hint closes, the button clears, and the toast names whoever took
   the pointer. */
function standDown(reason) {
  if (!armed) return;
  armed = false;
  releaseControls();
  preview(null, null);
  showHint(false);
  paintBtn();
  const who = reason && (reason.name || reason.label);
  say('🌊 Sea Drain tool put away' + (who ? ' — you picked ' + who + '.' : '.') +
      ' Click 🌊 Sea Drain to place another.', 'good');
}

function paintBtn() {
  if (!barBtn) return;
  barBtn.classList.toggle('active', armed);
  barBtn.disabled = !!busy;
}

function showHint(on) {
  if (!hint) return;
  hint.classList.toggle('on', !!on);
  if (!on) return;
  const p = price();
  const n = api ? api.Net.drainCount() : 0;
  hint.innerHTML =
    '<button class="nwdx" type="button" data-nwdx="1" aria-label="Close">✖</button>' +
    '<b>🌊 SEA DRAIN</b> — click the water east of the city · right-click to take one out · Esc to stop' +
    '<div class="nwdhint">' + n + ' drain' + (n === 1 ? '' : 's') + ' placed' +
    (p != null ? ' · ' + money(p) + ' 🔥 each' : '') +
    ' · it does nothing until a 🚰 main reaches it.</div>';
}

function buildUI() {
  if (typeof document === 'undefined' || !document.body) return;
  if (!document.getElementById('nwd-style')) {
    const st = document.createElement('style');
    st.id = 'nwd-style';
    st.textContent = `
#nwd-hint{position:absolute;left:50%;transform:translateX(-50%);bottom:92px;z-index:7;display:none;
  background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));
  border-radius:10px;padding:7px 12px;color:var(--bone,#e9e0cc);font-size:12px;line-height:1.4;
  box-shadow:0 14px 34px rgba(0,0,0,.55);max-width:min(680px,calc(100% - 24px))}
#nwd-hint.on{display:block}
#nwd-hint b{color:var(--sky,#8fd0e8)}
#nwd-hint .nwdhint{color:var(--mist,#8f87a3);font-size:11px}
#nwd-hint .nwdx{background:none;border:0;color:var(--mist,#8f87a3);cursor:pointer;font-size:13px;
  float:right;margin-left:10px}`;
    document.head.appendChild(st);
  }
  hint = document.createElement('div');
  hint.id = 'nwd-hint';
  hint.addEventListener('click', (ev) => { if (ev.target.closest('[data-nwdx]')) arm(false); });
  document.body.appendChild(hint);

  const bar = document.getElementById('buildbar');
  if (!bar) return;
  barBtn = document.createElement('button');
  barBtn.className = 'bbtn tool';
  barBtn.id = 'nwd-open';
  barBtn.title = 'Place a Sea Drain in the ocean, then pipe your mains out to it';
  barBtn.innerHTML = '<span class="bico">🌊</span><span class="bname">Sea Drain</span>';
  barBtn.onclick = () => arm(!armed);
  bar.appendChild(barBtn);
}

async function claimPointer() {
  try {
    const rig = await import('../netdrag/rig.js');
    TOOLS = (rig && typeof rig.tools === 'function') ? rig.tools() : null;
  } catch (e) { TOOLS = null; }
  if (!TOOLS) {
    warn('/src/netdrag/rig.js is absent, so the Sea Drain tool cannot arm without becoming a second pointer owner.');
    if (barBtn) { barBtn.disabled = true; barBtn.title = 'The shared map-pointer tool is not loaded.'; }
    return;
  }
  TOK = TOOLS.claim('water-drain', { label: '🌊 Sea Drain', standDown });
  TOK.on({
    down: onDown, move: onMove, up: onUp, ctx: onCtx, key: onKey,
    /* Mid-gesture hand-over. Releasing OrbitControls here is not cosmetic: a
       tool that stands down still holding controls.enabled = false kills the
       camera for the rest of the session and presents as a renderer bug three
       files from its cause. */
    cancel: () => { releaseControls(); preview(null, null); },
  });
  try { TOOLS.bindMode(host.onMode, host.BUILDINGS); } catch (e) {}

  /* THE SHARED PREVIEW, DYNAMICALLY IMPORTED — /src/netdrag/preview.js, not a
     second one. power/lines.js already reuses it rather than writing its own;
     a second ghost would be a second y-stack decision, a second colour-space
     decision and a second place for a price chip to disagree with the charge. */
  try {
    const pv = await import('../netdrag/preview.js');
    if (T && scene && pv && pv.makeRunPreview) PREV = pv.makeRunPreview({ THREE: T, scene, HALF });
  } catch (e) { PREV = null; }

  if (typeof host.cellFromEvent !== 'function') {
    warn('the host published no cellFromEvent, so the pointer cannot reach past the plate — ' +
         'the Sea Drain tool will refuse every cell it can pick.');
    if (barBtn) barBtn.title = 'This build cannot point at the water (no apron picker).';
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   MOUNT. `h` is node-city's hand-over — the globals trap: THREE, scene, canvas,
   controls and every helper are top-level `const` in the host's module script
   and invisible to an ES module. Every key is optional; absent ones cost the
   TOOL and never the graph, because the drain set is data and a toolbar is only
   one way to edit it (MythicWater.drains.add exists for the driven test).
   ════════════════════════════════════════════════════════════════════════════ */
export function mount(h, a) {
  host = h || {}; api = a;
  GRID = (h && h.grid) | 0 || 24;
  HALF = GRID / 2;
  if (h && h.THREE && h.scene) {
    T = h.THREE; scene = h.scene;
    try {
      group = new T.Group();
      group.name = 'sea-drains';
      scene.add(group);
    } catch (e) { group = null; warn('group: ' + (e && e.message)); }
  }
  buildUI();
  syncMeshes();
  claimPointer();      // deliberately not awaited; see netui.js's note
  return true;
}

/* 🔍 SELF-CHECK — reported only when it FAILS, the idiom every module here uses.
   Silence is a pass; a check that logs on success trains everyone to skip the
   console. */
export function verify() {
  const p = [];
  const A = apron();
  if (A < 1) p.push('apron is ' + A + ', so no cell east of the plate can be picked at all');
  const O = oceanApi();
  if (!O) p.push('no MythicOcean — every cell will refuse');
  else {
    let anyLegal = false;
    for (let z = 0; z < GRID && !anyLegal; z++) if (firstSeaColumn(z) >= 0) anyLegal = true;
    /* THE RULE MUST BE SATISFIABLE. `shoreTiles`'s own 🐞 records a gate that
       matched no tile in any city and fell through silently; a sea-only rule
       with no legal cell would be that failure with no fallback at all. */
    if (!anyLegal) p.push('no cell in the ' + A + '-column apron reads as sea in any row — the rule is unsatisfiable');
  }
  for (const k of api ? api.Net.drainKeys() : []) {
    const q = k.split(','), x = +q[0], z = +q[1];
    if (!isSeaCell(x, z)) p.push('a drain at ' + k + ' is not in the water');
    if (T && group && !built.has(k)) p.push('a drain at ' + k + ' has no structure drawn for it');
  }
  return { ok: !p.length, problems: p, apron: A, drains: api ? api.Net.drainCount() : 0, drawn: built.size };
}

export function dispose() {
  try { if (PREV) PREV.dispose(); } catch (e) {}
  try { if (group && scene) scene.remove(group); } catch (e) {}
  built.clear();
  group = null; PREV = null;
}

export default { mount, arm, isArmed, place, lift, refusalAt, isSeaCell, apron,
                 price, syncMeshes, structures, verify, dispose };
