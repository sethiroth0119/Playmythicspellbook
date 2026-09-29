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

/* ══════════════════════════════════════════════════════════════════════════
   🔔 THE NOTIFICATION SOUND
   ══════════════════════════════════════════════════════════════════════════
   ⚠ ONE ELEMENT, REUSED. A `new Audio()` per post leaks an element per
     notification for the life of the session, and a busy city posts often.
   ⚠ ABSOLUTE PATH. This module is imported by /node-city/, so a relative
     'assets/…' would resolve to /node-city/assets and 404 silently — a sound
     that never plays and never says why.
   ⚠ IT NEVER THROWS AND NEVER BLOCKS. Browsers refuse audio until the user
     has interacted with the page; play() rejects, and an unhandled rejection
     every two seconds is worse than a missed ping. The catch is the feature.
   ⚠ AND IT IS RATE-LIMITED. A pass that lands four posts at once is ONE
     ping, not four — the sound says 'the city said something', not 'here are
     four things'. */
const PING = {
  src: '/assets/Audio/Phone notification.mp3',
  gapMs: 1500,      // never two pings closer than this
  volume: 0.55,
};
let _ping = null, _pingAt = 0, _pingSeen = null;

/* 🔕 THE RING / SILENT SWITCH, which is the one control on a real handset
   that everybody already knows how to use — so on a phone that now LOOKS
   like one, it is where a player will look for it.
   ⚠ IT PERSISTS. A mute a player has to set again every session is not a
     setting, it is a nag; localStorage keeps it per browser like every other
     per-viewer preference in this file's neighbourhood.
   ⚠ AND IT IS READ LAZILY, NOT AT MODULE LOAD. localStorage throws outright
     in some embedded contexts (a private window, a thumbnail capture), and a
     throw at module scope would take the entire phone down rather than cost
     one preference. Every access is wrapped and falls back to unmuted, which
     is the behaviour that existed before this switch did. */
