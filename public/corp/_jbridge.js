/* _jbridge.js — game ⇄ "Just Business" bridge (plain JS, runs BEFORE the
   Babel scripts so window.__JB exists when app.jsx evaluates). The parent
   game posts the player's REAL economy in (Cinders / Aza / resources / the
   player's Corporation); the app reads it live and re-renders on the
   'jbdata' window event. Actions (sell / buy) post back to the parent which
   runs them against the real economy + the Foundation Reserve tax system.
   Degrades to the app's own mock data when opened standalone (no parent). */
(function () {
  window.__JB = window.__JB || { econ: null, ready: false };

  function announce() {
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'jb:ready' }, '*'); } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'jb:data') {
      if (d.econ && typeof d.econ === 'object') window.__JB.econ = d.econ;
      window.__JB.ready = true;
      try { window.dispatchEvent(new Event('jbdata')); } catch (e2) {}
    }
  });

  // Send the embedding game back to the Ruin Exchange.
  window.JB_back = function () {
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'jb:back' }, '*'); } catch (e) {}
  };

  // Ask the parent to run a real economy action against the game:
  //   { kind:'sell', resource, qty, unit }   — sell goods for net Cinders (2% Foundation Tax → Reserve log)
  //   { kind:'buy',  total }                  — spend Cinders
  //   { kind:'corpCreate', name, tag }        — found a corporation (guild)
  //   { kind:'corpJoin',  tag }               — join a corporation by tag
  window.JB_action = function (payload) {
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'jb:action', action: payload }, '*'); } catch (e) {}
  };

  window.JB_isBridged = function () { return !!(window.__JB && window.__JB.econ); };

  announce();
  window.addEventListener('load', function () { announce(); setTimeout(announce, 300); });
})();
