/* ══════════════════════════════════════════════════════════════════════════
   🚜 THE FORKLIFT — a vehicle the warehouse owner buys, boards and drives.
   ══════════════════════════════════════════════════════════════════════════
   THE ASK, in the owner's words: "For the warehouse business I want to add a
   forklift where if a player who purchased a forklift they are given the
   forklift that is in the GLB, allow for the players to enter it and make it
   look like they are driving it in first person showing them in the forklift,
   allow the players to stack 10 boxes but it will only show 5 of the boxes in
   front of the forklift at a time. Allow the player to drive the forklift into
   the bay and press E to put in the bay. Make the enter [be] the space bar and
   exit the space bar. If the player exit the forklift with boxes in front of
   the forklift keep them there."

   ── HOW IT SITS IN THE PAGE ────────────────────────────────────────────────
   The warehouse is a first-person walker: `camera` IS the player. So boarding
   is not a camera swap onto a vehicle — it is the same camera, moved to the
   driver's seat and thereafter driven by the forklift's heading instead of the
   walker's. That is what makes it read as first person "showing them in the
   forklift": the model is around the camera, so the mast, the cage posts and
   the forks are all genuinely in shot because the player is genuinely inside.

   🔴 THE FORKLIFT OWNS ITS BOXES, THE PLAYER DOES NOT. Every count below lives
      on the vehicle, and that is the whole of "if the player exits with boxes
      in front of the forklift keep them there". A carried count on the PLAYER
      would have to be given back, dropped or destroyed on exit, and all three
      are wrong — the boxes are on the forks, and the forks do not move when the
      driver gets off.

   ⚠ IT DECIDES NOTHING ABOUT STORAGE. Depositing calls the page's own bay
     handler, which calls the same wh_store_crate the walking game uses, so a
     forklift load goes through the identical server rules: bay capacity, tier
     cap, ownership. A vehicle that could put things in a bay by a different
     route would be a second set of storage rules to keep in sync, and the first
     thing to drift would be the cap.

   ⚠ AND IT NEVER TOUCHES A WALLET. Buying is the page's job through WH.rpc.
   ══════════════════════════════════════════════════════════════════════════ */

export const FORK = {
  /* 📦 TEN CARRIED, FIVE DRAWN. Asked for exactly, and the gap is deliberate
     rather than a limitation: a real fork carries a pallet stack deeper than
     you can see past, and drawing all ten would bury the windscreen. The count
     is always the truth; the render is the front of the stack. */
  MAX_BOXES: 10,
  SHOWN_BOXES: 5,
  /* Metres per second. A forklift is slow, and that is the point of it — it
     carries ten where the walker carries one. */
  SPEED: 3.1,
  REVERSE: 1.9,
  TURN: 1.9,                 // radians/sec at full lock
  ACCEL: 6.0, BRAKE: 9.0,
  /* Seated eye height, and how far forward of the model's centre the driver's
     head is, as a fraction of the model's own length. Fractions rather than
     metres so the numbers survive the model being re-exported at a scale.
     🔴 POSITIVE, AND THAT WAS WORTH A SCREENSHOT. At −0.06 the camera sat
        BEHIND the seat: the shot was a driver's-eye view of the back of their
        own chair, with the mast and the load beyond it. A driver's head is in
        FRONT of the seat back, so the seat belongs behind the camera and out
        of frame — which is also what puts the roll cage posts either side of
        the view where they read as a cab rather than as scenery. */
  SEAT_Y: 1.42, SEAT_F: 0.05,
  /* Where the load sits, forward of centre and just off the deck.
     🔴 MEASURED OFF THE FORK BLADES, NOT EYEBALLED FROM THE CAB — and the two
        earlier numbers were both wrong because they were tuned from inside the
        machine, where anything ahead of you looks like it is on the forks.
        Seen from OUTSIDE, 0.82 put the pallet at Z −2.17 against a model that
        ends at −1.32: the boxes floated 0.85 m past the fork tips, unattached,
        and from most angles read as sitting beside the forklift rather than on
        it. That is the reported "the boxes is not on the forklift".
        The blades were then measured directly — geometry below 22% of the
        model's height and forward of its centre — and they run from Z −1.31
        (tip) to −0.21 (heel), 0 to 0.36 high. A pallet belongs in the middle of
        that: Z ≈ −0.85, which is 0.32 of the model's length.
     ⚠ FRACTIONS, SO A RESIZE CANNOT BREAK THIS. LENGTH grew from 2.65 to 3.05
       in the same round and this number did not have to move, because the
       blades scale with the body. */
  FORK_F: 0.32, FORK_Y: 0.30,
  BOX: 0.42,                 // a carried box is 42 cm cubed
  /* Nose to tail. The model is normalised to this whatever the exporter did,
     so it is the one place the machine's size is decided. 2.65 → 3.05 on the
     owner's note that it should be "a tad bigger": a real counterbalance truck
     is about 3 m over the forks, and at 2.65 it read as a toy beside a step
     van it is supposed to unload. */
  LENGTH: 3.05,
  BOARD_R: 2.9,              // how close you must stand to board
  /* 🚧 THE BOX THE REST OF THE WORLD BUMPS INTO, as half-extents in metres.
     Deliberately a bit tighter than the model: an axis-aligned box around a
     machine that rotates has to be the size of the BODY, not of the diagonal,
     or the player is stopped by nothing a metre from the paintwork. The forks
     are outside it on purpose — they are 10 cm off the floor and you step over
     them, which is also what stops a parked forklift walling off an aisle. */
  HULL_HW: 0.62, HULL_HD: 0.95,
  MODEL: '/assets/models/forklift.glb',
};

