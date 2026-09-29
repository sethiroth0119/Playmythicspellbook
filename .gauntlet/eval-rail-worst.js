/* WORST-CASE ROW MEASUREMENT at 1280 wide — the same measurement the RAILS
   comment quotes, re-run with the thirteenth launcher in place. Every launcher
   forced visible, the raid clock forced to h:mm:ss, and every badge forced to
   two digits, which is the case the original note says came to 1123px for
   twelve. Nothing here is a shipped code path; it is the ruler. */
(() => {
  const bar = document.getElementById('railbar');
  const all = [...bar.querySelectorAll('.rl')];
  for (const b of all) {
    b.style.display = '';
    b.classList.add('has-badge');
    b.querySelector('.rlbadge').textContent = '99';
  }
  const raid = bar.querySelector('.rl[data-rail="raidcard"]');
  if (raid) { raid.classList.add('has-clock'); raid.querySelector('.rlclock').textContent = '1:59:59'; }
  const tops = new Set(all.map(b => Math.round(b.getBoundingClientRect().top)));
  let used = 0; for (const b of all) used += b.getBoundingClientRect().width;
  const withoutPhone = used - (bar.querySelector('.rl[data-rail="bcphone"]').getBoundingClientRect().width);
  return JSON.stringify({
    viewport: innerWidth,
    launchers: all.length,
    rows: tops.size,
    trackPx: Math.round(bar.getBoundingClientRect().width),
    usedPx: Math.round(used + 6 * (all.length - 1)),
    usedWithoutPhonePx: Math.round(withoutPhone + 6 * (all.length - 2)),
    phonePx: Math.round(bar.querySelector('.rl[data-rail="bcphone"]').getBoundingClientRect().width),
    each: all.map(b => b.dataset.rail + '=' + Math.round(b.getBoundingClientRect().width)),
  }, null, 1);
})()
