/* ══════════════════════════════════════════════════════════════════════════
   📣 EMERGENCY BROADCAST — the city's social feed. Module entry point.
   Registers window.MythicBroadcast.

   WHAT THIS IS. A Chirper-shaped feed for node-city: named citizens,
   businesses by their own names, and city departments posting about things
   that are actually happening, newest first, each with a like count that is a
   MEASUREMENT of how many people the post is true for. The phone-shaped modal
   that renders it is a separate piece of work; this module is the engine, and
   the read API it exposes is at the bottom of this file.

   ══ 🔴 "MAKE IT RANDOM AND FRESH, HAVE AI MAKE IT DIFFERENT" ═══════════════
   Read as an instruction about the OUTPUT, not about the implementation, and
   deliberately so. A runtime language model is the wrong tool here on two
   independent grounds and either one is disqualifying:

     1. There is no reachable network from inside the game. The city already
        runs offline and degrades to mock or empty data everywhere else
        (CLAUDE.md's first non-negotiable); a feed that needed an API call
        would be an empty panel for every offline player, and a slow one for
        everybody else.
     2. A generated sentence is not accountable to a number. The mechanic the
        user actually asked for is that a like count tells them how big a
        problem is — that only works if the sentence and the count come out of
        the same reading. A model writing prose over a summary is free to
        invent an emphasis the data does not support, and the player cannot
        tell which parts are measured.

   So variety is STRUCTURAL, and it is built out of five things:
     · every post is generated from a real city event PLUS the poster's own
       situation, so the same shortfall from two people reads differently;
     · templates COMPOSE — frame × opener × clause × intensity × tail × tags —
       rather than being drawn whole (phrases.js);
     · every citizen has a stable VOICE, hashed off their identity, so you
       recognise a regular across sessions (voices.js);
     · intensity tracks real severity, so the adjective is part of the reading;
     · nothing repeats verbatim in a session (feed.js `SEEN`).
   Measured combinatorics are on the API as `variants()` — a claim about
   variety that nobody can check is a claim not worth making.

   ══ 🔴 EVERY POST TRACES TO SOMETHING REAL ════════════════════════════════
   There is no code path from a template to the feed that does not pass through
   sources.js, and every function in sources.js reads a live number off a
   module that is actually mounted. A clause that wants a figure the event does
   not have is DROPPED, not filled in (compose.js). Every published post
   carries `source.why` — the reading it came from — and that string rides the
   save. A feed of plausible invented noise is worse than no feed, because the
   player will make decisions on it.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `NEED_META`, `vitals`,
      `wx` and `cityPop` are top-level `const` in node-city's module script and
      are invisible from here. The ctx passed to mount() IS the hand-over.
      Note what is NOT in it: nothing that writes to a tile, a citizen, the
      ledger or the economy. This module reads the city and writes one array.
      The single mutating call it is given is `saveSoon`.
   ══════════════════════════════════════════════════════════════════════════ */
import { BCAST } from './tuning.js';
import { SUBJECTS, DEPTS, subjectOf, deptOf } from './subjects.js';
import { VOICES, VOICE_IDS, voiceFor, INSTITUTIONAL, COMMERCIAL } from './voices.js';
import { composePost, variantCount } from './compose.js';
import * as Feed from './feed.js';
import * as Src from './sources.js';
import * as LK from './likes.js';
import { hashStr, rngFrom } from './rng.js';

let CTX = null;
let mounted = false;
let simSec = 0;            // simulated city seconds accumulated since mount
let lastPassAt = -1e9;     // simSec of the last observation pass
let lastWall = 0;          // wall clock of the last pass — the catch-up guard
let catchUpPasses = 0;
let stats = { passes: 0, events: 0, published: 0, dropped: 0, refusedNoClause: 0, refusedCooldown: 0 };

const CZ = () => { try { return window.MythicCitizens || null; } catch (e) { return null; } };

function warn(msg, e) { try { console.warn('[Broadcast] ' + msg, e || ''); } catch (x) {} }

