/* ════════════════════════════════════════════════════════════════════════════
   🚰 THE PIPE TOOL — a dragged run, its preview, and the network overlay.
   ----------------------------------------------------------------------------
   network.js is the graph and knows nothing about a pointer. THIS file is the
   only part of the mains that touches the DOM or THREE, which is what keeps
   network.js importable from node — and therefore what makes the mains testable
   at all (see .gauntlet/drive-water-mains.mjs).

   ── 🖱 WHY THE ARBITER'S LISTENERS ARE ON `document` WITH capture:true ──────
   Verbatim the reasoning /src/zoning/ui.js wrote down and rig.js inherited,
   because it is the same canvas: node-city binds pointerdown/move/up ON THE
   CANVAS and so does OrbitControls. A listener on the same element runs in
   registration order, i.e. after the click has already been read as "place a
   building" or "orbit the camera", and stopPropagation() from there is too late.
   A capture-phase listener on `document` runs first, and one stopPropagation()
   owns the gesture. Events are swallowed ONLY while this tool is the armed
   claimant and its own hot() says the pointer is over the canvas; every UI click
   passes through untouched.

   ── 🔴 AND THIS FILE WRITES NO LISTENERS OF ITS OWN ────────────────────────
   /src/zoning/ui.js's header records the measured defect: with the Zones panel
   open, picking Housing off the build bar and clicking the map painted a green
   square and raised nothing — no building, no toast, no cue — "the worst class
   of UI bug: the player blames themselves". Its fix was written 1-vs-1. With
   four tools on this canvas the pairwise wiring is N² and every missing edge is
   that same silent bug, so this round landed /src/netdrag/rig.js: ONE armed
   claimant city-wide, ONE set of capture-phase document listeners dispatching
   only to that claimant, and one bindMode that stands everybody down when the
   player picks a building.

   This tool is a CLAIMANT on that arbiter. A fifth tool costs one claim() call
   and cannot forget an edge, which is the whole reason not to write the
   listeners again here.
   ⚠ DYNAMICALLY IMPORTED AND GUARDED. A static import would let a 404 on
     /src/netdrag take the hydrology, the mains model and the save slice down
     with it. Absent ⇒ this warns once, the button says why it is disabled, and
     everything that is not the pointer still works — including
     MythicWater.pipes.add(), which is the seam the driven test uses.
   🔴 AND NO SECOND LISTENER STACK AS A FALLBACK, DELIBERATELY. Installing our
     own document-capture listeners "just in case" is exactly the shape rig.js
     exists to stop: two dispatchers, each convinced it holds the only armed
     tool, and a build click that silently lays pipe.
   ⚠ NEVER CALL setMode FROM INSIDE A STAND-DOWN. node-city fires the mode hook
     from within setMode itself, and calling back puts two tools in a loop
     handing the pointer to each other. Arming calls setMode; standing down
     never does.

   ── THE OVERLAY IS ONE MESH ────────────────────────────────────────────────
   Same constraint /src/water/overlay.js and /src/power/overlay.js both state: a
   24×24 layer must not be 576 meshes. One PlaneGeometry, one CanvasTexture,
   repainted only when the network or the drag actually changed.
   ════════════════════════════════════════════════════════════════════════════ */

import { WATER } from './tuning.js';

let THREE = null, scene = null, host = null, api = null;
let mesh = null, tex = null, cvs = null, cx2 = null;
let GRID = 24, PX = 0;

let armed = false, drag = null, erase = false, busy = false;
let ctrlWas = null;
let dirty = true, layerOn = false, lastSig = '';
let barBtn = null, strip = null;
let lastState = null;
let TOOLS = null, TOK = null;   // /src/netdrag/rig.js — the shared arbiter

const M = () => WATER.mains;

export function repaintNext() { dirty = true; lastSig = ''; }
export function isArmed() { return armed; }

/* ════════════════════════════════════════════════════════════════════════════
   MOUNT
   `h` is node-city's hand-over (the globals trap: THREE, scene, canvas,
   controls, game and every helper below are top-level `const` in the host's
   module script and invisible to an ES module). EVERY one of them is optional:
   an older node-city that mounts /src/water with the original four-key ctx gets
   no tool and no overlay, and the simulation is unchanged — the pipe set is
   data, and a toolbar is only one way to edit it.
   ════════════════════════════════════════════════════════════════════════════ */