/* The module keeps no globals of its own beyond this one live instance —
   the page mounts exactly one warehouse. */
let CTX = null;
let S = null;

export function state() { return S; }
export function isDriving() { return !!(S && S.driving); }
export function boxes() { return S ? S.crates.length : 0; }
export function exists() { return !!(S && S.root); }

/* ══════════════════════════════════════════════════════════════════════════
   MOUNT
   ctx: { THREE, scene, camera, App, WH, toast, blocked(x,z), clampPos(x,z),
          yaw():number, setYaw(y), owned():boolean, onDeposit(unit, n):Promise,
          nearestBay():{unit,x,z}|null, setPrompt(html|null) }
   ══════════════════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  CTX = ctx || {};
  S = {
    root: null, loaded: false, loading: false,
    /* 🔴 REAL CRATES, NOT A COUNT. The first draft carried an integer, and it
       would have been a second, parallel idea of cargo living beside the
       page's own: every crate in this warehouse has a WEIGHT, an id and a BAY
       IT IS ADDRESSED TO, and the server refuses one put in the wrong bay.
       An abstract box would have had to invent all three at deposit time, and
       the first thing it would have got wrong is the address. These are the
       very objects App.held holds — {c, s} — so a forklift load is ten of
       exactly what the walker carries one of. */
    driving: false, crates: [], boxMeshes: [],
    x: 0, z: 0, heading: 0, vel: 0,
    /* Where the walker was standing when they boarded, so exiting puts them
       back beside the machine rather than inside it. */
    exitAt: null,
  };
  return API;
}

function T() { return CTX && CTX.THREE; }

/* Load a classic script once. Resolves on load, rejects on error — a silent
   failure here would leave GLTFLoader undefined and the caller guessing. */
let _scripts = {};
function loadScript(src) {
  if (_scripts[src]) return _scripts[src];
  _scripts[src] = new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => res(true);
    el.onerror = () => rej(new Error('failed to load ' + src));
    document.head.appendChild(el);
  });
  return _scripts[src];
}

/* ── loading ──────────────────────────────────────────────────────────────
   🔴 LOADED ONLY WHEN OWNED, AND ONLY ONCE. The model is 1.7 MB after being
      cut from 122; a player who has not bought one must not pay that download
      to walk around their own yard. */