/* ── POSTER RESOLUTION ─────────────────────────────────────────────────────
   Turns an event into somebody who can plausibly be the one saying it. Returns
   null when there is nobody — an empty city cannot produce a citizen post, and
   the correct behaviour is silence, not a stock name. */
function resolvePoster(ev) {
  if (ev.posterKind === 'dept') {
    const d = deptOf(ev.subject);
    if (!d) return null;
    return { kind: 'dept', name: d.name, sub: null, hue: d.hue, ico: d.ico,
             voice: INSTITUTIONAL, key: 'dept:' + d.id };
  }
  if (ev.posterKind === 'company') {
    const p = ev.poster;
    if (!p || !p.name) return null;
    return { kind: 'company', name: p.name, sub: p.sub || null,
             hue: hashStr('bcbiz|' + p.name) % 360, ico: p.ico || '🏬',
             voice: COMMERCIAL, key: 'biz:' + p.name };
  }
  /* A citizen the EVENT names, rather than one chosen to speak for a citywide
     reading. Every life-path event is of this kind: the roster diff knows
     precisely who was hired, who lost a seat and who left, and picking a
     different resident to announce it would be a false statement about a named
     person. The leaver's identity comes off the previous snapshot — by the
     time this runs they are not on the roster to look up. */
  if (ev.poster && ev.poster.name && ev.posterKind === 'citizen') {
    const who = { id: ev.poster.id != null ? ev.poster.id : hashStr(ev.poster.name),
                  name: ev.poster.name, job: ev.poster.job || null };
    return { kind: 'citizen', name: who.name, sub: ev.poster.sub || null,
             hue: hashStr('bcav|' + who.name) % 360, ico: null,
             voice: voiceFor(who), key: 'cz:' + who.id, citizen: who };
  }
  const c = Src.pickCitizen(ev.seed, ev.pole);
  if (!c) return null;
  let sub = null;
  try {
    const cz = CZ();
    const emp = cz && cz.employer ? cz.employer(c.id) : null;
    if (emp && emp.name) sub = emp.name;
    else if (c.job && CTX && CTX.game.tiles[c.job]) {
      /* The business's OWN name where it has one — /src/naming gave it one, and
         printing "Farm" under a poster who works at Ashgrove Provisions is the
         kind of near-miss that makes a whole panel read as generated. */
      const nm = (window.MythicNaming && window.MythicNaming.nameFor(c.job)) || null;
      const def = CTX.BUILDINGS[CTX.game.tiles[c.job].type];
      sub = nm || (def && def.name) || null;
    }
  } catch (e) {}
  return { kind: 'citizen', name: c.name, sub, hue: hashStr('bcav|' + c.name) % 360,
           ico: null, voice: voiceFor(c), key: 'cz:' + c.id, citizen: c };
}

/* How many people a PERSONAL event is additionally true for. Coworkers at the
   same seat are the bond the live roster can actually answer for — node-city's
   CITIZENS_API has no bonds list, and inventing a friend count would be
   exactly the fabricated headcount likes.js forbids. */
function bondsOf(citizen) {
  try {
    const cz = CZ();
    if (!cz || !citizen || !citizen.job || !cz.byJob) return 0;
    return Math.max(0, (cz.byJob(citizen.job) || []).length - 1);
  } catch (e) { return 0; }
}

/* ── PUBLISH ONE EVENT ─────────────────────────────────────────────────────
   Four gates, in order, and each of them can refuse. Refusals are counted so
   `stats()` can say WHY the feed is quiet — a silent feed with no explanation
   is indistinguishable from a broken one, which is the failure modcheck.mjs
   was written for. */
