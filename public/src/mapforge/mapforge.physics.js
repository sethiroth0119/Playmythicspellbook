/* ═══════════════════════════════════════════════════════════════════════════
   mapforge.physics.js — rigid-body physics for Athena worlds (cannon-es).

   WHY cannon-es and not a WASM engine: the game's props are low-poly boxes,
   cylinders and heightfields; cannon-es covers exactly those shapes in
   ~340 KB of plain JavaScript that loads through one dynamic import, needs
   no build step and no WASM/CSP story. It is VENDORED at /vendor/cannon-es.js
   (v0.20.0, MIT — LICENSE next to it) rather than pulled from a CDN, so
   players never depend on a third-party host for gameplay. Override the
   URL with window.MF_CANNON_URL (the harness serves a local copy).

   What is simulated, only while PLAYING:
     • the terrain as a Heightfield (exactly the heights the player walks on)
     • every solid collider (props, .glb models, prefab parts) as a STATIC
       box / cylinder — dynamic bodies bounce off walls and crates
     • objects with a Physics component as DYNAMIC (mass, gravity) or
       KINEMATIC (moved by the graph, pushes things) bodies, synced back to
       their three.js roots each frame
     • the player as a kinematic sphere so walking into a barrel shoves it
   Contacts are collected per frame for the actor graph's On Hit event.

   Editor/edit mode never touches this; the actor snapshot restores every
   transform when play stops, so a barrel knocked into the lake is back on
   its shelf afterwards.
   ═══════════════════════════════════════════════════════════════════════════ */

let cannonP = null;
export function ensureCannon() {
  if (cannonP) return cannonP;
  const url = (typeof window !== 'undefined' && window.MF_CANNON_URL) || new URL('../../vendor/cannon-es.js', import.meta.url).href;
  cannonP = import(/* @vite-ignore */ url).then(m => m && m.World ? m : (m.default || m)).catch(e => { cannonP = null; throw e; });
  return cannonP;
}

export const PHYSICS_FIELDS = { kind: 'dynamic', shape: 'box', mass: 1, friction: 0.5, bounce: 0.1 };
export const PHYSICS_ENUMS = { kind: ['dynamic', 'kinematic'], shape: ['box', 'sphere', 'cylinder'] };

