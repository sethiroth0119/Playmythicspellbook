/* Reconnaissance: where does the HUD chip actually land, and what is under it?
   Returns a plain object; drive-outside.mjs prints it whole. */
(() => {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
             bottom: Math.round(r.bottom) }; };
  const el = (id) => document.getElementById(id);
  try { window.MythicOutside && window.MythicOutside.hud(); } catch (e) {}
  const chip = el('oc-chip');
  const bar = el('railbar');
  const rls = [...document.querySelectorAll('#railbar .rl')].filter(b => b.style.display !== 'none');
  let stack = [];
  if (chip) {
    const r = chip.getBoundingClientRect();
    stack = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      .slice(0, 6).map(e => e.tagName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''));
  }
  return {
    innerWidth: innerWidth, innerHeight: innerHeight,
    topbarh: getComputedStyle(document.documentElement).getPropertyValue('--topbarh').trim(),
    mounted: !!window.MythicOutside,
    connected: (() => { try { return window.MythicOutside.state().connected; } catch (e) { return 'ERR'; } })(),
    chipText: chip ? chip.textContent : null,
    chipRect: R(chip),
    chipParent: chip && chip.parentElement ? chip.parentElement.tagName + '#' + chip.parentElement.id : null,
    daypill: R(el('daypill')),
    railbar: R(bar),
    railVisible: rls.length,
    railTotalWidth: rls.reduce((a, b) => a + b.getBoundingClientRect().width + 6, 0) | 0,
    railFirst: rls[0] ? R(rls[0]) : null,
    railLast: rls[rls.length - 1] ? R(rls[rls.length - 1]) : null,
    railRows: [...new Set(rls.map(b => Math.round(b.getBoundingClientRect().y)))],
    buildbar: R(el('buildbar')),
    underChipCentre: stack,
  };
})()