const MUTE_KEY = 'mythic_phone_muted';
let _muted = null;
export function isMuted() {
  if (_muted === null) {
    try { _muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { _muted = false; }
  }
  return !!_muted;
}
export function setMuted(on) {
  _muted = !!on;
  try { localStorage.setItem(MUTE_KEY, _muted ? '1' : '0'); } catch (e) {}
  paintMute();
  return _muted;
}
/* Paint BOTH controls from one place. Two buttons for one setting is two ways
   to be out of step with it, and the one that goes stale is always the one the
   player is not looking at. */
function paintMute() {
  try {
    const m = isMuted();
    const lab = m ? 'Notification sound is off — turn it on' : 'Notification sound is on — turn it off';
    const sw = document.getElementById('bcp-mute');
    if (sw) {
      sw.classList.toggle('on', m);
      sw.setAttribute('aria-pressed', m ? 'true' : 'false');
      sw.setAttribute('aria-label', lab);
      sw.title = m ? 'Silent — no notification sound' : 'Ringer on — notifications make a sound';
    }
    const bell = document.getElementById('bcp-bell');
    if (bell) {
      bell.classList.toggle('on', m);
      bell.setAttribute('aria-pressed', m ? 'true' : 'false');
      bell.setAttribute('aria-label', lab);
      bell.title = m ? 'Muted — tap to turn the sound back on' : 'Mute notifications';
      bell.textContent = m ? '🔕' : '🔔';
    }
  } catch (e) {}
}
function pingEl() {
  if (_ping) return _ping;
  try {
    _ping = new Audio(PING.src);
    _ping.preload = 'auto';
    _ping.volume = PING.volume;
  } catch (e) { _ping = null; }
  return _ping;
}
function ping() {
  /* 🔕 SILENCED BEFORE THE THROTTLE IS TOUCHED, deliberately. Returning early
     without stamping `_pingAt` means muting never shifts the gap between the
     pings that DO play — flip the switch back and the next post sounds
     immediately rather than waiting out a window it spent muted. */
  if (isMuted()) return false;
  const now = Date.now();
  if (now - _pingAt < PING.gapMs) return false;
  _pingAt = now;
  const a = pingEl(); if (!a) return false;
  try {
    a.currentTime = 0;
    const p = a.play();
    /* play() returns a promise in every current browser and REJECTS when the
       page has not been interacted with yet. Swallowed deliberately: the
       alternative is an unhandled rejection in the console on every post. */
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { return false; }
  return true;
}
/* Watches the newest post id and pings when it changes.
   🔴 IT DOES NOT PING ON FIRST SIGHT. The first call only records where the
      feed already was — otherwise opening the phone on a city with eighty
      existing posts would announce them all as new, which is the opposite of
      what a notification means.
   ⚠ RUNS WHETHER THE PHONE IS OPEN OR NOT. A notification the player only
     hears once they are already looking at the feed is not a notification. */
export function pingTick() {
  const B = API(); if (!B) return false;
  let top = null;
  try { const r = B.posts({ limit: 1 }); top = r && r.length ? r[0].id : null; } catch (e) { return false; }
  if (top == null) return false;
  if (_pingSeen === null) { _pingSeen = top; return false; }   // first sight: remember, say nothing
  if (top === _pingSeen) return false;
  _pingSeen = top;
  return ping();
}
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
  /* 💼 NOT A POST FILTER. Every tab above narrows the feed; this one replaces
     it with a roster of the people in this city who have no work, and the two
     things a player can do about it. `view` is what marks it, and render()
     branches on that rather than on the id — a second tab of this kind should
     not mean a second special case. */
  { id: 'jobs',  label: 'Unemployed', view: 'jobs' },
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
/* ══════════════════════════════════════════════════════════════════════════
   💼 THE UNEMPLOYED TAB — who has no work, and the two ways to fix it.
   ══════════════════════════════════════════════════════════════════════════
   Asked for as: a tab "that shows all of the people looking for jobs inside of
   the player city", with a button to help one find work, a modal of the
   businesses that need staff, and a Hire button that places them.

   🔴 IT READS THE SAME ROSTER THE JOB FAIR DOES — MythicCitizens.unemployed()
      — and hires through the SAME errand path, sendToJob. Not for tidiness:
      a second hiring path is a second set of rules about who may take which
      seat, and the schooling gate would have to be re-argued in both. The
      phone is a second WINDOW onto one mechanic, never a second mechanic.
   ⚠ SO A HIRE FROM HERE IS STILL NOT INSTANT. The resident walks; the card
      shows the countdown. That was an explicit ask when the job fair was
      built, and a phone button that teleported somebody into a job would
      quietly undo it.
   ⚠ AND IT SAVES ITSELF. The errand and the resulting job both live on the
      citizen record, which citSave writes with the city — so a hire made here
      survives a reload in every city, with nothing extra to persist.
   ══════════════════════════════════════════════════════════════════════════ */
const CIT = () => { try { return window.MythicCitizens || null; } catch (e) { return null; } };
/* One sentence back to the player. The city owns a real toast; this module is
   imported by it, so the function is reached through window rather than
   imported — and a build without it falls back to the console rather than
   swallowing the only feedback a refused hire produces. */
function toastish(msg, bad) {
  try { if (typeof window.toast === 'function') { window.toast(msg, bad ? 'bad' : 'good'); return; } } catch (e) {}
  try { if (window.parent && window.parent !== window && window.parent.showToast) { window.parent.showToast(msg, 4000); return; } } catch (e) {}
  try { console.info('[phone] ' + msg); } catch (e) {}
}
function jobsLeft(ms) {
  const left = Math.max(0, ms - Date.now());
  if (left < 60000) return Math.max(1, Math.round(left / 1000)) + 's';
  return Math.round(left / 60000) + ' min';
}
function jobsHtml() {
  const M = CIT();
  if (!M || typeof M.unemployed !== 'function') {
    return '<div class="bcp-empty"><b>The register is not available.</b>' +
      '<span>This city has no citizen roster loaded, so nobody can be listed.</span></div>';
  }
  let people = [];
  try { people = M.unemployed() || []; } catch (e) { people = []; }
  if (!people.length) {
    return '<div class="bcp-empty"><b>Everyone has work.</b>' +
      '<span>Nobody in the city is looking for a job right now.</span></div>';
  }
  return people.map((p) => {
    const busy = p.task
      ? '<div class="bcp-jb-busy">' + (p.task.kind === 'school' ? '🎓 At ' : '🚶 Heading to ') +
        esc(p.task.name) + ' — about ' + jobsLeft(p.task.doneAt) + ' left</div>'
      : '<button type="button" class="bcp-jb-btn" data-jobhelp="' + esc(p.id) + '">' +
        'Help with finding a job</button>';
    /* 🎓 THE SCHOOLING IS ITS OWN BADGE, not a clause in a subtitle. It is the
       fact that decides which jobs this person can take, so it has to be
       readable at a glance against the requirement printed on each business
       row in the modal — the two are meant to be compared.
       👤 AND THE NAME IS A BUTTON. `data-go="cit:<id>"` is the phone's existing
       citizen route (goCitizen → CTX.openCitizen), already used by every
       citizen post in the feed — so 'who is this person' is answered by the
       dialogue the game already has, not by a second panel invented here. */
    return '<article class="bcp-jb">' +
      '<div class="bcp-jb-top">' +
        '<span class="bcp-jb-face">' + esc(p.aptIco || '🧑') + '</span>' +
        '<span class="bcp-jb-who">' +
          '<button type="button" class="bcp-jb-name" data-go="cit:' + esc(p.id) + '"' +
            ' title="Who is this?">' + esc(p.name) + '</button>' +
          '<small>good at ' + esc(p.aptName || '') + '</small></span>' +
        '<span class="bcp-jb-edu" title="How far they got in school — it decides which work they can take">' +
          esc(p.eduIco || '🎓') + ' ' + esc(p.eduLabel || 'unschooled') + '</span>' +
      '</div>' +
      (p.suggest ? '<div class="bcp-jb-fit">Best fit: <b>' + esc(p.suggest.name) + '</b></div>' : '') +
      busy +
    '</article>';
  }).join('');
}

/* 🏢 THE PLACES THAT NEED THIS PERSON.
   ⚠ FILTERED TO SEATS THEY CAN ACTUALLY TAKE. placements() reports every open
     seat in the city; offering a self-taught farmhand a Clinic bench would be
     a button that exists only to be refused. The schooling rule is the city's
     (citQualifies), and it is asked rather than re-implemented — the roster
     already resolves a `suggest` under exactly the same gate.
   ⚠ AND AN EMPTY LIST SAYS WHICH KIND OF EMPTY IT IS. 'No business has a free
     seat' and 'none of the open seats will take them' are different problems
     with different fixes, and a single blank panel answers neither. */
/* 🎓 EVERY ROW SAYS WHAT SCHOOLING IT WANTS, and the ones this person cannot
   take are SHOWN rather than hidden.

   🔴 THAT IS A REVERSAL, AND IT IS THE RIGHT ONE. The first cut filtered the
      list to seats the person already cleared, on the reasoning that offering
      a seat the errand would refuse is a button that exists to be refused.
      True — but it also silently answered the question the player is actually
      asking: what would this person need in order to work THERE. A Clinic that
      simply never appears teaches nothing; a Clinic listed as 'needs College'
      with no Hire button is a build order.
   ⚠ THE GATE ITSELF IS UNCHANGED. An out-of-reach row carries no Hire button
     and no data-hire, so it cannot be clicked — the refusal is made
     unreachable rather than reachable-and-refused. citQualifies is still the
     one rule, asked of the city, never re-implemented here. */
function hireModalHtml(person, places) {
  const rows = places.map((o) => {
    const need = o.needLabel ? ('needs ' + esc(o.needLabel)) : 'open to anyone';
    const meta = o.free + ' seat' + (o.free === 1 ? '' : 's') + ' free · ' + need
      + (o.matched ? ' · suits them' : '');
    if (!o.reachable) {
      return '<div class="bcp-hire-row locked" title="' + esc(person.name) +
        ' has not finished ' + esc(o.needLabel || 'the schooling') + '">' +
        '<span class="bcp-hire-ico">' + esc(o.ico || '🏢') + '</span>' +
        '<span class="bcp-hire-body"><b>' + esc(o.name) + '</b>' +
          '<small>' + meta + '</small></span>' +
        '<span class="bcp-hire-no">🔒</span>' +
      '</div>';
    }
    return '<button type="button" class="bcp-hire-row" data-hire="' + esc(person.id) + '" data-at="' + esc(o.key) + '">' +
      '<span class="bcp-hire-ico">' + esc(o.ico || '🏢') + '</span>' +
      '<span class="bcp-hire-body"><b>' + esc(o.name) + '</b>' +
        '<small>' + meta + '</small></span>' +
      '<span class="bcp-hire-go">Hire</span>' +
    '</button>';
  }).join('');
  return '<div class="bcp-modal-in">' +
    '<div class="bcp-modal-head"><b>Place ' +
      '<button type="button" class="bcp-jb-name" data-go="cit:' + esc(person.id) + '"' +
        ' title="Who is this?">' + esc(person.name) + '</button></b>' +
      '<button type="button" class="bcp-modal-x" data-hireclose="1" aria-label="Close">✕</button></div>' +
    /* Their schooling sits directly above the list of requirements, so the
       comparison the player is making is one glance rather than two. */
    '<div class="bcp-modal-sub"><b class="bcp-jb-edu">' + esc(person.eduIco || '🎓') + ' ' +
      esc(person.eduLabel || 'unschooled') + '</b> · good at ' + esc(person.aptName || '') + '</div>' +
    (rows || '<div class="bcp-empty"><b>Nowhere to send them yet.</b><span>' +
      'Either no business has a free seat, or the ones that do need more schooling than ' +
      esc(person.name) + ' has finished. Build, or send them to school from the Job Fair.</span></div>') +
  '</div>';
}
function openHireModal(personId) {
  const M = CIT(); if (!M) return;
  let person = null, places = [];
  try {
    person = (M.unemployed() || []).find((p) => p.id === personId) || null;
    places = M.placements() || [];
  } catch (e) { person = null; }
  /* 🔴 THE CARD CAN BE STALE, AND SILENCE IS THE WRONG ANSWER. The feed repaints
     on a 2s timer and the CITY hires on its own beat, so a resident listed a
     moment ago may already have work by the time the button is pressed. The
     first version simply returned: the tap did nothing, no modal, no message,
     which reads as a broken button rather than as good news. Say what happened
     and repaint, so the roster the player is looking at becomes true. */
  if (!person) {
    toastish('💼 They have already found work.');
    try { render(true); } catch (e) {}
    return;
  }
  const fit = person.suggest ? person.suggest.key : null;

  /* 🎓 WHAT EACH PLACE DEMANDS, and whether this person clears it.
     ⚠ THE BAND COMES FROM THE ECONOMY and the rung label from the city — the
       same two sources citQualifies and the work-seeker card read. A label
       derived here would be a third opinion about one rule, and it would drift
       the first time the education ladder was retuned.
     ⚠ A tile the economy has no band for demands nothing, which is a real
       answer (a school, a barracks) and not a missing one. */
  const bands = (() => {
    try { const E = window.MythicEconomy; return (E && E.tileBands) ? (E.tileBands() || {}) : {}; }
    catch (e) { return {}; }
  })();
  const ORDER = ['advanced', 'technical', 'skilled', 'unskilled'];
  const rungLabel = (band) => {
    try {
      const E = window.MythicEconomy;
      const edu = E && E.ECON && E.ECON.demographics && E.ECON.demographics.education;
      if (!edu || !edu.requires || !edu.levels) return band || null;
      const rung = edu.requires[band];
      return (rung && edu.levels[rung] && edu.levels[rung].label) || band || null;
    } catch (e) { return band || null; }
  };
  const decorate = (o) => {
    const need = bands[o.key] || null;
    const have = ORDER.indexOf(person.band), lo = ORDER.indexOf(need);
    const reachable = !need || (have >= 0 && lo >= 0 && have <= lo);
    return { ...o, matched: o.key === fit, needBand: need,
             needLabel: need ? rungLabel(need) : null, reachable };
  };
  const usable = places.filter((o) => o && o.free > 0).map(decorate);
  /* Reachable first — the player can act on those — then best fit, then most
     seats. The locked ones stay on the list because they are the answer to
     'what would they need', which is the other half of the question. */
  usable.sort((a, b) => (b.reachable - a.reachable)
    || ((b.key === fit) - (a.key === fit)) || (b.free - a.free));
  let host = document.getElementById('bcp-hire');
  if (!host) {
    host = document.createElement('div');
    host.id = 'bcp-hire';
    /* 🔴 INSIDE #bcp-screen, NOT #bcphone. Two reasons, and the first one is a
       bug this cost: the click handler is delegated on #bcp-screen, so a modal
       mounted on the outer wrapper receives clicks that NEVER REACH IT — the
       Hire button rendered, highlighted, and did nothing at all. The second is
       the CSS: #bcp-screen is the positioned, overflow-hidden shell, so the
       sheet is clipped by the handset instead of escaping the bezel. */
    const screenEl = document.getElementById('bcp-screen');
    (screenEl || document.body).appendChild(host);
  }
  host.innerHTML = hireModalHtml(person, usable);
  host.classList.add('on');
}
function closeHireModal() {
  const host = document.getElementById('bcp-hire');
  if (host) { host.classList.remove('on'); host.innerHTML = ''; }
}

function render(force) {
  if (!open) return;
  const B = API(); if (!B) return;
  const feed = $('bcp-feed'); if (!feed) return;

  const t = TABS.find((x) => x.id === tab) || TABS[0];
  /* 💼 A VIEW TAB REPLACES THE FEED and returns before any of the post
     bookkeeping below — the NEW pill, topSeen and the footer all count POSTS,
     and running them against a roster would report '3 new' about people. */
  if (t.view === 'jobs') {
    feed.innerHTML = jobsHtml();
    const st = $('bcp-status'); if (st) st.innerHTML = statusHtml();
    const ft = $('bcp-foot');
    if (ft) {
      let n = 0; try { n = (CIT() ? (CIT().unemployed() || []).length : 0); } catch (e) { n = 0; }
      ft.textContent = n ? (n + ' looking for work · tap one to place them')
                         : 'Nobody is looking for work';
    }
    const pill = $('bcp-new'); if (pill) pill.classList.remove('on');
    return;
  }
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
  /* 🧹 The hire sheet lives INSIDE the phone screen, so closing the phone hides
     it but does not dismiss it — it would still be sitting there, mid-decision,
     the next time the phone opened. Tapping a resident's name closes the phone
     to show you who they are, which is exactly the path that leaves one open. */
  try { closeHireModal(); } catch (e) {}
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
    /* 💼 THE JOB CONTROLS ARE MATCHED FIRST AND SEPARATELY. They live inside the
       roster and the modal, neither of which is a post, and folding them into
       the selector below would put a Hire button through goTile(). */
    const jh = ev.target && ev.target.closest ? ev.target.closest('[data-jobhelp]') : null;
    if (jh) { ev.preventDefault(); openHireModal(jh.getAttribute('data-jobhelp')); return; }
    const hx = ev.target && ev.target.closest ? ev.target.closest('[data-hireclose]') : null;
    if (hx) { ev.preventDefault(); closeHireModal(); return; }
    const hr = ev.target && ev.target.closest ? ev.target.closest('[data-hire]') : null;
    if (hr) {
      ev.preventDefault();
      const who = hr.getAttribute('data-hire'), at = hr.getAttribute('data-at');
      const M = CIT();
      let r = null;
      /* 🔴 THROUGH sendToJob — the city's own errand path, with the city's own
         refusals. The phone never seats anybody itself: one hiring rule, one
         place, and the schooling gate is applied to a phone hire exactly as it
         is to one made at the Job Fair. */
      try { r = M && M.sendToJob(who, at); } catch (e) { r = null; }
      closeHireModal();
      if (!r || !r.ok) { toastish('⚠ ' + ((r && r.why) || 'That did not work.'), true); return; }
      toastish('✅ ' + r.name + ' is ' + r.what + '.');
      render(true);
      return;
    }
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
    /* 🔕 The header bell. Handled HERE rather than on the wrapper because it
       is inside #bcp-screen where this delegate is bound — the chassis switch
       is outside it and is wired separately, and that split is the whole
       reason both exist as separate listeners. */
    if (act === 'mute') {
      const now = setMuted(!isMuted());
      toastish(now ? '🔕 Notifications silenced.' : '🔔 Notification sound on.');
      if (!now) { try { const a = pingEl(); if (a) { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} }
      return;
    }
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
  /* 🔕 THE RING/SILENT SWITCH IS WIRED HERE, ON THE WRAPPER, NOT ON THE SCREEN.
     🔴 THE MAIN DELEGATE IS BOUND TO #bcp-screen, and this button is physically
        on the shell BESIDE the screen — so a data-act handled there would never
        receive its click. That is not a guess: the hire modal shipped mounted on
        the outer wrapper for exactly this reason, rendered perfectly, and its
        Hire button did nothing at all. Same geometry, so the same fix, applied
        before rather than after.
     ⚠ AND THE BACKDROP CLOSE STAYS EXACT. `ev.target === wrap` only fires on
       the scrim itself, so this must run BEFORE it and return — otherwise a
       click on hardware sitting over the scrim could close the phone. */
  wrap.addEventListener('click', (ev) => {
    const m = ev.target && ev.target.closest ? ev.target.closest('#bcp-mute') : null;
    if (m) {
      ev.preventDefault(); ev.stopPropagation();
      const now = setMuted(!isMuted());
      try { toastish(now ? '🔕 Notifications silenced.' : '🔔 Notification sound on.'); } catch (e) {}
      /* Ring it once on the way back ON, so the player hears what they just
         switched on rather than taking the label's word for it. */
      if (!now) { try { const a = pingEl(); if (a) { a.currentTime = 0; const p = a.play(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} }
      return;
    }
    if (ev.target === wrap) close();
  });

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
      /* 🔕 THE RING/SILENT SWITCH IS A REAL BUTTON, not decoration — it is the
         topmost thing on the left rail exactly as it is on the handset this is
         drawn from, so it needs no label to be found. The volume pair and the
         power key below it stay decorative: they have nothing to do. */
      '<button type="button" id="bcp-mute" data-act="mute" aria-pressed="false"' +
        ' aria-label="Notification sound is on — turn it off"><i aria-hidden="true"></i></button>' +
      '<i class="bcp-vol up" aria-hidden="true"></i><i class="bcp-vol dn" aria-hidden="true"></i>' +
      '<i class="bcp-pwr" aria-hidden="true"></i>' +
      '<div id="bcp-screen">' +
        '<i class="bcp-notch-hw" aria-hidden="true"><b class="cam"></b><b class="spk"></b></i>' +
        '<div id="bcp-status"></div>' +
        '<div id="bcp-app">' +
          '<span class="bcp-glyph" aria-hidden="true">📣</span>' +
          '<span class="bcp-ttl"><b id="bcp-appttl">Emergency Broadcast</b>' +
            '<small>The city, in its own words</small></span>' +
          /* 🔕 THE MUTE, IN THE HEADER, BESIDE THE CLOSE BUTTON.
             🔴 THE SIDE SWITCH WAS NOT DISCOVERABLE AND THAT WAS THE POINT OF
                IT — a 4px sliver on the chassis rail is exactly what a real
                ring/silent switch looks like, and on a real phone you find it
                with your thumb, not your eyes. On a picture of a phone there
                is no thumb. It stays (it is correct, and it works), but the
                control a player can SEE is here, in the app, next to the only
                other button on the bar. The two drive the same state through
                the same setMuted, so they can never disagree. */
          '<button type="button" id="bcp-bell" data-act="mute" aria-pressed="false"' +
            ' aria-label="Notification sound is on — turn it off" title="Mute notifications">🔔</button>' +
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
  /* The switch is built in its default (unmuted) markup, so a player who
     silenced it last session must see that reflected on the first paint
     rather than on their first click. */
  paintMute();
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
/* 📱 THE HANDSET. 19.5:9 and a 56px corner, which is the real thing's geometry
   and the reason the old 9:19 / 6px slab never read as a phone however much
   hardware was drawn on it.
   🔴 THIS DELIBERATELY BREAKS DESIGN-BAR.md SECTION 3, WHICH CAPS A PANEL AT
      6px, AND THE BAR HAS BEEN AMENDED RATHER THAN QUIETLY IGNORED. The old
      note here said the corners went to 6/4 because large radii read as modern
      web, that the silhouette would be carried by the rails and the notch
      instead, and ended: do not put the 38px back without moving the bar
      first. The owner has since asked for it in as many words — make the phone
      modal fit that perfectly where it looks like an iPhone — so the bar moved
      first: DESIGN-BAR.md section 3 now carves out depicted physical objects,
      of which this is the only one in the app. The rule still binds every
      panel and card; a phone is not one.
   ⚠ THE SCREEN INSIDE IS STILL THE GAME'S LOOK. Only the DEVICE is an iPhone.
     The feed, the tabs and the status bar keep their 4px frames and their gold,
     because the conceit is the city's own broadcast app running on a handset,
     not an iOS reskin. */
/* 🔴 THE WIDTH IS COMPUTED, NOT LEFT TO aspect-ratio, AND THAT IS A FIX.
   The shell carried aspect-ratio:9/19 with width:auto for its whole life and
   NEVER HONOURED IT. Measured at 1280x900: height 676px, width 420px — 0.62,
   nothing like the 0.47 the ratio asks for. The cause is flex: the shell is an
   item in a flex row, so with width:auto its base size comes from the CONTENT
   (a feed of text, which is wide), and aspect-ratio never gets to resolve; the
   only thing holding the width down was max-width, so the phone was simply
   420px wide at every size. It read as a slab because it WAS one, which is
   also why no amount of rail detailing had rescued the old silhouette.
   The height drives, in a custom property so it is stated once, and the width
   is derived from it. 94vw still clamps a very narrow window — a phone that
   overflows its own dialog is worse than one briefly off-ratio. */
#bcp-shell{--ph:min(860px,calc(100vh - var(--topbarh,60px) - 40px));
  position:relative;flex:0 0 auto;
  height:var(--ph);width:min(94vw,calc(var(--ph) * 9 / 19.5));
  border-radius:56px;padding:11px;box-sizing:border-box;
  /* Brushed titanium: a bright top-left edge, a dark body, a bright bottom-right
     edge. Three stops in one gradient is what makes a flat border read as a
     machined rail rather than as a stroke. */
  background:linear-gradient(148deg,#e9ecef 0%,#a7adb5 12%,#5c6169 34%,#3d4147 52%,#6f757d 74%,#c9ced4 92%,#8e949c 100%);
  border:0;
  box-shadow:0 40px 110px rgba(0,0,0,.82),
             inset 0 0 0 1.5px rgba(255,255,255,.22),
             inset 0 1px 2px rgba(255,255,255,.5),
             inset 0 -1px 2px rgba(0,0,0,.55);
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
/* The side hardware, in its real arrangement: silent switch, volume up, volume
   down on the left rail; power on the right. Machined to match the frame — the
   same bright-edge / dark-body gradient, so they read as part of the chassis
   rather than as tabs stuck onto it.
   ⚠ ONLY THE SWITCH DOES ANYTHING. The volume keys and the power key are
     chrome and carry aria-hidden; giving a decorative key a hover state would
     promise an action that does not exist. */
#bcp-shell .bcp-vol,#bcp-shell .bcp-pwr,#bcp-mute{position:absolute;left:-2.5px;width:3.5px;
  border-radius:3px;border:0;padding:0;
  background:linear-gradient(90deg,#8f959d,#4a4e55 55%,#2b2e33);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.35), 0 1px 2px rgba(0,0,0,.5);}
#bcp-shell .bcp-vol.up{top:150px;height:52px;}
#bcp-shell .bcp-vol.dn{top:212px;height:52px;}
#bcp-shell .bcp-pwr{left:auto;right:-2.5px;top:186px;height:86px;}

/* 🔕 THE RING / SILENT SWITCH. Slightly shorter and slightly proud of the rail,
   because on the real handset it is the one control that MOVES — and the whole
   reason it is here rather than in a menu is that a player already knows what
   this shape does. */
#bcp-mute{top:104px;height:30px;width:4px;left:-3px;cursor:pointer;
  transition:background .16s ease;}
#bcp-mute > i{position:absolute;left:-16px;top:50%;transform:translateY(-50%);
  width:14px;height:14px;border-radius:50%;pointer-events:none;
  background:transparent;transition:background .16s ease,box-shadow .16s ease;}
/* Muted: the switch is thrown, and the orange dot a real one exposes appears. */
#bcp-mute.on{background:linear-gradient(90deg,#ffb066,#e0651a 60%,#a83f08);}
#bcp-mute.on > i{background:radial-gradient(circle at 40% 35%,#ffd0a0,#e0651a 60%,#8f3406);
  box-shadow:0 0 8px rgba(224,101,26,.6);}
#bcp-mute:hover{filter:brightness(1.25);}
#bcp-mute:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:3px;}

/* The display. 46px = the 56px chassis corner minus the 11px bezel, which is
   how a real device's screen radius is derived and why anything else leaves a
   visible crescent of frame at each corner. */
#bcp-screen{height:100%;display:flex;flex-direction:column;overflow:hidden;
  border-radius:46px;position:relative;
  background:linear-gradient(180deg,rgba(20,17,13,.99),rgba(8,7,6,1));
  box-shadow:inset 0 0 0 1px rgba(212,175,55,.18), inset 0 0 60px rgba(212,175,55,.03);}

/* 📱 THE NOTCH, cut out of the DISPLAY rather than drawn in the status bar.
   🔴 THE OLD ONE WAS A BLACK PILL FLOATING INSIDE THE STATUS ROW — it sat on
      the same background it was meant to be a hole in, so it read as a widget
      and not as hardware. This one hangs off the top edge of the screen with
      its bottom corners rounded, which is the actual shape, and it carries the
      camera and speaker the eye looks for to confirm what it is.
   ⚠ pointer-events:none — it overlaps the status bar and must never eat a
     click meant for the app underneath it. */
#bcp-screen .bcp-notch-hw{position:absolute;left:50%;top:0;transform:translateX(-50%);
  width:52%;max-width:170px;height:26px;background:#000;z-index:6;pointer-events:none;
  border-radius:0 0 18px 18px;
  display:flex;align-items:center;justify-content:center;gap:9px;}
#bcp-screen .bcp-notch-hw .spk{width:34px;height:4px;border-radius:3px;
  background:linear-gradient(180deg,#1e1f22,#111);box-shadow:inset 0 1px 1px rgba(255,255,255,.07);}
#bcp-screen .bcp-notch-hw .cam{width:7px;height:7px;border-radius:50%;
  background:radial-gradient(circle at 35% 30%,#2b3a52,#0a0d14 70%);
  box-shadow:inset 0 0 0 1px rgba(90,120,170,.35);}

/* ── status bar ── */
/* The status row sits UNDER the notch and pushes its two ends outboard of it,
   which is what a real one does — the clock left, the battery right, nothing
   in the middle where the hardware is. The extra top padding is the notch
   depth; without it the clock renders behind black. */
#bcp-status{flex:none;height:44px;display:flex;align-items:flex-end;justify-content:space-between;
  padding:0 30px 5px;position:relative;font-size:10.5px;color:#b8ac96;
  font-variant-numeric:tabular-nums;letter-spacing:.03em;}
#bcp-status .bcp-clk{font-weight:700;color:#e8dcc0;}
/* 🔴 THE OLD DRAWN NOTCH IS GONE — the real one is cut out of the display
   above. Kept as a zero-size rule rather than deleted because renderStatus()
   still emits the element and a stray undecorated <i> would inherit the status
   row's layout and push the clock off-centre. */
#bcp-status .bcp-notch{display:none;}
#bcp-status .bcp-sysr{display:flex;align-items:center;gap:5px;}
#bcp-status .bcp-wx{font-size:11px;line-height:1;}
#bcp-status .bcp-batt{display:inline-block;width:20px;height:9px;border-radius:2px;
  border:1px solid rgba(255,255,255,.35);padding:1px;position:relative;}
#bcp-status .bcp-batt::after{content:"";position:absolute;right:-3px;top:2.5px;width:2px;height:3px;
  border-radius:0 1px 1px 0;background:rgba(255,255,255,.35);}
#bcp-status .bcp-batt > i{display:block;height:100%;background:#7fd3a4;border-radius:1px;}
#bcp-status .bcp-batt.low > i{background:var(--ember,#ff7a2f);}
#bcp-status .bcp-bp{font-size:9.5px;color:#9d907a;}

/* ── app header ── */
#bcp-app{flex:none;display:flex;align-items:center;gap:9px;padding:6px 14px 10px;
  border-bottom:1px solid rgba(212,175,55,.26);
  background:linear-gradient(180deg,rgba(212,175,55,.08),transparent);}