function publish(ev, nowSec) {
  const subj = subjectOf(ev.subject); if (!subj) return null;
  if (!Feed.subjectReady(ev.subject, nowSec, ev.severity)) { stats.refusedCooldown++; return null; }
  const poster = resolvePoster(ev);
  if (!poster) { stats.dropped++; return null; }
  if (!Feed.posterReady(poster.key, nowSec, ev.subject)) { stats.refusedCooldown++; return null; }

  /* The headcount. A personal event's is filled in HERE, from the citizen who
     actually turned out to be posting — not guessed by the observer, which
     could not know who it would be. */
  let affected = ev.affected;
  if (ev.personal) affected = LK.fromPerson(bondsOf(poster.citizen));
  if (affected == null || !Number.isFinite(affected)) { stats.dropped++; return null; }

  const out = composePost(ev, poster, poster.voice, Feed.seenSet());
  if (!out) { stats.refusedNoClause++; return null; }

  const post = Feed.add({
    at: ev.at, clock: Feed.clockOf(ev.at),
    kind: poster.kind,
    poster: { name: poster.name, sub: poster.sub,
              avatar: Feed.avatarFor(poster.kind, poster.name, poster.hue, poster.ico) },
    body: out.body, tags: out.tags,
    likes: LK.likesFor(affected, ev.key + '|' + poster.key),
    affected: Math.round(affected),
    subject: ev.subject, severity: ev.severity, pole: ev.pole,
    source: { src: ev.src, why: ev.why },
  });
  Feed.noteSpoke(ev.subject, poster.key, nowSec, ev.severity);
  stats.published++;
  return post;
}

/* ── THE PASS ──────────────────────────────────────────────────────────────
   Ranked so the loudest genuinely-new thing gets the scarce slots. Ties inside
   a severity band break toward subjects the feed has not covered recently,
   which is what stops a persistent brownout crowding out a famine that started
   thirty seconds ago. */
function runPass(nowSec) {
  stats.passes++;
  let evs = [];
  try { evs = Src.observe(CTX) || []; } catch (e) { warn('observe threw', e); return []; }
  stats.events += evs.length;
  evs.sort((a, b) => {
    const ra = Feed.subjectReady(a.subject, nowSec, a.severity) ? 1 : 0;
    const rb = Feed.subjectReady(b.subject, nowSec, b.severity) ? 1 : 0;
    if (ra !== rb) return rb - ra;
    const ds = (b.severity || 0) - (a.severity || 0);
    /* Only break a genuine tie on `pref`. Sorting by pref FIRST would put a
       resident's mild grumble above a department's account of a collapse, and
       the top of the feed has to be the biggest thing happening. */
    if (Math.abs(ds) > 0.02) return ds;
    return (b.pref || 0) - (a.pref || 0);
  });
  const made = [];
  const kinds = {};
  for (const ev of evs) {
    if (made.length >= BCAST.observe.maxPerPass) break;
    const cap = BCAST.observe.kindCap[ev.posterKind];
    if (cap != null && (kinds[ev.posterKind] || 0) >= cap) continue;
    const p = publish(ev, nowSec);
    if (p) { made.push(p); kinds[ev.posterKind] = (kinds[ev.posterKind] || 0) + 1; }
  }
  if (made.length) { try { CTX.saveSoon && CTX.saveSoon(); } catch (e) {} }
  return made;
}

/* ── TICK ──────────────────────────────────────────────────────────────────
   Driven off economyTick, in SIMULATED minutes. Not a timer of its own: a
   second clock would drift from the one every other panel quotes, and a tab
   left open with no ticks running would fill the feed with posts about a city
   that did nothing. Same argument /src/economy's header makes. */
export function tick(dtMin) {
  if (!mounted) return 0;
  const dt = Math.max(0, +dtMin || 0) * 60;
  simSec += dt;
  if (simSec - lastPassAt < BCAST.observe.everySec) return 0;

  /* ⏳ THE OFFLINE CATCH-UP VALVE. offlineCatchUp() drives economyTick in a
     tight loop, so 36 hours of absence would otherwise run hundreds of passes
     in a few hundred milliseconds and hand a returning player a feed of
     nothing but their absence. Passes that arrive with no wall clock between
     them are catch-up passes and are capped; the counter resets as soon as the
     game is running at a human rate again. */
  const wall = Date.now();
  if (wall - lastWall < 200) {
    if (++catchUpPasses > BCAST.observe.catchUpMaxPasses) { lastPassAt = simSec; return 0; }
  } else { catchUpPasses = 0; }
  lastWall = wall;
  lastPassAt = simSec;
  return runPass(simSec).length;
}

