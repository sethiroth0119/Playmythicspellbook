/* ══════════════════════════════════════════════════════════════════════════
   🧩 COMPOSE — event + poster + voice → one sentence nobody has read before.

   THE PIPELINE, in order, and every step is a filter that can REFUSE:

     1. pick the clause pool for (subject, poster kind, polarity, severity band)
     2. drop every clause whose slots the event cannot honestly fill
     3. if the pool is now empty, step DOWN a band and try again — a severe
        reading told in notable words is still true; a notable reading told in
        severe words is not, so the fallback only ever goes one way
     4. if it is still empty, return null. NO POST. This is the important exit:
        a subject with nothing true to say says nothing, rather than falling
        back to a generic line that would be indistinguishable from invention.
     5. frame × opener × tail from the voice, slots filled from event facts
     6. hashtags from the SUBJECT (never from the template)
     7. dedup against everything said this session; re-roll the seed and retry

   🔴 STEP 2 IS THE ANTI-INVENTION GATE. A clause containing {n} is only legal
      when the event carries a real number; {p} only when it carries a real
      place; {w} only when there is real weather. There is no default value
      anywhere in this file. The first draft substituted "some" for a missing
      {n} and the result was a feed of sentences that were shaped like
      measurements and contained none — which is worse than no feed, because
      the player cannot tell the two apart.
   ══════════════════════════════════════════════════════════════════════════ */
import { BCAST } from './tuning.js';
import { rngFrom, pick, pickSome } from './rng.js';
import { clauses, FRAMES, INTENSITY } from './phrases.js';
import { subjectOf } from './subjects.js';

/* Some tails are FRAGMENTS ("send snacks", "as expected") and some are whole
   SENTENCES ("Crews are aware.", "Residents do not need to take any action.").
   Joining a sentence with an em-dash or a comma produced, verbatim on the
   standard district:
     "…Additional capacity is required immediately, Residents do not need to
      take any action."
   Both halves were correct; the join was not. A tail that starts with a
   capital is a sentence and gets a full stop before it, whatever frame was
   drawn. Detected rather than declared, so adding a tail to a voice cannot
   forget to flag it. */
const SENTENCE_FRAMES = ['{o} {S}. {t}', '{S}. {t}'];

const BAND_DOWN = { severe: 'notable', notable: 'mild', mild: null, great: 'good', good: null };

/* Which slots a clause needs. Cheap, and it runs per candidate rather than per
   post, so it is deliberately a regex test and not a parse. */
function needs(tpl) {
  return { n: /\{n\}/.test(tpl), v: /\{v\}/.test(tpl), p: /\{p\}/.test(tpl), w: /\{w\}/.test(tpl),
           /* 🪦 {q} — A NAMED PERSON, and it is a fifth slot rather than a
              second use of {p} on purpose. {p} is "a real PLACE", and the one
              rule this file has never bent is that a slot carries one unit:
              the first cut let each observer format {n} how it liked and the
              Health Department published "4 residents residents cannot be
              treated" while the Food office published a headcount as a rate.
              Both composed correctly, both were nonsense. A person in the
              place slot is the same error one clause later — "we have recorded
              a death at Ilva Vantree" — so it gets its own slot and its own
              no-name-no-clause rule. */
           q: /\{q\}/.test(tpl) };
}

function fillable(tpl, facts) {
  const q = needs(tpl);
  if (q.n && !facts.n) return false;
  if (q.v && !facts.v) return false;
  if (q.p && !facts.p) return false;
  if (q.w && !facts.w) return false;
  if (q.q && !facts.q) return false;
  return true;
}

/* Sentence-case: the first letter, and any letter that opens a new sentence
   after an opener like "Wonderful." — without this the dry voice produces
   "Wonderful. the #electricity flickered again", which reads as a bug. */
