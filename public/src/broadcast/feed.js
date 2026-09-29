/* ══════════════════════════════════════════════════════════════════════════
   📜 THE FEED — the store, the retention policy, the likes, the save.

   Newest-first is what the reader wants and oldest-first is what a ring buffer
   wants, so the array is kept OLDEST-FIRST internally (push / shift, no
   reindexing) and reversed on the way out. Doing it the other way round means
   an unshift per post and a re-scan per trim, on the one code path that runs
   every observation for the whole life of a city.

   🔑 IDS ARE MONOTONIC AND PERSISTED. `seq` rides the save. Without that, a
   reload restarts the counter, a new post collides with a saved post's id, and
   the mayor's likes land on the wrong rows — the class of silent save bug this
   codebase has shipped three times.
   ══════════════════════════════════════════════════════════════════════════ */
import { BCAST } from './tuning.js';
import { hashStr } from './rng.js';

const V = 1;

let POSTS = [];              // oldest first
let SEQ = 0;                 // next post number
let LIKED = new Set();       // post ids the mayor liked
let FOLLOW = new Set();      // subject ids the mayor follows (see tuning.cooldown)
let READ = 0;                // highest seq the player has seen
let SEEN = new Set();        // lower-cased bodies, for the never-repeat rule

/* Cooldown bookkeeping, in SIMULATED city seconds. Not persisted: a cooldown
   is a fact about the last few minutes of play, and carrying one across a
   reload would silence a city that has been shut for a week. */
let lastSubjAt = {};
let lastSubjSev = {};
let lastPosterAt = {};
let lastPosterSubjAt = {};

export function reset() {
  POSTS = []; SEQ = 0; LIKED = new Set(); FOLLOW = new Set(); READ = 0; SEEN = new Set();
  lastSubjAt = {}; lastSubjSev = {}; lastPosterAt = {}; lastPosterSubjAt = {};
}

/* ── AVATARS ───────────────────────────────────────────────────────────────
   The reference gives every poster a coloured circle. The colour is derived
   HERE rather than in the UI so the same person is the same colour in the feed,
   in a future notification and in whatever else grows off this API — a poster
   whose colour depends on which panel drew it is a poster the player cannot
   learn to recognise at a glance, which is the only thing the colour is for.
   Departments carry a fixed hue from subjects.js; everyone else is hashed. */
export function avatarFor(kind, name, hue, ico) {
  const n = String(name || '?').trim();
  const initials = n.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  return {
    seed: n,
    initials,
    hue: Number.isFinite(hue) ? (hue | 0) : (hashStr('bcav|' + n) % 360),
    ico: ico || null,
    kind,
  };
}

/* ── COOLDOWN GATE ─────────────────────────────────────────────────────────
   Answers "may this subject speak now". Three ways through:
     · the cooldown has expired;
     · the severity has moved by `escalateBy` — a problem that got materially
       worse is news again, and a feed that stayed quiet through an escalation
       would be actively misleading;
     · the mayor FOLLOWS the subject, which halves the interval (tuning.js).
   Nothing here looks at the poster's identity; that is the second gate. */
export function subjectReady(subjectId, nowSec, severity) {
  const last = lastSubjAt[subjectId];
  if (last == null) return true;
  const mult = FOLLOW.has(subjectId) ? BCAST.cooldown.followedMult : 1;
  if (nowSec - last >= BCAST.cooldown.perSubjectSec * mult) return true;
  const prev = lastSubjSev[subjectId];
  if (Number.isFinite(prev) && Number.isFinite(severity) &&
      severity - prev >= BCAST.cooldown.escalateBy) return true;
  return false;
}

export function posterReady(posterKey, nowSec, subjectId) {
  const last = lastPosterAt[posterKey];
  if (last != null && (nowSec - last) < BCAST.cooldown.perPosterSec) return false;
  const ls = lastPosterSubjAt[posterKey + '|' + subjectId];
  return ls == null || (nowSec - ls) >= BCAST.cooldown.perPosterSubjectSec;
}

export function noteSpoke(subjectId, posterKey, nowSec, severity) {
  lastSubjAt[subjectId] = nowSec;
  if (Number.isFinite(severity)) lastSubjSev[subjectId] = severity;
  if (posterKey) {
    lastPosterAt[posterKey] = nowSec;
    lastPosterSubjAt[posterKey + '|' + subjectId] = nowSec;
  }
}

/* ── ADD ───────────────────────────────────────────────────────────────────
   The only writer. `p` arrives fully composed; this function owns the id, the
   ordering, the dedup ledger and the trim, and nothing else in the module
   touches POSTS. */