/* ── SAVE ──────────────────────────────────────────────────────────────────
   Through the module save shelf (/src/naming/save.js), which is the pattern
   for anything that persists after it existed: one `register` call and NO edit
   to node-city's serialize() literal. The log cursor rides the blob with the
   posts, because a returning player must not be handed forty posts about the
   forty log lines that were already on disk when they closed the tab. */
function saveBlob() {
  const b = Feed.serialize();
  b.lc = Src.logCursor();
  return b;
}
function loadBlob(raw) {
  try {
    Feed.load(raw);
    if (raw && raw.lc) Src.setLogCursor(raw.lc);
    else if (CTX) Src.skipExistingLog(CTX.game);
  } catch (e) { warn('load failed', e); Feed.reset(); }
}

/* ── MOUNT ─────────────────────────────────────────────────────────────────
   Mounted AFTER loadState so `skipExistingLog` sees the log that came off
   disk, and after /src/naming so a business that opens on the first tick can
   post under the name the register gave it rather than under "Farm". */
export function mount(ctx) {
  CTX = ctx || {};
  if (!CTX.game) { warn('mount() without a game — refusing'); return null; }
  if (typeof CTX.cityPop !== 'function') CTX.cityPop = () => 0;
  if (typeof CTX.weather !== 'function') CTX.weather = () => null;
  if (!CTX.NEED_META) CTX.NEED_META = {};
  if (!CTX.BUILDINGS) CTX.BUILDINGS = {};
  mounted = true;
  simSec = 0; lastPassAt = -1e9; lastWall = 0; catchUpPasses = 0;

  /* The shelf replays a payload to a late arrival, so registering is enough —
     there is no ordering requirement against loadState here. When there is no
     shelf at all (a build where /src/naming 404'd) the feed still runs; it
     just does not persist, and `skipExistingLog` keeps it from re-posting the
     saved log tail. */
  let shelved = false;
  try {
    const shelf = window.MythicCitySave;
    if (shelf && typeof shelf.register === 'function') {
      shelved = shelf.register('broadcast', { save: saveBlob, load: loadBlob });
    }
  } catch (e) { warn('save shelf', e); }
  if (!shelved) Src.skipExistingLog(CTX.game);
  return API;
}

/* ══════════════════════════════════════════════════════════════════════════
   📖 THE READ API — what the phone UI consumes.

     ready()                    -> bool
     posts({ limit, subject, kind, tag, followed, unread }) -> [Post] newest first
     post(id)                   -> Post | null
     unread()                   -> int      the button's badge
     unreadFollowed()           -> int      badge for subjects the mayor follows
     markRead()                 -> 0        call when the modal opens
     like(id)                   -> Post     TOGGLE. See below.
     liked(id) / following()
     subjects()                 -> [{ id, label, tag, ico, dept, scope }]
     affectedFor(likes)         -> int      the like curve, inverted
     stats() / variants()       -> diagnostics
     tick(dtMin) / mount(ctx) / save() / load(blob) / reset()

   POST SHAPE
     { id, at, clock:'16:14', kind:'citizen'|'company'|'dept',
       poster: { name, sub, avatar: { seed, initials, hue, ico, kind } },
       body, tags:['electricity'],
       likes,        THE MEASUREMENT — how many citizens the post is true for
       mine,         the mayor liked it
       shown,        likes + (mine?1:0) — print THIS next to the ♡
       affected,     the raw headcount the likes were derived from
       subject, severity, pole, followed, unread,
       source: { src, why } — the live reading the post came from }

   🔴 THE ONE THING A UI MUST NOT DO: print `likes` and `mine` as two numbers,
      or add its own increment. `shown` is the number to render. `likes` is the
      instrument and nothing the player does moves it (likes.js).
   ══════════════════════════════════════════════════════════════════════════ */
