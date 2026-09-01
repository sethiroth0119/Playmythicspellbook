/* ══════════════════════════════════════════════════════════════════════════
   🦠 STRAINS — the virus model. Pure data + pure math, no I/O, no globals.
   ──────────────────────────────────────────────────────────────────────────
   A strain is FOUR NUMBERS and nothing else that matters. Everything the cure
   system does is a distance measurement against `sig`, so the whole disease
   ↔ cure loop is one legible equation rather than a table of special cases:

     sig = { vector, envelope, replication, resilience }   each 0..100

   🔴 WHY FOUR AXES AND NOT A LIST OF DISEASES. A hand-written disease list
   makes every cure a lookup — you either know the answer or you do not, and
   there is no such thing as a NEAR MISS. Near misses are the entire point of
   this feature: the player has to be able to ship something that is 70% right
   and watch it half-work, and a mutant strain has to be describable as "the
   parent, moved". Continuous axes give both for free. Do not replace them
   with an enum.

   🔴 A STRAIN IS NEVER FATAL TO A CITIZEN. /src/city/citizens.city.js's rule
   is that nothing may delete a player's people or touch their tiles, and this
   module inherits it: severity raises misery and drags city vitals, and that
   is the whole punishment. `stage` tops out at 'critical' and comes back down.
   If you are ever tempted to add a death path, read the POPULATION ACCOUNTING
   note in citizens.city.js first — the roster is a SUBSET of a population
   counter this module does not own and must not decrement.

   ⚠ DETERMINISM. Every strain is generated from a seed string, the same way
   citizens generate their names, so a save that lost its strain blob comes
   back byte-identical and two clients handed the same seed agree without
   talking to each other. Nothing here calls Math.random().
   ══════════════════════════════════════════════════════════════════════════ */

export const V = 1;                       // save-blob version

/* The four axes, in canonical order. Order is the contract: cures.js builds
   its blend vectors positionally and a reorder here silently re-labels every
   reagent in the game. Add to the END if you ever add a fifth. */
export const AXES = ['vector', 'envelope', 'replication', 'resilience'];

export const AXIS_META = {
  vector:      { label: 'Vector',      icon: '🧭', blurb: 'How it travels — airborne at 100, contact-only at 0.' },
  envelope:    { label: 'Envelope',    icon: '🛡️', blurb: 'The coat a solvent has to break before anything reaches the core.' },
  replication: { label: 'Replication', icon: '🧬', blurb: 'How fast it copies. High replication outruns a slow cure.' },
  resilience:  { label: 'Resilience',  icon: '🪨', blurb: 'Survival outside a host — high means surfaces stay hot.' },
};

/* Families are FLAVOUR ON TOP OF THE AXES, never a substitute for them. Each
   one only biases the roll; two strains in the same family can still be
   nothing alike, which is what stops players from learning one recipe per
   family and never thinking again. */
export const FAMILIES = [
  { key: 'respiratory', name: 'Respiratory', icon: '🫁', color: '#7fd6ff',
    bias: { vector: +26, envelope: -8,  replication: +10, resilience: -10 } },
  { key: 'haemic',      name: 'Blood-borne', icon: '🩸', color: '#ff8aa0',
    bias: { vector: -22, envelope: +18, replication: -4,  resilience: +6 } },
  { key: 'neural',      name: 'Neuroviral',  icon: '🧠', color: '#7fb8ff',
    bias: { vector: -12, envelope: +10, replication: -14, resilience: +18 } },
  { key: 'fungal',      name: 'Mycotic',     icon: '🍄', color: '#c08a4a',
    bias: { vector: +4,  envelope: +22, replication: -18, resilience: +26 } },
  { key: 'anomalous',   name: 'Anomalous',   icon: '🟣', color: '#b06bff',
    bias: { vector: +8,  envelope: +14, replication: +20, resilience: +14 } },
];

export function familyOf(key) {
  for (const f of FAMILIES) if (f.key === key) return f;
  return FAMILIES[0];
}

/* ── deterministic RNG ─────────────────────────────────────────────────────
   FNV-1a → mulberry32, the same shape citizens.city.js uses for names. Seeded
   from a string so "the strain that emerged in this city on day 40" is a
   reproducible object rather than a lucky roll nobody can reproduce in a bug
   report. */
