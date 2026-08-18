/* ══════════════════════════════════════════════════════════════════════════
   📱 EMERGENCY BROADCAST — THE PHONE.

   The reader for /src/broadcast. The engine (index.js, feed.js, compose.js)
   observes the city and publishes posts; this file is the cell phone the mayor
   reads them on, plus the launcher in node-city's rail dock that opens it.

   🔴 THIS FILE WRITES NO SENTENCES. There is not one line of post copy here and
      there must never be. Every word inside a card came out of compose.js
      against a live reading, and the only strings this file owns are chrome:
      the app name, the filter labels, the empty state and the legend under the
      feed. If a future change wants a new kind of thing said, it belongs in
      the composer where the numbers are — a sentence written in the view layer
      is a claim about the city that nothing checked.

   🔴 THE ONE RENDERING RULE THE API STATES AND THIS FILE OBEYS: the number
      beside the heart is `post.shown`, never `post.likes` plus a local
      increment. `likes` is the instrument — how many citizens the post is true
      for — and the mayor's own tap must not move it. `shown` is
      `likes + (mine ? 1 : 0)` and the engine computes it. See likes.js.

   ── WHAT A LIKE ACTUALLY DOES, said out loud in the UI ────────────────────
   Tapping the heart subscribes the mayor to that post's SUBJECT, and a
   followed subject's report cooldown is halved. That is a real consequence and
   an invisible one, so the phone says it: the first time a like starts a
   follow the card grows a FOLLOWING chip and a toast explains the trade. A
   control with a hidden effect is a control the player cannot learn.

   ── WHY A PHONE AND NOT A RAIL CARD ───────────────────────────────────────
   node-city's rail dock moves one `.card` node into a shared gilded modal
   (#railmodal). This is deliberately NOT one of those. The brief asks for a
   cell phone, the phone shape is the feature's whole identity, and a 560px
   gilded box with rounded corners is the thing it was asked not to be. So the
   phone is its own body-level dialog, like #inspect and #citback already are —
   but its LAUNCHER is a real `.rl` button inside #railbar, laid out by the
   same flex row, badged on the same 0.5 s beat, hidden by the same rule that
   hides a launcher whose module never mounted. The dock owns the button; this
   file owns the screen.

   ── THE GLOBALS TRAP (CLAUDE.md) ──────────────────────────────────────────
   `openInspect`, `openCitTalk`, `toast`, `logEsc`, `wx` and `hourOf` are all
   top-level `const`/function declarations in node-city's module script and are
   invisible from an ES module. `ctx` IS the hand-over. Note what does not
   cross: nothing that writes a tile, a citizen, the ledger or the feed. The
   only mutating call this file makes anywhere is `MythicBroadcast.like()`.
   ══════════════════════════════════════════════════════════════════════════ */

let CTX = null;
let mounted = false;
let open = false;
let timer = null;

/* html of the last painted feed, for the diff guard. The feed repaints on a
   2 s beat while the phone is open and an unconditional innerHTML write would
   throw away the player's text selection and their focus every two seconds. */
let lastHtml = null;
/* Post ids that were unread at the moment the phone was opened. markRead()
   fires on open — that is what clears the launcher badge — so the "new" dot
   has to be remembered here or it would vanish in the same frame the player
   arrived to look at it. */
let openUnread = new Set();
/* Newest post id the player has actually been level with. Drives the "N NEW"
   pill: posts arriving while they are scrolled down must not silently shove
   the thing they are reading off the screen. */
let topSeen = null;
let newAbove = 0;

const API = () => { try { return window.MythicBroadcast || null; } catch (e) { return null; } };
const $ = (id) => document.getElementById(id);

function esc(s) {
  if (CTX && typeof CTX.esc === 'function') return CTX.esc(s);
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, cls) { try { if (CTX && CTX.toast) CTX.toast(msg, cls); } catch (e) {} }

/* ── HASHTAGS ──────────────────────────────────────────────────────────────
   🔴 SPLIT FIRST, ESCAPE SECOND, and the order is a real bug and not a style
      preference. node-city's `logEsc` turns an apostrophe into `&#39;`, so a
      body containing "we're" becomes "we&#39;re" — and a `/#\w+/` run over the
      ESCAPED string matches `#39` and paints it as a hashtag. So the raw body
      is tokenised into tag runs and text runs, and only the text runs are
      escaped. The tag itself is matched by a character class that cannot
      contain markup, and is escaped anyway on the way out.
      The API is explicit that the tags are ALREADY inside the body — `post.tags`
      is for filtering. Nothing here appends them. */
const TAG_RE = /#[A-Za-z0-9_]+/g;
function hashify(raw) {
  const s = String(raw == null ? '' : raw);
  let out = '', at = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s))) {
    out += esc(s.slice(at, m.index));
    out += '<span class="bcp-tag">' + esc(m[0]) + '</span>';
    at = m.index + m[0].length;
  }
  return out + esc(s.slice(at));
}

/* ── GO SOMEWHERE ──────────────────────────────────────────────────────────
   A post about a person or a place should take the player to them. The post
   shape carries a NAME, not an id or a tile key, so the destination is
   resolved by name against the two registries that own those names:
   /src/citizens' roster and /src/naming's register.

   ⚠ Resolved at RENDER time, not at click time, and that is the point: a name
     that cannot be resolved is drawn as plain text rather than as a link that
     apologises after you press it. A citizen who left the city between the
     render and the click still gets the roster's own "no longer here" message,
     which is the same one the dossier's workforce rows give.
   ⚠ Two citizens can share a name and the first one wins. The alternative is
     no link at all for either, which is worse: the roster is the only index
     from a name to a person, and being sent to the wrong Erin Wallace is a
     smaller failure than a dead post.
   Cached for 4 s because `MythicNaming.all()` walks every tile in the city and
   this runs on the feed's 2 s repaint. */