export function mount(h, a) {
  host = h || {}; api = a;
  GRID = (h && h.grid) | 0 || 24;
  PX = WATER.overlay.px;
  if (h && h.THREE && h.scene) buildMesh(h.THREE, h.scene);
  if (typeof document !== 'undefined' && document.body) { buildButton(); buildStrip(); }
  /* Deliberately NOT awaited by the caller. /src/water's mount() is synchronous
     and the simulation must be live the moment it returns — the arbiter is only
     needed by the time a human can press a button, which is several frames
     later. Failure leaves `TOOLS` null and the button explaining itself. */
  claimPointer();
  return true;
}

async function claimPointer() {
  try {
    const rig = await import('../netdrag/rig.js');
    TOOLS = (rig && typeof rig.tools === 'function') ? rig.tools() : null;
  } catch (e) { TOOLS = null; }
  if (!TOOLS) {
    try { console.warn('[water/mains] /src/netdrag/rig.js is absent, so the pipe drag cannot arm without becoming a second pointer owner. Everything else in /src/water is unaffected.'); } catch (e) {}
    if (barBtn) {
      barBtn.disabled = true;
      barBtn.title = 'The shared map-pointer tool is not loaded, so mains cannot be laid by hand right now.';
    }
    return;
  }
  TOK = TOOLS.claim('water-mains', { label: '🚰 Pipes', standDown });
  TOK.on({
    down: onDown, move: onMove, up: onUp, ctx: onCtx, key: onKey,
    /* `cancel` is the mid-gesture case: the arbiter hands the seat away while a
       drag is in flight. Releasing OrbitControls here is not cosmetic — a tool
       that stands down still holding `controls.enabled = false` kills the camera
       for the rest of the session. */
    cancel: () => { drag = null; releaseControls(); dirty = true; paint(); },
  });
  /* Registered ONCE by whichever module gets there first; a second call is a
     no-op that returns true, so neither this file nor the road tool has to know
     which of them mounted earlier. BUILDINGS is not in this module's ctx — the
     arbiter uses it only to NAME the building in the stand-down reason, and
     whichever claimant did pass it has already bound the hook. */
  try { TOOLS.bindMode(host.onMode, host.BUILDINGS); } catch (e) {}
}

/* 🔴 THE STAND-DOWN MUST END IN SOMETHING THE PLAYER CAN SEE — rig.js says so in
   as many words, and /src/zoning's header explains what a silent one costs. The
   strip closes, the bar button clears, and a toast names the tool that took the
   pointer. */
function standDown(reason) {
  if (!armed) return;
  armed = false;
  drag = null;
  releaseControls();
  dirty = true;
  refreshStrip();
  syncVisible();
  paint();
  const who = reason && (reason.name || reason.label);
  toast('🚰 Pipe tool put away' + (who ? ' — you picked ' + who + '.' : '.') +
        ' Click 🚰 Pipes to lay mains again.', 'good');
}

function buildMesh(T, sc) {
  THREE = T; scene = sc;
  try {
    cvs = document.createElement('canvas');
    cvs.width = cvs.height = GRID * PX;
    cx2 = cvs.getContext('2d');
    if (!cx2) return;
    tex = new THREE.CanvasTexture(cvs);
    /* NearestFilter, unlike the aquifer overlay's Linear one, and for the reason
       that file states in the other direction: an aquifer is a continuous body
       and hard tile edges draw a staircase the geology does not have — but a
       pipe either is under this tile or is not, and a smeared main is a main the
       player cannot tell the extent of. */
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(GRID, GRID);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true,
      opacity: M().overlayOpacity, depthWrite: false, toneMapped: false });
    mesh = new THREE.Mesh(geo, mat);
    // -PI/2 about X lays it flat with canvas (0,0) over tile (0,0) — node-city's
    // own mapping, no flip anywhere. Above both other info-view planes; see
    // WATER.mains.overlayY for why the y-stack is load-bearing.
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, M().overlayY, 0);
    mesh.renderOrder = M().renderOrder;
    mesh.visible = false;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
  } catch (e) { mesh = null; }
}

