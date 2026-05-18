/* _bridge.js — game ⇄ base-builder/world-map bridge (plain JS, runs BEFORE
   the Babel scripts so window.__BRIDGE exists when data.jsx evaluates).
   The parent game posts REAL data in; the sub-app reads it live and the
   React tree re-renders on the 'bridgedata' window event. */
(function () {
  window.__BRIDGE = window.__BRIDGE || { resources: null, threat: null, alerts: null, ready: false };

  function announce() {
    try { window.parent && window.parent.postMessage({ type: 'base:ready' }, '*'); } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'base:data') {
      if (Array.isArray(d.resources)) window.__BRIDGE.resources = d.resources;
      if (typeof d.threat === 'number') window.__BRIDGE.threat = d.threat;
      if (Array.isArray(d.alerts)) window.__BRIDGE.alerts = d.alerts;
      window.__BRIDGE.ready = true;
      try { window.dispatchEvent(new Event('bridgedata')); } catch (e2) {}
    }
  });

  // Let the embedding game send us back to its menu.
  window.BB_back = function () {
    try { window.parent && window.parent.postMessage({ type: 'base:back' }, '*'); } catch (e) {}
  };

  // Announce as soon as possible AND once more after load (covers both the
  // case where the parent listener is already attached and where it isn't).
  announce();
  window.addEventListener('load', function () { announce(); setTimeout(announce, 300); });
})();