#bcp-app .bcp-glyph{font-size:19px;line-height:1;flex:none;}
#bcp-app .bcp-ttl{flex:1;min-width:0;}
#bcp-app .bcp-ttl b{display:block;
  font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;
  /* 🔴 SIZED TO FIT, TWICE, AND MEASURED BOTH TIMES. The handset is 312px wide
     since it started keeping its real 9:19.5 ratio, and the app bar now carries
     TWO buttons (mute and close) rather than one. At the original 12.5px/.14em
     the title read EMERGENCY BROADC…; at 11px/.07em, with the bell added, it
     read EMERGENCY BROA…. 9.5px/.02em fits the whole phrase with the bell in
     place — the driver asserts it rather than trusting this comment.
     ⚠ Do not add a third control to this bar without re-measuring. */
  font-size:9.5px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:#f0d68f;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#bcp-app .bcp-ttl small{display:block;font-size:9.5px;color:var(--mist,#9d907a);margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#bcp-x{flex:none;cursor:pointer;background:rgba(255,255,255,.05);
  border:1px solid rgba(212,175,55,.4);color:#e8dcc0;border-radius:4px;
  padding:5px 8px;font-size:12px;line-height:1;}
#bcp-x:hover{background:rgba(212,175,55,.16);color:#ffd166;}
/* 🔕 The bell sits beside the close button and matches it, because they are
   the two controls on the app bar and a stranger should not read one as more
   dangerous than the other. Muted turns it amber — the same colour the
   chassis switch shows, so the two states agree at a glance. */