async function load() {
  if (S.loaded || S.loading) return S.loaded;
  if (!CTX.owned || !CTX.owned()) return false;
  S.loading = true;
  try {
    const THREE = T();
    /* 🔴 THE PAGE'S OWN LOADER, OFF window.THREE — NOT AN ESM IMPORT.
       The warehouse runs three.js r128 as a CLASSIC GLOBAL script, and the
       examples/jsm GLTFLoader is a module that imports its own copy of three:
       loading it would build the model against a SECOND three.js whose Mesh,
       Material and Texture classes are different objects from the ones this
       scene is made of. It does not throw — it renders nothing, which is the
       worst way for it to fail. assets/vfx/loaders/GLTFLoader.js is the
       classic build that attaches to the global, and it is already in this
       repo (it supports EXT_texture_webp, which this model uses). */
    if (!THREE.GLTFLoader) await loadScript('/assets/vfx/loaders/GLTFLoader.js');
    if (!THREE.GLTFLoader) throw new Error('GLTFLoader did not attach to window.THREE');
    const loader = new THREE.GLTFLoader();
    const gltf = await new Promise((res, rej) => loader.load(FORK.MODEL, res, undefined, rej));
    const root = gltf.scene || gltf.scenes[0];

    /* Normalise: whatever the exporter did, the forklift ends up FORK.LENGTH
       long, sitting on the floor, with its nose down −Z (the page's forward). */
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3(); box.getSize(size);
    const span = Math.max(size.x, size.z) || 1;
    const k = FORK.LENGTH / span;
    root.scale.setScalar(k);

    const box2 = new THREE.Box3().setFromObject(root);
    const c = new THREE.Vector3(); box2.getCenter(c);
    /* Re-centre on X/Z and drop to the floor on Y, inside a wrapper so the
       outer node's position is the vehicle's position and nothing else. */
    const inner = new THREE.Group();
    root.position.set(-c.x, -box2.min.y, -c.z);
    inner.add(root);
    /* 🔴 THE MODEL IS AUTHORED FACING SIDEWAYS, WITH ITS FORKS DOWN −X.
       Everything in this page drives down −Z, so it gets turned a quarter — and
       the SIGN of that quarter is the whole of the reported "the boxes is not
       on the forklift, it's backwards".
       At +π/2 the mapping is (x,z) → (z,−x), which sends the forks to +Z: the
       machine drove counterweight-first and the pallet rendered at the back,
       buried in the engine cowl. At −π/2 the mapping is (x,z) → (−z,x), which
       sends −X to −Z — forks forward, load on the blades, drive nose-first.
     ⚠ AND THE HEURISTIC THAT GOT THIS WRONG IS WORTH RECORDING. The end was
       first picked by counting low-lying vertices, on the theory that fork
       blades sit near the floor. So do the wheels, the chassis rails and the
       counterweight — the two halves came out 0.34 against 0.23 and the wrong
       one won. A screenshot settled it in one look. Geometry heuristics are
       fine for measuring a thing you can already see; they are a poor way to
       decide which way a vehicle faces. */
    if (size.x > size.z) inner.rotation.y = -Math.PI / 2;

    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    S.root = wrap;
    S.forks = new THREE.Group();
    wrap.add(S.forks);
    CTX.scene.add(wrap);

    /* Park it beside the bay aisle, clear of the walking route. */
    if (!S.placed) { S.x = 4.6; S.z = 6.2; S.heading = Math.PI; S.placed = true; }
    wrap.position.set(S.x, 0, S.z);
    wrap.rotation.y = S.heading;

    /* 🚧 REGISTERED AS A COLLIDER THE MOMENT IT EXISTS. The page's blocked()
       walks App.colliders, so a plain entry in that array is all it takes for
       the walking player to bump into the machine — no second collision system,
       and it works for the truck routes and everything else that already asks
       blocked(). It is tagged _fork so the page can ignore it while the
       FORKLIFT is the thing asking (see the note in drive()), and so the bay
       rebuild's filters — which drop and re-add their own tagged entries —
       never sweep it up. */
    try {
      S.collider = { x: S.x, z: S.z, hw: FORK.HULL_HW, hd: FORK.HULL_HD, _fork: true };
      CTX.App.colliders.push(S.collider);
    } catch (e) {}

    S.loaded = true;
    return true;
  } catch (e) {
    try { console.warn('[forklift] could not load', e); } catch (_) {}
    return false;
  } finally { S.loading = false; }
}

/* ── the load on the forks ────────────────────────────────────────────────
   🔴 THE MESHES ARE POOLED, NOT REBUILT. This runs on every pick-up and every
      deposit; creating five BoxGeometries each time leaks them (three.js does
      not free GPU buffers on scene.remove) — the same leak the page's own
      rebuildTruckCrates() carries a note about. Five meshes are made once and
      shown or hidden. */
function paintLoad() {
  const THREE = T(); if (!THREE || !S.forks) return;
  if (!S.boxMeshes.length) {
    const geo = new THREE.BoxGeometry(FORK.BOX, FORK.BOX, FORK.BOX);
    for (let i = 0; i < FORK.SHOWN_BOXES; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a7b4a, roughness: 0.86, metalness: 0.04 });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.visible = false;
      S.forks.add(m);
      S.boxMeshes.push(m);
    }
  }
  /* 📦 FIVE AT MOST, STACKED FORWARD OF THE MAST. `shown` is the count the
     player SEES; `S.boxes` is the count they HAVE, and the HUD prints the
     second one so the two can never be confused. */
  const shown = Math.min(FORK.SHOWN_BOXES, S.crates.length);
  for (let i = 0; i < S.boxMeshes.length; i++) {
    const m = S.boxMeshes[i];
    m.visible = i < shown;
    if (!m.visible) continue;
    /* Two per row on the pallet, climbing — a stack, not a column. */
    const row = Math.floor(i / 2), col = i % 2;
    m.position.set((col ? 0.24 : -0.24), FORK.FORK_Y + row * (FORK.BOX + 0.02),
                   -(FORK.LENGTH * FORK.FORK_F));
    m.rotation.y = (i * 0.11) % 0.3;      // hand-stacked, not machine-perfect
  }
}

