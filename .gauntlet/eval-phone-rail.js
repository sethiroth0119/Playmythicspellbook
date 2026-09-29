/* The launcher on its own: fill the feed so the badge has a number, sync the
   rail, and leave the phone CLOSED so a crop of #railbar shows the button
   rather than the dialog sitting on top of it. */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { steps: [] };
  const S = (k, v) => out.steps.push(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
  const B = window.MythicBroadcast, P = window.MythicPhone;
  if (!B || !P) { S('missing', { B: !!B, P: !!P }); return JSON.stringify(out, null, 1); }
  for (let i = 0; i < 10; i++) { try { B.tick(9); } catch (e) {} await sleep(260); }
  try { window.__nc.rail.sync(); } catch (e) {}
  await sleep(300);

  const bar = document.getElementById('railbar');
  const btns = [...bar.querySelectorAll('.rl')].filter(b => getComputedStyle(b).display !== 'none');
  const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
  S('viewport', { w: innerWidth, h: innerHeight });
  S('railVisible', btns.map(b => b.dataset.rail));
  S('railRows', tops.size);
  S('railTrackPx', Math.round(bar.getBoundingClientRect().width));
  let used = 0; for (const b of btns) used += b.getBoundingClientRect().width;
  S('railUsedPx', Math.round(used + 6 * (btns.length - 1)));

  const btn = bar.querySelector('.rl[data-rail="bcphone"]');
  const r = btn.getBoundingClientRect();
  S('btnRect', { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  /* Five points across the button, not just the centre: a chip laid OVER the
     row rather than laid out BY it can still win the exact middle pixel. */
  const pts = [[.12, .5], [.3, .25], [.5, .5], [.7, .75], [.9, .5]];
  S('hitTest', pts.map(([fx, fy]) => {
    const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
    const top = document.elementsFromPoint(x, y)[0];
    return { x, y, mine: top === btn || btn.contains(top), top: top ? top.tagName + '.' + (top.className || '') : null };
  }));
  S('badge', btn.querySelector('.rlbadge').textContent);
  S('tone', btn.className);
  S('unread', B.unread());
  S('phoneOpen', P.isOpen());

  /* ..and it really opens from a real click on the launcher, then closes. */
  btn.click(); S('openedByClick', P.isOpen());
  btn.click(); S('closedBySecondClick', P.isOpen());
  /* …and the badge comes BACK as the city keeps talking after the mayor has
     read the feed. Opening cleared it (markRead); these ticks earn it again,
     which is what the crop needs to show. */
  for (let i = 0; i < 6; i++) { try { B.tick(9); } catch (e) {} await sleep(260); }
  try { window.__nc.rail.sync(); } catch (e) {}
  await sleep(200);
  S('badgeAfterReread', btn.querySelector('.rlbadge').textContent);
  S('unreadAfterReread', B.unread());
  return JSON.stringify(out, null, 1);
})()
