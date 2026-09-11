/* closet.rig.js — MEASURING a character so clothing fits it.

   Asked for: "connect clothing correctly to the models so the character
   creator looks good — when I add a watch and measure it against the human
   models it fits them rightfully."

   How a fit is portable across bodies:
     1. findBones()   names the rig's bones by FAMILY (head, neck, chest,
                      hand.l, foot.r …) whatever the file calls them —
                      Mixamo ("mixamorig:Head"), VRM ("J_Bip_C_Head"),
                      Blender/Rigify ("hand.L"), Unreal ("hand_l"), Ready
                      Player Me ("LeftHand") all resolve to the same family.
     2. measure()     walks every skinned vertex, gives it to the bone that
                      owns most of it and grows that bone's box — so "the
                      head" is the actual head geometry, in the BODY's frame
                      (x right, y up, −z forward), with the body's scale
                      applied. That box's size is the tape measure: head
                      width, wrist thickness, foot length.
     3. socketFor()   a Group under the bone whose axes stay aligned with the
                      body at rest, so an offset of "+0.5 heads up" means the
                      same thing on every rig and follows the bone when the
                      character walks.
     4. placeItem()   scales the item so its key dimension is k × the part's
                      dimension, sits its anchor face on the part's, then
                      applies the offset and rotation from the fit record.

   A model with no skeleton (a static mannequin, a prop) still works:
   virtualParts() carves the parts out of its bounding box by human
   proportions, so every item has somewhere to hang. */

/* ── bone families and the names they go by ──
   Matching is on a NORMALISED name: lower-case, prefixes up to the last ':'
   or '_' group stripped, separators removed. Left/right is decided
   separately (l/r/left/right at either end) so one list covers both hands. */
const FAMILIES = {
  head:  ['head'],
  neck:  ['neck', 'neck1', 'neck01'],
  chest: ['spine2', 'spine02', 'spine3', 'upperchest', 'chest', 'spine1', 'spine01', 'spine'],
  hips:  ['hips', 'pelvis', 'root'],
  hand:  ['hand', 'wrist'],
  foot:  ['foot', 'ankle'],
  toe:   ['toebase', 'toe', 'toes', 'ball'],
  upperarm: ['arm', 'upperarm', 'shoulder', 'upper_arm'],
  forearm: ['forearm', 'lowerarm', 'lower_arm'],
};