/* ── boarding ─────────────────────────────────────────────────────────────── */
function nearEnough() {
  if (!S.root) return false;
  const c = CTX.camera.position;
  return Math.hypot(c.x - S.x, c.z - S.z) < FORK.BOARD_R;
}

function board() {
  if (S.driving || !S.root) return false;
  if (!nearEnough()) return false;
  S.exitAt = { x: CTX.camera.position.x, z: CTX.camera.position.z };
  S.driving = true;
  S.vel = 0;
  try { CTX.setYaw(S.heading); } catch (e) {}
  try { CTX.toast('🚜 <b>In the forklift.</b> WASD to drive · <b>E</b> at a bay to unload · <b>Space</b> to get out.', 5200); } catch (e) {}
  return true;
}

function alight() {
  if (!S.driving) return false;
  S.driving = false;
  S.vel = 0;
  /* 🔴 THE BOXES DO NOT COME WITH THEM. The ask says so in as many words, and
     the model here is what makes that free rather than a special case: the load
     was never on the player, it was always on the vehicle. Nothing is moved,
     dropped or refunded here — the forks simply keep what is on them. */
  const THREE = T();
  /* Step out to the left of the cab, or back to where they boarded if that is
     somewhere they can actually stand. */
  let ex = S.x + Math.cos(S.heading) * 1.6;
  let ez = S.z - Math.sin(S.heading) * 1.6;
  /* ⚠ '_fork' HERE TOO. Stepping out puts the player 1.6 m to the side, which
     is well inside the machine's own hull — tested against everything BUT the
     forklift, or every exit would fall back to the boarding spot and a player
     who drove somewhere would be teleported back to where they got in. */
  if (CTX.blocked && CTX.blocked(ex, ez, '_fork') && S.exitAt) { ex = S.exitAt.x; ez = S.exitAt.z; }
  CTX.camera.position.x = ex; CTX.camera.position.z = ez;
  try { CTX.toast(S.crates.length > 0
    ? '🚜 Out. <b>' + S.crates.length + '</b> crate' + (S.crates.length === 1 ? '' : 's') + ' still on the forks.'
    : '🚜 Out of the forklift.', 3400); } catch (e) {}
  return true;
}

/* ── the drive ────────────────────────────────────────────────────────────── */
function drive(dt, keys) {
  const f = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
  const r = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);

  const want = f > 0 ? FORK.SPEED : f < 0 ? -FORK.REVERSE : 0;
  const rate = (want === 0 || (want > 0) !== (S.vel > 0)) ? FORK.BRAKE : FORK.ACCEL;
  S.vel += Math.max(-rate * dt, Math.min(rate * dt, want - S.vel));
  if (Math.abs(S.vel) < 0.02) S.vel = 0;

  /* 🚜 IT STEERS ONLY WHILE IT IS ROLLING, which is what a wheeled vehicle
     does and is also what stops the player spinning on the spot to line up a
     bay — the reason parking one is a small skill rather than a formality.
     Sign follows travel so reversing steers the way reversing does. */
  if (S.vel !== 0 && r) {
    const grip = Math.min(1, Math.abs(S.vel) / FORK.SPEED);
    S.heading += -r * FORK.TURN * dt * grip * (S.vel < 0 ? -1 : 1);
  }

  if (S.vel !== 0) {
    const nx = S.x - Math.sin(S.heading) * S.vel * dt;
    const nz = S.z - Math.cos(S.heading) * S.vel * dt;
    /* ⚠ THE SAME blocked() THE WALKER USES. A vehicle with its own collision
       would drive through the one wall the walker cannot, and the bug would be
       found by a player, in their own warehouse, holding ten boxes. Axis-split
       so a glancing hit slides instead of stopping dead. */
    let hit = false;
    /* 🚧 '_fork' IS THIS MACHINE'S OWN TAG. It is solid to the walking player
       now, which means it is also in the collider list this call reads — so
       without naming itself the forklift is stopped by its own hull and
       cannot move at all. */
    if (!CTX.blocked(nx, S.z, '_fork')) S.x = nx; else hit = true;
    if (!CTX.blocked(S.x, nz, '_fork')) S.z = nz; else hit = true;
    if (hit) S.vel *= 0.35;
    const cp = CTX.clampPos(S.x, S.z);
    S.x = cp.x; S.z = cp.z;
  }

  S.root.position.set(S.x, 0, S.z);
  S.root.rotation.y = S.heading;
  /* 🚧 …and the hull goes with it, so a machine the player parked in a doorway
     is still in the doorway when they walk back to it. An axis-aligned box
     cannot turn, so this only tracks position — see HULL_HW for why that is
     the honest trade rather than a shortcut. */
  if (S.collider) { S.collider.x = S.x; S.collider.z = S.z; }

  /* The camera IS the driver. Seated, at the wheel, looking where the machine
     is pointed — the player keeps mouse-look for their head, but the BODY is
     the vehicle, so the heading is written into the look and not merely
     followed by it. */
  const sx = S.x - Math.sin(S.heading) * (FORK.LENGTH * FORK.SEAT_F);
  const sz = S.z - Math.cos(S.heading) * (FORK.LENGTH * FORK.SEAT_F);
  CTX.camera.position.set(sx, FORK.SEAT_Y, sz);
}

