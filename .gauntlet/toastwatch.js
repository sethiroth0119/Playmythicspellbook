(() => {
  /* `toast()` is module-scope, so it cannot be wrapped from outside — but every
     toast reaches the rail through box.appendChild, and that CAN be trapped.
     The stack at the moment of append names the caller outright, which is the
     one thing neither the message text nor the element markup could. */
  const box = document.getElementById('toasts');
  if (!box) return 'no #toasts';
  const seen = new Map();
  const orig = box.appendChild.bind(box);
  box.appendChild = function (n) {
    try {
      const msg = (n && n.textContent || '').trim().slice(0, 24);
      const st = (new Error().stack || '').split('\n').slice(1, 6)
        .map(s => s.trim().replace(/^at\s+/, '').replace(/https?:\/\/[^/]+/, ''))
        .filter(s => s && !/toastwatch/.test(s)).slice(0, 3).join('  <-  ');
      const k = msg + '\n        ' + st;
      seen.set(k, (seen.get(k) | 0) + 1);
    } catch (e) {}
    return orig(n);
  };
  window.__toasts = () => {
    box.appendChild = orig;
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, n]) => 'x' + String(n).padStart(4) + '  ' + k);
  };
  return 'trapping appendChild';
})()
