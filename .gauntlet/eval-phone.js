(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = { steps: [] };
  const S = (k, v) => out.steps.push(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
  const B = window.MythicBroadcast, P = window.MythicPhone;
  S('engine', !!B && B.ready());
  S('phone', !!P && P.ready());
  if (!B || !P) return JSON.stringify(out, null, 1);

  /* Fill the feed through the SHIPPED path: tick() advances simulated seconds,
     which is what expires the per-subject cooldowns, and it runs its own
     observation pass. 250 ms of real time between ticks so the offline
     catch-up valve (wall gap < 200 ms) does not cap them. rAF is dead in the
     capture pane so node-city's own tick loop never runs — this stands in for
     roughly two and a half hours of city time. */
  let made = 0;
  for (let i = 0; i < 18; i++) { try { made += B.tick(9); } catch (e) { out.passErr = String(e); } await sleep(260); }
  S('published', made);
  S('count', B.count());
  S('unread', B.unread());

  // Repaint the rail so the launcher derives its state.
  try { window.__nc.rail.sync(); } catch (e) { S('syncErr', String(e)); }

  const btn = document.querySelector('#railbar .rl[data-rail="bcphone"]');
  S('btnExists', !!btn);
  if (btn) {
    const r = btn.getBoundingClientRect();
    S('btnRect', { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const stack = document.elementsFromPoint(cx, cy);
    S('hitPoint', { cx, cy });
    S('elementsFromPoint', stack.slice(0, 5).map(e => e.tagName + (e.id ? '#' + e.id : '') +
      (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') +
      (e.dataset && e.dataset.rail ? '[rail=' + e.dataset.rail + ']' : '')));
    S('topIsMyButton', stack[0] === btn || btn.contains(stack[0]));
    S('badge', btn.querySelector('.rlbadge').textContent);
    S('hasBadgeClass', btn.classList.contains('has-badge'));
    S('display', getComputedStyle(btn).display);
  }

  // The whole rail row on one line? Measure the wrap.
  const bar = document.getElementById('railbar');
  const btns = [...bar.querySelectorAll('.rl')].filter(b => b.style.display !== 'none');
  const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
  let used = 0; for (const b of btns) used += b.getBoundingClientRect().width;
  S('railVisible', btns.length);
  S('railRows', tops.size);
  S('railUsedPx', Math.round(used + 6 * (btns.length - 1)));
  S('railTrackPx', Math.round(bar.getBoundingClientRect().width));

  // Open through the real click path.
  btn.click();
  S('phoneOpen', P.isOpen());
  S('ariaHidden', document.getElementById('bcphone').getAttribute('aria-hidden'));
  S('unreadAfterOpen', B.unread());

  const shell = document.getElementById('bcp-shell').getBoundingClientRect();
  S('shellRect', { x: Math.round(shell.x), y: Math.round(shell.y), w: Math.round(shell.width), h: Math.round(shell.height) });
  const feed = document.getElementById('bcp-feed');
  S('cards', feed.querySelectorAll('.bcp-post').length);
  S('feedScrollable', { h: Math.round(feed.clientHeight), sh: Math.round(feed.scrollHeight) });
  S('nav', P._nav());
  S('status', document.getElementById('bcp-status').textContent.trim());
  S('foot', document.getElementById('bcp-foot').textContent);

  const first = feed.querySelector('.bcp-post');
  if (first) {
    S('firstKind', first.dataset.kind);
    S('firstWho', first.querySelector('.bcp-who').textContent);
    S('firstBody', first.querySelector('.bcp-txt').textContent.slice(0, 120));
    S('firstTags', [...first.querySelectorAll('.bcp-tag')].map(t => t.textContent));
    S('goLinks', feed.querySelectorAll('[data-go]').length);
    S('instAvatars', feed.querySelectorAll('.bcp-av.inst').length);
    S('czAvatars', feed.querySelectorAll('.bcp-av.cz').length);

    // LIKE: the count must move, and it must move by exactly one from `shown`.
    const lb = first.querySelector('.bcp-like');
    const id = first.dataset.id;
    const before = B.post(id);
    lb.click();
    const after = B.post(id);
    S('like', { id, likesBefore: before.likes, likesAfter: after.likes,
                shownBefore: before.shown, shownAfter: after.shown,
                mine: after.mine, followed: after.followed,
                printed: first.querySelector('.bcp-n').textContent,
                pressed: lb.getAttribute('aria-pressed'),
                instrumentMoved: before.likes !== after.likes });
    // toggle back off then on so the screenshot shows a liked row
    lb.click(); lb.click();
    S('afterRetoggle', { shown: B.post(id).shown, printed: first.querySelector('.bcp-n').textContent });

    // Keyboard reachability of the heart.
    lb.focus();
    S('focusIsHeart', document.activeElement === lb);
    // survive a repaint
    P.render(true);
    S('focusAfterRepaint', document.activeElement && document.activeElement.className);
  }

  // Filters go through the engine's own query.
  S('tabDept', P._tab('dept'));
  S('deptRows', P._rows().length);
  S('deptAllDept', P._rows().every(p => p.kind === 'dept'));
  P._tab('foll');
  S('follRows', P._rows().length);
  P._tab('all');

  // Page must never scroll.
  S('bodyOverflow', { docSH: document.documentElement.scrollHeight, docCH: document.documentElement.clientHeight });

  // Escape closes.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  S('openAfterEsc', P.isOpen());
  // reopen for the screenshot
  btn.click();
  try { window.__nc.rail.sync(); } catch (e) {}
  S('reopened', P.isOpen());
  /* ── IT MUST BEHAVE AS A FEED ──────────────────────────────────────────
     Posts arriving while the phone is OPEN, with the player scrolled down:
     the card under their eye must not move, and the pill must appear. */
  {
    const f = document.getElementById('bcp-feed');
    f.scrollTop = 900;
    const anchorId = [...f.querySelectorAll('.bcp-post')]
      .find(a => a.getBoundingClientRect().top > f.getBoundingClientRect().top).dataset.id;
    const anchorTop = f.querySelector('.bcp-post[data-id="' + anchorId + '"]').getBoundingClientRect().top;
    const before = B.count();
    for (let i = 0; i < 4; i++) { try { B.tick(9); } catch (e) {} await sleep(260); }
    P.render(false);
    await sleep(60);
    const stillThere = f.querySelector('.bcp-post[data-id="' + anchorId + '"]');
    S('liveArrival', {
      added: B.count() - before,
      anchorId,
      driftPx: stillThere ? Math.round(stillThere.getBoundingClientRect().top - anchorTop) : 'GONE',
      pillOn: document.getElementById('bcp-new').classList.contains('on'),
      pillText: document.getElementById('bcp-new').textContent,
    });
    document.getElementById('bcp-new').click();
    await sleep(500);
    S('afterPillClick', { scrollTop: Math.round(f.scrollTop),
                          pillOn: document.getElementById('bcp-new').classList.contains('on') });
  }
  await sleep(600);
  const sh = document.getElementById('bcp-shell');
  const cs = getComputedStyle(sh);
  S('shellPaint', { opacity: cs.opacity, transform: cs.transform, display: cs.display,
                    vis: cs.visibility, anim: cs.animationName });
  const sc = getComputedStyle(document.getElementById('bcp-screen'));
  S('screenPaint', { opacity: sc.opacity, bg: sc.backgroundImage.slice(0, 40) });
  return JSON.stringify(out, null, 1);
})()