const API = {
  version: BCAST.version,
  ready: () => mounted,
  mount, tick,

  posts: (o) => Feed.posts(o),
  post: (id) => Feed.byId(id),
  count: () => Feed.count(),

  unread: () => Feed.unread(),
  unreadFollowed: () => Feed.unreadFollowed(),
  markRead: () => Feed.markRead(),

  like: (id) => Feed.like(id),
  liked: (id) => Feed.liked(id),
  following: () => Feed.following(),

  subjects: () => Object.keys(SUBJECTS).map((k) => {
    const s = SUBJECTS[k], d = s.dept ? DEPTS[s.dept] : null;
    return { id: s.id, label: s.label, tag: s.tag, scope: s.scope,
             ico: d ? d.ico : null, dept: d ? d.name : null };
  }),
  depts: () => Object.keys(DEPTS).map((k) => ({ ...DEPTS[k] })),

  /* The like curve, both ways. Public so a panel — or a player who wants to
     check the instrument — can go from a heart back to a headcount. */
  likesFor: (n, seed) => LK.likesFor(n, seed || 'probe'),
  affectedFor: (l) => LK.affectedFor(l),
  /* The guarantee in tuning.js, re-runnable. Default 1.4 is the ratio the
     jitter is documented to preserve; pass a smaller one to watch it fail. */
  likeSelfCheck: (r, n) => LK.selfCheck(r, n),

  save: saveBlob,
  load: loadBlob,
  reset: () => { Feed.reset(); Src.resetLog(); Src.resetRoster(); simSec = 0; lastPassAt = -1e9; },

  /* ── DIAGNOSTICS ────────────────────────────────────────────────────────
     `stats()` says why the feed is quiet, which is the difference between a
     working feature and a dark one. `variants()` counts the distinct bodies
     the composer can reach without generating them — the falsifiable version
     of "it does not repeat". */
  stats: () => ({ ...stats, ...Feed.stats(), simSec: Math.round(simSec),
                  nextPassIn: Math.max(0, Math.round(BCAST.observe.everySec - (simSec - lastPassAt))) }),
  variants: () => {
    /* Facts are assumed available, which is the CEILING — a real event with no
       number reaches fewer. Reported per (subject, pole) summed over voices. */
    const facts = { n: '1', v: '1', p: 'x', w: 'x', q: 'x' };
    const out = {};
    let total = 0;
    for (const id in SUBJECTS) {
      let n = 0;
      for (const pole of SUBJECTS[id].poles) {
        for (const band of (pole === 'bad' ? ['mild', 'notable', 'severe'] : ['good', 'great'])) {
          for (const v of VOICE_IDS) n += variantCount(id, 'cit', pole, band, VOICES[v], facts);
          n += variantCount(id, 'dept', pole, band, INSTITUTIONAL, facts);
          n += variantCount(id, 'biz', pole, band, COMMERCIAL, facts);
        }
      }
      out[id] = n; total += n;
    }
    return { total, bySubject: out, voices: VOICE_IDS.length };
  },

  /* Driver seams. `_pass` forces an observation regardless of the cadence, and
     `_observe` returns the raw events without publishing — the only way to
     test the bus and the composer separately, and RAF is dead in the capture
     pane so a timer-driven feature is otherwise unverifiable.
     ⚠ `_observe()` IS NOT FREE OF SIDE EFFECTS and a driver has to know it:
       it advances the game.log cursor and re-takes the roster snapshot, so
       calling it and THEN calling `_pass()` gives an empty pass — the events
       were already consumed. Inspect with `_observe()` or publish with
       `_pass()`, not both against the same tick. */
  _pass: () => runPass(simSec).map((p) => Feed.byId(p.id)),
  _observe: () => { try { return Src.observe(CTX); } catch (e) { return []; } },
  _publish: (ev) => publish(ev, simSec),
  _feed: Feed,
  _ctx: () => CTX,
  tuning: BCAST,
};

/* 🔌 module → window is the direction that works; window → a top-level `const`
   in the host is the direction that does not. Same handshake /src/economy,
   /src/power, /src/water and /src/pollution use: this line only announces that
   the API exists, and the host calls mount() when IT is ready. */
try {
  if (typeof window !== 'undefined') {
    window.MythicBroadcast = API;
    if (typeof window.__ncBroadcastReady === 'function') window.__ncBroadcastReady(API);
  }
} catch (e) {}

export default API;