function norm(name) {
  let s = String(name || '');
  s = s.replace(/^.*[:]/, '');                 // mixamorig:Head → Head, J_Bip_C_Head stays (handled below)
  s = s.replace(/^mixamorig[:_]?/i, '');        // a glTF export drops the colon: mixamorigHead → Head
  s = s.replace(/^j_bip_[clr]_/i, (m) => m.slice(6));   // VRM: J_Bip_L_Hand → L_Hand
  s = s.replace(/^(def|org|mch)[-_]/i, '');     // Rigify
  return s;
}
function sideOf(raw) {
  const s = norm(raw);
  const m = s.match(/^(left|right)/i) || s.match(/(left|right)$/i);
  if (m) return m[1].toLowerCase() === 'left' ? 'l' : 'r';
  const m2 = s.match(/^([lr])[_.\-]/i) || s.match(/[_.\-]([lr])$/i);
  if (m2) return m2[1].toLowerCase();
  return '';
}
function core(raw) {
  let s = norm(raw).replace(/^(left|right)/i, '').replace(/(left|right)$/i, '').replace(/^([lr])[_.\-]/i, '').replace(/[_.\-]([lr])$/i, '');
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* Every bone of the rig by family key: head, neck, chest, hips, hand.l,
   hand.r, foot.l, foot.r, toe.l … The FIRST bone in the tree wins a family
   (spine2 before spine, so `chest` is the upper chest when there is one). */
export function findBones(root) {
  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  const out = {};
  const rank = {}; Object.keys(FAMILIES).forEach(f => FAMILIES[f].forEach((n, i) => { rank[f + ':' + n] = i; }));
  bones.forEach(b => {
    const c = core(b.name), s = sideOf(b.name);
    Object.keys(FAMILIES).forEach(f => {
      const i = FAMILIES[f].indexOf(c); if (i < 0) return;
      const key = (f === 'hand' || f === 'foot' || f === 'toe' || f === 'upperarm' || f === 'forearm') ? (s ? f + '.' + s : null) : f;
      if (!key) return;
      if (!out[key] || rank[f + ':' + core(out[key].name)] > i) out[key] = b;
    });
  });
  return out;
}

/* ── the PARTS an item can be fitted to ──
   Each names the bone family it is measured from and, when the geometry does
   not tell us enough, a rule to derive it from a neighbouring part. */
export const PARTS = ['head', 'neck', 'chest', 'hips', 'wrist', 'hand', 'foot', 'ear'];

/* Human proportions (fractions of total height) for a body with no skeleton
   — or for a part no bone owns. Widths are fractions of the body's width. */
const PROPORTION = {
  head:  { y: [0.87, 1.00], w: 0.36 },
  neck:  { y: [0.82, 0.87], w: 0.22 },
  chest: { y: [0.60, 0.82], w: 0.85 },
  hips:  { y: [0.46, 0.60], w: 0.70 },
  hand:  { y: [0.40, 0.50], w: 0.14, x: 0.95 },
  wrist: { y: [0.49, 0.53], w: 0.11, x: 0.95 },
  foot:  { y: [0.00, 0.06], w: 0.22, x: 0.35, z: 1.6 },
  ear:   { y: [0.91, 0.95], w: 0.05, x: 1.0 },
};

const comp = (attr, i, k) => k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : k === 2 ? attr.getZ(i) : attr.getW(i);
function box3(THREE) { return new THREE.Box3(new THREE.Vector3(Infinity, Infinity, Infinity), new THREE.Vector3(-Infinity, -Infinity, -Infinity)); }
function partOf(THREE, bb, bone, key) {
  if (!bb || bb.min.x === Infinity) return null;
  const size = new THREE.Vector3(), c = new THREE.Vector3(); bb.getSize(size); bb.getCenter(c);
  return { key, bone: bone || null, min: bb.min.clone(), max: bb.max.clone(), size, center: c, virtual: !bone };
}

/* ── MEASURE ──
   Returns { frame, height, width, box, parts: { head, neck, chest, hips,
   wrist.l/.r, hand.l/.r, foot.l/.r, ear.l/.r }, bones, skinned }.
   Every vector is in FRAME space: the local space of the body's parent (the
   avatar group, the studio's scene), so the body's own scale is included
   (real metres) and its parent's position / yaw are not.
   🔴 Call with matrices up to date and the rig in its REST POSE (right after
   loading, before a mixer has run) — a measured T-pose puts the hands out to
   the sides, and that is exactly the pose the fit records expect. */
export function measure(THREE, body) {
  body.updateMatrixWorld(true);
  const parent = body.parent;
  const toFrame = new THREE.Matrix4(); if (parent) { parent.updateMatrixWorld(true); toFrame.copy(parent.matrixWorld).invert(); }
  const bones = findBones(body);
  const boxes = new Map();   // bone → Box3 in frame space
  const whole = box3(THREE);
  const v = new THREE.Vector3();
  let skinned = 0;
  body.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const pos = m.geometry.attributes.position, n = pos.count;
    const si = m.isSkinnedMesh && m.geometry.attributes.skinIndex, sw = m.isSkinnedMesh && m.geometry.attributes.skinWeight;
    const skel = m.isSkinnedMesh && m.skeleton;
    if (si && sw && skel) skinned++;
    // a dense mesh is sampled: 60k vertices tell us nothing 20k do not
    const step = n > 24000 ? Math.ceil(n / 24000) : 1;
    for (let i = 0; i < n; i += step) {
      if (si && sw && skel && m.boneTransform) { m.boneTransform(i, v); m.localToWorld(v); }
      else { v.fromBufferAttribute(pos, i); m.localToWorld(v); }
      v.applyMatrix4(toFrame);
      whole.expandByPoint(v);
      if (si && sw && skel) {
        let best = -1, bw = 0;
        // r128's BufferAttribute has getX/Y/Z/W and no getComponent
        for (let k = 0; k < 4; k++) { const w = comp(sw, i, k); if (w > bw) { bw = w; best = comp(si, i, k); } }
        /* keyed by NAME, not object: a clone whose skeleton still points at
           the template's bones (a plain Object3D.clone) measures the same */
        const bone = best >= 0 ? skel.bones[best] : null;
        if (bone) { let bb = boxes.get(bone.name); if (!bb) { bb = box3(THREE); boxes.set(bone.name, bb); } bb.expandByPoint(v); }
      }
    }
  });
  if (whole.min.x === Infinity) whole.set(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, 1.8, 0.2));
  const size = new THREE.Vector3(); whole.getSize(size);
  const H = size.y || 1.8, W = size.x || 0.6;
  const parts = {};
  const byFamily = (key) => { const b = bones[key]; return b ? partOf(THREE, boxes.get(b.name), b, key) : null; };
  /* a part's box from its bone, OR from human proportions inside the whole box */
  const virt = (key, side) => {
    const P = PROPORTION[key] || PROPORTION.chest;
    const w = W * P.w, d = (size.z || 0.3) * (P.z || 1);
    // a body facing −z has its LEFT at −x (right = forward × up = +x)
    const cx = side ? (side === 'l' ? -1 : 1) * W * 0.5 * (P.x || 0) : 0;
    const bb = new THREE.Box3(new THREE.Vector3(cx - w / 2, whole.min.y + H * P.y[0], -d / 2 + whole.min.z + size.z / 2), new THREE.Vector3(cx + w / 2, whole.min.y + H * P.y[1], d / 2 + whole.min.z + size.z / 2));
    // hands and wrists are at the sides of a T-pose or an A-pose; a static
    // mannequin is drawn with arms down, so proportions put them by the hips
    return partOf(THREE, bb, null, key + (side ? '.' + side : ''));
  };
  parts.head = byFamily('head') || virt('head');
  parts.neck = byFamily('neck') || virt('neck');
  parts.chest = byFamily('chest') || virt('chest');
  parts.hips = byFamily('hips') || virt('hips');
  ['l', 'r'].forEach(s => {
    const hand = byFamily('hand.' + s);
    parts['hand.' + s] = hand || virt('hand', s);
    /* the wrist: the hand bone's ORIGIN is the wrist joint — a watch wraps
       there. Its thickness is the hand's box at the wrist end; the hand box
       is longest along the arm, so its two shorter dimensions are the wrist. */
    if (hand && hand.bone) {
      const o = new THREE.Vector3().setFromMatrixPosition(hand.bone.matrixWorld).applyMatrix4(toFrame);
      const dims = [hand.size.x, hand.size.y, hand.size.z].slice().sort((a, b) => a - b);
      const t = Math.max(0.03, dims[0] * 0.95), t2 = Math.max(0.03, dims[1] * 0.9);
      // the wrist is a band: thickness `t` across, `t2` deep, a fifth of the hand long along the arm
      const along = Math.max(0.02, dims[2] * 0.22);
      const ax = ['x', 'y', 'z'][[hand.size.x, hand.size.y, hand.size.z].indexOf(Math.max(hand.size.x, hand.size.y, hand.size.z))];
      const half = new THREE.Vector3(t / 2, t2 / 2, t / 2); half[ax] = along / 2;
      const bb = new THREE.Box3(o.clone().sub(half), o.clone().add(half));
      parts['wrist.' + s] = partOf(THREE, bb, hand.bone, 'wrist.' + s);
      parts['wrist.' + s].along = ax;
    } else parts['wrist.' + s] = virt('wrist', s);
    const foot = byFamily('foot.' + s), toe = byFamily('toe.' + s);
    if (foot && toe) { const bb = foot.min.clone(); const mx = foot.max.clone(); bb.min(toe.min); mx.max(toe.max); parts['foot.' + s] = partOf(THREE, new THREE.Box3(bb, mx), foot.bone, 'foot.' + s); }
    else parts['foot.' + s] = foot || virt('foot', s);
  });
  /* ears: no bone owns them — the sides of the head, at eye height */
  {
    const h = parts.head;
    ['l', 'r'].forEach(s => {
      const sx = s === 'l' ? -1 : 1;   // left ear at −x, see above
      const w = Math.max(0.02, h.size.x * 0.12), hh = Math.max(0.02, h.size.y * 0.2);
      const cx = h.center.x + sx * h.size.x * 0.5, cy = h.center.y - h.size.y * 0.08, cz = h.center.z;
      const bb = new THREE.Box3(new THREE.Vector3(cx - w / 2, cy - hh / 2, cz - w), new THREE.Vector3(cx + w / 2, cy + hh / 2, cz + w));
      parts['ear.' + s] = partOf(THREE, bb, h.bone, 'ear.' + s);
    });
  }
  return { box: whole, size, height: H, width: W, parts, bones, skinned, frame: parent || null };
}

