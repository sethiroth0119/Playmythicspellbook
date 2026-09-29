(() => {
  /* Name whatever is repainting. A flicker is a DOM write that lands often and
     changes nothing a player asked to change, so count writes per target over a
     window and report the worst offenders with a sample of what they wrote. */
  const hits = new Map();
  const key = (n) => {
    if (!n) return '?';
    if (n.nodeType === 3) return (n.parentElement ? key(n.parentElement) : '#text') + ' >text';
    const id = n.id ? '#' + n.id : '';
    const cl = n.className && typeof n.className === 'string'
      ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (n.tagName || '?').toLowerCase() + id + cl;
  };
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      const k = key(m.target);
      const rec = hits.get(k) || { n: 0, kinds: {} };
      rec.n++;
      rec.kinds[m.type] = (rec.kinds[m.type] | 0) + 1;
      hits.set(k, rec);
    }
  });
  obs.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['style', 'class']
  });
  window.__flick = () => {
    obs.disconnect();
    return [...hits.entries()]
      .sort((a, b) => b[1].n - a[1].n).slice(0, 14)
      .map(([k, v]) => k + '  x' + v.n + '  ' + JSON.stringify(v.kinds));
  };
  return 'watching';
})()