/* ── THE BUILD-BAR BUTTON ───────────────────────────────────────────────────
   Created here rather than in node-city so the whole feature is one import: a
   404 on /src/water leaves no dead button pointing at nothing. Same argument
   /src/zoning/ui.js makes for its own. */
function buildButton() {
  const bar = document.getElementById('buildbar');
  if (!bar) return;
  if (!document.getElementById('nwp-style')) {
    const st = document.createElement('style');
    st.id = 'nwp-style';
    st.textContent = `
#nwp-strip{position:absolute;left:50%;transform:translateX(-50%);bottom:92px;z-index:7;display:none;
  background:var(--panel,rgba(16,12,26,.92));border:1px solid var(--edge,rgba(212,175,55,.35));
  border-radius:10px;padding:7px 12px;color:var(--bone,#e9e0cc);font-size:12px;line-height:1.4;
  box-shadow:0 14px 34px rgba(0,0,0,.55);max-width:min(680px,calc(100% - 24px))}
#nwp-strip.on{display:block}
#nwp-strip b{color:var(--sky,#8fd0e8)}
#nwp-strip .nwphint{color:var(--mist,#8f87a3);font-size:11px}
#nwp-strip .nwpwarn{color:#ffbf9a}
#nwp-strip .nwpx{background:none;border:0;color:var(--mist,#8f87a3);cursor:pointer;font-size:13px;
  float:right;margin-left:10px}`;
    document.head.appendChild(st);
  }
  barBtn = document.createElement('button');
  barBtn.className = 'bbtn tool';
  barBtn.id = 'nwp-open';
  barBtn.innerHTML = '<span class="bico">🚰</span><span class="bname">Pipes</span>';
  barBtn.onclick = () => arm(!armed);
  bar.appendChild(barBtn);
}

function buildStrip() {
  strip = document.createElement('div');
  strip.id = 'nwp-strip';
  strip.addEventListener('click', (ev) => { if (ev.target.closest('[data-nwpx]')) arm(false); });
  (document.body || document.documentElement).appendChild(strip);
}

const money = (n) => Math.round(n).toLocaleString();

/* The price of ONE tile of main. The authored figure lives in this module's
   tuning table (WATER.mains.pipeCost, on node-city's own 2..600 shelf) and the
   ×100 scaling lives in the host's single scaleCost() helper — the same split
   /src/streets/index.js uses for `roadCost`, and with the same warning attached:
   reading a raw table figure without the host's scaling quotes 100× low and
   looks perfectly correct. */
function tilePrice() {
  const raw = M().pipeCost;
  try { if (typeof host.scaleCinder === 'function') return host.scaleCinder(raw) | 0; } catch (e) {}
  return null;   // unknown, NOT a guess — see commit()
}

function stripHtml() {
  const n = api.Net.count();
  const parts = api.Net.components().count;
  const price = tilePrice();
  const st = api.netState && api.netState();
  let h = '<button class="nwpx" type="button" data-nwpx="1" aria-label="Close">✖</button>';
  h += '<b>🚰 MAINS</b> — drag to lay a run · right-drag to lift one · Esc to stop';
  h += '<div class="nwphint">' + n + ' tile' + (n === 1 ? '' : 's') + ' of main · ' +
       parts + ' network' + (parts === 1 ? '' : 's') +
       (price != null ? ' · ' + money(price) + ' 🔥 per tile' : '') + '</div>';
  if (drag) {
    const path = api.Net.pathBetween(drag.x0, drag.z0, drag.x1, drag.z1, api.grid());
    const fresh = erase ? path.filter(k => api.Net.has(k)) : path.filter(k => !api.Net.has(k));
    h += '<div class="nwphint">' + (erase ? '🧽 Lifting ' : '▬ ') + fresh.length + ' of ' + path.length + ' tile' +
         (path.length === 1 ? '' : 's') +
         (!erase && price != null ? ' · <b>' + money(fresh.length * price) + ' 🔥</b>' : '') + '</div>';
  } else if (st && st.plumbed) {
    if (st.demand.unservedTiles) {
      h += '<div class="nwphint nwpwarn">⚠ ' + st.demand.unservedTiles +
           ' building' + (st.demand.unservedTiles === 1 ? '' : 's') + ' the mains do not reach.</div>';
    }
    if (st.backup > WATER.sewer.warnAbove) {
      h += '<div class="nwphint nwpwarn">🚱 ' + Math.round(st.backup * 100) +
           '% of the sewage has nowhere to go — build a Sewer Outfall on open water and pipe it in.</div>';
    }
  }
  return h;
}

