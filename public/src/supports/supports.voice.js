/* ════════════════════════════════════════════════════════════════════════════
   💬 THE VOICE ENGINE — two heroes talk, and it sounds like THEM.
   ----------------------------------------------------------------------------
   Generates a support conversation from what the game already knows about a
   pair: their traits (CAMP_TRAITS), their bond, their shared history, and the
   rank being unlocked.

   🔴 DETERMINISTIC, KEYED ON (pair, rank). The SAME two heroes at the SAME rank
   must produce the SAME conversation every time it is opened. A scene that
   re-rolls on each view is not a memory, it is a slot machine, and the moment a
   player reopens one and finds different words the whole system stops reading
   as characters and starts reading as filler. `seeded()` below is why this
   holds; never introduce Math.random() into this file.

   🔴 NO NETWORK, NO LLM, NO API KEY. CLAUDE.md's non-negotiable is that the
   game works offline. This engine ships working today at zero cost. There IS a
   documented seam for a real model — `setProvider()` at the bottom — so a
   hosted generator can be dropped in later WITHOUT touching any caller: it is
   async everywhere already, and the local engine stays as the offline
   fallback. Do not "upgrade" this by making the local path optional.

   HOW IT SOUNDS LIKE THEM: a hero's traits pick their VOICE (the fragment pools
   they draw from) and their TOPIC (what they bring up). `brave` opens by making
   light of danger; `cowardly` opens by admitting fear; `wise` asks a question
   instead of answering one. Rank sets how far the conversation goes — a C is
   small talk, an S is the thing neither of them says in front of anyone else.
   ════════════════════════════════════════════════════════════════════════════ */

import { pairKey } from './supports.data.js';