/* Which measured part a category uses on a given side */
export function partKey(cat, side) {
  const p = cat.part;
  if (p === 'wrist' || p === 'hand' || p === 'foot' || p === 'ear') return p + '.' + (side || (p === 'wrist' ? 'l' : 'l'));
  return p;
}

/* ── the SOCKET: a body-aligned frame that rides on a bone ──
   socket.world = bone.world × socket.local, and we want socket.world to have
   the FRAME's orientation and scale at the part's centre — so the item can
   be authored in body axes and metres and still follow the bone. */
export function socketFor(THREE, meas, part, body) {
  const socket = new THREE.Group(); socket.name = 'closet-socket:' + part.key;
  const parent = part.bone || body;
  parent.updateMatrixWorld(true);
  const frameM = meas.frame ? meas.frame.matrixWorld : new THREE.Matrix4();
  // the part centre, frame → world → parent-local
  const cw = part.center.clone().applyMatrix4(frameM);
  socket.position.copy(parent.worldToLocal(cw.clone()));
  const pq = new THREE.Quaternion(), ps = new THREE.Vector3(), pp = new THREE.Vector3(); parent.matrixWorld.decompose(pp, pq, ps);
  const fq = new THREE.Quaternion(), fs = new THREE.Vector3(), fp = new THREE.Vector3(); frameM.decompose(fp, fq, fs);
  socket.quaternion.copy(pq.clone().invert().multiply(fq));
  socket.scale.set(fs.x / (ps.x || 1), fs.y / (ps.y || 1), fs.z / (ps.z || 1));
  parent.add(socket);
  return socket;
}