let navAt = 0, navCit = null, navBiz = null;
function navMaps() {
  const now = Date.now();
  if (navCit && now - navAt < 4000) return { cit: navCit, biz: navBiz };
  navAt = now;
  navCit = new Map(); navBiz = new Map();
  try {
    const L = window.MythicCitizens && window.MythicCitizens.list();
    if (L) for (const c of L) if (c && c.name && !navCit.has(c.name)) navCit.set(c.name, String(c.id));
  } catch (e) {}
  try {
    const A = window.MythicNaming && window.MythicNaming.all();
    if (A) for (const k in A) { const n = A[k] && A[k].name; if (n && !navBiz.has(n)) navBiz.set(n, k); }
  } catch (e) {}
  return { cit: navCit, biz: navBiz };
}

/* The two shipped openers, through ctx. index.html already delegates
   `.wfrow[data-cit]` clicks to `openCitTalk` — but that listener is bound to
   #inspanes and cannot see this tree, so the phone reuses the FUNCTION rather
   than adding a rival global listener. The phone closes on the way out because
   the dossier lives at z-index 44 and this dialog sits above it; leaving both
   open would put the destination behind the thing that sent you there. */
function goCitizen(id) {
  close();
  let ok = false;
  try { ok = !!(CTX && CTX.openCitizen && CTX.openCitizen(id)); } catch (e) { ok = false; }
  if (!ok) toast('That citizen is no longer on the roster.', 'warn');
}
function goTile(k) {
  close();
  try { if (CTX && CTX.openTile) CTX.openTile(k); } catch (e) {}
}

/* ── THE STATUS BAR ────────────────────────────────────────────────────────
   ⚠ THE CLOCK AGREES WITH THE TIMESTAMPS, NOT WITH #daypill, and that is a
     decision worth writing down. node-city's day pill runs on `estClock()` —
     an America/New_York wall clock — while feed.js stamps every post from the
     player's own `new Date()` and SAVES that string with the post. Those two
     disagree by the player's offset from Eastern. A status bar showing the
     day-pill hour would sit two lines above a post claiming to be five hours
     in the future, on the same screen, which reads as a broken clock. So the
     phone prints the clock its own feed is stamped in and the CITY appears on
     the right-hand side instead — the live weather glyph, and a battery driven
     by the real grid supply factor.
   The battery is not decoration: /src/power's `supply().factor` is how much of
   the city's demand the grid is actually meeting, so a browning-out city has a
   phone on 40%. It is hidden entirely when /src/power is not mounted rather
   than defaulted to full — an invented reading is the thing this feature does
   not do, and that applies to the chrome too. */
function statusHtml() {
  const d = new Date();
  const clock = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  let wx = null;
  try { wx = CTX && CTX.weather ? CTX.weather() : null; } catch (e) { wx = null; }
  let batt = null;
  try {
    const s = window.MythicPower && window.MythicPower.supply();
    if (s && Number.isFinite(s.factor)) batt = Math.max(0, Math.min(1, s.factor));
  } catch (e) { batt = null; }
  const pct = batt == null ? null : Math.round(batt * 100);
  return '<span class="bcp-clk">' + esc(clock) + '</span>' +
    '<i class="bcp-notch" aria-hidden="true"></i>' +
    '<span class="bcp-sysr">' +
      (wx ? '<span class="bcp-wx" title="' + esc(wx.name) + '">' + esc(wx.ico || '') + '</span>' : '') +
      (pct == null ? '' :
        '<span class="bcp-batt' + (pct < 55 ? ' low' : '') + '" title="Grid supply ' + pct +
        '% — the phone runs on the city’s power">' +
        '<i style="width:' + Math.max(6, pct) + '%"></i></span><span class="bcp-bp">' + pct + '%</span>') +
    '</span>';
}

/* ── ONE POST CARD ─────────────────────────────────────────────────────────
   The reference layout, field for field: coloured circular avatar, poster name,
   right-aligned timestamp, body with the hashtags picked out, and a like count
   with a heart at the bottom right.

   ⚠ Institutions read differently from citizens at a glance and the reference
     is explicit about how — the Electricity Department gets a dark badge with a
     ⚡ where citizens get a plain colour disc. `avatar.ico` is the emoji for a
     department or a business and null for a citizen, so the two branches fall
     straight out of the data rather than out of a list of names kept here. */
