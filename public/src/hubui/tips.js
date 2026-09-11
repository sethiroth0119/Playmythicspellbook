/* 💬 TIPS — one tooltip engine for the whole game (v121v112, owner:
   "add tool tips on all of the buttons on the menus, everything in camp, and
   hovering over the resources").

   HOW IT RESOLVES what to say for the thing under the pointer, in order:
     1. `data-tip` on the element or an ancestor (up to 8 levels).
     2. `title` on the element or an ancestor — every one of the ~600 titles
        already in the game becomes a styled tooltip. The native title bubble
        is suppressed while ours shows (the attribute is parked in
        `data-tip-title` for the hover and put back after), so nothing shows
        twice and code that reads `.title` later still finds it.
     3. TIP_BY — a table of selectors → text, for menu buttons and camp
        controls that never had a title. Central on purpose: one table, not
        a hundred render sites, and a missing entry is a one-line fix.
     4. A resource icon under the pointer. The character at the pointer is
        taken from the text itself (caretPositionFromPoint / caretRangeFromPoint,
        grapheme-safe via Intl.Segmenter), so "🥫 12 · 🔫 4" names each icon as
        the mouse crosses it, wherever it is printed. The icon → name map is
        built lazily from the game's own tables (RESOURCES, SALVAGE_RES,
        CITY_STOCK, the haul's materials) plus TIP_ICONS for currencies.

   Touch: a long press (450 ms) shows the tip for what is under the finger;
   lifting hides it after a moment. Keyboard: focus shows the tip.
   Scroll, click, Escape and pointer-leave hide it. Nothing here changes
   layout — the bubble is a fixed, pointer-events:none layer above every modal.

   ⚠ Classic script, not a module: it reads the game's top-level `const`
     tables by name (typeof-guarded), which only the global lexical scope
     of classic scripts can see. */