export function createPhysics(THREE, CANNON, world, opts) {
  opts = opts || {};
  const pw = new CANNON.World({ gravity: new CANNON.Vec3(0, opts.gravity == null ? -9.82 : opts.gravity, 0) });
  pw.broadphase = new CANNON.SAPBroadphase(pw); pw.allowSleep = true;
  const matDefault = new CANNON.Material('default');
  pw.defaultContactMaterial.friction = 0.5; pw.defaultContactMaterial.restitution = 0.1;
  const bodies = new Map();       // object id → { body, root, offset, comp }
  const statics = [];
  let playerBody = null, lastPlayer = null, hits = [], running = false;
  const _bb = new THREE.Box3(), _size = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _off = new THREE.Vector3();

  /* ── terrain ── cannon's Heightfield lies in its local XY plane with Z up;
     rotated -90° about X, local (x, y, h) lands at world (x, h, -y). With the
     body at (-half, 0, +half) the field covers exactly the terrain square, and
     matrix[i][j] is the height at world x = i·cell - half, z = half - j·cell. */
  function addTerrain() {
    const t = world.map.terrain, n = t.n, cell = t.cell, half = n * cell / 2, H = t.heights;
    const matrix = [];
    for (let i = 0; i <= n; i++) { const col = []; for (let j = 0; j <= n; j++) col.push(H[(n - j) * (n + 1) + i]); matrix.push(col); }
    const shape = new CANNON.Heightfield(matrix, { elementSize: cell });
    const body = new CANNON.Body({ mass: 0, material: matDefault });
    body.addShape(shape); body.quaternion.setFromEuler(-Math.PI / 2, 0, 0); body.position.set(-half, 0, half);
    body.userData = { id: 'ground' }; pw.addBody(body); statics.push(body);
  }
  /* ── static colliders ── the same world-space boxes the player walks against. */
  function addStatics() {
    world.colliders.forEach((c, id) => {
      const o = world.map.objects.find(x => x.id === id) || (world.partDoc && world.partDoc(id));
      if (o && physicsComp(o)) return;   // it will be a dynamic/kinematic body instead
      const w = c.maxX - c.minX, h = c.top - c.bottom, d = c.maxZ - c.minZ; if (w <= 0 || h <= 0 || d <= 0) return;
      const body = new CANNON.Body({ mass: 0, material: matDefault });
      if (c.shape === 'cyl') body.addShape(new CANNON.Cylinder(c.r, c.r, h, 12)); else body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
      body.position.set(c.cx, (c.top + c.bottom) / 2, c.cz); body.userData = { id };
      pw.addBody(body); statics.push(body);
    });
  }
  function physicsComp(o) { return (o && o.bp && o.bp.comps.find(x => x.type === 'physics')) || null; }
  /* ── a dynamic / kinematic body from an object's rendered bounds ── */
  function addBody(o) {
    const comp = physicsComp(o); const root = world.rootOf(o.id); if (!comp || !root) return null;
    root.updateMatrixWorld(true); _bb.setFromObject(root); if (_bb.isEmpty()) return null;
    _bb.getSize(_size); _bb.getCenter(_c);
    const kin = comp.kind === 'kinematic';
    const body = new CANNON.Body({ mass: kin ? 0 : Math.max(0.01, comp.mass), type: kin ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC, material: new CANNON.Material({ friction: comp.friction, restitution: comp.bounce }) });
    if (comp.shape === 'sphere') body.addShape(new CANNON.Sphere(Math.max(_size.x, _size.y, _size.z) / 2));
    else if (comp.shape === 'cylinder') body.addShape(new CANNON.Cylinder(Math.max(_size.x, _size.z) / 2, Math.max(_size.x, _size.z) / 2, _size.y, 12));
    else body.addShape(new CANNON.Box(new CANNON.Vec3(_size.x / 2, _size.y / 2, _size.z / 2)));
    body.position.set(_c.x, _c.y, _c.z); body.quaternion.set(root.quaternion.x, root.quaternion.y, root.quaternion.z, root.quaternion.w);
    body.linearDamping = 0.05; body.angularDamping = 0.15; body.userData = { id: o.id };
    // where the root sits relative to the body's centre, in the body's frame — so a rotating body carries its mesh correctly
    _off.copy(root.position).sub(_c).applyQuaternion(_q.copy(root.quaternion).invert());
    body.addEventListener('collide', (e) => { if (running) hits.push({ id: o.id, other: (e.body && e.body.userData && e.body.userData.id) || 'ground', impact: Math.abs(e.contact ? e.contact.getImpactVelocityAlongNormal() : 0) }); });
    pw.addBody(body);
    bodies.set(o.id, { body, root, offset: _off.clone(), comp });
    return body;
  }
  function removeBody(id) { const b = bodies.get(id); if (!b) return; pw.removeBody(b.body); bodies.delete(id); }
  function sync() {
    bodies.forEach(b => {
      if (b.body.type === CANNON.Body.KINEMATIC) { // the graph moves the root; the body follows
        b.root.updateMatrixWorld(true); _bb.setFromObject(b.root); _bb.getCenter(_c); b.body.position.set(_c.x, _c.y, _c.z); b.body.quaternion.set(b.root.quaternion.x, b.root.quaternion.y, b.root.quaternion.z, b.root.quaternion.w); return;
      }
      const q = b.body.quaternion, p = b.body.position;
      b.root.quaternion.set(q.x, q.y, q.z, q.w);
      _off.copy(b.offset).applyQuaternion(b.root.quaternion);
      b.root.position.set(p.x + _off.x, p.y + _off.y, p.z + _off.z);
    });
  }
  const api = {
    CANNON, world: pw, bodies, get running() { return running; },
    start() {
      if (running) return; running = true; hits = [];
      addTerrain(); addStatics();
      world.map.objects.forEach(o => { if (physicsComp(o)) addBody(o); });
      playerBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.45) }); playerBody.userData = { id: 'player' }; pw.addBody(playerBody); lastPlayer = null;
    },
    stop() {
      if (!running) return; running = false;
      Array.from(bodies.keys()).forEach(removeBody); statics.forEach(b => pw.removeBody(b)); statics.length = 0;
      if (playerBody) { pw.removeBody(playerBody); playerBody = null; } hits = [];
    },
    step(dt, player) {
      if (!running) return;
      if (player && playerBody) {
        const px = player.pos.x, py = player.pos.y + 0.9, pz = player.pos.z;
        if (lastPlayer) playerBody.velocity.set((px - lastPlayer.x) / Math.max(dt, 1e-3), (py - lastPlayer.y) / Math.max(dt, 1e-3), (pz - lastPlayer.z) / Math.max(dt, 1e-3));
        playerBody.position.set(px, py, pz); lastPlayer = { x: px, y: py, z: pz };
      }
      pw.step(1 / 60, dt, 3);
      sync();
    },
    /* the frame's contacts, drained by the actor runtime for On Hit */
    drainHits() { const h = hits; hits = []; return h; },
    impulse(id, v, local) { const b = bodies.get(id); if (!b) return false; b.body.wakeUp(); const vec = new CANNON.Vec3(v[0], v[1], v[2]); if (local) { const q = b.body.quaternion; const t = new CANNON.Vec3(); q.vmult(vec, t); vec.copy(t); } b.body.applyImpulse(vec, b.body.position); return true; },
    setVelocity(id, v) { const b = bodies.get(id); if (!b) return false; b.body.wakeUp(); b.body.velocity.set(v[0], v[1], v[2]); return true; },
    setKind(id, kind) { const b = bodies.get(id); if (!b) return false; if (kind === 'static') { b.body.type = CANNON.Body.STATIC; b.body.mass = 0; b.body.velocity.setZero(); } else if (kind === 'kinematic') { b.body.type = CANNON.Body.KINEMATIC; b.body.mass = 0; } else { b.body.type = CANNON.Body.DYNAMIC; b.body.mass = Math.max(0.01, b.comp.mass); } b.body.updateMassProperties(); b.body.wakeUp(); return true; },
    has: (id) => bodies.has(id),
    adopt(o) { if (running && physicsComp(o) && !bodies.has(o.id)) addBody(o); },
    forget(id) { removeBody(id); },
    dispose() { api.stop(); },
  };
  return api;
}