function card(p, nav) {
  const av = p.poster.avatar || {};
  const hue = Number.isFinite(av.hue) ? av.hue : 0;
  const isInst = p.kind !== 'citizen';

  /* Where this post can take you. Departments have no address and no face, so
     they are never a link — the honest answer for "show me the Electricity
     Department" is that there isn't one building to show. */
  let go = '';
  if (p.kind === 'citizen' && nav.cit.has(p.poster.name)) go = 'cit:' + nav.cit.get(p.poster.name);
  else if (p.kind === 'company' && nav.biz.has(p.poster.name)) go = 'tile:' + nav.biz.get(p.poster.name);

  const nameInner = esc(p.poster.name);
  const name = go
    ? '<button type="button" class="bcp-who go" data-go="' + esc(go) + '" title="' +
      (go.startsWith('cit:') ? 'Talk to ' + esc(p.poster.name) : 'Open ' + esc(p.poster.name)) +
      '">' + nameInner + '</button>'
    : '<span class="bcp-who">' + nameInner + '</span>';

  /* The poster's affiliation — a citizen's employer, a business's street. Only
     a linked one when /src/naming knows a tile by that name. */
  let sub = '';
  if (p.poster.sub) {
    const bk = nav.biz.get(p.poster.sub);
    sub = bk
      ? '<button type="button" class="bcp-sub go" data-go="tile:' + esc(bk) + '" title="Open ' +
        esc(p.poster.sub) + '">' + esc(p.poster.sub) + '</button>'
      : '<span class="bcp-sub">' + esc(p.poster.sub) + '</span>';
  }

  const heart = p.mine ? '♥' : '♡';
  /* `shown`, not `likes`. See the header. `affected` is the raw headcount the
     count was derived from and it goes in the title, because the whole mechanic
     is that this number MEANS something and a player who hovers deserves to be
     told what. `source.why` is the live reading the post came from. */
  const why = p.source && p.source.why ? ' — ' + p.source.why : '';
  const likeTitle = p.likes + (p.likes === 1 ? ' citizen this is true for' : ' citizens this is true for') +
    (p.affected ? ' (' + p.affected + ' affected' + esc(why) + ')' : esc(why));

  return '<article class="bcp-post' + (p.followed ? ' followed' : '') +
      (openUnread.has(p.id) ? ' fresh' : '') + '" data-id="' + esc(p.id) +
      '" data-kind="' + esc(p.kind) + '" data-pole="' + esc(p.pole || '') + '">' +
    '<span class="bcp-av ' + (isInst ? 'inst ' + esc(p.kind) : 'cz') + '" style="--h:' + hue +
      '" aria-hidden="true">' + (av.ico ? esc(av.ico) : esc(av.initials || '?')) + '</span>' +
    '<div class="bcp-main">' +
      '<div class="bcp-hd">' + name +
        '<time class="bcp-when">' + esc(p.clock) + '</time>' +
      '</div>' +
      /* ⚠ THE FOLLOWING CHIP SITS UNDER THE NAME, NOT BESIDE IT. It was beside
         it first, and measured at 1280x720 — where the shell is 324px wide and
         the header has about 230px for a name, a chip and a timestamp — it
         truncated "Environment Department" to "Environment D…". The poster's
         identity is the one thing on the card that must never be clipped, so
         the chip moved down to the affiliation line, which has the whole width
         and is empty for a department anyway. */
      (p.followed || sub
        ? '<div class="bcp-subline">' +
          (p.followed ? '<span class="bcp-foll" title="You liked a post on this subject — the city reports on it twice as often">FOLLOWING</span>' : '') +
          sub + '</div>'
        : '') +
      '<p class="bcp-txt">' + hashify(p.body) + '</p>' +
      '<div class="bcp-act">' +
        '<button type="button" class="bcp-like' + (p.mine ? ' on' : '') + '" data-act="like" ' +
          'aria-pressed="' + (p.mine ? 'true' : 'false') + '" title="' + likeTitle + '">' +
          '<span class="bcp-n">' + p.shown + '</span>' +
          '<span class="bcp-heart" aria-hidden="true">' + heart + '</span>' +
          '<span class="bcp-sr">likes — ' + likeTitle + '</span>' +
        '</button>' +
      '</div>' +
    '</div>' +
  '</article>';
}

/* ── FILTERS ───────────────────────────────────────────────────────────────
   Four, and each one is a query the engine already answers. No filtering is
   done here: `posts(opts)` takes them all and AND-s them, so the phone cannot
   drift from the feed's own idea of what a department post is. */
const TABS = [
  { id: 'all',   label: 'All',      q: {} },
  { id: 'foll',  label: 'Following', q: { followed: true } },
  { id: 'dept',  label: 'City',     q: { kind: 'dept' } },
  { id: 'cz',    label: 'People',   q: { kind: 'citizen' } },
];
let tab = 'all';

function emptyHtml() {
  const B = API();
  const total = B ? B.count() : 0;
  if (tab === 'foll') {
    return '<div class="bcp-empty"><b>Nothing followed yet.</b>' +
      '<span>Tap the heart on a post and the city will report on that subject twice as often. ' +
      'Your like never moves the count itself — that number is the measurement.</span></div>';
  }
  if (total) {
    return '<div class="bcp-empty"><b>Nothing under this filter.</b>' +
      '<span>' + total + ' post' + (total === 1 ? '' : 's') + ' in the feed under All.</span></div>';
  }
  return '<div class="bcp-empty"><b>The city has nothing to say yet.</b>' +
    '<span>Posts are generated from things that actually happen — a shortfall, an opening, ' +
    'a graduation, a price move. Build, and the feed fills.</span></div>';
}

function footText(rows) {
  const B = API(); if (!B) return '';
  let foll = 0;
  try { foll = B.following().length; } catch (e) {}
  return rows.length + ' post' + (rows.length === 1 ? '' : 's') +
    (foll ? ' · ' + foll + ' subject' + (foll === 1 ? '' : 's') + ' followed' : '') +
    ' · ♡ = citizens it is true for';
}

/* ── RENDER ────────────────────────────────────────────────────────────────
   Diff-guarded, scroll-preserving and focus-preserving, because this runs on a
   2 s beat over a list the player is reading and clicking.
     · SCROLL. New posts land at the TOP, so a naive repaint shoves whatever
       they were reading down by the height of the new cards. Anchored instead:
       at the top, stay at the top; anywhere else, add the height the list grew
       by, which holds the same card under the cursor.
     · FOCUS. A heart that had keyboard focus must still have it after the
       repaint, or the feed is unusable from the keyboard the moment it ticks. */
