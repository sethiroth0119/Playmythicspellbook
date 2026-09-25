/* mapforge.player.js — the first-person walker.

   Shared by the editor's Play mode and the engine's FPS mode so a map feels
   identical in both. It owns its own key/mouse listeners while active and
   nothing else: no UI, no scene ownership. Ground = the terrain heightfield;
   water = buoyancy below the map's water level. No object collision — that
   is a deliberate v1 limit, not an oversight. */

export function createPlayer(THREE, opts) {
  const { world, camera, dom } = opts;
  const P = {
    active: false, yaw: 0, pitch: 0, vy: 0, pos: new THREE.Vector3(), keys: {}, grounded: false, lockedAt: 0,
    eye: opts.eye || 1.7, radius: opts.radius || 0.35, speed: opts.speed || 6, runSpeed: opts.runSpeed || 11, jump: opts.jump || 7.5, gravity: opts.gravity || 22,
    sensitivity: opts.sensitivity || 0.0022, pointerLock: opts.pointerLock !== false,
    /* 🎥 the point of view (map.player.view) and the character it drives.
       'top' ignores the mouse: the camera hangs above and WASD move on the
       world's axes, the character turning to face where it walks. */
    view: opts.view || 'fps', avatar: opts.avatar || null, state: 'idle',
  };
  if (P.view === 'top') P.pointerLock = false;
  const map = () => world.map;

  function spawnAt(spawn) {
    if (spawn) { P.pos.set(spawn.p[0], spawn.p[1], spawn.p[2]); P.yaw = spawn.r[1] + Math.PI; }
    P.pos.y = world.heightAt(P.pos.x, P.pos.z); P.pitch = 0; P.vy = 0; P.grounded = true;
  }
  function start(where) {
    if (P.active) return;
    P.active = true; P.keys = {};
    if (where && where.pos) { P.pos.copy(where.pos); P.yaw = where.yaw || 0; P.pos.y = world.heightAt(P.pos.x, P.pos.z); P.pitch = 0; P.vy = 0; }
    else spawnAt(world.spawns()[0] || null);
    window.addEventListener('keydown', onKeyDown, true); window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('pointerlockchange', onLockChange);
    if (P.pointerLock) { try { Promise.resolve(dom.requestPointerLock()).catch(() => {}); } catch (e) {} }
    try { dom.focus(); } catch (e) {}
    frame(0);
  }
  function stop() {
    if (!P.active) return;
    P.active = false; P.keys = {};
    window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('pointerlockchange', onLockChange);
    if (document.pointerLockElement === dom) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function onKeyDown(e) {
    if (isTyping(e)) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { P.keys.space = true; e.preventDefault(); }
    else if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { P.keys[k] = true; if (k !== 'shift') e.preventDefault(); }
  }
  function onKeyUp(e) { const k = e.key.toLowerCase(); P.keys[k] = false; if (k === ' ') P.keys.space = false; }
  function onLockChange() {
    if (document.pointerLockElement === dom) P.lockedAt = performance.now();
    else if (P.active && P.pointerLock && opts.onUnlock) opts.onUnlock();
  }
  function onMouseMove(e) {
    if (!P.active) return;
    if (P.pointerLock && document.pointerLockElement !== dom) return;
    // Browsers can emit one huge synthetic movement as the cursor recentres on
    // lock; taking it as input snaps the view to the sky. Ignore that burst.
    if (performance.now() - P.lockedAt < 150 || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    P.yaw -= e.movementX * P.sensitivity;
    P.pitch = Math.max(-1.5, Math.min(1.5, P.pitch - e.movementY * P.sensitivity));
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3(), look = new THREE.Vector3();
  function frame(dt) {
    if (!P.active) return;
    const k = P.keys, m = map();
    if (P.view === 'top') { fwd.set(0, 0, -1); right.set(1, 0, 0); } else fwd.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
    right.set(fwd.z, 0, -fwd.x); mv.set(0, 0, 0);
    if (k.w || k.arrowup) mv.add(fwd); if (k.s || k.arrowdown) mv.sub(fwd); if (k.d || k.arrowright) mv.add(right); if (k.a || k.arrowleft) mv.sub(right);
    const moving = mv.lengthSq() > 0;
    if (moving && P.view === 'top') P.yaw = Math.atan2(-mv.x, -mv.z);
    P.state = moving ? (k.shift ? 'run' : 'walk') : 'idle';
    const half = world.terrain.half - 0.5;
    const inWater = m.water.on && P.pos.y + 0.9 < m.water.level;
    if (mv.lengthSq()) {
      mv.normalize().multiplyScalar((k.shift ? P.runSpeed : P.speed) * (inWater ? 0.45 : 1) * dt);
      let nx = Math.max(-half, Math.min(half, P.pos.x + mv.x)), nz = Math.max(-half, Math.min(half, P.pos.z + mv.z));
      if (world.resolveMove) { const r = world.resolveMove(P.pos.x, P.pos.z, nx, nz, P.pos.y, P.eye, P.radius); nx = r.x; nz = r.z; }
      P.pos.x = nx; P.pos.z = nz;
    }
    const ground = world.groundAt ? world.groundAt(P.pos.x, P.pos.z, P.pos.y) : world.heightAt(P.pos.x, P.pos.z);
    if (inWater) { P.vy += (k.space ? 6 : -2) * dt; P.vy *= 0.92; if (P.pos.y + 0.9 > m.water.level - 0.2 && P.vy > 0 && !k.space) P.vy = 0; }
    else { P.vy -= P.gravity * dt; if (P.grounded && k.space) { P.vy = P.jump; P.grounded = false; } }
    P.pos.y += P.vy * dt;
    if (P.pos.y <= ground) { P.pos.y = ground; P.vy = 0; P.grounded = true; } else P.grounded = inWater;
    look.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    if (P.view === 'tps') {
      /* over the shoulder: behind and a little to the right of the head, the
         camera never below the ground it is over */
      const back = 3.2, side = 0.6, up = 1.55;
      camera.position.set(P.pos.x - look.x * back + right.x * side, P.pos.y + up - look.y * back + 0.3, P.pos.z - look.z * back + right.z * side);
      const gy = world.heightAt(camera.position.x, camera.position.z) + 0.35; if (camera.position.y < gy) camera.position.y = gy;
      camera.lookAt(P.pos.x + look.x * 6 + right.x * side, P.pos.y + up + look.y * 6, P.pos.z + look.z * 6 + right.z * side);
    } else if (P.view === 'top') {
      camera.position.set(P.pos.x, P.pos.y + 17, P.pos.z + 8.5);
      camera.lookAt(P.pos.x, P.pos.y + 1, P.pos.z);
    } else {
      camera.position.set(P.pos.x, P.pos.y + P.eye, P.pos.z);
      camera.lookAt(camera.position.x + look.x, camera.position.y + look.y, camera.position.z + look.z);
    }
    if (P.avatar) { P.avatar.setVisible(P.view !== 'fps'); P.avatar.update(dt, P.pos, P.yaw, P.state); }
    if (opts.onFrame) opts.onFrame(P, dt);
  }
  function setView(view, avatar) { P.view = view || 'fps'; if (avatar !== undefined) P.avatar = avatar; P.pointerLock = opts.pointerLock !== false && P.view !== 'top'; if (P.avatar) P.avatar.setVisible(P.view !== 'fps'); }
  function interact() { return !!(P.avatar && P.avatar.interact()); }
  return Object.assign(P, { start, stop, frame, spawnAt, setView, interact });
}
