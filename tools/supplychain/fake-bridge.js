/* ═══════════════════════════════════════════════════════════════════════════
   🎭 fake-bridge — window.SupplyChainBridge with no game behind it.

   A CLASSIC script, on purpose, for the same reason the real bridge block in
   index.html is one: it must have finished running before the first
   <script type="module"> executes, and classic scripts run in document order
   while modules are deferred. Put it ABOVE the piece's module tag:

       <script src="/__sc/fake-bridge.js"></script>
       <script type="module"> import { … } from '/src/supplychain/modal.js' … </script>

   WHERE THE NUMBERS COME FROM. Not from here. Every figure is read from
   fixture.opsecon.json, which gen-fixture.mjs cuts out of public/index.html —
   so a harness page shows the game's real startup costs, wages, yields and
   catalogue rows, and this file holds no economy number of its own. The fetch
   is a SYNCHRONOUS XHR: deprecated on the main thread and exactly right here,
   because the bridge has to exist before the next script tag runs and a
   harness page has no user to jank.

   PERSONAS — query string on the harness page, so one page covers every state
   a critic needs without editing a file:
     ?scbridge=full    (default) every member present
     ?scbridge=none    no bridge at all            → the feature's offline notice
     ?scbridge=half    only opEcon + opLabel        → the "half-present" case
     ?scbridge=throw   every member throws          → totality under fire
     ?scbridge=reject  every member is async and rejects → no "Uncaught (in promise)"
     ?scbridge=junk    every member returns garbage → typed defaults
     ?owns=mining,transport   businesses the player owns   (default: none)
     ?held=none|some|all      what the stash holds         (default: some)
     ?admin=1  ?signedin=0  ?confirm=no  ?phase=2
     ?gems=poor|mid|rich      wallet RELATIVE to the fixture's licence asks
   What the feature did to the bridge is recorded on window.__scFake
   (toasts, confirms, opened) so a test can assert on it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var mode = q.get('scbridge') || 'full';
  var log = { mode: mode, toasts: [], confirms: [], opened: [], fixture: null, error: null };
  window.__scFake = log;
  if (mode === 'none') { try { delete window.SupplyChainBridge; } catch (e) {} return; }

  // Resolve the fixture beside THIS file, wherever the server mounted it.
  var here = (document.currentScript && document.currentScript.src) || (location.origin + '/__sc/fake-bridge.js');
  var fx = null;
  try {
    var x = new XMLHttpRequest();
    x.open('GET', new URL('fixture.opsecon.json', here).href, false);
    x.send(null);
    if (x.status >= 200 && x.status < 300) fx = JSON.parse(x.responseText);
    else log.error = 'fixture HTTP ' + x.status;
  } catch (e) { log.error = String(e); }
  if (!fx || !fx.opsEcon) {
    // Loud, and NO bridge: a harness silently running on an empty table would
    // photograph a map of blanks and a critic would judge the blanks.
    console.error('[fake-bridge] fixture.opsecon.json did not load (' + log.error + '). Run: node tools/supplychain/gen-fixture.mjs');
    return;
  }
  log.fixture = { dataHash: fx.source && fx.source.dataHash, counts: fx.counts };

  var clone = function (v) { return v == null ? v : JSON.parse(JSON.stringify(v)); };
  var owns = (q.get('owns') || '').split(',').filter(Boolean);
  var heldMode = q.get('held') || 'some';

  // Deterministic "stash": a string hash, so the same id holds the same amount
  // on every run and two screenshots of one state are pixel-comparable.
  var hash = function (s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  var held = function (id) {
    if (heldMode === 'none') return 0;
    var h = hash(String(id));
    if (heldMode === 'all') return 1 + (h % 97);
    return (h % 3 === 0) ? 0 : (h % 53);      // 'some': about a third of ids are empty
  };

  /* The wallet is RELATIVE to the fixture — a quantile of the licence asks the
     game itself states — so "poor / mid / rich" stay meaningful after a retune
     and this file still carries no price. */
  var asks = Object.keys(fx.opsEcon).map(function (k) { return +fx.opsEcon[k].startup || 0; }).sort(function (a, b) { return a - b; });
  var quant = function (f) { return asks.length ? asks[Math.min(asks.length - 1, Math.floor(f * asks.length))] : 0; };
  var gemsMode = q.get('gems') || 'mid';
  var gems = gemsMode === 'poor' ? Math.floor(quant(0) / 2) : gemsMode === 'rich' ? quant(1) * 2 : quant(0.5);

  var full = {
    opEcon: function (id) { return clone(fx.opsEcon[id] || null); },
    opLabel: function (id) { return (fx.opLabels && fx.opLabels[id]) || String(id); },
    ownsOp: function (id) { return owns.indexOf(String(id)) >= 0; },
    resources: function () { return clone(fx.resources || []); },
    salvageRes: function () { return clone(fx.salvageRes || []); },
    lootResIds: function () { return clone(fx.lootResIds || []); },
    structureSalvage: function () { return clone(fx.structureSalvage || {}); },
    held: held,
    gems: function () { return gems; },
    isAdmin: function () { return q.get('admin') === '1'; },
    signedIn: function () { return q.get('signedin') !== '0'; },
    toast: function (m, ms) { log.toasts.push({ m: String(m), ms: ms }); try { console.log('[fake-bridge toast] ' + m); } catch (e) {} },
    confirm: function (m) { log.confirms.push(String(m)); return Promise.resolve(q.get('confirm') !== 'no'); },
    openBusiness: function (id) { log.opened.push(String(id)); return !!fx.opsEcon[id]; },
    transportPhase: function () { var p = parseInt(q.get('phase') || '', 10); return p > 0 ? p : (fx.transportPhase | 0); },
  };

  var b = full;
  if (mode === 'half') {
    b = { opEcon: full.opEcon, opLabel: full.opLabel };
  } else if (mode === 'throw') {
    b = {};
    Object.keys(full).forEach(function (k) { b[k] = function () { throw new Error('fake-bridge: ' + k + ' throws (scbridge=throw)'); }; });
  } else if (mode === 'reject') {
    // The realistic failure: index.html routes a member through an async
    // legacy opener and it rejects. A sync throw is caught by any try; this one
    // is only caught if sc.bridge.js defuses the promise. The page listens for
    // unhandledrejection so a harness can assert on log.unhandled === 0.
    b = {};
    log.unhandled = 0;
    window.addEventListener('unhandledrejection', function () { log.unhandled++; });
    Object.keys(full).forEach(function (k) { b[k] = function () { return Promise.reject(new Error('fake-bridge: ' + k + ' rejects (scbridge=reject)')); }; });
  } else if (mode === 'junk') {
    // Wrong TYPES, not errors: a string where an array is promised, NaN where
    // a count is, a cyclic object where a row is.
    var cyc = {}; cyc.self = cyc;
    b = {
      opEcon: function () { return cyc; }, opLabel: function () { return 42; }, ownsOp: function () { return 'yes'; },
      resources: function () { return 'oops'; }, salvageRes: function () { return [null, 7, { id: 5 }, { name: 'no id' }]; },
      lootResIds: function () { return { a: 1 }; }, structureSalvage: function () { return [1, 2]; },
      held: function () { return NaN; }, gems: function () { return -Infinity; }, isAdmin: function () { return 1; },
      signedIn: function () { return 'true'; }, toast: function () { return cyc; }, confirm: function () { return Promise.reject(new Error('junk')); },
      openBusiness: function () { return {}; }, transportPhase: function () { return '3rd'; },
    };
  }
  window.SupplyChainBridge = b;
})();
