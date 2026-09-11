/* ☣️ CONTAINMENT — the Research Facility's mini-game, its ward, and the
   world viruses, behind one window object.

   Registers window.MythicContainment and is INERT until something calls it.
   Neither the 3D lab nor three.js is fetched at boot: openLab() is what pulls
   /src/biolab in, so the whole feature costs one small module until a player
   walks through the airlock.

   ⚠ THE GLOBALS TRAP (CLAUDE.md). Every module under /src/plague, /src/biolab
     and /src/ward reads the legacy app ONLY through window.MythicPlagueBridge,
     which index.html defines. With no bridge the modules still load, still
     compute, and refuse to spend anything.

   ⚠ IF THIS 404s the game loses the Containment Lab button, the ward and the
     virus banner, and nothing else — every call site checks for the object. */

import * as PL from './state.js';
import * as WS from './worldstrains.js';
import * as OB from './outbreak.js';
import * as STR from './strains.js';
import * as CURES from './cures.js';

/* The 3D lab and the ward are loaded on demand. Failure is reported to the
   caller rather than thrown: a missing sub-module must degrade to a toast,
   never to a dead button that looks like a bug. */
async function openLab(opts) {
  try {
    const m = await import('../biolab/index.js');
    return await m.open(opts || {});
  } catch (e) {
    try { console.warn('[containment] lab failed to open', e); } catch (e2) {}
    return { ok: false, error: (e && e.message) || 'Containment Lab could not load.' };
  }
}
async function openWard(opts) {
  try {
    const m = await import('../ward/index.js');
    return m.open(opts || {});
  } catch (e) {
    try { console.warn('[containment] ward failed to open', e); } catch (e2) {}
    return { ok: false, error: (e && e.message) || 'The ward could not load.' };
  }
}

/* What the Research Facility card shows without opening anything: whether a
   world virus is running, how many crates are waiting on a decision, and how
   the player's own city is doing. Every field is safe with no bridge. */
function status() {
  const out = { ready: PL.ready(), world: null, crates: 0, overdue: 0, batches: 0, strains: 0, worstStrain: null };
  try { out.world = PL.worldEvent(); } catch (e) {}
  try { out.crates = PL.awaitingWard().length; } catch (e) {}
  try { out.overdue = PL.wardOverdue().length; } catch (e) {}
  try { out.batches = PL.heldBatches().length; } catch (e) {}
  try {
    const list = PL.activeStrains();
    out.strains = list.length;
    out.worstStrain = list.slice().sort((a, b) => b.severity - a.severity)[0] || null;
  } catch (e) {}
  return out;
}

const api = {
  /* the two rooms */
  openLab, openWard,
  isLabOpen: () => { try { return !!(window.MythicBioLab && window.MythicBioLab.isOpen()); } catch (e) { return false; } },
  isWardOpen: () => { try { return !!(window.MythicWard && window.MythicWard.isOpen()); } catch (e) { return false; } },

  /* the state seam, for index.html and node-city */
  status,
  state: PL,
  cityTick: PL.cityTick,
  cityReport: PL.cityReport,
  strains: PL.strains,
  activeStrains: PL.activeStrains,
  /* the lab's register: what may go on the bench, loose or not */
  catalogue: PL.catalogue,
  sampleStrains: PL.sampleStrains,
  sampleStrain: PL.sampleStrain,
  batches: PL.batches,
  /* the loading bay: crates on the bench vs crates on the dispatch table */
  benchBatches: PL.benchBatches,
  stagedBatches: PL.stagedBatches,
  stageBatch: PL.stageBatch,
  shipments: PL.shipments,
  collect: PL.collect,

  /* 🦠 world viruses */
  worldEvent: PL.worldEvent,
  worldEventCityFx: PL.worldEventCityFx,
  worldEventBanner: WS.worldEventBanner,
  syncWorldEvent: PL.syncWorldEvent,
  WORLD_STRAINS: WS.WORLD_STRAINS,

  /* pure model, exposed so a surface can label a strain without importing */
  model: { outbreak: OB, strains: STR, cures: CURES, world: WS },

  /* 🛠 dev handles, mirroring the __mg.* convention the rest of the app uses */
  _install() {
    try {
      const mg = (window.__mg = window.__mg || {});
      mg.plague = api;
      mg.plagueWorld = (when) => WS.activeWorldEvent(when);
      /* Force a named virus into THIS city for testing. It still goes through
         introduce(), so it behaves exactly like the real thing. */
      mg.plagueSeed = (defId, host) => {
        const def = WS.WORLD_STRAIN_BY_ID[defId];
        if (!def) return 'ids: ' + WS.WORLD_STRAINS.map((s) => s.id).join(', ');
        const ev = { def, window: WS.windowIndex(), strainId: WS.worldStrainId(def.id, WS.windowIndex()) };
        const s = WS.worldStrain(ev);
        try { OB.introduce(host || { citizens: () => [] }, PL.outbreakState(), s, def.seedCases || 2, 'seeded for testing'); PL.persist(); } catch (e) {}
        return s;
      };
    } catch (e) {}
  },
};

try { window.MythicContainment = api; api._install(); } catch (e) {}
export default api;