#bcp-bell{flex:none;cursor:pointer;background:rgba(255,255,255,.05);
  border:1px solid rgba(212,175,55,.4);color:#e8dcc0;border-radius:4px;
  padding:5px 8px;font-size:12px;line-height:1;margin-right:5px;}
#bcp-bell:hover{background:rgba(212,175,55,.16);}
#bcp-bell.on{background:rgba(224,101,26,.2);border-color:rgba(255,150,70,.65);}
#bcphone button:focus-visible{outline:2px solid var(--sky,#7fb8ff);outline-offset:2px;}

/* ── filter tabs ── */
/* 🔴 THE TABS WRAP NOW, AND THEY USED TO SCROLL SIDEWAYS OFF THE SCREEN.
   Five tabs at 11px of padding and .11em of tracking need about 400px; the
   handset is 312px wide since it started keeping its real 9:19.5 ratio. So
   the fifth tab — UNEMPLOYED, the newest and least expected one — sat cut in
   half at the right edge behind an invisible scrollbar (scrollbar-width:none,
   deliberately). A control a player cannot see is a control they do not have,
   and it was the one tab nobody would think to look for.
   ⚠ WRAP RATHER THAN SHRINK-TO-FIT. Squeezing five tabs into 312px means ~7px
     type on a dark ground, which is unreadable at the size a phone is drawn.
     Two rows of legible tabs is the right trade on a device whose whole
     premise is that it is small.
   ⚠ AND NO MORE HORIZONTAL SCROLL. It is what hid the problem: the layout was
     never broken, so nothing looked wrong — the content simply left. */