export function add(p) {
  const id = 'b' + (++SEQ);
  const post = {
    id, seq: SEQ,
    at: p.at, clock: p.clock,
    kind: p.kind,                 // 'citizen' | 'company' | 'dept' | 'world'
    poster: p.poster,             // { name, sub, avatar }
    body: p.body,
    tags: p.tags || [],
    likes: p.likes | 0,           // 🔴 THE MEASUREMENT. Never written again.
    affected: p.affected | 0,
    subject: p.subject,
    severity: Number.isFinite(p.severity) ? +p.severity.toFixed(3) : null,
    pole: p.pole,
    source: p.source || null,     // { src, why } — the event it came from
  };
  POSTS.push(post);
  SEEN.add(String(post.body).toLowerCase());
  while (POSTS.length > BCAST.feed.max) {
    const gone = POSTS.shift();
    /* ⚠ The body stays in SEEN after its post is trimmed. "Never repeats
       verbatim in a session" means the SESSION, not the visible window — a
       player who scrolls back up must not find the same sentence twice
       because the first copy aged out in between. SEEN is bounded by the
       number of posts a session can produce, not by feed.max. */
    if (gone) LIKED.delete(gone.id);
  }
  return post;
}

/* ── READS ─────────────────────────────────────────────────────────────────
   Everything the UI gets goes through here, and everything it gets is a fresh
   object: handing out a reference into POSTS is how a panel ends up mutating
   the store, which is the live bug this codebase already paid for on the card
   seam. */
function view(p) {
  const mine = LIKED.has(p.id);
  return {
    id: p.id, at: p.at, clock: p.clock, kind: p.kind,
    poster: { name: p.poster.name, sub: p.poster.sub, avatar: { ...p.poster.avatar } },
    body: p.body, tags: p.tags.slice(),
    likes: p.likes,                        // the measurement
    mine,                                  // the mayor liked it
    shown: p.likes + (mine ? 1 : 0),       // what a card prints next to the ♡
    affected: p.affected,
    subject: p.subject, severity: p.severity, pole: p.pole,
    followed: FOLLOW.has(p.subject),
    unread: p.seq > READ,
    source: p.source ? { ...p.source } : null,
  };
}

export function posts(opts) {
  const o = opts || {};
  let rows = POSTS;
  if (o.subject) rows = rows.filter((p) => p.subject === o.subject);
  if (o.kind) rows = rows.filter((p) => p.kind === o.kind);
  if (o.tag) rows = rows.filter((p) => p.tags.indexOf(o.tag) >= 0);
  if (o.followed) rows = rows.filter((p) => FOLLOW.has(p.subject));
  if (o.unread) rows = rows.filter((p) => p.seq > READ);
  const out = rows.slice().reverse();       // newest first, for the reader
  return (o.limit > 0 ? out.slice(0, o.limit) : out).map(view);
}

export function byId(id) {
  const p = POSTS.find((x) => x.id === id);
  return p ? view(p) : null;
}

export function count() { return POSTS.length; }
export function seenSet() { return SEEN; }

/* ── UNREAD, for the button's badge ───────────────────────────────────────
   Counted against a persisted high-water SEQ rather than a timestamp. A
   timestamp is wrong across an offline catch-up: the catch-up posts events
   stamped in the past, and a `since` cursor would mark them read on arrival —
   the player would return to a badge of 0 over a feed full of things that
   happened while they were away. */
export function unread() { let n = 0; for (const p of POSTS) if (p.seq > READ) n++; return n; }
export function unreadFollowed() {
  let n = 0; for (const p of POSTS) if (p.seq > READ && FOLLOW.has(p.subject)) n++; return n;
}
export function markRead() { READ = SEQ; return 0; }

/* ── THE MAYOR'S LIKE ─────────────────────────────────────────────────────
   Toggle. Returns the updated view, or null for an id that is not in the feed.
   See tuning.js `followedMult` for what following actually buys, and likes.js
   for the thing it deliberately does NOT do. */
export function like(id) {
  const p = POSTS.find((x) => x.id === id);
  if (!p) return null;
  if (LIKED.has(id)) {
    LIKED.delete(id);
    /* Unfollow only when the mayor has no other liked post on the subject —
       otherwise un-hearting one row would silently unsubscribe them from a
       problem they liked five other posts about. */
    if (!POSTS.some((x) => x.subject === p.subject && LIKED.has(x.id))) FOLLOW.delete(p.subject);
  } else {
    LIKED.add(id);
    FOLLOW.add(p.subject);
  }
  return view(p);
}
export function liked(id) { return LIKED.has(id); }
export function following() { return Array.from(FOLLOW); }

