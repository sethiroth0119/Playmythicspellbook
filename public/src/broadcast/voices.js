/* ══════════════════════════════════════════════════════════════════════════
   🗣 VOICES — why the same complaint from two people reads differently.

   THE PROBLEM THIS SOLVES. A feed assembled out of one shared phrase pool is
   a string table on rotation, and a player spots that in about ninety seconds:
   every citizen sounds like the same person, so the names stop meaning
   anything and the feed becomes wallpaper. The brief's "have AI make it
   different" is answered structurally rather than with a runtime model (see
   index.js's header for why a model is the wrong tool here), and a stable
   per-citizen voice is the single biggest part of that answer.

   A VOICE IS STABLE FOR A CITIZEN, FOR EVER. It is derived from a hash of
   their id and name, exactly the way /src/naming seeds a business and
   makeHousing seeds on tile coords. Toma Ashford is terse in every session of
   every city; Vess Corvin is always the one who over-writes. That stability is
   what makes a regular recognisable, and recognising a regular is what turns
   a list of rows into a place with people in it.

   A voice owns FOUR things and no more:
     · which openers and tails it is allowed to use,
     · whether it exclaims, ellipses, or ends flat,
     · how heavily it uses hashtags,
     · a `bias`, which nudges how it phrases the same severity.

   ⚠ A VOICE NEVER CHANGES WHAT THE POST CLAIMS. Sarcasm is a tail, not a
     different number. The dry voice and the earnest voice looking at the same
     18% water shortfall produce two sentences that are both true about 18%.
     The moment a voice was allowed to overstate, the feed stopped being an
     instrument — that was the first draft and it is why this note exists.
   ══════════════════════════════════════════════════════════════════════════ */
import { hashStr } from './rng.js';

export const VOICES = {
  /* Short. Full stops. No decoration. */
  terse: {
    id: 'terse', label: 'terse',
    openers: ['', '', 'Right.', 'So.', 'Again:', 'Note:'],
    tails: ['', '', 'That is all.', 'Fix it.', 'Noted.', 'Moving on.'],
    exclaim: 0, tagLove: 0.35, bias: -0.05,
  },
  /* Long, warm, adjectives everywhere. */
  florid: {
    id: 'florid', label: 'florid',
    openers: ['Friends,', 'I have to say,', 'Well now —', 'Neighbours,', 'Honestly,', 'Let me tell you,'],
    tails: ['and I mean that sincerely', 'as one does', 'and there it is', 'and my heart is full about it',
            'which is rather the whole of it', 'and I shall say no more'],
    exclaim: 0.5, tagLove: 0.8, bias: 0.08,
  },
  /* Deadpan. The joke is that there is no joke. */
  dry: {
    id: 'dry', label: 'dry',
    openers: ['Wonderful.', 'Great.', 'Cool.', 'Love this.', 'Superb.', 'Delightful.'],
    tails: ['no notes', 'anyway', 'as expected', 'thrilled', 'living the dream', 'ten out of ten'],
    exclaim: 0.05, tagLove: 0.55, bias: 0.02,
  },
  /* Means it. Says it plainly. */
  earnest: {
    id: 'earnest', label: 'earnest',
    openers: ['', 'Genuinely,', 'I think', 'For what it is worth,', 'Just saying —', 'Truly,'],
    tails: ['', 'and I hope somebody is listening', 'that is all I wanted to say',
            'we can do better', 'I do appreciate the people who try', 'thank you for reading'],
    exclaim: 0.35, tagLove: 0.6, bias: 0.0,
  },
  /* Jokes about it. */
  wry: {
    id: 'wry', label: 'wry',
    openers: ['Update:', 'Breaking:', 'Fun fact:', 'Local news:', 'Live from my window:', 'Situation report:'],
    tails: ['send help', 'send snacks', 'I am fine', 'this is fine', 'no further questions',
            'somebody tell the mayor'],
    exclaim: 0.3, tagLove: 0.75, bias: 0.03,
  },
  /* Writes like a small politician. Tags everything. */
  civic: {
    id: 'civic', label: 'civic',
    openers: ['As a resident,', 'On the record:', 'Filed and noted —', 'For the minutes:',
              'Speaking as a taxpayer,', 'A point of order:'],
    tails: ['and I would like a response', 'this belongs in the record',
            'I have raised it before', 'somebody is accountable for this',
            'I will be following up', 'credit where it is due'],
    exclaim: 0.15, tagLove: 0.95, bias: 0.06,
  },
};

export const VOICE_IDS = Object.keys(VOICES);

/* 🔴 THE ASSIGNMENT. Hashed on id AND name, not on id alone: node-city's ids
   are a monotonic counter, so id-only hashing walks the voice list in lockstep
   with the roster and every third citizen in a new city is dry. Mixing the
   name in decorrelates them. */
export function voiceFor(citizen) {
  const c = citizen || {};
  const key = 'bcvoice|' + (c.id == null ? '?' : c.id) + '|' + (c.name || '');
  return VOICES[VOICE_IDS[hashStr(key) % VOICE_IDS.length]];
}

/* Institutions do not have a voice in this sense — they have a REGISTER, which
   is the same for all of them and is defined by the reference post
   ("Our #electricity production is not meeting demand, so we're forced to
   import some from our neighbors."): first person plural, factual, names the
   shortfall, offers the mitigation. It is a voice object so the composer has
   one code path, but it exclaims never and jokes never. */
export const INSTITUTIONAL = {
  id: 'inst', label: 'institutional',
  openers: ['', '', 'Advisory:', 'Notice:', 'Service update:', 'Bulletin:'],
  tails: ['', '', 'We will update this notice as the situation changes.',
          'Crews are aware.', 'Thank you for your patience.',
          'Residents do not need to take any action.'],
  exclaim: 0, tagLove: 0.7, bias: 0,
};

/* A business speaks for itself and is allowed to be pleased about it. */
export const COMMERCIAL = {
  id: 'biz', label: 'commercial',
  openers: ['', '', 'Big news —', 'Doors are open:', 'Announcement:', 'Hello neighbours!'],
  tails: ['', 'Come and say hello.', 'Tell your neighbours.', 'We are glad to be here.',
          'See you soon.', 'Thanks for having us.'],
  exclaim: 0.55, tagLove: 0.7, bias: 0.1,
};

export default { VOICES, VOICE_IDS, voiceFor, INSTITUTIONAL, COMMERCIAL };