function refreshStrip() {
  if (!strip) return;
  strip.classList.toggle('on', armed);
  if (armed) strip.innerHTML = stripHtml();
  if (barBtn) barBtn.classList.toggle('active', armed);
}

/* ── ARMING, AND THE TOOL EXCLUSION ─────────────────────────────────────── */
export function arm(v) {
  const want = v == null ? true : !!v;
  if (want === armed) { refreshStrip(); return armed; }
  if (want) {
    if (!TOK) {
      toast('🚰 The shared map tool is not loaded in this build, so mains cannot be laid by hand.', 'bad');
      return false;
    }
    /* 🔴 THE ARBITER DECIDES, NOT THIS FILE. `arm()` returns false when it is
       re-entered from inside a stand-down — which is the loop rig.js exists to
       refuse — and taking the seat regardless is how two tools end up both
       believing they hold it. */
    if (!TOK.arm()) return armed;
    armed = true;
    /* Leave build mode, exactly as /src/zoning does — and tell the player, so a
       building taken out of their hand is a tool swap rather than a lost click.
       ⚠ SAFE TO CALL setMode HERE: this is the ARM path, not a stand-down. The
         arbiter's bindMode only reacts to setMode('place'). */
    let held = false;
    try { held = typeof host.mode === 'function' && host.mode() === 'place'; } catch (e) {}
    try { if (typeof host.setMode === 'function') host.setMode('inspect'); } catch (e) {}
    if (held) toast('🚰 Pipe tool armed — the building you were holding was put back. Press ✖, or pick a building again, to build.', 'good');
  } else {
    armed = false;
    drag = null; releaseControls();
    try { if (TOK) TOK.disarm(); } catch (e) {}
  }
  dirty = true;
  refreshStrip();
  syncVisible();
  return armed;
}

function toast(msg, cls) { try { if (typeof host.toast === 'function') host.toast(msg, cls); } catch (e) {} }

function holdControls() {
  if (ctrlWas === null && host.controls) { ctrlWas = host.controls.enabled; host.controls.enabled = false; }
}
function releaseControls() {
  if (ctrlWas !== null && host.controls) { host.controls.enabled = ctrlWas; }
  ctrlWas = null;
}

/* ── POINTER ────────────────────────────────────────────────────────────────
   `hot` is the whole guard: armed, over the canvas, and the page able to turn a
   pointer into a tile. Anything else and the event is left alone.
   ⚠ THE `place` BELT, same as /src/zoning's. If this is ever loaded against a
     page with no mode hook, the exclusion above cannot fire — and then the
     player who just picked a building must win, because they are holding it. */
function hot(ev) {
  const canvas = host.canvas;
  if (!armed || !canvas || ev.target !== canvas || typeof host.tileFromEvent !== 'function') return false;
  try { if (typeof host.mode === 'function' && host.mode() === 'place') return false; } catch (e) {}
  return true;
}

function onDown(ev) {
  if (!hot(ev) || (ev.button !== 0 && ev.button !== 2)) return;
  const t = host.tileFromEvent(ev);
  if (!t) return;
  ev.preventDefault(); ev.stopPropagation();
  erase = ev.button === 2;
  drag = { x0: t.x, z0: t.z, x1: t.x, z1: t.z };
  holdControls();
  dirty = true; refreshStrip(); paint();
}

function onMove(ev) {
  if (!hot(ev)) return;
  if (!drag) return;
  const t = host.tileFromEvent(ev);
  ev.preventDefault(); ev.stopPropagation();
  if (t && (t.x !== drag.x1 || t.z !== drag.z1)) {
    drag.x1 = t.x; drag.z1 = t.z;
    dirty = true; refreshStrip(); paint();
  }
}