function render(force) {
  if (!open) return;
  const B = API(); if (!B) return;
  const feed = $('bcp-feed'); if (!feed) return;

  const t = TABS.find((x) => x.id === tab) || TABS[0];
  const rows = B.posts({ limit: 80, ...t.q });
  const nav = navMaps();
  const html = rows.length ? rows.map((p) => card(p, nav)).join('') : emptyHtml();

  const st = $('bcp-status'); if (st) st.innerHTML = statusHtml();
  const ft = $('bcp-foot'); if (ft) ft.textContent = footText(rows);

  /* The "N NEW" pill. Counted against the newest post the player has been
     level with, not against a timestamp, so it survives the feed trimming. */
  if (rows.length) {
    if (topSeen == null) topSeen = rows[0].id;
    let n = 0;
    for (const p of rows) { if (p.id === topSeen) break; n++; }
    newAbove = feed.scrollTop <= 4 ? 0 : n;
    if (!newAbove) topSeen = rows[0].id;
  } else { newAbove = 0; topSeen = null; }
  const pill = $('bcp-new');
  if (pill) {
    pill.textContent = '▲ ' + newAbove + ' new';
    pill.classList.toggle('on', newAbove > 0);
  }

  if (html === lastHtml && !force) return;
  lastHtml = html;

  const atTop = feed.scrollTop <= 4;
  const beforeH = feed.scrollHeight, beforeTop = feed.scrollTop;
  const act = document.activeElement;
  /* Which control had focus, named by the two attributes that survive a
     rebuild — the post id and the control's own data-act / data-go. Anything
     else in the tree is unfocusable, so there is no third case. */
  const keep = act && feed.contains(act) && act.closest('.bcp-post')
    ? { id: act.closest('.bcp-post').dataset.id,
        sel: act.getAttribute('data-act') ? '[data-act="' + act.getAttribute('data-act') + '"]'
           : act.getAttribute('data-go') ? '[data-go="' + act.getAttribute('data-go') + '"]'
           : null }
    : null;

  feed.innerHTML = html;

  if (atTop) feed.scrollTop = 0;
  else feed.scrollTop = Math.max(0, beforeTop + (feed.scrollHeight - beforeH));
  if (keep && keep.sel) {
    try {
      const el = feed.querySelector('.bcp-post[data-id="' + keep.id + '"] ' + keep.sel);
      if (el) el.focus({ preventScroll: true });
    } catch (e) {}
  }
}

/* ── OPEN / CLOSE ──────────────────────────────────────────────────────────
   markRead() on open, exactly as the API asks. The unread set is snapshotted
   one line earlier so the arriving posts still carry their dot for this
   sitting — clearing the badge and erasing the evidence in the same frame
   would tell the player nothing about what was new. */
function openPhone() {
  if (open) return true;
  const B = API(); if (!B || !B.ready()) return false;
  ensureDom();
  openUnread = new Set();
  try { for (const p of B.posts({ unread: true, limit: 80 })) openUnread.add(p.id); } catch (e) {}
  try { B.markRead(); } catch (e) {}
  topSeen = null; newAbove = 0; lastHtml = null;
  open = true;
  const wrap = $('bcphone');
  wrap.classList.add('open');
  wrap.setAttribute('aria-hidden', 'false');
  render(true);
  const f = $('bcp-feed'); if (f) f.scrollTop = 0;
  try { $('bcp-x').focus({ preventScroll: true }); } catch (e) {}
  /* 2 s, the same order as the city's own system beat. rAF is dead in the
     capture pane and a feed that only repainted on a frame would be untestable
     as well as frozen behind an inactive tab. */
  clearInterval(timer);
  timer = setInterval(() => { try { render(false); } catch (e) {} }, 2000);
  return true;
}

function close() {
  if (!open) return false;
  open = false;
  clearInterval(timer); timer = null;
  const wrap = $('bcphone');
  if (wrap) { wrap.classList.remove('open'); wrap.setAttribute('aria-hidden', 'true'); }
  /* Hand focus back to the launcher that opened it, the same contract
     railClose() keeps. */
  try { const b = document.querySelector('#railbar .rl[data-rail="bcphone"]'); if (b) b.focus({ preventScroll: true }); } catch (e) {}
  return false;
}

function toggle() { return open ? close() : openPhone(); }

/* ── THE ONE LISTENER ──────────────────────────────────────────────────────
   Delegated on the screen, so every control inside a feed that is rebuilt from
   innerHTML twice a minute keeps working without a single per-card binding. */