#bcp-tabs{flex:none;display:flex;flex-wrap:wrap;gap:4px;padding:7px 10px;
  border-bottom:1px solid var(--edge,rgba(198,160,74,.34));}
#bcp-tabs button{flex:0 1 auto;min-width:0;cursor:pointer;background:rgba(255,255,255,.04);
  border:1px solid rgba(198,160,74,.2);color:var(--mist,#9d907a);border-radius:4px;
  padding:4px 8px;font-size:9px;letter-spacing:.06em;text-transform:uppercase;
  white-space:nowrap;
  font-family:'Cinzel',Georgia,'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',serif;}
#bcp-tabs button:hover{color:var(--bone,#e8e2d5);}
#bcp-tabs button[aria-selected="true"]{background:rgba(212,175,55,.16);color:#f0d68f;
  border-color:rgba(212,175,55,.5);}

/* ── 💼 the Unemployed tab, and the hire modal ── */
/* Scoped under #bcphone like everything else here: .post, .tag and friends
   already mean something in an 11 MB page, so nothing is a bare class name.
   NOTE: no backticks in here — this whole block is a JS template literal and a
   backtick in a CSS comment ENDS THE STRING. It parsed fine and threw at
   runtime with the stylesheet as the error message. */
.bcp-jb{margin:6px 8px;padding:9px 10px;border:1px solid rgba(212,175,55,.22);
  border-radius:9px;background:rgba(255,255,255,.03);}