/* ── loading and unloading ────────────────────────────────────────────────── */
/* Load crates onto the forks. The page hands over whatever the van has and
   whatever the lifter is allowed to raise; this only decides how many FIT. */
function pick(list) {
  const room = FORK.MAX_BOXES - S.crates.length;
  const take = (Array.isArray(list) ? list : []).slice(0, Math.max(0, room));
  for (const p of take) S.crates.push(p);
  paintLoad();
  return take;
}

async function unload(bayUnit) {
  if (!S.driving) return { ok: false, why: 'not-driving' };
  if (!S.crates.length) return { ok: false, why: 'empty' };
  if (!bayUnit) return { ok: false, why: 'no-bay' };
  /* 🔴 THROUGH THE PAGE'S OWN STORE PATH, ONE CRATE AT A TIME, AND ONLY THE
     ONES ADDRESSED TO THIS BAY. Every rule the walking game plays under — bay
     capacity, the tier ceiling, who owns the bay, whether the crate belongs
     here at all — is the server's, and this route must not be a second set of
     them. It counts down by what the page reports actually STORED, never by
     what it offered: a bay that fills on crate six must leave four on the
     forks, not swallow them.
     ⚠ CRATES FOR OTHER BAYS STAY ON THE FORKS. That is not a failure, it is
       the player having loaded a mixed pallet, and the toast says so. */
  const mine = S.crates.filter((p) => p && p.s && p.s.unit_id === bayUnit.id);
  if (!mine.length) return { ok: false, why: 'wrong-bay', left: S.crates.length };
  let stored = 0, refusal = null;
  for (const p of mine) {
    let r = null;
    try { r = await CTX.onDeposit(bayUnit, p); } catch (e) { r = null; }
    if (!r || r.ok === false) { refusal = (r && r.why) || 'refused'; break; }
    const i = S.crates.indexOf(p);
    if (i >= 0) S.crates.splice(i, 1);
    stored++;
  }
  paintLoad();
  return { ok: stored > 0, stored, left: S.crates.length, why: refusal, bay: bayUnit };
}

/* ── the per-frame hook the page calls ────────────────────────────────────── */
function tick(dt, keys) {
  if (!S.loaded || !S.root) return false;
  if (!S.driving) return false;
  drive(Math.min(0.05, dt), keys || {});
  return true;
}

const API = {
  FORK, load, tick, paintLoad,
  board, alight, pick, unload,
  isDriving: () => !!S.driving,
  boxes: () => S.crates.length,
  crates: () => S.crates.slice(),
  shown: () => Math.min(FORK.SHOWN_BOXES, S.crates.length),
  room: () => Math.max(0, FORK.MAX_BOXES - S.crates.length),
  loaded: () => !!S.loaded,
  nearEnough,
  pos: () => ({ x: S.x, z: S.z, heading: S.heading }),
  /* Board or step out with one key, which is what the ask asks for: "make the
     enter the space bar and exit the space bar". */
  toggle: () => (S.driving ? alight() : board()),
  /* Test seam — the page never calls these. */
  _set: (o) => Object.assign(S, o || {}),
  _state: () => S,
};

export default { mount, state, isDriving, boxes, exists, FORK };