/* ── PLACE an item inside its socket from the fit record ──
   `dims` is the item's own size at scale 1 (measured on import; re-measured
   here if missing). Returns { scale, box } for the studio's readouts. */
const FACE = { c: 0, top: 1, bottom: -1, front: -1, back: 1 };   // front = −z (the body faces −z)
export function placeItem(THREE, item, itemObj, part, cat, fit, side) {
  const axis = fit.axis || cat.axis, paxis = cat.paxis || axis;
  // the item's rotated bounding box at scale 1, so the anchor and size read as worn
  itemObj.position.set(0, 0, 0); itemObj.scale.set(1, 1, 1);
  itemObj.rotation.set(fit.rot[0], fit.rot[1], fit.rot[2]);
  itemObj.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(itemObj);
  if (bb.min.x === Infinity) bb.set(new THREE.Vector3(-0.05, -0.05, -0.05), new THREE.Vector3(0.05, 0.05, 0.05));
  // setFromObject on a child of a placed socket gives world units; measure the item alone
  const size = new THREE.Vector3(); bb.getSize(size);
  const local = localBox(THREE, itemObj);
  const lsize = new THREE.Vector3(); local.getSize(lsize);
  const itemDim = Math.max(1e-4, lsize[axis]);
  const target = Math.max(1e-4, fit.k * (part.size[paxis] || 0.1));
  const s = target / itemDim;
  const mirror = side === 'r' && cat.pair;
  itemObj.scale.set(mirror ? -s : s, s, s);
  // anchor: item face on part face, in socket space (socket origin = part centre)
  const an = fit.anchor || cat.anchor || ['c', 'c'];
  const pos = new THREE.Vector3(0, 0, 0);
  const applyAnchor = (ax, itemFace, partFace) => {
    const pf = FACE[partFace] == null ? 0 : FACE[partFace];
    const itf = FACE[itemFace] == null ? 0 : FACE[itemFace];
    const half = part.size[ax] / 2;
    const imin = local.min[ax] * s, imax = local.max[ax] * s;
    const partEdge = pf * half;
    const itemEdge = itf > 0 ? imax : itf < 0 ? imin : (imin + imax) / 2;
    pos[ax] = partEdge - itemEdge;
  };
  const yFaces = ['top', 'bottom', 'c'], zFaces = ['front', 'back', 'c'];
  if (yFaces.includes(an[1]) && yFaces.includes(an[0])) { applyAnchor('y', an[0], an[1]); applyAnchor('z', 'c', 'c'); }
  else if (zFaces.includes(an[1]) && zFaces.includes(an[0])) { applyAnchor('z', an[0], an[1]); applyAnchor('y', 'c', 'c'); }
  else { applyAnchor('y', 'c', 'c'); applyAnchor('z', 'c', 'c'); }
  applyAnchor('x', 'c', 'c');
  // the author's offset, in fractions of the part
  pos.x += fit.off[0] * part.size.x * (mirror ? -1 : 1);
  pos.y += fit.off[1] * part.size.y;
  pos.z += fit.off[2] * part.size.z;
  if (mirror) itemObj.rotation.set(fit.rot[0], -fit.rot[1], -fit.rot[2]);
  itemObj.position.copy(pos);
  itemObj.updateMatrixWorld(true);
  return { scale: s, size: lsize.clone().multiplyScalar(s), target, itemDim };
}