function wire() {
  const wrap = $('bcphone');
  const screen = $('bcp-screen');

  screen.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('[data-act],[data-go],[data-tab]') : null;
    if (!el) return;
    ev.preventDefault();

    const go = el.getAttribute('data-go');
    if (go) {
      const k = go.slice(go.indexOf(':') + 1);
      return go.startsWith('cit:') ? goCitizen(k) : goTile(k);
    }
    const tb = el.getAttribute('data-tab');
    if (tb) {
      tab = tb; lastHtml = null; topSeen = null;
      for (const b of screen.querySelectorAll('[data-tab]'))
        b.setAttribute('aria-selected', b.getAttribute('data-tab') === tab ? 'true' : 'false');
      render(true);
      const f = $('bcp-feed'); if (f) f.scrollTop = 0;
      return;
    }
    const act = el.getAttribute('data-act');
    if (act === 'close') return void close();
    if (act === 'top') {
      /* 🔴 INSTANT, NOT SMOOTH, AND FOR THE SAME REASON THE ENTRANCE KEYFRAME
         DOES NOT TOUCH OPACITY. The first version used
         scrollTo({top:0, behavior:'smooth'}); measured in the gauntlet pane,
         which does not composite, the feed stayed at scrollTop 1663 and the
         button did nothing at all — a control that silently no-ops wherever
         animation is throttled. `scrollTop = 0` cannot fail, it is what "jump
         to the newest" actually means, and it needs no reduced-motion branch
         because there is no motion. */
      const f = $('bcp-feed');
      if (f) f.scrollTop = 0;
      newAbove = 0;
      el.classList.remove('on');
      const B = API();
      if (B) { const r = B.posts({ limit: 1, ...(TABS.find((x) => x.id === tab) || TABS[0]).q }); topSeen = r.length ? r[0].id : null; }
      return;
    }
    if (act === 'like') {
      const art = el.closest('.bcp-post'); if (!art) return;
      const id = art.dataset.id;
      const B = API(); if (!B) return;
      const before = B.post(id);
      const p = B.like(id);
      if (!p) return;

      /* ⚠ PATCHED IN PLACE, NOT RE-RENDERED. A full repaint here would reset
         the scroll anchor and drop focus off the button the player is still
         holding down. The next 2 s beat reconciles the whole list anyway. */
      const n = art.querySelector('.bcp-n'); if (n) n.textContent = p.shown;
      const h = art.querySelector('.bcp-heart'); if (h) h.textContent = p.mine ? '♥' : '♡';
      el.classList.toggle('on', !!p.mine);
      el.setAttribute('aria-pressed', p.mine ? 'true' : 'false');
      art.classList.toggle('followed', !!p.followed);
      lastHtml = null;

      /* What the like BOUGHT, said out loud. The follow is the only real
         consequence and it is invisible on screen otherwise. */
      const wasF = before && before.followed;
      const tag = (p.tags && p.tags[0]) ? '#' + p.tags[0] : (p.subject || 'that subject');
      if (p.followed && !wasF) toast('Following ' + tag + ' — the city will report on it twice as often. Your like does not move the count.', 'good');
      else if (!p.followed && wasF) toast('Unfollowed ' + tag + '.', '');
      return;
    }
  });

  /* Reaching the top clears the pill — the player has now seen what arrived. */
  $('bcp-feed').addEventListener('scroll', () => {
    if (!open || !newAbove) return;
    if ($('bcp-feed').scrollTop <= 4) { newAbove = 0; const pl = $('bcp-new'); if (pl) pl.classList.remove('on'); }
  }, { passive: true });

  /* The backdrop closes; the phone body eats its own clicks. */
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });

  /* ⌨ CAPTURE, and it stops the event. node-city has three other Escape
     handlers on window/document already — the rail dock's, the dossier's and
     the one that drops build mode. Without capture + stopPropagation, closing
     the phone would also cancel whatever the player had queued behind it. */
  addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !open) return;
    ev.stopPropagation(); ev.preventDefault();
    close();
  }, true);
}

/* ⚠ There is deliberately no `prefers-reduced-motion` check in this file. Both
   places the phone could animate — the shell's entrance and the NEW pill's
   fade — are CSS, and both are turned off by the media queries in CSS below.
   A JS mirror of a media query is a second copy of the same decision, and the
   one thing that WOULD have needed it (a smooth scroll to top) was replaced by
   an instant one, which has no motion to reduce. */

/* ── DOM ───────────────────────────────────────────────────────────────────
   Built once, kept in the document, hidden between openings. Not rebuilt per
   open: the phone carries a scroll container and a filter selection, and a
   dialog that is recreated every time is a dialog that forgets both. */
function ensureDom() {
  if ($('bcphone')) return;
  const wrap = document.createElement('div');
  wrap.id = 'bcphone';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'bcp-appttl');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    '<div id="bcp-shell">' +
      '<i class="bcp-vol" aria-hidden="true"></i><i class="bcp-pwr" aria-hidden="true"></i>' +
      '<div id="bcp-screen">' +
        '<div id="bcp-status"></div>' +
        '<div id="bcp-app">' +
          '<span class="bcp-glyph" aria-hidden="true">📣</span>' +
          '<span class="bcp-ttl"><b id="bcp-appttl">Emergency Broadcast</b>' +
            '<small>The city, in its own words</small></span>' +
          '<button type="button" id="bcp-x" data-act="close" aria-label="Close Emergency Broadcast">✕</button>' +
        '</div>' +
        '<div id="bcp-tabs" role="tablist" aria-label="Filter the broadcast">' +
          TABS.map((t) => '<button type="button" role="tab" data-tab="' + t.id + '" aria-selected="' +
            (t.id === tab ? 'true' : 'false') + '">' + t.label + '</button>').join('') +
        '</div>' +
        '<div class="bcp-feedwrap">' +
          '<div id="bcp-feed" tabindex="0" role="feed" aria-label="City broadcast posts"></div>' +
          '<button type="button" id="bcp-new" data-act="top">▲ 0 new</button>' +
        '</div>' +
        '<div id="bcp-home"><span id="bcp-foot"></span><i class="bar" aria-hidden="true"></i></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);
  wire();
}

/* ── CSS ───────────────────────────────────────────────────────────────────
   Everything is scoped under #bcphone. `.post`, `.tag`, `.av` and `.feed` all
   already mean something somewhere in an 11 MB single-page app, so nothing
   here is allowed to be a bare class name.
   The palette is node-city's own: --gold, --bone, --mist, --ember, --edge and
   the same panel gradient the dossier and the rail modal are built out of, so
   the phone reads as an object inside this game rather than as a web widget
   dropped on top of it. The one thing it does NOT copy is the gilded frame —
   this is a mass-produced handset in a fantasy city, so the BODY is graphite
   with a thin gold rim and the SCREEN is the familiar dark panel. */