/* ── SAVE ──────────────────────────────────────────────────────────────────
   Keys are one or two characters because this rides inside a city save that
   already carries 576 tiles and three pollution fields, and forty posts of
   {poster, body, tags, likes, source} in long-form JSON is several times the
   size of the thing it is describing.

   🔴 THE BODY TEXT IS SAVED, NOT RE-COMPOSED FROM ITS SEED. Recomposing would
      be about a third of the bytes and it was the first design; it is wrong.
      The composer's pools are TUNING, and tuning changes — so a retune would
      silently rewrite the history of every existing city, and the player would
      scroll back to find that the thing they read last week now says something
      else. What was published is what stays. */
export function serialize() {
  const rows = POSTS.slice(-BCAST.feed.save).map((p) => ({
    i: p.id, q: p.seq, t: p.at, k: p.kind,
    n: p.poster.name, s: p.poster.sub || null,
    h: p.poster.avatar.hue, g: p.poster.avatar.ico || null,
    b: p.body, a: p.tags,
    l: p.likes, f: p.affected, u: p.subject,
    v: p.severity, o: p.pole,
    w: p.source ? String(p.source.why || '').slice(0, 56) : null,
    r: p.source ? p.source.src : null,
    m: LIKED.has(p.id) ? 1 : 0,
  }));
  return { v: V, q: SEQ, r: READ, p: rows, fw: Array.from(FOLLOW) };
}

export function load(blob) {
  reset();
  if (!blob || typeof blob !== 'object') return { loaded: 0 };
  /* Absent-tolerant and row-by-row defensive, like everything else that loads
     in this codebase. A corrupt row costs itself and nothing else. */
  const rows = Array.isArray(blob.p) ? blob.p : [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const body = typeof r.b === 'string' ? r.b.slice(0, BCAST.feed.bodyMax) : '';
    const name = typeof r.n === 'string' ? r.n.slice(0, 48) : '';
    if (!body || !name) continue;
    const seq = Number.isFinite(+r.q) ? +r.q : 0;
    const p = {
      id: typeof r.i === 'string' ? r.i : 'b' + seq,
      seq,
      at: Number.isFinite(+r.t) ? +r.t : 0,
      clock: clockOf(Number.isFinite(+r.t) ? +r.t : 0),
      kind: typeof r.k === 'string' ? r.k : 'citizen',
      poster: { name, sub: typeof r.s === 'string' ? r.s : null,
                avatar: avatarFor(r.k, name, +r.h, r.g || null) },
      body,
      tags: Array.isArray(r.a) ? r.a.filter((t) => typeof t === 'string').slice(0, BCAST.feed.tagsMax) : [],
      likes: Math.max(0, +r.l || 0),
      affected: Math.max(0, +r.f || 0),
      subject: typeof r.u === 'string' ? r.u : 'mood',
      severity: Number.isFinite(+r.v) ? +r.v : null,
      pole: r.o === 'good' ? 'good' : 'bad',
      source: r.r ? { src: String(r.r).slice(0, 24), why: String(r.w || '').slice(0, 56) } : null,
    };
    POSTS.push(p);
    SEEN.add(body.toLowerCase());
    if (r.m) LIKED.add(p.id);
  }
  POSTS.sort((a, b) => a.seq - b.seq);
  SEQ = Math.max(Number.isFinite(+blob.q) ? +blob.q : 0, POSTS.length ? POSTS[POSTS.length - 1].seq : 0);
  READ = Math.min(SEQ, Math.max(0, +blob.r || 0));
  for (const s of (Array.isArray(blob.fw) ? blob.fw : [])) if (typeof s === 'string') FOLLOW.add(s);
  return { loaded: POSTS.length, seq: SEQ };
}

/* The reference prints a wall clock beside every post ("16:14"). Formatted
   once, at publish, and SAVED with the post rather than recomputed on read:
   a post published at 23:58 must still say 23:58 tomorrow morning. */
export function clockOf(ts) {
  const d = new Date(ts || Date.now());
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function stats() {
  let bytes = 0;
  try { bytes = JSON.stringify(serialize()).length; } catch (e) {}
  const byKind = {};
  for (const p of POSTS) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  return {
    posts: POSTS.length, seq: SEQ, read: READ, unread: unread(),
    liked: LIKED.size, following: Array.from(FOLLOW),
    distinctBodies: SEEN.size, byKind, saveBytes: bytes,
    saveRows: Math.min(POSTS.length, BCAST.feed.save),
  };
}

export default {
  reset, add, posts, byId, count, unread, unreadFollowed, markRead,
  like, liked, following, serialize, load, stats, avatarFor, clockOf,
  subjectReady, posterReady, noteSpoke, seenSet,
};