(function () {
  'use strict';
  if (window.__mxTips) return;
  window.__mxTips = true;

  /* ── currencies and icons no table names ── */
  const TIP_ICONS = {
    '🔥': 'Cinder — the game\'s currency',
    '🪙': 'Aza coin — premium currency',
    '🌙': 'Luni — the exchange token',
    '⛽': 'Fuel — burned by long deployments and the haul',
    '⭐': 'XP — experience',
    '💊': 'Medicine — treats trauma, corruption and fatigue',
    '🧂': 'Salvage — scrap recovered from deployments',
    '🩸': 'Injury',
    '☠️': 'Permadeath risk',
    '🪖': 'Guard',
  };

  /* ── selector → text, for controls that carry no title of their own ── */
  const TIP_BY = [
    /* the cinematic main menu (main-menu/index.html loads this file too) */
    ['.nav-item[data-label="Card Shop"]', 'Card Shop — run your own shop · visit player shops'],
    ['.nav-item[data-label="Battle Hall"]', 'Battle Hall — fight, climb, win the day'],
    ['.nav-item[data-label="Forge Sanctum"]', 'Forge Sanctum — craft cards, moves, sprites, decks'],
    ['.nav-item[data-label="Ruin Exchange"]', 'Ruin Exchange — trade, sell, cash out'],
    ['.nav-item[data-label="The Codex"]', 'The Codex — inventory, bestiary, trophies'],
    ['.nav-item[data-label="The Camp"]', 'The Camp — roster, replays, leaders'],
    ['.nav-item[data-label="Arcanum"]', 'Arcanum — settings & data'],
    ['.nav-item[data-label="Warpath"]', 'Warpath — leave the city · draft a deck by surviving'],
    ['#charactersBtn', 'Characters — your heroes and units'],
    /* the hub breadcrumb and the Luni market bar */
    ['#hub-back', 'Back to the main menu'],
    ['#btn-back-market-nav', 'Back to the menu'],
    ['.luni-nav-btn[data-tab="browse"]', 'Browse — every listing on the player market'],
    ['.luni-nav-btn[data-tab="watch"]', 'Watchlist — listings you are keeping an eye on'],
    ['.luni-nav-btn[data-tab="sell"]', 'Sell — list a card or resources for Cinder'],
    ['.luni-nav-btn[data-tab="mine"]', 'My Listings — what you have up for sale'],
    ['.luni-nav-btn[data-tab="resources"]', 'Resources — buy and sell stock by the unit'],
    ['.luni-nav-btn[data-tab="valuation"]', 'Valuation — what your cards are worth on real sales'],
    ['[data-luni-quick="auction"]', 'Auctions only'],
    ['[data-luni-quick="fixed"]', 'Buy It Now only — fixed-price listings'],
    /* currencies drawn as sprites, not emoji */
    ['.cinder-icon', 'Cinder — the game\'s currency'],
    ['.aza-icon', 'Aza coin — premium currency'],
    /* camp */
    ['#btn-back-camp', 'Back — leave the camp page'],
    ['.chud-day', 'Camp day and clock — deployments and rest run on this clock'],
    ['.result-stat-pill', 'Your Cinder'],
    ['#camp-wh-open', 'Player Storage — stash resources and pull them back'],
    ['#camp-bed-rack-open, #camp-rest-fab', 'Bed rack — rest tired heroes so they can battle again'],
    ['[data-dpxtab="deploy"]', 'Deploy Slots — send survivors out on scouts, raids and deep runs'],
    ['[data-dpxtab="park"]', 'Park — survivors waiting for a slot'],
    ['[data-dpxtab="barracks"]', 'Barracks — every survivor you have and their state'],
    ['[data-build]', 'Build or upgrade this facility — the cost comes out of camp stock'],
    ['.cmpx-room', 'A camp facility — build it, upgrade it, and it works for the whole camp'],
    ['.dpx-av-b[data-park]', 'Deploy — put this survivor in a slot'],
    ['.dpx-av[data-detail-card]', 'A survivor waiting in Park — tap to see the card'],
    ['.dpx-slot[data-detail-card]', 'A deployed survivor — tap the portrait for the card, the buttons to send them out'],
    ['.dpx-collect[data-act="collect"]', 'Collect the XP this deployment earned'],
    ['[data-act="eject"]', 'Remove from the slot without applying XP'],
    ['[data-rescue]', 'Send a rescue party for a missing survivor'],
    ['[data-mia]', 'Missing in action — a rescue can bring them home'],
    ['.dpx-empty', 'Empty deployment slot — pick a survivor from Park or Barracks'],
    ['.camp-bed', 'A bed — rest restores battle energy'],
    ['#camp-debrief-close', 'Acknowledge the debrief and return to camp'],
    ['#btn-camp-amb', 'Camp ambience — set the sound'],
    ['#btn-camp-amb-clear', 'Clear the camp ambience'],
    ['#cc-cancel', 'Close without saving'],
    ['#cc-save', 'Save these costs'],
    ['[data-preset="max"]', 'Fill to the maximum'],
    /* general */
    ['.modal-close, .pp-modal-x, .hl-x', 'Close'],
    ['#prof-claim-all', 'Claim every pending gift at once'],
    ['#prof-open-redeem', 'Redeem a code'],
    ['#btn-cloudify', 'Admin — move local media to the cloud'],
  ];
  window.TIP_BY = TIP_BY;   // other scripts may push entries

  /* ── the bubble ── */
  const css = document.createElement('style');
  css.textContent = [
    '#mx-tip{position:fixed;z-index:2147483000;pointer-events:none;max-width:280px;padding:0.42rem 0.6rem;border-radius:8px;',
    'background:rgba(18,15,10,0.96);color:#f3ead2;border:1px solid rgba(212,175,55,0.55);box-shadow:0 6px 18px rgba(0,0,0,0.5);',
    'font:0.8rem/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0.01em;opacity:0;transform:translateY(3px);',
    'transition:opacity .12s ease,transform .12s ease;white-space:pre-line;word-break:break-word;left:0;top:0}',
    '#mx-tip.on{opacity:1;transform:none}',
    '#mx-tip b{color:#ffd166;font-weight:600}',
  ].join('');
  document.head.appendChild(css);
  const bubble = document.createElement('div');
  bubble.id = 'mx-tip'; bubble.setAttribute('role', 'tooltip');
  const mount = () => { if (!bubble.parentNode && document.body) document.body.appendChild(bubble); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  let parked = null;        // the element whose native title we hid, and the title
  let shownFor = null;      // the element (or text node) the bubble is about
  let pressTimer = 0, hideTimer = 0;

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ── the icon map, from the game's own tables ── */
  let iconMap = null;
  function icons() {
    if (iconMap) return iconMap;
    iconMap = new Map();
    /* the currencies first: a chain resource that borrows 🔥 for its icon
       ("Cat Gasoline") must not rename Cinder */
    for (const k of Object.keys(TIP_ICONS)) iconMap.set(k, TIP_ICONS[k]);
    const add = (t) => { try { for (const r of (Array.isArray(t) ? t : Object.values(t || {}))) if (r && typeof r === 'object' && r.icon && r.name && !iconMap.has(r.icon)) iconMap.set(String(r.icon), String(r.name)); } catch (e) {} };
    try { if (typeof RESOURCES !== 'undefined') add(RESOURCES); } catch (e) {}
    try { if (typeof SALVAGE_RES !== 'undefined') add(SALVAGE_RES); } catch (e) {}
    try { if (typeof CITY_STOCK !== 'undefined') add(CITY_STOCK); } catch (e) {}
    try { if (typeof CITY_RESOURCES !== 'undefined') add(CITY_RESOURCES); } catch (e) {}
    try { const H = window.MythicHaul; const m = H && H.economy && H.economy.MATERIALS; if (m) add(m); } catch (e) {}
    try { const extra = window.TIP_ICONS || {}; for (const k of Object.keys(extra)) if (!iconMap.has(k)) iconMap.set(k, extra[k]); } catch (e) {}
    for (const k of Object.keys(TIP_ICONS)) if (!iconMap.has(k)) iconMap.set(k, TIP_ICONS[k]);
    return iconMap;
  }
  window.mxTipIcons = icons;   // for the console and the smoke

  /* the grapheme at (x, y) inside a text node, or null */
  const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  function graphemeAt(x, y) {
    let node = null, off = 0;
    try {
      if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
      else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
    } catch (e) { return null; }
    if (!node || node.nodeType !== 3) return null;
    const s = node.data || '';
    if (!s.trim()) return null;
    /* The caret sits on a BOUNDARY, so a pointer on the right half of an
       icon reports the offset after it: both graphemes that touch the offset
       are candidates, and iconTipAt takes whichever is an icon. */
    const out = [];
    if (seg) {
      for (const g of seg.segment(s)) { const a = g.index, b = a + g.segment.length; if (off >= a && off <= b) out.push({ text: g.segment, node, at: a }); if (a > off) break; }
      return out.length ? out : null;
    }
    const cp = s.codePointAt(Math.max(0, off - (off > 0 && s.charCodeAt(off - 1) >= 0xD800 && s.charCodeAt(off - 1) <= 0xDBFF ? 1 : 0)));
    return cp ? [{ text: String.fromCodePoint(cp), node, at: off }] : null;
  }
  function iconTipAt(x, y) {
    const gs = graphemeAt(x, y); if (!gs) return null;
    const map = icons();
    for (const g of gs) {
      const key = g.text.replace(/️/g, '');
      if (!key.trim()) continue;
      for (const [icon, name] of map) { if (icon === g.text || icon.replace(/️/g, '') === key) return { text: icon + ' ' + name, anchor: g.node }; }
    }
    return null;
  }

  /* ── resolve ── */
  function resolve(target, x, y) {
    let el = target && target.nodeType === 1 ? target : (target && target.parentElement);
    for (let i = 0; el && i < 8 && el !== document.body; i++, el = el.parentElement) {
      const dt = el.getAttribute('data-tip');
      if (dt) return { text: dt, el };
      const t = el.getAttribute('title');
      if (t) return { text: t, el, native: true };
      for (const [sel, text] of TIP_BY) { try { if (el.matches(sel)) return { text, el }; } catch (e) {} }
      if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') break;   // a control with no tip: do not climb into its container
    }
    if (typeof x === 'number') { const it = iconTipAt(x, y); if (it) return it; }
    return null;
  }

  /* ── show / hide ── */
  function place(el, x, y) {
    const w = bubble.offsetWidth, h = bubble.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (el && el.getBoundingClientRect && el.nodeType === 1) {
      const r = el.getBoundingClientRect();
      left = r.left + r.width / 2 - w / 2; top = r.bottom + 8;
      if (top + h > vh - 6) top = r.top - h - 8;
    } else { left = x + 14; top = y + 16; if (top + h > vh - 6) top = y - h - 10; }
    left = Math.max(6, Math.min(vw - w - 6, left)); top = Math.max(6, Math.min(vh - h - 6, top));
    bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
  }
  function show(res, x, y) {
    if (!res) return hide();
    if (shownFor === (res.el || res.anchor) && bubble.classList.contains('on')) { if (!res.el) place(null, x, y); return; }
    hide();
    mount();
    if (res.native && res.el) { parked = { el: res.el, title: res.el.getAttribute('title') }; res.el.setAttribute('data-tip-title', parked.title); res.el.removeAttribute('title'); }
    bubble.innerHTML = esc(res.text).replace(/^([^—\n]{1,40}) — /, '<b>$1</b> — ');
    shownFor = res.el || res.anchor;
    place(res.el, x, y);
    bubble.classList.add('on');
  }
  function hide() {
    clearTimeout(hideTimer);
    if (parked) { try { if (parked.el.getAttribute('title') == null) parked.el.setAttribute('title', parked.title); parked.el.removeAttribute('data-tip-title'); } catch (e) {} parked = null; }
    bubble.classList.remove('on'); shownFor = null;
  }
  window.mxTipHide = hide;
  window.mxTipResolve = resolve;      // for the console and the smoke
  window.mxTipIconAt = iconTipAt;

  /* ── pointer ── */
  let lastX = 0, lastY = 0;
  document.addEventListener('mousemove', (ev) => {
    lastX = ev.clientX; lastY = ev.clientY;
    if (ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents) return;
    const res = resolve(ev.target, ev.clientX, ev.clientY);
    if (!res) { if (shownFor) hide(); return; }
    show(res, ev.clientX, ev.clientY);
  }, { passive: true });
  document.addEventListener('mouseleave', hide);
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });

  /* ── touch: long press ── */
  document.addEventListener('touchstart', (ev) => {
    clearTimeout(pressTimer);
    const t = ev.touches && ev.touches[0]; if (!t) return;
    const x = t.clientX, y = t.clientY, target = ev.target;
    pressTimer = setTimeout(() => { const res = resolve(target, x, y); if (res) show(res, x, y); }, 450);
  }, { passive: true });
  const endPress = () => { clearTimeout(pressTimer); if (shownFor) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 1400); } };
  document.addEventListener('touchend', endPress, { passive: true });
  document.addEventListener('touchcancel', endPress, { passive: true });
  document.addEventListener('touchmove', () => { clearTimeout(pressTimer); }, { passive: true });

  /* ── keyboard focus ── */
  document.addEventListener('focusin', (ev) => { const res = resolve(ev.target); if (res && res.el) show(res); });
  document.addEventListener('focusout', () => { if (shownFor) hide(); });

  /* ── the DOM under the pointer re-rendered (the game repaints whole screens) ── */
  const mo = new MutationObserver(() => { if (shownFor && (!shownFor.isConnected)) hide(); });
  const startMo = () => { try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {} };
  if (document.body) startMo(); else document.addEventListener('DOMContentLoaded', startMo);
})();