function sentenceCase(s) {
  return String(s)
    .replace(/^(\s*)([a-z])/, (m, a, b) => a + b.toUpperCase())
    .replace(/([.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

/* Frames are written for the general case (opener present, tail present) and
   the voices supply empty strings for both. Rather than branch the frame table
   four ways, the artefacts an empty slot leaves behind are swept here. */
function tidy(s) {
  return String(s)
    .replace(/\s+/g, ' ')
    .replace(/\s*—\s*\.\s*$/, '.')
    .replace(/,\s*\.\s*$/, '.')
    .replace(/\s*—\s*$/, '')
    .replace(/^\s*[—,]\s*/, '')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\.\.+$/, '.')
    .trim();
}

/* ── ONE ATTEMPT ─────────────────────────────────────────────────────────── */
function attempt(ev, poster, voice, band, seed) {
  const subj = subjectOf(ev.subject); if (!subj) return null;
  const pool = clauses(ev.subject, poster.kind === 'citizen' ? 'cit'
                                 : poster.kind === 'company' ? 'biz' : 'dept',
                       ev.pole, band).filter((t) => fillable(t, ev.facts));
  if (!pool.length) return null;

  const rnd = rngFrom(seed);
  const clause = pick(rnd, pool);
  const opener = pick(rnd, voice.openers) || '';
  const tail = pick(rnd, voice.tails) || '';
  const frame = (tail && /^[A-Z]/.test(tail)) ? pick(rnd, SENTENCE_FRAMES) : pick(rnd, FRAMES);

  /* Intensity comes from the BAND, never across bands — see phrases.js. The
     'good'/'great' bands have no intensity pool because a contented post has
     no severity to express; {i} simply never appears in a good clause. */
  const ints = INTENSITY[band] || INTENSITY.notable;
  const inten = pick(rnd, ints) || '';

  let body = frame
    .replace('{o}', opener)
    .replace('{S}', clause)
    .replace('{t}', tail);

  body = body
    .replace(/\{tag\}/g, '#' + subj.tag)
    .replace(/\{i\}/g, inten)
    .replace(/\{n\}/g, ev.facts.n || '')
    .replace(/\{v\}/g, ev.facts.v || '')
    .replace(/\{p\}/g, ev.facts.p || '')
    .replace(/\{w\}/g, ev.facts.w || '')
    .replace(/\{q\}/g, ev.facts.q || '');

  body = sentenceCase(tidy(body));

  /* An exclamation is a VOICE trait and a polarity trait, not a severity one:
     the reference's happy posts exclaim and its Electricity Department never
     does. INSTITUTIONAL.exclaim is 0, so this branch cannot fire for a
     department however bad the news is. */
  if (rnd() < voice.exclaim && (ev.pole === 'good' || band === 'severe')) {
    body = body.replace(/\.$/, '!');
  }

  /* ── HASHTAGS. The inline {tag} already spent one of the budget. Whether a
     second is appended is the voice's `tagLove`, and it is drawn from the
     subject's own extras — never invented, never more than tagsMax total. */
  const tags = [subj.tag];
  const budget = Math.max(0, (BCAST.feed.tagsMax | 0) - 1);
  const extras = (ev.pole === 'good' ? subj.tagsGood : subj.tagsBad) || [];
  if (budget > 0 && rnd() < voice.tagLove && extras.length) {
    const extra = pickSome(rnd, extras.filter((t) => t !== subj.tag), budget);
    for (const t of extra) { tags.push(t); body += ' #' + t; }
  }

  /* Over-length loses the tail first — it is the least informative part of the
     sentence, which is precisely why it is the part that goes. */
  if (body.length > BCAST.feed.bodyMax && tail) {
    return attempt(ev, poster, { ...voice, tails: [''] }, band, seed);
  }
  if (body.length > BCAST.feed.bodyMax) return null;

  return { body, tags, band };
}

/* ── THE ENTRY POINT ──────────────────────────────────────────────────────
   `seen` is a Set of body hashes (feed.js owns it and seeds it from the loaded
   save, so a reload does not re-say what the player already read). Up to
   `tries` distinct seeds are attempted before the band steps down; a subject
   that genuinely has nothing new to say goes quiet, which is the correct
   behaviour and not a failure. */
export function composePost(ev, poster, voice, seen, tries = 10) {
  let band = ev.band;
  while (band) {
    for (let i = 0; i < tries; i++) {
      const out = attempt(ev, poster, voice, band, ev.seed + '|' + band + '|' + i);
      if (!out) break;                        // this band has no fillable clause
      const key = out.body.toLowerCase();
      if (!seen || !seen.has(key)) return out;
    }
    band = BAND_DOWN[band];
  }
  return null;
}

/* Exposed for the combinatorics self-check in index.js — "how many distinct
   posts CAN this produce" is a claim worth being able to check rather than
   assert. Counts the reachable bodies for one (subject, kind, pole, band,
   voice) without generating them. */
export function variantCount(subjectId, kind, pole, band, voice, facts) {
  const pool = clauses(subjectId, kind, pole, band).filter((t) => fillable(t, facts || {}));
  if (!pool.length) return 0;
  /* Per tail, because a sentence tail is only reachable through
     SENTENCE_FRAMES and a fragment only through FRAMES — multiplying by the
     wrong table would overstate the variety by ~3x, which is exactly the kind
     of unfalsifiable claim this function exists to avoid making. */
  let frames = 0;
  for (const t of voice.tails) frames += (t && /^[A-Z]/.test(t)) ? SENTENCE_FRAMES.length : FRAMES.length;
  return pool.length * voice.openers.length * frames;
}

export default { composePost, variantCount };