function onUp(ev) {
  if (!drag) return;
  const d = drag;
  drag = null;
  releaseControls();
  if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); }
  commit(d);
}

function onCtx(ev) { if (hot(ev)) { ev.preventDefault(); ev.stopPropagation(); } }

function onKey(ev) {
  if (!armed) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (ev.key === 'Escape') { arm(false); ev.stopPropagation(); }
}

/* ── THE COMMIT ─────────────────────────────────────────────────────────────
   🔴 ONE AWAITED CHARGE FOR THE WHOLE RUN, NOT ONE PER TILE. node-city's
      tryPlace() is an awaited bridge round-trip per building and its refusals
      are toasts on a three-slot rail; a 20-tile drag through that path shows the
      player three arbitrary refusals and no account of the rest, which is why
      /src/zoning's develop() had to invent the __ncToastSink batching pattern.
      A pipe is not a BUILDINGS row and does not go near tryPlace, so the honest
      shape here is the simple one: price the run, charge it once, lay it once,
      say so once.
   ⚠ AND THE PRICE IS NEVER GUESSED. If the host did not hand over its cost
     scaler, tilePrice() returns null and this refuses rather than laying free
     pipe — a utility that is silently free is a balance change nobody chose.
     ⚠ `busy` because payCost is awaited: a second drag released while the first
       is in flight would spend twice against one quote. */
async function commit(d) {
  if (busy) return;
  const path = api.Net.pathBetween(d.x0, d.z0, d.x1, d.z1, api.grid());
  if (!path.length) { dirty = true; paint(); return; }

  if (erase) {
    const n = api.Net.remove(path);
    if (n) {
      toast('🧽 Lifted ' + n + ' tile' + (n === 1 ? '' : 's') + ' of main.', 'good');
      after();
    }
    dirty = true; refreshStrip(); paint();
    return;
  }

  const fresh = path.filter(k => !api.Net.has(k));
  if (!fresh.length) { dirty = true; paint(); refreshStrip(); return; }

  const price = tilePrice();
  if (price == null) {
    toast('🚰 The pipe price is unavailable in this build, so nothing was laid. (The city did not hand /src/water its cost scaler.)', 'bad');
    dirty = true; paint(); return;
  }
  const total = fresh.length * price;
  busy = true;
  try {
    let paid = false;
    try { paid = typeof host.payCost === 'function' ? await host.payCost({ cinder: total }) : false; }
    catch (e) { paid = false; }
    if (!paid) {
      toast('🚰 Cannot afford ' + fresh.length + ' tile' + (fresh.length === 1 ? '' : 's') +
            ' of main (' + money(total) + ' 🔥).', 'bad');
      dirty = true; paint(); return;
    }
    api.Net.add(fresh);
    toast('🚰 Laid ' + fresh.length + ' tile' + (fresh.length === 1 ? '' : 's') + ' of main · ' +
          money(total) + ' 🔥.', 'good');
    after();
  } finally {
    busy = false;
    dirty = true; refreshStrip(); paint();
  }
}