/* ── A tiny seeded PRNG (mulberry32). Deterministic, fast, no dependency. ── */
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function seeded(seed) {
  let a = hash(String(seed));
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/* ── VOICES ───────────────────────────────────────────────────────────────
   Keyed by the trait ids already in CAMP_TRAITS. A hero with several traits
   blends them; a hero with none falls back to `plain`, which is written to be
   serviceable rather than characterless — most of the roster will use it. */
const VOICE = {
  plain: {
    open:  ['Got a minute?', 'You busy?', 'Sit down a second.', 'Been meaning to catch you.'],
    probe: ['How are you holding up?', 'You alright, out there?', 'That last one was rough. You good?'],
    admit: ['I keep running it back. The whole fight.', 'I do not sleep much. Not properly.', 'Some days I am not sure why I am still doing this.'],
    warm:  ['Glad you are here.', 'You made it easier. That is all I wanted to say.', 'I would rather do this with you than without.'],
    close: ['Anyway. Get some rest.', 'Right. Back to it.', 'That is all. Go on.'],
  },
  brave: {
    open:  ['You look grim. Cheer up — we won.', 'Still breathing. That is a good day.', 'Come on, that was almost fun.'],
    probe: ['You did not flinch back there. Where does that come from?', 'Does any of it scare you? Honestly.'],
    admit: ['I am not fearless. I am just louder than the fear.', 'The trick is not being unafraid. It is going anyway.'],
    warm:  ['I would walk into anything with you at my back.', 'You steady me. I do not say that to many people.'],
    close: ['Right. Next one is on me.', 'Go on, before I get sentimental.'],
  },
  cowardly: {
    open:  ['Do not — do not say anything about earlier.', 'I froze. I know I froze.'],
    probe: ['How do you do it? Just… go?', 'Does it get easier? Tell me it gets easier.'],
    admit: ['I was terrified. The whole time. I am always terrified.', 'I nearly ran. I have nearly run every single time.'],
    warm:  ['You never once made me feel small about it. I noticed.', 'I stayed because you were there. That is the only reason.'],
    close: ['Thanks. For not laughing.', 'I will do better. I mean it.'],
  },
  wise: {
    open:  ['May I ask you something?', 'You have been quiet. That usually means something.'],
    probe: ['What do you think we are actually doing out here?', 'When this ends — if it ends — what then?'],
    admit: ['I have been wrong about a great many things. Loudly.', 'Knowing what to do and being able to do it are different countries.'],
    warm:  ['You ask better questions than I do. That is rarer than you think.', 'I have learned more from you than I have taught. Do not tell the others.'],
    close: ['Something to sleep on.', 'We will speak again.'],
  },
  strong: {
    open:  ['Help me with this.', 'Hold that. No — like that.'],
    probe: ['You carry more than you should. Why?', 'You do not have to take every hit for us.'],
    admit: ['Everyone assumes I do not get tired. I get tired.', 'They see the arms. Nobody asks about the rest.'],
    warm:  ['You are the only one who asks. That counts for something.', 'Lean on me. I mean it literally, but also not.'],
    close: ['Enough talk. Sleep.', 'Go on. I will finish here.'],
  },
  lucky: {
    open:  ['Told you it would work out.', 'Do you want to hear something ridiculous?'],
    probe: ['Do you believe in luck? Properly believe?', 'How many times have you nearly died? Be honest.'],
    admit: ['One day it runs out. I know that. I count on it every morning.', 'It is not luck. It is just that it has not been my turn yet.'],
    warm:  ['You are the best thing that has happened to me and I do not think that was luck.', 'If it does run out, I would like you there.'],
    close: ['Come on. Before I jinx it.', 'Ha. Get some sleep.'],
  },
  resourceful: {
    open:  ['Look what I found.', 'Do not ask where I got this.'],
    probe: ['What would you take? If we had to leave tonight, one thing.', 'You never keep anything. Why?'],
    admit: ['I hoard because I remember having nothing. It is not clever, it is a scar.', 'Every pocket full is one night I do not lie awake.'],
    warm:  ['Here. No, take it. I want you to have it.', 'I would give you the lot. That is new for me.'],
    close: ['Go on, before I want it back.', 'Right. Inventory.'],
  },
  hardy: {
    open:  ['Walk with me.', 'Still standing. You?'],
    probe: ['How long can you keep this up? Truthfully.', 'You never complain. That worries me.'],
    admit: ['I do not stop because I am afraid of what happens when I do.', 'The body holds. It is the rest of it that wears.'],
    warm:  ['You slow me down. It is the best thing anyone has done for me.', 'I would stop, for you. I would actually stop.'],
    close: ['Enough. Rest.', 'Tomorrow, then.'],
  },
  firstAid: {
    open:  ['Sit. Let me see it.', 'Do not tell me it is nothing. Sit down.'],
    probe: ['Who patches you up? When I am not there.', 'You hide injuries from me. I always know.'],
    admit: ['I have lost people I could have saved. I know exactly how many.', 'I keep everyone alive so I do not have to think about the ones I did not.'],
    warm:  ['I need you to come back. Every time. That is my whole condition.', 'Promise me you will tell me when it is bad. Promise me.'],
    close: ['Keep it clean. And rest it.', 'Go. Sleep. Doctor\'s orders.'],
  },
};

/* Topics. Which one a pair lands on is seeded, but weighted by what actually
   happened to them — a pair who revived each other talks about that, because a
   conversation that ignores the thing the player watched happen is worse than
   no conversation. */
const TOPICS = [
  { id: 'theFight',  weight: 1, line: (a, b) => `${a} and ${b} talk over the last fight.` },
  { id: 'before',    weight: 1, line: (a, b) => `${a} asks ${b} about life before all this.` },
  { id: 'after',     weight: 1, line: (a, b) => `${b} wonders aloud what happens when it is over.` },
  { id: 'theSave',   weight: 0, line: (a, b) => `Neither of them brings up the save. Both of them are thinking about it.` },
  { id: 'theLoss',   weight: 0, line: (a, b) => `They talk around the empty bunk.` },
];

function voiceOf(traits) {
  const list = (traits || []).map(t => VOICE[t]).filter(Boolean);
  if (!list.length) return VOICE.plain;
  if (list.length === 1) return list[0];
  // Blend: concatenate the pools so a multi-trait hero can draw from any of
  // their sides, which is what makes two `brave` heroes still sound different.
  const merged = { open: [], probe: [], admit: [], warm: [], close: [] };
  for (const v of list) for (const k of Object.keys(merged)) merged[k] = merged[k].concat(v[k] || []);
  for (const k of Object.keys(merged)) if (!merged[k].length) merged[k] = VOICE.plain[k];
  return merged;
}

/* How far the conversation goes, by rank. This is the actual arc:
   C is two people being polite; S is the thing they do not say to anyone else. */
const BEATS = {
  C: ['open', 'probe', 'close'],
  B: ['open', 'probe', 'admit', 'close'],
  A: ['open', 'probe', 'admit', 'warm', 'close'],
  S: ['open', 'admit', 'warm', 'probe', 'warm', 'close'],
};

/* ── The local generator ────────────────────────────────────────────────── */
function generateLocal(ctx) {
  const { a, b, rank, history } = ctx;
  const rng = seeded(pairKey(a.id, b.id) + ':' + rank);

  const va = voiceOf(a.traits), vb = voiceOf(b.traits);

  // Topic — weighted by what actually happened to this pair.
  const topics = TOPICS.map(t => ({
    ...t,
    weight: t.id === 'theSave' && history && history.revived ? 3
          : t.id === 'theLoss' && history && history.lostAlly ? 3
          : t.weight,
  })).filter(t => t.weight > 0);
  const total = topics.reduce((s, t) => s + t.weight, 0);
  let roll = rng() * total, topic = topics[0];
  for (const t of topics) { roll -= t.weight; if (roll <= 0) { topic = t; break; } }

  const beats = BEATS[rank] || BEATS.C;
  const lines = [];
  let speakerIsA = rng() < 0.5;                 // who opens is seeded, not fixed

  for (const beat of beats) {
    const sp = speakerIsA ? a : b;
    const voice = speakerIsA ? va : vb;
    lines.push({ who: sp.id, name: sp.name, text: pick(rng, voice[beat] || VOICE.plain[beat]) });
    speakerIsA = !speakerIsA;                   // strict alternation — it is a conversation
  }

  return {
    rank,
    topic: topic.id,
    scene: topic.line(a.name, b.name),
    lines,
    generator: 'local',
  };
}

/* ── The provider seam ────────────────────────────────────────────────────
   A hosted generator can be installed here later. Contract:

       setProvider(async (ctx) => ({ scene, lines:[{who,name,text}…] }))

   Rules it MUST honour, and the reason each exists:
     • Deterministic for the same (pair, rank), or cache the result — see the
       header; a re-rolling scene destroys the illusion.
     • Resolve within a couple of seconds or the local engine is used; the camp
       must never sit waiting on a network call.
     • Throwing is fine — it falls back. Never let it reject into a caller.
   The local engine is NOT removed when a provider is installed; it remains the
   offline path, because the game must work with no network at all. */
let _provider = null;
export function setProvider(fn) { _provider = (typeof fn === 'function') ? fn : null; }
export function hasProvider() { return !!_provider; }

const PROVIDER_TIMEOUT_MS = 2500;

export async function generate(ctx) {
  if (_provider) {
    try {
      const out = await Promise.race([
        Promise.resolve(_provider(ctx)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), PROVIDER_TIMEOUT_MS)),
      ]);
      if (out && Array.isArray(out.lines) && out.lines.length) {
        return { rank: ctx.rank, topic: out.topic || 'custom', scene: out.scene || '', lines: out.lines, generator: 'provider' };
      }
    } catch (e) {
      try { console.info('[supports] provider failed or timed out — using the local voice engine.'); } catch (e2) {}
    }
  }
  return generateLocal(ctx);
}

export { generateLocal };
