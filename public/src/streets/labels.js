/* ══ 🛣 THE NAME, PAINTED ON THE ROAD ═══════════════════════════════════════
   The reference frame draws "Robin Street" along the carriageway, so this does
   too. The cost model is what decides whether it ships, and it was chosen to be
   cheap by construction rather than cheap by hope:

     · ONE plane per STREET, not per tile. A 24x24 city with a dense grid has on
       the order of 40 streets, so this is ~40 extra meshes against a built
       city's ~1,700 — about 2%, and every one of them is two triangles.
     · ONE canvas texture per street, generated once and disposed the moment the
       street it belongs to stops existing. Texture memory is 256..1024 x 64
       RGBA per street; the cap (STREET.LABEL_MAX) bounds it absolutely.
     · The planes are rebuilt only when the road network CHANGES, on the same
       rescan the street graph uses — never per frame.
     · castShadow off and receiveShadow off. A decal that casts a shadow is both
       wrong and a second draw into the shadow map.

   ⚠ Y PLACEMENT IS NOT A GUESS. index.html states the two heights this has to
     live between: the carriageway top is RD_Y = 0.016 and the footway top is
     RD_PT = 0.046. STREET.LABEL_Y sits at 0.028 — clear of the asphalt so it
     cannot z-fight it, under the kerb so it cannot appear to climb one. The
     plane is also polygonOffset'd, because a coplanar-ish decal is exactly the
     case depth precision loses on a distant tile.

   ⚠ THIS FILE OWNS NO GEOMETRY IT DOES NOT FREE. index.html's whole memory
     story (dropTileMesh / disposeOwnedGeo) is that whoever mints a buffer frees
     it. clear() below disposes geometry, material AND the canvas texture.

   ── 🔴 WHAT THE ROUND-2 CRITIC SAW, AND WHY ────────────────────────────────
   Every frame of round 2 carried "giant MIRRORED street-name text" lying across
   the roads, and it was named as the second thing that gave the game away.
   Photographed, measured and fixed here; both halves are worth writing down
   because both were wrong for a reason that looks right on paper.

   1. IT WAS NEVER MIRRORED — IT WAS 180° OUT, on north-south streets only.
      Rotating the round-2 aerial by 180° makes "East Temperance Parkway" read
      perfectly, and mirroring it does not. The plane's normal was always up and
      the transform always right-handed, so a flip was impossible; the label
      simply pointed its reading direction AWAY from the camera's right. An
      east-west street at rotation.z = 0 runs its text along world +X, which the
      default aerial (looking from +X+Z toward the origin) sees left-to-right; a
      north-south street at rotation.z = -90° runs it along world +Z, which that
      same camera sees right-to-LEFT. One convention, two opposite results.
      So the reading direction is no longer a constant at all: `orient()` is
      handed the camera's right vector and flips any label whose direction
      disagrees with it, which also means the paint stays readable when the
      player orbits. A flip is `rotation.z += PI` — the normal stays up, so the
      plane never turns away and vanishes.

   2. IT WAS TWICE THE SIZE OF ROAD PAINT. LABEL_HALF_W was 0.17 against a
      carriageway half-width of RD_HW = 0.20, i.e. the glyph band covered 85% of
      the road and cap heights ran to ~38% of it. A MUTCD road legend is about a
      third of a two-lane carriageway. The constant moved to 0.11 (see
      tuning.js) and the type went from a Georgia serif with a heavy black halo
      — which is signwriting, not paint — to a bold condensed sans with a thin
      low-alpha edge, at worn-white rather than full white.

   3. IT GLOWED. MeshBasicMaterial + toneMapped:false means paint that is the
      same brightness at midnight as at noon, which is why the dusk frame had
      four white billboards on an otherwise dark map. It is a MeshLambert now:
      two triangles per street, lit by the sun and the fill like everything else
      it sits next to, so the name dims at night and warms at dusk. That is one
      extra shader program for the whole feature and no extra draw calls.       */

import { STREET } from './tuning.js';

