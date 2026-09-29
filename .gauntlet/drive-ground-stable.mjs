/* ══════════════════════════════════════════════════════════════════════════
   🗺 DRIVE-GROUND-STABLE — the ground under a city stops moving, and the mains
      stop being thrown away.

   Reported: "their ground resources are switching and changing… where the water
   ground and oil is shifting… and their pipes are deleting."

   🔴 WHAT IT ACTUALLY WAS. cityGroundId() read
        anchors[0].node.id  ||  MythicCityBridge.cityKey()  ||  'local-city'
      and the middle term is DEAD — B.cityKey has never been assigned, which
      node-city's own note at B.localKey says outright. So the answer was a
      TWO-WAY TOSS settled by how far boot had got: the anchor node id when
      game.anchors was already populated, and 'local-city' when it was not.
      /src/resmap, /src/water and /src/power all hash that string to place the
      aquifers, the ore and the oil — so one city had two grounds.
      And /src/water/network.js REFUSED any pipe blob stamped with the other
      id, wiping the mains; the next autosave then wrote the empty network over
      the top, which is what made it permanent rather than a bad boot.

   WHAT THIS PINS:
     · two ids really do produce two different deposit maps (the premise)
     · a pipe blob whose stamp disagrees is ADOPTED, not binned, and the ground
       is re-pinned to follow it — the mains are the oldest surviving evidence
       of what this city was seeded from
     · an already-built city is NEVER moved, not even to a better id
     · cityKey() is not reachable from the seed any more

   Run:  node .gauntlet/drive-ground-stable.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fieldsFor } from '../public/src/resmap/fields.js';
import Net from '../public/src/water/network.js';

const GRID = 48;
const out = {};

/* ── 1 · the premise: two ids, two worlds ────────────────────────────────── */
{
  const sig = (id) => {
    const f = fieldsFor(id, GRID);
    return f.ids.map(fid => fid + '@' + f.best(fid).x + ',' + f.best(fid).z).join('|');
  };
  const a = sig('nd_hells_kitchen');
  const b = sig('local-city');
  out.twoIdsTwoMaps = a !== b;
  out.sampleAnchored = a.slice(0, 34);
  out.sampleLegacy = b.slice(0, 34);
}

/* ── 2 · the mains survive a boot that derived the other id ──────────────── */
{
  const run = (x0, x1, z) => { const l = []; for (let x = x0; x <= x1; x++) l.push(x + ',' + z); return l; };
  Net.reset(); Net.setDomain(GRID);
  Net.setCity('nd_hells_kitchen');
  out.laid = Net.add(run(4, 19, 10));
  const blob = Net.save();
  out.savedUnder = blob.cityId;

  /* the next boot derives the legacy id — the exact drift players hit */
  Net.reset(); Net.setDomain(GRID);
  Net.setCity('local-city');
  Net.load(blob, GRID);
  out.pipesAfterDrift = Net.count();
  out.adopted = Net.adoptedId();
  out.adoptedCleared = Net.adoptedId();        // read once, then gone

  /* …and the save written after that boot still has them */
  const after = Net.save();
  out.pipesInNextSave = (after.p || '').split(' ').filter(Boolean).length;
  out.nextSaveId = after.cityId;

  /* control: a matching id adopts nothing */
  Net.reset(); Net.setDomain(GRID);
  Net.setCity('nd_hells_kitchen');
  Net.load(blob, GRID);
  out.controlPipes = Net.count();
  out.controlAdopted = Net.adoptedId();
}

/* ── 3 · the source rules a module test cannot reach ─────────────────────── */
{
  const nc = fs.readFileSync(path.resolve('public/node-city/index.html'), 'utf8');
  const wi = fs.readFileSync(path.resolve('public/src/water/index.js'), 'utf8');
  const rm = fs.readFileSync(path.resolve('public/src/resmap/index.js'), 'utf8');
  /* the seed no longer touches the storage key */
  const seedFn = nc.slice(nc.indexOf('function cityGroundId()'), nc.indexOf('function _groundHash'));
  out.src = {
    /* ⚠ THE CALL FORMS, NOT THE WORD. The seed function TALKS about cityKey —
       it has to, that warning is half the point of the comment — so a bare
       substring search finds the very word it is meant to ban and reports a
       correct fix as a failure. What matters is whether anything CALLS it. */
    seedHasNoCityKey: seedFn.indexOf('cityKey(') < 0 && seedFn.indexOf('.cityKey') < 0,
    /* an already-built city keeps the seed it has been running on */
    builtCityNotMoved: seedFn.indexOf('if (built > 0) return GROUND_LEGACY_ID;') >= 0,
    /* the pinned id still outranks everything derivable */
    pinnedWins: seedFn.indexOf('if (pinnedId) return pinnedId;') >= 0,
    /* the adoption is wired through to the ground, not just the pipes */
    waterRepinsGround: wi.indexOf('if (rm && rm.adoptCityId) rm.adoptCityId(adopted);') >= 0,
    resmapAcceptsRepair: rm.indexOf('adoptCityId(id) {') >= 0,
  };
}

console.log(JSON.stringify(out, null, 2));

const F = [];
if (!out.twoIdsTwoMaps) F.push('the premise failed — two ids gave the same map, so this test proves nothing');
if (out.pipesAfterDrift !== out.laid) F.push('the mains were lost on a drifted boot (' + out.pipesAfterDrift + ' of ' + out.laid + ')');
if (out.adopted !== 'nd_hells_kitchen') F.push('the saved ground id was not adopted (' + out.adopted + ')');
if (out.adoptedCleared !== null) F.push('the adoption was not cleared after being read — it would re-fire every boot');
if (out.pipesInNextSave !== out.laid) F.push('the next save dropped the mains (' + out.pipesInNextSave + ')');
if (out.nextSaveId !== 'nd_hells_kitchen') F.push('the next save was stamped with the drifted id, so the drift persists');
if (out.controlPipes !== out.laid) F.push('a matching id lost pipes');
if (out.controlAdopted !== null) F.push('a matching id reported an adoption it did not make');
for (const [k, v] of Object.entries(out.src)) if (!v) F.push('source rule failed: ' + k);

console.log(F.length ? ('FAIL\n  - ' + F.join('\n  - ')) : 'PASS · one city, one ground, and the mains outlive a boot that guessed wrong');
process.exit(F.length ? 1 : 0);