export function hash32(s) {
  let h = 2166136261 >>> 0;
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rngFrom(seed) {
  let a = hash32(seed);
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp100 = (v) => clamp(Math.round(v), 0, 100);

/* ── naming ────────────────────────────────────────────────────────────────
   Greek-letter + a two-syllable coinage + a numeric isolate. The isolate is
   the part players will actually say out loud ("the 41-C"), so it is short
   and it is derived from the seed rather than a counter — a counter drifts
   between clients that never spoke to each other. */
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Omega'];
const STEM_A = ['Kor', 'Vas', 'Mor', 'Thal', 'Ser', 'Ryn', 'Bel', 'Dru', 'Hal', 'Ith',
  'Nyx', 'Orr', 'Pyr', 'Quel', 'Sab', 'Ur', 'Vend', 'Wex', 'Zar', 'Cald'];
const STEM_B = ['ova', 'ilis', 'ara', 'esh', 'ium', 'oth', 'ane', 'ira', 'ux', 'enne'];
const SUFFIX = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function nameFrom(seed) {
  const r = rngFrom('name:' + seed);
  const g = GREEK[Math.floor(r() * GREEK.length)];
  const a = STEM_A[Math.floor(r() * STEM_A.length)];
  const b = STEM_B[Math.floor(r() * STEM_B.length)];
  const n = 10 + Math.floor(r() * 89);
  const s = SUFFIX[Math.floor(r() * SUFFIX.length)];
  return { name: g + '-' + a + b, isolate: n + '-' + s };
}

/* ── generation ────────────────────────────────────────────────────────────
   `pressure` (0..1) is the city's own condition, computed by outbreak.js from
   vitals the city ALREADY runs on. It is the only outside input, and it moves
   severity and contagion — not the signature. A filthy city breeds a WORSE
   virus, not a differently-shaped one; shape is the strain's identity and
   letting the city dictate it would make every outbreak in a bad city feel
   the same. */
export function makeStrain(seed, opts) {
  const o = opts || {};
  const r = rngFrom('strain:' + seed);
  const pressure = clamp(+o.pressure || 0, 0, 1);

  const fam = o.family ? familyOf(o.family)
                       : FAMILIES[Math.floor(r() * FAMILIES.length)];
  const sig = {};
  for (const ax of AXES) {
    // 30..70 base, then the family bias, then a wide jitter. The base is
    // centred so a bias of ±26 cannot pin an axis at a rail every time.
    sig[ax] = clamp100(30 + r() * 40 + (fam.bias[ax] || 0) + (r() - 0.5) * 22);
  }

  const nm = nameFrom(seed);
  return {
    v: V,
    id: 'str_' + hash32('id:' + seed).toString(36),
    seed: String(seed),
    name: nm.name,
    isolate: nm.isolate,
    family: fam.key,
    sig: sig,
    // 1..5. Pressure is worth up to two whole steps — a city with no clinics
    // and no clean water genuinely breeds something nastier.
    severity: clamp(1 + Math.floor(r() * 3) + Math.round(pressure * 2), 1, 5),
    contagion: +clamp(0.10 + r() * 0.35 + pressure * 0.30, 0.05, 0.95).toFixed(3),
    // How far a mutant lands from its parent. Anomalous strains wander most,
    // which is why corruptedEssence is such a dangerous reagent (see cures.js).
    mutability: +clamp(0.15 + r() * 0.35 + (fam.key === 'anomalous' ? 0.25 : 0), 0.05, 0.95).toFixed(3),
    origin: o.origin || 'wild',
    parentId: o.parentId || null,
    /* 🧪 RESISTANCE — raised by cures.js every time a WEAK batch is
       administered. It is a per-strain penalty on future efficacy, and it is
       the reason "just ship the 40% cure, something is better than nothing"
       is a real mistake rather than a free win. Capped at 0.6 so a strain can
       always still be beaten by a good enough formulation. */
    resistance: 0,
    bornAt: +o.bornAt || Date.now(),
    // Set by cures.js when a batch actually retires the strain. A cured strain
    // stays in the ledger — the player's outbreak history is content.
    curedAt: null,
    note: o.note || '',
  };
}

/* ── mutation ──────────────────────────────────────────────────────────────
   🔴 THIS IS THE "CURE THAT CAUSES A VIRUS" PATH, and it is deliberately NOT
   a random new strain. A botched batch produces the PARENT, PUSHED — the
   signature moves along the axes the failed blend was leaning on, so the
   player can look at the mutant, look at what they mixed, and see their own
   mistake in it. A fresh random strain would read as the game punishing them
   arbitrarily; this reads as consequence.

   `drift` comes from the batch's instability, so a nearly-stable failure
   makes a near-twin (annoying) and a wildly unstable one makes something new
   (a catastrophe). Severity inherits +1 because an iatrogenic strain has
   already survived a therapeutic dose — it is, by construction, harder. */
export function mutate(parent, seed, drift, lean) {
  const r = rngFrom('mut:' + seed);
  const d = clamp(+drift || 0.25, 0.05, 1);
  const push = lean || {};
  const sig = {};
  for (const ax of AXES) {
    const base = (parent && parent.sig && +parent.sig[ax]) || 50;
    // Two terms: a directed push along whatever the failed blend emphasised,
    // and an undirected wander. Both scale with drift.
    const directed = (+push[ax] || 0) * d * 0.45;
    const wander = (r() - 0.5) * 70 * d;
    sig[ax] = clamp100(base + directed + wander);
  }
  const nm = nameFrom(seed);
  return {
    v: V,
    id: 'str_' + hash32('id:' + seed).toString(36),
    seed: String(seed),
    name: nm.name,
    isolate: nm.isolate,
    family: (parent && parent.family) || 'anomalous',
    sig: sig,
    severity: clamp(((parent && parent.severity) || 2) + 1, 1, 5),
    contagion: +clamp(((parent && parent.contagion) || 0.3) * (1 + d * 0.5), 0.05, 0.95).toFixed(3),
    mutability: +clamp(((parent && parent.mutability) || 0.3) + d * 0.2, 0.05, 0.95).toFixed(3),
    origin: 'iatrogenic',
    parentId: (parent && parent.id) || null,
    resistance: 0,
    bornAt: Date.now(),
    curedAt: null,
    note: 'Escaped a failed batch.',
  };
}

/* Distance between a blend and a signature, normalised 0..1 where 0 is a
   perfect match. Manhattan rather than Euclidean on purpose: a formulation
   that is perfect on three axes and catastrophically wrong on the fourth
   SHOULD score badly, and Euclidean distance forgives exactly that case. */
export function sigDistance(sig, blend) {
  let sum = 0;
  for (const ax of AXES) sum += Math.abs((+sig[ax] || 0) - (+blend[ax] || 0));
  return clamp(sum / (AXES.length * 100), 0, 1);
}

export function severityLabel(n) {
  return ['—', 'Mild', 'Moderate', 'Severe', 'Virulent', 'Catastrophic'][clamp(n | 0, 0, 5)];
}

export function describe(s) {
  if (!s) return '';
  const f = familyOf(s.family);
  return f.icon + ' ' + s.name + ' (' + s.isolate + ') · ' + f.name + ' · ' + severityLabel(s.severity);
}
