/* 🚰 DRIVE THE MAINS IN THE REAL PAGE — the WIRING, not the model.
   Run:  node .gauntlet/win-drive.mjs --rich --wait 45000 \
           --eval-file .gauntlet/drive-water-mains-page.js

   drive-water-mains.mjs proves the model in node. This proves the six places a
   new BUILDINGS row has to be right in, four of which fail SILENTLY:
     · the row places at all, and tryPlace's fourth module refusal let it;
     · buildMesh has an arm for it (no arm = an empty Group = an invisible
       building on a tile the player paid for);
     · the pre-pass hands the module its four lists;
     · and the factor the module composed is the one `wtFactor(k)` returns at
       node-city's single `r === 'water' ? wtFactor(k) : 1`.

   MEASURED, 2026-08-20 (city `local-city`, station over the Kessel basin at 8,14):
     A  unpiped   ground 1.3474 × mains 0.3000 × sewer 1 = factor 0.4042
     B  3 tiles of main dragged with __nc.waterPipe, ONE component
        ground 1.3474 × mains 1.0000 × sewer 1 = factor 1.3474
   i.e. the network is worth 3.33× on this building and node-city charges it.

   ⚠ KEEP THIS SHORT. Under SwiftShader on a loaded box the renderer process
     dies after roughly a minute of page time, and a long driver then reports
     "Target crashed" with no result — which reads exactly like the feature under
     test throwing. Everything that can be asserted in node belongs in
     drive-water-mains.mjs; only what needs the real page belongs here.
   ⚠ --rich seeds the bridge's mock ledger before boot. A Water Station is
     3,400🔥 and the standalone ledger starts at 400. */
const nc = window.__nc, W = window.MythicWater; const out = {};
if (!nc || !W) return { fail: 'no __nc / no MythicWater' };
const E = W.endowment();
let wet = null;
for (let z = 4; z < 20 && !wet; z++) for (let x = 4; x < 16; x++)
  if (!nc.game.tiles[x + ',' + z] && E.groundAt(x, z) >= 0.25) { wet = [x, z]; break; }
out.wet = wet;
if (!wet) return Object.assign(out, { fail: 'no free aquifer tile in this scene' });

try { await nc.place('waterstation', wet[0], wet[1]); } catch (e) { out.err = e.message; }
try { nc.build.finishAll('mains driver'); } catch (e) {}
const SK = wet[0] + ',' + wet[1], t = nc.game.tiles[SK];
out.placed = !!t;
// A real recipe, not an empty Group — the silent failure this line exists for.
out.meshKids = t && t.mesh ? t.mesh.children.length : null;

const row = () => { const s = nc.water(); const w = s && s.wells && s.wells.find(q => q.k === SK);
  return w ? { f: +w.factor.toFixed(4), ground: +w.ground.toFixed(4),
               mains: +w.mains.toFixed(4), sewer: +w.sewer.toFixed(4) } : null; };
// `nc.water().factor[SK]` IS `_wtFac[k]` — the map wtFactor() reads.
const charged = () => +(nc.water().factor[SK] || 0).toFixed(4);

await nc.step(0.2, 1);
out.A_unpiped = { mains: W.mains(), factor: charged(), row: row() };

out.laid = nc.waterPipe(wet[0], wet[1] + 1, wet[0], wet[1] + 3);
await nc.step(0.2, 1);
out.B_piped = { mains: W.mains(), factor: charged(), row: row() };

out.verdict = {
  bit: out.A_unpiped.factor < out.B_piped.factor - 0.2,
  restored: Math.abs(out.B_piped.row.mains - 1) < 1e-6,
  oneComponent: out.B_piped.mains.parts === 1,
  meshReal: out.meshKids > 0,
};

/* 🖱 THE POINTER ARBITER. The pipe tool is a CLAIMANT on /src/netdrag/rig.js
   rather than a fifth listener stack, so the thing to prove is that arming it
   takes the one seat and that picking a building gives the seat back. */
const T = window.__ncTools || null;
out.tools = T ? { list: T.list(), before: T.armedId() } : null;
if (T) {
  W.pipes.tool(true);
  out.tools.afterArm = T.armedId();
  /* The OTHER half of the exclusion. Buildings are picked from the shop modal,
     not from a .bbtn, and setMode is a top-level const deliberately kept off
     the diagnostics seam — so this drives the arbiter call that node-city
     ITSELF makes on setMode('place'): rig.js bindMode -> standDownAll. What is
     being proved is that this tool releases the seat and that its release is
     VISIBLE, which is the half that actually fixes the silent-mode-conflict
     bug /src/zoning measured.
  */
  out.tools.stoodDown = T.standDownAll({ kind: 'place', type: 'housing', name: 'Housing' });
  const strip = document.getElementById('nwp-strip');
  const btn = document.getElementById('nwp-open');
  out.tools.visible = { strip: !!(strip && strip.classList.contains('on')),
                        btn: !!(btn && btn.classList.contains('active')) };
  out.tools.afterPickBuilding = T.armedId();
  W.pipes.tool(false);
}
return out;
