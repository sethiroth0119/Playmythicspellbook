/* ════════════════════════════════════════════════════════════════════════════
   🗼 DRIVER — the power-line GEOMETRY, built against real three.
   ----------------------------------------------------------------------------
   Run:  node .gauntlet/drive-power-lines-mesh.mjs

   WHY A SECOND DRIVER. drive-power-lines.mjs proves the SIMULATION with a stub
   THREE, because lines.js wraps its own mesh build in try/catch so a host that
   cannot give it a renderer still gets the network. That is the right shape and
   it has an obvious hole: with the stub, the mesh code never runs, so a typo in
   a constructor name would pass every assertion in that file and ship as an
   invisible network — the exact failure mode CLAUDE.md warns about for a module
   that "is reported at runtime as not mounted (non-fatal)".

   So this one hands lines.js the REAL three namespace from node_modules and
   asserts what came out. It is not a photograph and does not pretend to be:
   .gauntlet/README item 6 is emphatic that an A/B of the rendered frame needs
   renderer.render() between the two reads. This measures the SCENE GRAPH —
   how many draw calls, how many vertices, at what height — which is the thing
   a photograph would be a lossy proxy for anyway.

   ⚠ node_modules has three 0.128 and the page runs 0.171 (three.webgpu). Every
     class used here — BufferGeometry, Float32BufferAttribute, InstancedMesh,
     CylinderGeometry, BoxGeometry, Mesh, Group, Matrix4, DoubleSide — is
     present and unchanged in both, which is precisely why the wire is a MESH
     RIBBON and not THREE.LineSegments: nothing in this project renders a THREE
     line under the WebGPU build, and this driver could not tell us whether one
     would.
   ════════════════════════════════════════════════════════════════════════════ */

import * as THREE from '../node_modules/three/build/three.module.js';
import { POWER } from '../public/src/power/tuning.js';
import * as Lines from '../public/src/power/lines.js';

let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const hd = (s) => console.log('\n══ ' + s + ' ' + '═'.repeat(Math.max(0, 66 - s.length)));

const scene = new THREE.Scene();
const paid = [];
Lines.mount({ THREE, scene, grid: 24,
              tileAt: () => null,
              payCost: async (c) => { paid.push(c.cinder); return true; } },
            { onChange: () => {} });

const group = scene.children.find(o => o.name === 'mythic-power-lines');

hd('the group, and the connector that is there before anything is drawn');
ok(!!group, 'lines.js added exactly one group to the scene', group ? group.name : '(none)');

let draws = 0, verts = 0;
const walk = (o, f) => { f(o); for (const c of o.children || []) walk(c, f); };
walk(group, (o) => {
  if (o.isMesh || o.isInstancedMesh) {
    draws++;
    const p = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (p) verts += p.count * (o.isInstancedMesh ? o.count : 1);
  }
});
ok(draws > 0, 'the Grid Connector built real geometry before a single line was laid', draws + ' meshes');
const connDraws = draws;
ok(connDraws <= 12, 'and it is a handful of meshes, not a scene', connDraws + ' meshes / ' + verts + ' verts');

const conn = Lines.connector();
ok(conn.x === -1 && conn.z === -1, 'connector cell is the north-west verge', conn.k);
// world position of the connector structure: cell -1 → x-HALF+0.5 = -12.5
{
  const g = group.children.find(o => o.isGroup);
  ok(!!g, 'the connector is one Group');
  if (g) {
    ok(Math.abs(g.position.x + 12.5) < 1e-6 && Math.abs(g.position.z + 12.5) < 1e-6,
       'standing at world (-12.5, -12.5) — off the plate (ends at -12), clear of the embankment toe (-12.8)',
       g.position.x + ',' + g.position.z);
  }
}

hd('one drag, and what it costs the frame');
const run = Lines.runCells(-1, -1, 8, 8, false);
const r = await Lines.lay(run);
ok(r.ok, 'laid a long L-shaped run', r.n + ' cells for ' + r.cinder + '🔥');

let wireTris = 0;
const poles = group.children.find(o => o.isInstancedMesh);
const wires = group.children.find(o => o.isMesh && !o.isInstancedMesh);
ok(!!poles, 'the poles are ONE InstancedMesh', poles ? poles.count + ' instances for ' + r.n + ' cells' : '');
ok(!!wires, 'the wire is ONE mesh');
if (poles) ok(poles.count > 0 && poles.count < r.n,
              'a pole every other cell plus every corner — not one per cell (that reads as a fence)',
              poles.count + ' poles / ' + r.n + ' cells');
if (wires) {
  const p = wires.geometry.attributes.position;
  wireTris = p.count / 3;
  ok(!!wires.geometry.attributes.normal,
     'the wire carries normals — three\'s node materials warn once per geometry without them');
  ok(p.count % 3 === 0 && wireTris > 0, 'and is a real triangle list', wireTris + ' triangles');
  // every wire vertex sits at crossarm height, within the sag
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
  const yw = POWER.lines.y + POWER.lines.pole.h * POWER.lines.wire.hFrac;
  ok(Math.abs(hi - yw) < 1e-6, 'the wire hangs from the crossarm, not the pole tip', 'top=' + hi.toFixed(4) + ' expected=' + yw.toFixed(4));
  ok(hi - lo > 0 && hi - lo <= POWER.lines.wire.sag + 1e-6, 'and it sags', 'sag=' + (hi - lo).toFixed(4));
  ok(lo > 0.02, 'every wire vertex clears node-city\'s hover plane at y=0.02 and RD_Y at 0.016', 'lowest=' + lo.toFixed(4));
}

hd('the budget, and the rebuild');
{
  let d = 0;
  walk(group, (o) => { if (o.isMesh || o.isInstancedMesh) d++; });
  ok(d - connDraws <= 2, 'the whole network costs TWO draw calls however long it is',
     (d - connDraws) + ' beyond the connector (' + connDraws + ')');
}
// …and a second lay does not leak a second network into the scene.
await Lines.lay(Lines.runCells(8, 8, 8, 14, false));
{
  let d = 0;
  walk(group, (o) => { if (o.isMesh || o.isInstancedMesh) d++; });
  ok(d - connDraws <= 2, 'extending the network rebuilds it rather than stacking a second copy',
     (d - connDraws) + ' beyond the connector');
}
Lines.load(null);
{
  let d = 0;
  walk(group, (o) => { if (o.isMesh || o.isInstancedMesh) d++; });
  ok(d === connDraws, 'and clearing it leaves only the connector', d + ' vs ' + connDraws);
}

hd(fails ? fails + ' FAILURE(S)' : 'THE MESH IS REAL');
process.exit(fails ? 1 : 0);
