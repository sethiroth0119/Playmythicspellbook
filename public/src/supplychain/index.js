/* ═══════════════════════════════════════════════════════════════════════════
   🔗 SUPPLY CHAIN · index.js — the entry tag. Registration, the door, the
   probe, and the deep link. Nothing else: every line of screen is render.js.

   Loaded from index.html as
       <script type="module" src="src/supplychain/index.js?v=sc2"></script>
   with the classic `window.SupplyChainBridge` block ABOVE it (classic scripts
   run in document order, modules are deferred, so the bridge is always there
   first — the same ordering rule the Car Factory's seam follows).

   WHY THIS FILE IS TINY AND SYNCHRONOUS. It runs on every page load, for every
   player, whether or not they ever open the map. So it must not build the
   graph, must not touch three.js, and must not read the catalogue: all of that
   is inside render.open(), behind the tile the player clicks. The only work
   done at load is attaching three globals and, if the URL asks for it, one
   timer.

   🔴 THE MAP MUST OPEN WITH NO BRIDGE AT ALL. A missing or half-built
   SupplyChainBridge is not an error state: the structure of the economy is in
   the snapshot data files and is worth showing on its own. What changes is that
   every FIGURE reads "unknown" instead of a number, and the footer says so.
   warnMissing() logs that once, for a developer, and is never shown to a player
   as a failure.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SC } from './tuning.js';
import * as bridge from './sc.bridge.js';
import { open, close, isOpen, current, API as viewAPI } from './render.js';

/* One shared promise for "the map is up", so a caller (a test, a tutorial step,
   a deep link that races the hub's own boot) can await the same open instead of
   starting a second one. render.open() is already idempotent; this only keeps
   the last promise reachable. */
let _ready = null;

function openMap(opts) {
  if (!bridge.ready()) bridge.warnMissing('MythicSupplyChain.open');
  _ready = open(opts || {});
  return _ready;
}

const MythicSupplyChain = {
  version: SC.version,
  open: openMap,
  close,
  isOpen,
  /* `ready` is a PROPERTY, not a stored promise: before the first open there is
     nothing to await, and handing back a promise that never settles is worse
     than handing back null. */
  get ready() { return _ready; },
  get data() { const s = current(); return s ? s.data : null; },
  get graph() { const s = current(); const d = s && s.data; return d ? d.graph : null; },
  /* the bridge, re-exported, so a console session (or the integration piece's
     smoke) can see exactly what the map sees */
  bridge,
};

try { window.MythicSupplyChain = MythicSupplyChain; } catch (e) {}
/* The door the rest of the app calls. A plain global function, because the
   Ruin Exchange tile is a legacy onclick in index.html and a legacy onclick
   cannot see an ES-module binding (CLAUDE.md, the globals trap). */
try { window.openSupplyChain = (opts) => openMap(opts); } catch (e) {}

/* The probe. Every module feature in this app hangs one off window.__mg so a
   Playwright run (and a human in the console) can ask "is it mounted, and what
   is it showing" without opening anything. Everything here is READ-ONLY apart
   from open/close. */
try {
  window.__mg = window.__mg || {};
  window.__mg.supplyChain = {
    version: SC.version,
    mounted: true,
    isOpen,
    open: openMap,
    close,
    bridge: () => ({ ready: bridge.ready(), healthy: bridge.healthy(['transport']), phase: bridge.transportPhase() }),
    /* the mounted view's own API (select / home / highlightFlow / setFilter /
       pause / renderNow / project / stats). A test needs pause()+renderNow(t)
       to photograph ONE deterministic frame; without it an A/B of the map is
       racing the idle spin and the trucks, and reports a confident wrong
       number (CLAUDE.md, "Verifying"). */
    view: () => { const s = current(); return s ? s.view : null; },
    /* 🔴 The four recovery fields (view2dReason / scenePending / webgl /
       focused) are COPIED IN FROM render.js's own API, not re-derived here.
       They used to exist only on that object, which nothing imported, so a test
       following the documented recipe — `__mg.supplyChain.state().view2dReason`
       — read `undefined` and would score an HONEST "the 3D map could not start"
       footer as a missing one. The `import` above resolves to the same module
       instance render.js registered, so this is the same live state, not a
       copy: one door, not two. `webgl` in particular cannot be re-derived here
       (webglOk() is render.js-private), which is why the spread is the fix and
       a hand-written field list is not. */
    state: () => {
      const s = current();
      if (!s) return { open: false };
      const g = s.data && s.data.graph;
      const rv = (viewAPI && typeof viewAPI.state === 'function' && viewAPI.state()) || null;
      return {
        view2dReason: rv ? rv.view2dReason : null,
        scenePending: rv ? rv.scenePending : false,
        webgl: rv ? rv.webgl : null,
        focused: rv ? rv.focused : false,
        open: true, view: s.viewKind, tab: s.tab, selected: s.selected, flow: s.flow,
        filters: Array.from(s.filters),
        nodes: g && g.nodes ? g.nodes.length : 0,
        edges: g && g.edges ? g.edges.length : 0,
        errors: g && g.report ? g.report.errors.length : null,
        bridge: bridge.ready(),
        ms: Date.now() - s.t0,
      };
    },
  };
} catch (e) {}

/* Deep link: /?supplychain=1 — and the delay is not cosmetic. index.html is
   still assembling the hub for a beat after `load`, and an overlay that lands
   mid-boot has been seen to take the focus from a screen that then draws over
   it. The Player Closet solved this with exactly this shape, so the map copies
   it rather than inventing a second timing rule. */
try {
  const q = new URLSearchParams(location.search);
  if (q.get(SC.overlay.deepLinkParam) === '1') {
    const go = () => setTimeout(() => {
      openMap({ select: q.get('tile') || undefined, search: q.get('find') || undefined });
    }, SC.overlay.deepLinkDelayMs);
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }
} catch (e) {}

export default MythicSupplyChain;
export { MythicSupplyChain, openMap };