export function createLabels(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = 'street-labels';
  group.renderOrder = 2;
  try { ctx.scene.add(group); } catch (e) { /* no scene: labels simply never appear */ }

  let enabled = true;
  let sig = '';
  /* The camera's right vector in world XZ, as last handed to orient(). Kept so a
     REBUILD lands already facing the right way — otherwise every new plane would
     be born at its base rotation and snap round on the next orient tick. */
  let rightX = 1, rightZ = 0;

  /* ⚠ THE CANVAS IS SIZED TO THE TEXT, AND THE PLANE IS SIZED TO THE CANVAS.
     The first cut did the opposite — a fixed 1024x64 texture stretched across
     the WHOLE street — and it shipped a bug you could see from orbit: a
     19-tile street gives a plane of aspect 54:1 carrying a texture of aspect
     16:1, so every letter was smeared 3.4x wider than it was tall. Measure the
     text, cut the canvas to it, and hand the aspect ratio back so the caller
     can build a plane that matches. Nothing may assume either dimension. */
  const PAD = 18;
  function makeTexture(text) {
    const h = STREET.LABEL_TEX_H;
    const size = Math.round(h * 0.62);
    /* Road paint is a bold condensed sans, never a book serif. Georgia's
       brackets and thin strokes are what made this read as a lettered sign
       lying on the tarmac rather than as something rolled on with a stencil. */
    const font = '700 ' + size + 'px "Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif';
    const cvs = document.createElement('canvas');
    let g = cvs.getContext('2d');
    if (!g) return null;
    // Measure on a throwaway size first: setting canvas.width RESETS the 2d
    // context, so the font has to be applied again afterwards.
    cvs.width = 8; cvs.height = h;
    g.font = font;
    const textW = Math.ceil(g.measureText(text).width);
    const w = Math.max(64, Math.min(2048, textW + PAD * 2));
    cvs.width = w; cvs.height = h;
    g = cvs.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.font = font;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    /* WORN WHITE, AND ONLY AS MUCH DARK EDGE AS ANTI-ALIASING NEEDS. The old
       0.16-em black halo at 85% alpha is a drop shadow: it detached the letters
       from the surface and gave every name the outline of a logo. Real markings
       have no halo at all — they are paint that has been driven over. The thin
       0.05-em edge that is left exists so the glyphs do not dissolve where the
       label crosses the pale concrete of a crossing. */
    g.lineWidth = Math.max(1, size * 0.05);
    g.strokeStyle = 'rgba(14,13,18,.38)';
    g.lineJoin = 'round';
    g.strokeText(text, w / 2, h / 2 + 1);
    g.fillStyle = 'rgba(228,224,210,.80)';
    g.fillText(text, w / 2, h / 2 + 1);
    const tex = new THREE.CanvasTexture(cvs);
    tex.anisotropy = 4;
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return { tex, aspect: w / h };
  }

  /* WHERE THE NAME SITS. Not the street's midpoint — that is exactly where a
     crossroads tends to be, and two street names drawn across the same junction
     overlap into unreadable soup. Real road markings do the same thing for the
     same reason: they go on a clear stretch of carriageway, not through the
     intersection. So: the centre of the LONGEST run of tiles this street does
     not share with a crossing road, falling back to the true midpoint when the
     whole street is junctions (a two-tile link between two roads). */
  function seatOf(st) {
    const cells = st.cells;
    let bestA = -1, bestB = -1, curA = -1;
    for (let i = 0; i <= cells.length; i++) {
      const free = i < cells.length && !cells[i].perp;
      if (free) { if (curA < 0) curA = i; }
      else if (curA >= 0) {
        if ((i - curA) > (bestB - bestA + 1)) { bestA = curA; bestB = i - 1; }
        curA = -1;
      }
    }
    if (bestA < 0) { bestA = 0; bestB = cells.length - 1; }
    const a = cells[bestA], b = cells[bestB];
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, span: (bestB - bestA + 1) };
  }

  function clear() {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const m = group.children[i];
      group.remove(m);
      try { if (m.geometry) m.geometry.dispose(); } catch (e) {}
      try { if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } } catch (e) {}
    }
  }

  function build(streets, nameOf) {
    clear();
    if (!enabled) return 0;
    let made = 0;
    /* Longest streets first: if a pathological city somehow exceeds the cap, the
       labels that survive are the ones a player is most likely to be looking
       for, not whichever tiles Object.keys happened to yield first. */
    const list = streets.slice().sort((a, b) => b.len - a.len);
    for (const st of list) {
      if (made >= STREET.LABEL_MAX) break;
      if (st.len < STREET.LABEL_MIN_TILES) continue;
      const text = nameOf(st);
      if (!text) continue;
      const made2 = makeTexture(text);
      if (!made2) continue;
      const tex = made2.tex;
      /* Size the plane from the TEXTURE's aspect so letters keep their shape,
         then shrink it to fit inside the street if the name is long. The street
         span is inset half a tile at each end so the text never runs out over a
         junction it does not own. */
      const seat = seatOf(st);
      const spanTiles = Math.max(0.6, seat.span - 0.5);
      let ph = STREET.LABEL_HALF_W * 2;          // across the lane
      let pw = ph * made2.aspect;                // along the street
      if (pw > spanTiles) { const f = spanTiles / pw; pw = spanTiles; ph *= f; }
      const geo = new THREE.PlaneGeometry(pw, ph);
      /* ⚠ LAMBERT, NOT BASIC. See point 3 in the header: an unlit material with
         toneMapped:false is paint that does not know what time it is, and the
         dusk frame proved it. Lambert costs one program for the whole feature,
         no extra draw call, and no shadow-map work (both flags below stay off:
         a decal that casts is wrong, and a decal that receives would add a
         second program variant for a surface 3 cm above lit tarmac). */
      const mat = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = 3;

      // Tile centres -> world, using the SAME mapping placeMeshAt owns
      // (x - HALF + .5). Re-deriving it here is how a decal drifts off its road
      // the first time that mapping changes, so it is read from ctx.
      const mid = ctx.worldOf(seat.x, seat.z);
      mesh.position.set(mid.x, STREET.LABEL_Y, mid.z);
      /* rotation.x = -90 lays the plane flat. `rz` then turns it in that plane:
         0 runs the text along world +X (an east-west street), -90 along world
         +Z (a north-south one). Worked out from THREE's XYZ Euler order, not
         guessed: R = Rx * Ry * Rz, so the Z turn happens first, and under
         Rx(-90)*Rz(rz) the plane's normal lands on world +Y for EVERY rz — which
         is what makes the +PI flip in orient() safe. */
      const rz = st.axis === 'x' ? 0 : -Math.PI / 2;
      mesh.rotation.set(-Math.PI / 2, 0, rz);
      /* The reading direction this label would have at `rz`, in world XZ. Cached
         rather than re-derived because orient() runs on a timer and must not do
         trigonometry per label per tick. */
      mesh.userData.rz = rz;
      mesh.userData.dx = st.axis === 'x' ? 1 : 0;
      mesh.userData.dz = st.axis === 'x' ? 0 : 1;
      mesh.userData.flip = false;
      group.add(mesh);
      made++;
    }
    /* Face the camera we already know about, so a rebuild never shows one frame
       of back-to-front paint. */
    orient(rightX, rightZ);
    return made;
  }

  /* ── 🧭 WHICH WAY THE PAINT READS ──────────────────────────────────────────
     Handed the CAMERA's right vector projected onto world XZ. A label reads
     left-to-right exactly when its own direction agrees with that vector, so the
     test is one dot product and the fix is half a turn about the plane's normal.
     Both directions of a street are equally "correct" road paint — a real legend
     reads for the traffic it faces — so this is not correcting a bug every tick,
     it is choosing the one of two legal orientations the viewer can read.
     ⚠ It writes NOTHING when nothing changed. The common case (camera still, or
       orbiting within a quadrant) is `made` dot products and zero matrix
       updates; only a label that actually has to turn touches rotation. */
  function orient(rx, rz) {
    const m = Math.hypot(rx || 0, rz || 0);
    if (!(m > 1e-6)) return 0;            // a straight-down camera has no XZ right
    rightX = rx / m; rightZ = rz / m;
    let turned = 0;
    for (const mesh of group.children) {
      const u = mesh.userData;
      if (u.rz === undefined) continue;
      const want = (u.dx * rightX + u.dz * rightZ) < 0;
      if (want === u.flip) continue;
      u.flip = want;
      mesh.rotation.z = u.rz + (want ? Math.PI : 0);
      turned++;
    }
    return turned;
  }

  return {
    group,
    /* Rebuild only when the network or the names actually changed. `signature`
       is computed by the caller (it already walks the tiles) so this file never
       touches game.tiles. */
    sync(signature, streets, nameOf, force) {
      if (!force && signature === sig) return false;
      sig = signature;
      build(streets, nameOf);
      return true;
    },
    orient,
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) { clear(); sig = '__off__'; }
      else sig = '';                 // force a rebuild on the next sync
      return enabled;
    },
    isEnabled() { return enabled; },
    count() { return group.children.length; },
    dispose() { clear(); try { ctx.scene.remove(group); } catch (e) {} },
  };
}

export default { createLabels };
