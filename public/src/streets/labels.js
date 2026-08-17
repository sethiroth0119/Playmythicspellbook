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
     it. clear() below disposes geometry, material AND the canvas texture.      */

import { STREET } from './tuning.js';

export function createLabels(ctx) {
  const THREE = ctx.THREE;
  const group = new THREE.Group();
  group.name = 'street-labels';
  group.renderOrder = 2;
  try { ctx.scene.add(group); } catch (e) { /* no scene: labels simply never appear */ }

  let enabled = true;
  let sig = '';

  function makeTexture(text, tiles) {
    const w = Math.min(1024, Math.max(256, Math.round(tiles * STREET.LABEL_PX_PER_TILE)));
    const h = STREET.LABEL_TEX_H;
    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const g = cvs.getContext('2d');
    if (!g) return null;
    g.clearRect(0, 0, w, h);
    /* Fit the name to the plane. A long name on a two-tile street would either
       overflow or be clipped by the texture edge, and a clipped street name is
       worse than a small one. */
    let size = Math.round(h * 0.62);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (; size > 10; size--) {
      g.font = '600 ' + size + 'px Georgia, "Times New Roman", serif';
      if (g.measureText(text).width <= w * 0.92) break;
    }
    /* Painted road markings are worn white with a dark halo so the text holds
       up against both fresh asphalt and the wet-look night grade. */
    g.lineWidth = Math.max(2, size * 0.16);
    g.strokeStyle = 'rgba(8,7,14,.85)';
    g.lineJoin = 'round';
    g.strokeText(text, w / 2, h / 2 + 1);
    g.fillStyle = 'rgba(238,233,222,.94)';
    g.fillText(text, w / 2, h / 2 + 1);
    const tex = new THREE.CanvasTexture(cvs);
    tex.anisotropy = 4;
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
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
      const tex = makeTexture(text, st.len);
      if (!tex) continue;
      /* The plane spans the street's tiles, inset half a tile at each end so the
         text never runs out over a junction it does not own. */
      const spanTiles = st.len - 0.5;
      const geo = new THREE.PlaneGeometry(spanTiles, STREET.LABEL_HALF_W * 2);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = 3;

      // Tile centres -> world, using the SAME mapping placeMeshAt owns
      // (x - HALF + .5). Re-deriving it here is how a decal drifts off its road
      // the first time that mapping changes, so it is read from ctx.
      const first = st.cells[0], last = st.cells[st.cells.length - 1];
      const mid = ctx.worldOf((first.x + last.x) / 2, (first.z + last.z) / 2);
      mesh.position.set(mid.x, STREET.LABEL_Y, mid.z);
      /* rotation.x = -90 lays the plane flat with its +X along world +X (an
         east-west street). rotation.z = -90 on top of that maps local +X to
         world +Z for a north-south street — worked out from THREE's XYZ Euler
         order, not guessed: R = Rx * Ry * Rz, so the Z turn happens first. */
      mesh.rotation.set(-Math.PI / 2, 0, st.axis === 'x' ? 0 : -Math.PI / 2);
      group.add(mesh);
      made++;
    }
    return made;
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
