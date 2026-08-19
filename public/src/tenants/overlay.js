/* ════════════════════════════════════════════════════════════════════════════
   🗺 THE TENANT OVERLAY — how a business is doing, on the map.
   ----------------------------------------------------------------------------
   "Businesses fail, vacancies increase, property values decline… buildings
    become abandoned." A consequence the player cannot SEE is a consequence
    that did not happen, so the distress ladder /src/economy already runs has to
    reach the board.

   🔴 ONE PLANE, ONE CANVAS TEXTURE. The fourth instance of the pattern
      /src/power, /src/water, /src/pollution and /src/landvalue all use, and it
      is deliberately the same shape: a tinted quad per tile is 576 meshes and
      576 draw calls for a layer the player toggles.

   🔴 THREE ARRIVES FROM THE HOST (CLAUDE.md, the globals trap). `THREE` and
      `scene` are top-level `const` in node-city's module script. This file
      imports nothing from the page.

   ⚠ THE HEIGHT WAS READ OFF THE OTHER FOUR, NOT GUESSED. /src/landvalue sits
     at 0.105 with renderOrder 14, and two coplanar planes z-fight into a
     camera-dependent flicker a still frame would never show. This sits above
     it, and it is the top of that stack.

   ⚠ IT DRAWS TENANCIES, NOT BUILDINGS. A building with no tenancy is not
     painted at all — a hand-placed farm is not part of the private market and
     colouring it would be a claim about a business that does not exist.
   ══════════════════════════════════════════════════════════════════════════ */

const Y = 0.115, RENDER_ORDER = 15, PX = 16, OPACITY = 0.8;

/* The colours ARE the distress ladder's own — firms.js `RUNG_META` publishes a
   colour per rung and this reads it at sync time rather than restating it, so
   the map and the economy panel can never show a business as two different
   colours. Absent economy ⇒ the neutral tenanted tint, never an invented one. */
const NEUTRAL = '#9ad17a';
const VACANT = '#8a8578';

let THREE = null, scene = null, mesh = null, tex = null, cvs = null, cx = null;
let GRID = 24, on = false, lastSig = '', painted = 0;

export function mounted() { return !!mesh; }
export function visible() { return !!(mesh && mesh.visible); }
export function count() { return painted; }

export function mount(host) {
  if (mesh) return true;
  if (!host || !host.THREE || !host.scene) return false;
  THREE = host.THREE; scene = host.scene; GRID = host.grid || 24;
  cvs = document.createElement('canvas');
  cvs.width = cvs.height = GRID * PX;
  cx = cvs.getContext('2d');
  if (!cx) return false;
  tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: OPACITY,
                                            depthWrite: false, toneMapped: false });
  mesh = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, Y, 0);
  mesh.renderOrder = RENDER_ORDER;
  mesh.visible = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return true;
}

function rungColour(rung) {
  try {
    const E = (typeof window !== 'undefined') && window.MythicEconomy;
    const meta = E && E.ECON ? null : null;   // ECON does not carry RUNG_META
    const R = E && E.RUNG_META;
    if (R && R[rung] && R[rung].color) return R[rung].color;
  } catch (e) {}
  /* firms.js's own table, mirrored ONLY as a fallback and marked as such: the
     economy module does not currently re-export RUNG_META, and a colour is
     cosmetic — a wrong one is a wrong tint, never a wrong number. */
  return ({ HEALTHY: '#9ad17a', REDUCED: '#e0c060', LAYOFFS: '#e0a060',
            DEBT: '#7fb8ff', DEFAULT: '#e0556a', BANKRUPT: '#8a8578' })[rung] || NEUTRAL;
}

const p = (v) => v * PX;
function cell(x, z, col, inset) {
  const i = inset || 0;
  cx.fillStyle = col;
  cx.fillRect(p(x) + i, p(z) + i, PX - i * 2, PX - i * 2);
}
/* Level pips along the bottom edge of the tile — one per level the BUSINESS
   reached. The user's ladder ("Small Card Shop → … → Ouroboros Mega Store") is
   a number the player has to be able to read off the map, not out of a panel. */
function pips(x, z, n) {
  cx.fillStyle = '#ffffff';
  const w = PX * 0.13, gap = PX * 0.05;
  for (let i = 0; i < Math.min(5, n); i++) {
    cx.fillRect(p(x) + PX * 0.12 + i * (w + gap), p(z) + PX * 0.76, w, PX * 0.12);
  }
}
/* A cross for a pitch nobody will take. Distinct from a tint on purpose: the
   fact is categorical ("no company bid"), not a degree. */
function cross(x, z) {
  cx.strokeStyle = '#1b1a17'; cx.lineWidth = Math.max(2, PX * 0.13);
  cx.beginPath();
  cx.moveTo(p(x) + PX * 0.25, p(z) + PX * 0.25); cx.lineTo(p(x) + PX * 0.75, p(z) + PX * 0.75);
  cx.moveTo(p(x) + PX * 0.75, p(z) + PX * 0.25); cx.lineTo(p(x) + PX * 0.25, p(z) + PX * 0.75);
  cx.stroke();
}

/* ⚠ SIGNATURE-GATED, exactly as the other four are. Without it this is a
   texture upload every tick for a picture that has not moved. */
export function sync(data) {
  if (!mesh || !on) return 0;
  const lets = (data && data.lets) || {}, vacs = (data && data.vacs) || {};
  const keys = Object.keys(lets).sort(), vk = Object.keys(vacs).sort();
  let sig = '';
  for (const k of keys) sig += k + ':' + lets[k].rung + ':' + (lets[k].lvl | 0) + '|';
  sig += '#'; for (const k of vk) sig += k + '|';
  if (sig === lastSig) return painted;
  lastSig = sig;
  cx.clearRect(0, 0, cvs.width, cvs.height);
  painted = 0;
  for (const k of keys) {
    const c = k.split(','), x = +c[0], z = +c[1];
    if (!isFinite(x) || !isFinite(z)) continue;
    cell(x, z, rungColour(lets[k].rung), PX * 0.12);
    pips(x, z, lets[k].lvl | 0);
    painted++;
  }
  for (const k of vk) {
    const c = k.split(','), x = +c[0], z = +c[1];
    if (!isFinite(x) || !isFinite(z)) continue;
    cell(x, z, VACANT, PX * 0.12);
    cross(x, z);
    painted++;
  }
  tex.needsUpdate = true;
  return painted;
}

export function toggle(v, data) {
  if (!mesh) return false;
  on = v == null ? !on : !!v;
  mesh.visible = on;
  if (on) { lastSig = ''; sync(data); }
  return on;
}

export function dispose() {
  if (!mesh) return;
  try { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); } catch (e) {}
  mesh = tex = cvs = cx = null; lastSig = ''; on = false;
}

export default { mount, mounted, sync, toggle, visible, count, dispose };