const CSS = `
/* z-index 46: above #cardpicker (45) so a phone opened over a card picker is
   not buried, and it is a MODE — it covers the rail dock (43) deliberately.
   Every destination the phone offers (dossier 44, citizen dialogue 9865) is
   reached by closing the phone first, so nothing ever opens behind it. */
/* ⚠ NO backdrop-filter, and #citback (the citizen dialogue) IS the precedent
   for having one — this deliberately does not follow it. A blur is a full-screen
   filter pass over a live WebGL canvas on every composited frame, and the
   canvas underneath is a software-rasterised scene the rail dock was collapsed
   to stop repainting over (see the #railbar note in index.html). A talk dialog
   is on screen for seconds; a feed is on screen while the player reads it, so
   the cost is paid for a hundred times longer. A darker flat scrim reads the
   same and costs a fill. */
#bcphone{display:none;position:fixed;inset:0;z-index:46;
  background:rgba(4,3,10,.76);
  align-items:center;justify-content:center;
  padding:calc(var(--topbarh,60px) + 8px) 14px 24px;}
#bcphone.open{display:flex;}

/* THE BODY. Height-driven with a fixed aspect so it is a phone at every window
   size node-city supports: at 1280x720 that is a 596px handset, at 1920x1080 an
   869px one. max-width clamps the very tall case rather than letting it become
   a slab. */
#bcp-shell{position:relative;height:min(820px,calc(100vh - var(--topbarh,60px) - 40px));
  aspect-ratio:9 / 19;width:auto;max-width:min(94vw,420px);
  border-radius:38px;padding:9px;box-sizing:border-box;
  background:linear-gradient(155deg,#3a3550 0%,#171426 34%,#0d0b16 70%,#2a2540 100%);
  border:1px solid rgba(212,175,55,.5);
  box-shadow:0 40px 110px rgba(0,0,0,.8), inset 0 0 0 1px rgba(255,255,255,.05),
             inset 0 0 40px rgba(212,175,55,.05);
  animation:bcprise .22s cubic-bezier(.2,.9,.3,1);}
/* 🔴 TRANSFORM ONLY. THE FIRST VERSION ANIMATED OPACITY FROM 0 AND THE WHOLE
   PHONE WAS INVISIBLE — measured, not theorised: the gauntlet capture pane does
   not composite (CLAUDE.md), rAF never fires, and a CSS animation therefore
   never advances past its 0% frame. getComputedStyle on #bcp-shell reported an
   opacity of 0 a full 600 ms after the dialog opened, with the feed built, the
   post cards laid out and the shell sitting at its correct 356x752 rect. The
   screenshot was an empty blurred city.
   ⚠ AND NOTE WHERE THIS COMMENT LIVES: inside a template literal. The gate
     .gauntlet/modcheck.mjs exists because a stray backtick in exactly this
     position closed power/panel.js's CSS string and took a whole feature dark;
     this comment had two on its first draft and the gate caught them. No
     backticks below this line.
   The lesson generalises past this box: any environment that throttles or
   suspends animations — a background tab, a compositor stall, a will-change
   budget miss — leaves an opacity entrance stuck at invisible, and a modal that
   is sometimes invisible is a broken modal. So nothing in this keyframe may
   affect whether the element can be SEEN. Frozen at 0% the phone is 14px low
   and 1.5% small, which is indistinguishable from finished. */
@keyframes bcprise{from{transform:translateY(14px) scale(.985);}to{transform:none;}}
@media (prefers-reduced-motion: reduce){#bcp-shell{animation:none;}}
/* The side hardware. Purely chrome, and the cheapest thing that makes a
   rounded rectangle read as a handset rather than as a panel. */
#bcp-shell .bcp-vol,#bcp-shell .bcp-pwr{position:absolute;left:-3px;width:3px;border-radius:2px;
  background:linear-gradient(180deg,#4a4463,#221e33);}
#bcp-shell .bcp-vol{top:104px;height:66px;}
#bcp-shell .bcp-pwr{left:auto;right:-3px;top:132px;height:92px;}

#bcp-screen{height:100%;display:flex;flex-direction:column;overflow:hidden;
  border-radius:31px;position:relative;
  background:linear-gradient(180deg,rgba(18,15,32,.99),rgba(8,7,16,1));
  box-shadow:inset 0 0 0 1px rgba(212,175,55,.18), inset 0 0 60px rgba(212,175,55,.03);}

/* ── status bar ── */
#bcp-status{flex:none;height:30px;display:flex;align-items:center;justify-content:space-between;
  padding:0 18px;position:relative;font-size:10.5px;color:#bdb3d0;
  font-variant-numeric:tabular-nums;letter-spacing:.03em;}
#bcp-status .bcp-clk{font-weight:700;color:#e2d9ee;}
#bcp-status .bcp-notch{position:absolute;left:50%;top:5px;transform:translateX(-50%);
  width:74px;height:15px;border-radius:9px;background:#07060d;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);}
#bcp-status .bcp-sysr{display:flex;align-items:center;gap:5px;}
#bcp-status .bcp-wx{font-size:11px;line-height:1;}
#bcp-status .bcp-batt{display:inline-block;width:20px;height:9px;border-radius:2px;
  border:1px solid rgba(255,255,255,.35);padding:1px;position:relative;}
#bcp-status .bcp-batt::after{content:"";position:absolute;right:-3px;top:2.5px;width:2px;height:3px;
  border-radius:0 1px 1px 0;background:rgba(255,255,255,.35);}
#bcp-status .bcp-batt > i{display:block;height:100%;background:#7fd3a4;border-radius:1px;}
#bcp-status .bcp-batt.low > i{background:var(--ember,#ff7a2f);}
#bcp-status .bcp-bp{font-size:9.5px;color:#9a91ae;}

/* ── app header ── */
#bcp-app{flex:none;display:flex;align-items:center;gap:9px;padding:6px 14px 10px;
  border-bottom:1px solid rgba(212,175,55,.26);
  background:linear-gradient(180deg,rgba(212,175,55,.08),transparent);}
#bcp-app .bcp-glyph{font-size:19px;line-height:1;flex:none;}
#bcp-app .bcp-ttl{flex:1;min-width:0;}
#bcp-app .bcp-ttl b{display:block;
  font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  font-size:12.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f0d68f;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#bcp-app .bcp-ttl small{display:block;font-size:9.5px;color:var(--mist,#8f87a3);margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#bcp-x{flex:none;cursor:pointer;background:rgba(255,255,255,.05);
  border:1px solid rgba(212,175,55,.4);color:#e8dcc0;border-radius:8px;
  padding:5px 8px;font-size:12px;line-height:1;}
#bcp-x:hover{background:rgba(212,175,55,.16);color:#ffd166;}
#bcphone button:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px;}

/* ── filter tabs ── */
#bcp-tabs{flex:none;display:flex;gap:5px;padding:8px 12px;border-bottom:1px solid var(--edge,#2e2740);
  overflow-x:auto;scrollbar-width:none;}
#bcp-tabs::-webkit-scrollbar{display:none;}
#bcp-tabs button{flex:none;cursor:pointer;background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1);color:var(--mist,#8f87a3);border-radius:20px;
  padding:4px 11px;font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;
  font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;}
#bcp-tabs button:hover{color:var(--bone,#e8e2d5);}
#bcp-tabs button[aria-selected="true"]{background:rgba(212,175,55,.16);color:#f0d68f;
  border-color:rgba(212,175,55,.5);}

/* ── the feed ── */
.bcp-feedwrap{flex:1;min-height:0;position:relative;display:flex;}
/* 🔴 THE PAGE MUST NEVER SCROLL. overscroll-behavior:contain stops the wheel
   chaining out of this box into the document once the feed hits its end —
   which in node-city means the camera, not the page. */
#bcp-feed{flex:1;min-width:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
  padding:4px 0 10px;
  scrollbar-width:thin;scrollbar-color:rgba(212,175,55,.4) rgba(0,0,0,.25);}
#bcp-feed::-webkit-scrollbar{width:8px}
#bcp-feed::-webkit-scrollbar-track{background:rgba(0,0,0,.25)}
#bcp-feed::-webkit-scrollbar-thumb{background:rgba(212,175,55,.34);border-radius:4px;
  border:2px solid transparent;background-clip:content-box}
#bcp-feed:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:-2px;}

#bcp-new{position:absolute;left:50%;top:8px;transform:translateX(-50%) translateY(-140%);
  opacity:0;pointer-events:none;cursor:pointer;z-index:3;
  background:rgba(212,175,55,.9);color:#1a1409;border:0;border-radius:20px;
  padding:4px 12px;font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  box-shadow:0 6px 18px rgba(0,0,0,.6);transition:opacity .18s, transform .18s;}
#bcp-new.on{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0);}
@media (prefers-reduced-motion: reduce){#bcp-new{transition:none;}}

/* ── one post ── */
.bcp-post{display:grid;grid-template-columns:36px 1fr;gap:10px;padding:11px 14px;
  border-bottom:1px solid rgba(255,255,255,.055);position:relative;}
.bcp-post:last-child{border-bottom:0;}
/* Unread when the phone was opened. A hairline, not a banner — it marks what
   is new without shouting over the post that is actually urgent. */
.bcp-post.fresh::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;
  background:linear-gradient(180deg,var(--gold,#d4af37),rgba(212,175,55,.25));}
.bcp-post.followed{background:rgba(212,175,55,.045);}

/* The reference's two poster shapes. A citizen is a plain colour disc with
   their initials; an institution is a dark badge with its glyph. */
.bcp-av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none;
  font-size:12.5px;font-weight:700;letter-spacing:.02em;user-select:none;}
.bcp-av.cz{background:hsl(var(--h) 42% 34%);color:#fff;
  box-shadow:inset 0 0 0 1px hsl(var(--h) 50% 55% / .7);}
.bcp-av.inst{border-radius:11px;font-size:16px;font-weight:400;
  background:linear-gradient(160deg,#282139,#100e1c);
  box-shadow:inset 0 0 0 1px hsl(var(--h) 55% 50% / .75), 0 0 12px hsl(var(--h) 60% 45% / .18);}
.bcp-av.inst.company{border-radius:9px;
  box-shadow:inset 0 0 0 1px rgba(212,175,55,.5), 0 0 10px rgba(212,175,55,.12);}

.bcp-main{min-width:0;}
.bcp-hd{display:flex;align-items:baseline;gap:7px;}
.bcp-who{flex:1;min-width:0;text-align:left;padding:0;background:none;border:0;
  font-family:'Crimson Text',Georgia,serif;font-size:13.5px;font-weight:700;color:#efe5cf;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bcp-who.go{cursor:pointer;text-decoration:underline;text-decoration-color:rgba(212,175,55,.35);
  text-underline-offset:3px;}
.bcp-who.go:hover{color:#ffd98a;text-decoration-color:var(--gold,#d4af37);}
.bcp-post[data-kind="dept"] .bcp-who{color:#cfe0ff;}
.bcp-post[data-kind="company"] .bcp-who{color:#f2d79a;}
.bcp-when{flex:none;font-size:10.5px;color:#7d7593;font-variant-numeric:tabular-nums;}
.bcp-foll{font-size:7.5px;letter-spacing:.12em;padding:1px 5px;border-radius:20px;
  background:rgba(212,175,55,.15);color:#e6c86f;border:1px solid rgba(212,175,55,.4);
  font-family:'Cinzel',Georgia,serif;margin-right:6px;white-space:nowrap;}
.bcp-subline{margin-top:2px;display:flex;align-items:center;min-width:0;}
.bcp-sub{padding:0;background:none;border:0;text-align:left;min-width:0;
  font-size:10px;color:var(--mist,#8f87a3);letter-spacing:.03em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bcp-sub.go{cursor:pointer;text-decoration:underline;text-decoration-color:rgba(143,135,163,.4);
  text-underline-offset:2px;}
.bcp-sub.go:hover{color:#cbbfe0;}
.bcp-txt{margin:5px 0 0;font-family:'Crimson Text',Georgia,serif;font-size:13px;line-height:1.5;
  color:var(--bone,#e8e2d5);overflow-wrap:anywhere;}
.bcp-tag{color:#8fc2ff;font-weight:600;}
.bcp-post[data-pole="bad"] .bcp-tag{color:#ffab86;}

/* ── the like control ── */
.bcp-act{display:flex;justify-content:flex-end;margin-top:6px;}
.bcp-like{display:inline-flex;align-items:center;gap:5px;cursor:pointer;
  background:none;border:1px solid transparent;border-radius:20px;padding:2px 8px;
  color:#8f87a3;font-size:11.5px;font-variant-numeric:tabular-nums;line-height:1.4;}
.bcp-like:hover{background:rgba(224,90,70,.1);border-color:rgba(224,90,70,.35);color:#e8a5a5;}
.bcp-like .bcp-heart{font-size:12.5px;line-height:1;}
.bcp-like.on{color:#ff8f9a;border-color:rgba(255,143,154,.4);background:rgba(255,143,154,.08);}
.bcp-like .bcp-n{font-weight:700;}
/* Screen-reader-only: the heart's meaning is a number and a claim about the
   city, and neither survives being read out as "17 heart". */
.bcp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);
  clip-path:inset(50%);white-space:nowrap;}

.bcp-empty{padding:34px 22px;text-align:center;color:var(--mist,#8f87a3);}
.bcp-empty b{display:block;font-family:'Cinzel',Georgia,serif;font-size:11px;letter-spacing:.12em;
  text-transform:uppercase;color:#c9bb96;margin-bottom:8px;}
.bcp-empty span{display:block;font-family:'Crimson Text',Georgia,serif;font-size:12.5px;line-height:1.55;}

/* ── home bar ── */
#bcp-home{flex:none;padding:7px 14px 9px;border-top:1px solid rgba(255,255,255,.06);
  display:flex;flex-direction:column;align-items:center;gap:7px;background:rgba(0,0,0,.25);}
/* Wraps rather than ellipsises. Measured at 1280x720, where the shell is 324px
   wide: "26 posts · 1 subject followed · ♡ = citizens it is true for" was
   clipped to "…" and the legend — the one line that teaches what the number
   beside the heart MEANS — was the half that got cut. Two short lines cost
   11px of a bar that had the room. */
#bcp-foot{font-size:9.5px;color:#6f6786;letter-spacing:.03em;text-align:center;
  line-height:1.4;max-width:100%;}
#bcp-home .bar{width:96px;height:4px;border-radius:3px;background:rgba(255,255,255,.22);}

/* Short windows: node-city supports 1280x720, where the shell is 596px tall.
   The header subtitle and the footer legend are the two things that can go
   without costing the player information they cannot get elsewhere. */
@media (max-height:760px){
  #bcp-app .bcp-ttl small{display:none;}
  #bcp-app{padding-bottom:8px;}
  .bcp-post{padding:9px 12px;}
}
`;

