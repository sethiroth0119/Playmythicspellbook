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
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'jb:ready' }, window.location.origin); } catch (e) {}
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
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'jb:back' }, window.location.origin); } catch (e) {}
  };

  // Ask the parent to run a real economy action against the game:
  //   { kind:'sell', resource, qty, unit }   — sell goods for net Cinders (2% Foundation Tax → Reserve log)
  //   { kind:'buy',  total }                  — spend Cinders
  //   { kind:'corpCreate', name, tag }        — found a corporation (guild)
  //   { kind:'corpJoin',  tag }               — join a corporation by tag
  window.JB_action = function (payload) {
    try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'jb:action', action: payload }, window.location.origin); } catch (e) {}
  };

  window.JB_isBridged = function () { return !!(window.__JB && window.__JB.econ); };
  window.JB_isAdmin = function () { return !!(window.__JB && window.__JB.econ && window.__JB.econ.isAdmin); };

  // Admin-curated photos for Operations ('op') and Real Estate ('re'),
  // bridged in via econ.opArt / econ.reArt. Returns a data URL or ''.
  window.JB_art = function (artKind, id) {
    try {
      var m = window.__JB && window.__JB.econ && window.__JB.econ[artKind + 'Art'];
      return (m && m[id]) || '';
    } catch (e) { return ''; }
  };

  // Admin-only: pick an image, downscale it (compact JPEG so it never bloats
  // the cloud blob), and send it to the parent to store + publish.
  window.JB_uploadArt = function (artKind, id) {
    if (!window.JB_isAdmin || !window.JB_isAdmin()) return;
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) { try { inp.remove(); } catch (e) {} return; }
      var rd = new FileReader();
      rd.onload = function (ev) {
        var im = new Image();
        im.onload = function () {
          try {
            var MAX = 520;
            var sc = Math.min(MAX / im.width, MAX / im.height, 1);
            var cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.floor(im.width * sc));
            cv.height = Math.max(1, Math.floor(im.height * sc));
            var cx = cv.getContext('2d');
            cx.imageSmoothingEnabled = true;
            try { cx.imageSmoothingQuality = 'high'; } catch (e) {}
            cx.drawImage(im, 0, 0, cv.width, cv.height);
            var url = cv.toDataURL('image/jpeg', 0.62);
            window.JB_action({ kind: 'setArt', artKind: artKind, id: id, img: url });
          } catch (e) {}
          try { inp.remove(); } catch (e) {}
        };
        im.onerror = function () { try { inp.remove(); } catch (e) {} };
        im.src = ev.target.result;
      };
      rd.readAsDataURL(f);
    };
    document.body.appendChild(inp);
    inp.click();
  };

  announce();
  window.addEventListener('load', function () { announce(); setTimeout(announce, 300); });
})();