/* An object's bounding box in ITS OWN local space (rotation applied, scale
   and position not) — setFromObject only knows world space. */
export function localBox(THREE, obj) {
  const inv = new THREE.Matrix4();
  const saved = { p: obj.position.clone(), s: obj.scale.clone() };
  obj.position.set(0, 0, 0); obj.scale.set(1, 1, 1); obj.updateMatrixWorld(true);
  const parentM = obj.parent ? obj.parent.matrixWorld : new THREE.Matrix4();
  inv.copy(parentM).invert();
  const bb = new THREE.Box3(new THREE.Vector3(Infinity, Infinity, Infinity), new THREE.Vector3(-Infinity, -Infinity, -Infinity));
  const v = new THREE.Vector3();
  obj.traverse(m => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
    const pos = m.geometry.attributes.position, n = pos.count, step = n > 24000 ? Math.ceil(n / 24000) : 1;
    for (let i = 0; i < n; i += step) { v.fromBufferAttribute(pos, i); m.localToWorld(v); v.applyMatrix4(inv); bb.expandByPoint(v); }
  });
  obj.position.copy(saved.p); obj.scale.copy(saved.s); obj.updateMatrixWorld(true);
  if (bb.min.x === Infinity) bb.set(new THREE.Vector3(-0.05, -0.05, -0.05), new THREE.Vector3(0.05, 0.05, 0.05));
  return bb;
}
/* The item's size at scale 1 with no rotation — stored on the item as `dims` */
export function itemDims(THREE, obj) {
  const r = obj.rotation.clone(); obj.rotation.set(0, 0, 0);
  const bb = localBox(THREE, obj); obj.rotation.copy(r); obj.updateMatrixWorld(true);
  const s = new THREE.Vector3(); bb.getSize(s); return [s.x, s.y, s.z];
}

/* ── the CAMERA SWING ──
   Where to look and from where when a category opens: the part's centre (in
   frame space; the caller adds the body's world position), from the front,
   the back or the side, at `dist` × the part's largest dimension, no closer
   than `min`. A part on the left side is looked at from the left. */
export function focusFor(THREE, meas, cat, side) {
  const f = cat.focus || { part: 'chest', from: 'front', dist: 3, min: 1 };
  const key = partKey(Object.assign({}, cat, { part: f.part }), side || 'l');
  const part = meas.parts[key] || meas.parts[f.part] || meas.parts.chest;
  const big = Math.max(part.size.x, part.size.y, part.size.z, 0.05);
  const d = Math.max(f.min || 0.5, big * (f.dist || 3));
  const target = part.center.clone();
  const dir = new THREE.Vector3(0, 0, -1);
  if (f.from === 'back') dir.set(0, 0, 1);
  else if (f.from === 'side') { const sx = (side === 'r') ? 1 : -1; dir.set(sx * 0.55, 0.3, -0.8).normalize(); }   // the left wrist: from the front-left (−x) and a little above, so the body does not fill the frame
  else dir.set(0.12, 0.08, -1).normalize();
  const position = target.clone().addScaledVector(dir, d);
  return { target, position, dist: d, part: key };
}
/* the whole-body view: the default before a category is chosen */
export function focusBody(THREE, meas) {
  const c = new THREE.Vector3(); meas.box.getCenter(c);
  const d = Math.max(1.2, meas.height * 1.35);
  return { target: c, position: new THREE.Vector3(c.x + d * 0.18, c.y + meas.height * 0.08, c.z - d), dist: d, part: 'body' };
}