.bcp-jb-top{display:flex;gap:9px;align-items:center;}
.bcp-jb-face{width:30px;height:30px;flex:none;display:flex;align-items:center;justify-content:center;
  border-radius:50%;background:rgba(212,175,55,.14);border:1px solid rgba(212,175,55,.3);font-size:15px;}
.bcp-jb-who{display:flex;flex-direction:column;min-width:0;}
.bcp-jb-who b{font-size:12.5px;color:var(--bone,#e8dcc4);}
.bcp-jb-who small{font-size:10px;color:var(--mist,#9d907a);}
/* 👤 The name is a button but must not LOOK like one — it reads as a name that
   happens to be tappable, the same way a citizen post author does. */
.bcp-jb-name{background:none;border:0;padding:0;cursor:pointer;text-align:left;
  font-family:inherit;font-size:12.5px;font-weight:700;color:var(--bone,#e8dcc4);
  text-decoration:underline;text-decoration-color:rgba(212,175,55,.4);
  text-underline-offset:2px;}
.bcp-jb-name:hover{color:#f0d68f;text-decoration-color:rgba(212,175,55,.9);}
/* 🎓 The schooling badge. Sits opposite the name so it lines up with the
   requirement printed on each business row — they are meant to be compared. */
.bcp-jb-edu{flex:none;align-self:flex-start;font-size:9px;letter-spacing:.06em;
  text-transform:uppercase;padding:2px 6px;border-radius:999px;white-space:nowrap;
  border:1px solid rgba(212,175,55,.35);background:rgba(212,175,55,.1);color:#e8d49a;}
/* A place they cannot take yet: shown, explained, and not clickable. */
.bcp-hire-row.locked{opacity:.55;cursor:default;}
.bcp-hire-row.locked:hover{border-color:rgba(255,255,255,.08);background:rgba(255,255,255,.03);}
.bcp-hire-no{flex:none;font-size:12px;opacity:.8;}
.bcp-jb-fit{font-size:10.5px;color:var(--mist,#9d907a);margin-top:5px;}
.bcp-jb-fit b{color:var(--bone,#e8dcc4);}
.bcp-jb-busy{margin-top:7px;font-size:10.5px;color:#e0c37a;}
.bcp-jb-btn{margin-top:8px;width:100%;cursor:pointer;padding:7px;border-radius:7px;
  border:1px solid rgba(212,175,55,.5);background:rgba(212,175,55,.13);color:#f0d78a;
  font-size:11px;font-weight:800;letter-spacing:.04em;}
.bcp-jb-btn:hover{background:rgba(212,175,55,.24);}

/* The modal sits INSIDE the phone shell so it is clipped by the handset —
   a dialog escaping the bezel would read as a web page, not a device. */
#bcp-hire{position:absolute;inset:0;z-index:6;display:none;align-items:flex-end;
  background:rgba(4,3,10,.66);border-radius:inherit;}
#bcp-hire.on{display:flex;}
.bcp-modal-in{width:100%;max-height:78%;overflow-y:auto;overscroll-behavior:contain;
  background:linear-gradient(180deg,#191423,#120f1a);border-top:1px solid rgba(212,175,55,.45);
  border-radius:14px 14px 0 0;padding:10px 8px 14px;}
.bcp-modal-head{display:flex;align-items:center;gap:8px;padding:2px 6px 8px;}
.bcp-modal-head b{flex:1;font-size:12.5px;color:var(--gold,#d4af37);letter-spacing:.03em;}
.bcp-modal-x{cursor:pointer;background:none;border:0;color:var(--mist,#9d907a);font-size:13px;padding:2px 5px;}
.bcp-modal-sub{padding:0 6px 8px;font-size:10.5px;color:var(--mist,#9d907a);}
.bcp-hire-row{display:flex;gap:9px;align-items:center;width:calc(100% - 12px);margin:0 6px 6px;
  padding:8px 9px;cursor:pointer;text-align:left;border-radius:8px;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);}
.bcp-hire-row:hover{border-color:rgba(212,175,55,.5);background:rgba(212,175,55,.08);}
.bcp-hire-ico{font-size:17px;flex:none;}
.bcp-hire-body{flex:1;min-width:0;display:flex;flex-direction:column;}
.bcp-hire-body b{font-size:11.5px;color:var(--bone,#e8dcc4);}
.bcp-hire-body small{font-size:9.5px;color:var(--mist,#9d907a);}
.bcp-hire-go{flex:none;font-size:10px;font-weight:800;letter-spacing:.07em;padding:4px 9px;
  border-radius:999px;background:linear-gradient(180deg,#e8c65a,#a5811f);color:#241a05;}

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
  background:rgba(212,175,55,.9);color:#1a1409;border:0;border-radius:999px;
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
  background:linear-gradient(160deg,#2a2419,#100e0a);
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
.bcp-when{flex:none;font-size:10.5px;color:#8d8272;font-variant-numeric:tabular-nums;}
.bcp-foll{font-size:7.5px;letter-spacing:.12em;padding:1px 5px;border-radius:999px;
  background:rgba(212,175,55,.15);color:#e6c86f;border:1px solid rgba(212,175,55,.4);
  font-family:'Cinzel',Georgia,serif;margin-right:6px;white-space:nowrap;}
.bcp-subline{margin-top:2px;display:flex;align-items:center;min-width:0;}
.bcp-sub{padding:0;background:none;border:0;text-align:left;min-width:0;
  font-size:10px;color:var(--mist,#9d907a);letter-spacing:.03em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bcp-sub.go{cursor:pointer;text-decoration:underline;text-decoration-color:rgba(157,144,122,.4);
  text-underline-offset:2px;}
.bcp-sub.go:hover{color:#d9cbaa;}
.bcp-txt{margin:5px 0 0;font-family:'Crimson Text',Georgia,serif;font-size:13px;line-height:1.5;
  color:var(--bone,#e8e2d5);overflow-wrap:anywhere;}
.bcp-tag{color:#8fc2ff;font-weight:600;}
.bcp-post[data-pole="bad"] .bcp-tag{color:#ffab86;}

/* ── the like control ── */
.bcp-act{display:flex;justify-content:flex-end;margin-top:6px;}
.bcp-like{display:inline-flex;align-items:center;gap:5px;cursor:pointer;
  background:none;border:1px solid transparent;border-radius:4px;padding:2px 8px;
  color:#9d907a;font-size:11.5px;font-variant-numeric:tabular-nums;line-height:1.4;}
.bcp-like:hover{background:rgba(224,90,70,.1);border-color:rgba(224,90,70,.35);color:#e8a5a5;}
.bcp-like .bcp-heart{font-size:12.5px;line-height:1;}
.bcp-like.on{color:#ff8f9a;border-color:rgba(255,143,154,.4);background:rgba(255,143,154,.08);}
.bcp-like .bcp-n{font-weight:700;}
/* Screen-reader-only: the heart's meaning is a number and a claim about the
   city, and neither survives being read out as "17 heart". */
.bcp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);
  clip-path:inset(50%);white-space:nowrap;}

.bcp-empty{padding:34px 22px;text-align:center;color:var(--mist,#9d907a);}
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
#bcp-foot{font-size:9.5px;color:#8d8272;letter-spacing:.03em;text-align:center;
  line-height:1.4;max-width:100%;}
#bcp-home .bar{width:96px;height:4px;border-radius:2px;background:rgba(232,220,192,.22);}

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