function after() {
  try { if (typeof host.saveSoon === 'function') host.saveSoon(); } catch (e) {}
  try { if (api && api.onEdit) api.onEdit(); } catch (e) {}
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAINT. Tile space throughout, one canvas, repainted only when the picture
   actually changed — the signature gate /src/water/overlay.js states.
   ════════════════════════════════════════════════════════════════════════════ */
const px = (v) => v * PX + PX / 2;

function line(a, b, col, w) {
  cx2.strokeStyle = col;
  cx2.lineWidth = w;
  cx2.lineCap = 'round';
  cx2.beginPath();
  cx2.moveTo(px(a.x), px(a.z));
  cx2.lineTo(px(b.x), px(b.z));
  cx2.stroke();
}
function dot(p, col, r) {
  cx2.fillStyle = col;
  cx2.beginPath();
  cx2.arc(px(p.x), px(p.z), r, 0, Math.PI * 2);
  cx2.fill();
}
const parse = (k) => { const p = String(k).split(','); return { x: +p[0], z: +p[1] }; };

export function sync(state, layerEnabled) {
  lastState = state || lastState;
  layerOn = !!layerEnabled;
  syncVisible();
  paint();
}

export function onSolve(s) { lastState = s; dirty = true; paint(); refreshStrip(); }

function syncVisible() {
  if (!mesh) return;
  mesh.visible = armed || (layerOn && api.Net.count() > 0);
}

function paint() {
  if (!mesh || !cx2) return;
  syncVisible();
  if (!mesh.visible) return;

  const st = api.netState && api.netState();
  const sig = [
    api.Net.count(), api.Net.keys().join('|'),
    drag ? drag.x0 + ':' + drag.z0 + ':' + drag.x1 + ':' + drag.z1 + ':' + (erase ? 'e' : 'd') : '-',
    st ? st.components + ':' + st.wells.map(w => w.comp).join(',') : '-',
  ].join('#');
  if (!dirty && sig === lastSig) return;
  dirty = false; lastSig = sig;

  cx2.clearRect(0, 0, cvs.width, cvs.height);
  const C = WATER.col;
  const W = Math.max(2, PX * 0.26);

  /* WHICH COMPONENTS ARE ALIVE. A main with no waterworks on it is drawn dead
     slate rather than left out: the player built it, it is there, and "why is
     that run grey" is precisely the question this overlay exists to answer —
     the same argument /src/water/overlay.js makes for its grey well marker. */
  const live = new Set();
  if (st) for (const w of st.wells) if (w.comp >= 0) live.add(w.comp);

  const comp = st ? st.comp : api.Net.components();
  const keys = api.Net.keys();
  const set = new Set(keys);

  // Trunks first, then junctions on top, so a corner reads as a joint.
  for (const k of keys) {
    const a = parse(k);
    const c = comp.id[k];
    const col = (!st || !st.plumbed) ? C.pipe : (live.has(c) ? C.pipe : C.pipeDead);
    for (const b of [{ x: a.x + 1, z: a.z }, { x: a.x, z: a.z + 1 }]) {
      if (set.has(b.x + ',' + b.z)) line(a, b, col, W);
    }
    dot(a, col, W * 0.62);
  }

  /* THE DRAG PREVIEW. Ember for new tiles, red for the ones a right-drag will
     lift, and the tiles already carrying a main are drawn in neither — a
     preview that highlights what will not change is a preview that lies about
     the price on the strip beside it. */
  if (drag) {
    const path = api.Net.pathBetween(drag.x0, drag.z0, drag.x1, drag.z1, api.grid());
    const col = erase ? C.pipeBad : C.pipeGhost;
    for (let i = 0; i < path.length; i++) {
      const a = parse(path[i]);
      const shown = erase ? set.has(path[i]) : !set.has(path[i]);
      if (i + 1 < path.length) {
        const b = parse(path[i + 1]);
        const bShown = erase ? set.has(path[i + 1]) : !set.has(path[i + 1]);
        if (shown || bShown) line(a, b, col, W * 0.9);
      }
      if (shown) dot(a, col, W * 0.55);
    }
  }

  /* THE OUTFALLS. Marked on the network they are attached to, because "is my
     outfall on the main" is the second question the sewer meter provokes and
     the answer is otherwise invisible. */
  if (st) for (const o of st.sewage.outfalls) {
    /* `live` — wet AND on a main — not `effective > 0`. An outfall on a main
       that has no demand on it yet treats nothing simply because there is
       nothing to treat, and painting that red tells a player who just built it
       correctly that they built it wrong. */
    cx2.strokeStyle = o.live ? C.sewer : C.pipeBad;
    cx2.lineWidth = Math.max(2, PX * 0.14);
    cx2.strokeRect(o.x * PX + PX * 0.16, o.z * PX + PX * 0.16, PX * 0.68, PX * 0.68);
  }

  tex.needsUpdate = true;
}

export function dispose() {
  if (!mesh) return;
  try { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); } catch (e) {}
  mesh = tex = cvs = cx2 = null;
}

export default { mount, arm, isArmed, sync, onSolve, repaintNext, dispose };