function ensureCss() {
  try {
    if (typeof document === 'undefined' || document.getElementById('bcp-css')) return;
    const s = document.createElement('style');
    s.id = 'bcp-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  } catch (e) {}
}

/* ── MOUNT ─────────────────────────────────────────────────────────────────
   Called by node-city AFTER /src/broadcast has mounted. The DOM is built here
   rather than lazily on first open so the launcher can prove it exists, and so
   a driver can inspect the phone without opening it. */
export function mount(ctx) {
  CTX = ctx || {};
  ensureCss();
  ensureDom();
  mounted = true;
  return PHONE;
}

const PHONE = {
  version: 1,
  ready: () => mounted,
  mount,
  open: openPhone,
  close,
  toggle,
  isOpen: () => open,
  /* The launcher's badge goes through the engine, not through here — the phone
     is a reader and `unread()` is the feed's answer. Relayed only so a caller
     that has the phone does not have to reach past it. */
  unread: () => { const B = API(); return B ? B.unread() : 0; },
  render: (f) => { render(!!f); return lastHtml ? lastHtml.length : 0; },
  /* Driver seams. `_rows` is what the feed is currently showing, `_tab` moves
     the filter without a synthetic click, and `_nav` reports what the two
     name registries resolved — the only way to check the GO SOMEWHERE links
     without clicking one and losing the page. */
  _tab: (t) => { if (TABS.some((x) => x.id === t)) { tab = t; lastHtml = null; render(true); } return tab; },
  _rows: () => { const B = API(); const t = TABS.find((x) => x.id === tab) || TABS[0];
                 return B ? B.posts({ limit: 80, ...t.q }) : []; },
  _nav: () => { const m = navMaps(); return { citizens: m.cit.size, businesses: m.biz.size }; },
  _ctx: () => CTX,
};

try {
  if (typeof window !== 'undefined') window.MythicPhone = PHONE;
} catch (e) {}

export default PHONE;
