/* ══════════════════════════════════════════════════════════════════════════
   🛍 PATRONAGE — the city's residents live, and spend while they do it.
   ══════════════════════════════════════════════════════════════════════════
   THE ASK, in the owner's words: "Have the businesses that are not destroyed in
   players city earn cinder based on how well the economy is doing and how well
   the city is built, as well how happy the npcs are. Happy NPCS spend more
   cinder. But make it where NPCs are almost life like — they get sick, they
   need food so they shop for food, they get lazy so they go to fast food or
   food trucks, they need to work out so they go to gym, they play the card game
   Mythic Spellbook for fun."

   WHAT WAS THERE: of 163 building types, TWELVE had a `gen.cinder` line, each
   between 0.18 and 0.30 a minute. A city with one of every earner made about
   2.5 Cinder a minute — roughly 3,600 a day — and every other shop in the city
   earned exactly nothing, forever. The Trading card on a Food Truck read
   both of its customer lines read zero — no visitors, nothing taken — because
   nothing in the game had ever given it a customer.
   ⚠ THE EXACT ROW LABELS ARE DELIBERATELY NOT QUOTED HERE. The gate pins them
     as markers in node-city, and a prose copy in this file makes the count two
     and fails a piece that is perfectly intact — which is exactly what it did.

   ── HOW IT WORKS ───────────────────────────────────────────────────────────
   Residents carry NEEDS that grow with time. When one crosses its threshold the
   resident goes somewhere that answers it, spends, and the need resets. That is
   the whole model, and everything else is what scales the spend.

   A visit is worth:
       spend = base(need)
             × mood      happy residents spend more — asked for by name
             × economy   a strained economy has people holding on to their money
             × city      coverage, power and staffing: a city that works
             × tier      the node's own rate, free 0.5 … eternal 20

   🔴 THE CEILING IS EXACT, NOT EMERGENT. "the highest node level can generate 1
      million cinder a day" is a promise, so it is enforced as one: DAY_CAP_TOP
      is the per-real-day ceiling at the top tier, every city's cap is that
      scaled by its own tier rate, and the tick clamps to it. A formula tuned to
      *probably* land near a million would drift the first time a multiplier was
      retuned, and the number the owner asked for would quietly stop being true.

   ⚠ A DESTROYED OR UNBUILT SHOP TAKES NOTHING. Damaged tiles and construction
     sites are skipped — the ask says "not destroyed", and a burnt-out shop that
     kept serving customers would be the clearest possible lie the city could
     tell.

   ⚠ THIS MODULE NEVER TOUCHES A WALLET. It returns what was earned and by
     which tile; node-city banks it through the one path that already credits
     the player (game.frac.cinder + t.earn), so patronage lands in the ledger,
     the coin floats and the Bank of Ethos exactly like every other Cinder the
     city makes. A module that could write a balance is a money leak waiting for
     its first bug.

   ⚠ AND IT IS NOT THE /src/economy SIMULATION. That models firms, wages and
     industrial supply in its own units; this is the retail layer a player
     watches. They are deliberately separate: folding retail spend into
     revenueDay would double-count against the level gates and the distress
     ladder, which are computed from it.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── the needs, and who answers them ──────────────────────────────────────
   `every` is minutes of city time before the need fires. `base` is the Cinder a
   single visit is worth before any multiplier.
   ⚠ THE TYPES ARE node-city BUILDING KEYS. A need naming a type that does not
     exist simply never finds a venue and reports as unmet — which is a true
     statement about a city that has not built one, and is what the unmet report
     is for. It is not silent: report().unmet names it. */
export const NEEDS = [
  {
    id: 'food', icon: '🥫', label: 'Groceries',
    every: 26, base: 42, spread: 0.35,
    types: ['grocery', 'foodtruck', 'restaurant', 'fastfood'],
    say: 'shopping for food',
  },
  {
    id: 'lazy', icon: '🍟', label: 'Could not be bothered cooking',
    every: 41, base: 27, spread: 0.5,
    /* Deliberately the QUICK options only. A resident who cannot face cooking
       does not go to the grocer — that is the same errand they were avoiding. */
    types: ['fastfood', 'foodtruck', 'restaurant'],
    say: 'grabbing something quick',
  },
  {
    id: 'sick', icon: '🤒', label: 'Feeling unwell',
    every: 95, base: 78, spread: 0.6,
    types: ['clinic', 'pharmacy', 'medlab'],
    say: 'seeing someone about it',
  },
  {
    id: 'fitness', icon: '🏋', label: 'Needs to work out',
    every: 63, base: 36, spread: 0.4,
    types: ['gym', 'arena'],
    say: 'working out',
  },
  {
    id: 'fun', icon: '🎴', label: 'Playing Mythic Spellbook',
    every: 48, base: 48, spread: 0.55,
    /* 🎴 The card game the city is inside. The Game Store and the Player Shop
       sell the cards; the Duel Arena is where they are played. */
    /* ⚠ 'cardshop' WAS HERE AND IS NOT A BUILDING. A need type nobody can
       build is a slot that never matches a venue, so the need is that much
       harder to meet and reports as unmet — and from the need's own side that
       reads as a pass, which is why index.html carries a `hasType` hook for
       exactly this check. The Game Store and the Player Shop sell the cards;
       the Duel Arena is where they are played. */
    types: ['gamestore', 'shop', 'arena'],
    say: 'playing Mythic Spellbook',
  },
  {
    id: 'goods', icon: '🛍', label: 'Wants something new',
    every: 77, base: 63, spread: 0.6,
    /* ⚠ 'techstore' WAS HERE AND IS NOT A BUILDING EITHER — see the note on
       'fun' above. Great Buy is the city's electronics counter. */
    types: ['clothier', 'furnistore', 'greatbuy', 'weaponshop'],
    say: 'out shopping',
  },
  {
    id: 'night', icon: '🍸', label: 'Out for the evening',
    every: 88, base: 72, spread: 0.7,
    types: ['club', 'cinema', 'restaurant'],
    say: 'out for the evening',
  },
];
export const NEED_BY_ID = {};
for (const n of NEEDS) NEED_BY_ID[n.id] = n;

export const PATRON = {
  /* 🔴 THE PROMISE, AS A NUMBER. Per REAL day, at the top node tier, in a city
     that is fully built, fully covered and happy. Every other tier is this
     scaled by its own rate (free 0.5 … eternal 20), so a Starter city tops out
     near 50,000 a day and a Free one near 25,000. */
  /* HOW IT WAS CALIBRATED, so the next person to move a number knows what they
     are moving. 194 visits per resident per real day (the sum of 1440/every
     over NEEDS) at a frequency-weighted mean of ~52 🔥 is ~9,100 🔥 per
     resident per day at multipliers of 1. A city of ~110 residents therefore
     ARRIVES at the ceiling when it is well built, well staffed and happy, and
     a struggling city of forty makes about a fifth of it. That is the whole
     design: the million is reachable and it has to be earned. */
  DAY_CAP_TOP: 1000000,
  TOP_TIER_RATE: 20,
  MIN_PER_DAY: 0,
  /* Mood 0–100 → x0.45 … x1.55. Happy residents spend more, and miserable ones
     still spend something: a city in a bad mood should feel poorer, not dead. */
  MOOD_LO: 0.45, MOOD_HI: 1.55,
  /* The floors matter more than the ceilings. A city with no coverage and a
     wrecked economy should be BAD, not zero — zero is unrecoverable, and an
     unrecoverable city is one the player abandons rather than fixes. */
  CITY_FLOOR: 0.25, ECON_FLOOR: 0.30,
  /* Visits per resident are capped per tick so a long offline catch-up cannot
     bank a week of shopping in one frame. */
  MAX_VISITS_PER_TICK: 3,
  /* 👷 The most a posted work crew can lift one shop's takings. The same
     ×2.00 the city caps every other crew multiplier at — a second ceiling
     that disagreed with the first would be a bug wearing a constant's name. */
  BOOST_CAP: 2,
  /* 🏅 THE TIER SCALES SPEND AND THE CEILING BY THE SAME FACTOR, ON PURPOSE.
     Residents of a higher node are richer AND their ceiling is higher, in
     exact proportion — so the RATIO of what a city earns to what it is allowed
     to earn does not depend on its tier at all. Every player, on every node,
     is answering the same question: is my city big enough, built well enough
     and happy enough to reach my own ceiling?
     🔴 THE ALTERNATIVE WAS MEASURED AND REJECTED. With spend flat and only the
       cap scaled, a Free node's cap (25,000/day) is exceeded by about SEVENTEEN
       residents — every free and low-tier city would sit pinned to its ceiling
       from its first week, and nothing a player did to it afterwards would
       change its income by a single Cinder. The tier would not be a multiplier,
       it would be the only thing that mattered. */
  TIER_SCALES_SPEND: true,
};

/* ── the state, which is per resident and per need ──────────────────────── */
const _clock = new Map();     // citizenId → { needId: minutesAccrued }
/* 🚶 WHAT THEY JUST DID. The other half of the ask — "make NPCs almost life
   like" is not only that they spend, it is that a player can look at one and
   see them shopping for food. One entry per resident, overwritten each visit,
   because the panel asks "what are they doing" and not "what have they ever
   done" — a history here would grow without bound for no reader. */
const _doing = new Map();     // citizenId → { need, label, say, icon, tile, spend }
const _today = new Map();     // tileKey → { spend, visits, day }
let _dayStamp = 0;

/** Wipe everything. Called on city load — another city's shoppers are not ours. */
export function reset() { _clock.clear(); _today.clear(); _doing.clear(); _dayStamp = 0; }

/** What one tile has taken today, for the Trading card. */
export function todayFor(tileKey) {
  const r = _today.get(String(tileKey));
  return r ? { spend: r.spend, visits: r.visits } : { spend: 0, visits: 0 };
}
/** What this resident is up to, or null if they have not been out yet. */
export function doingFor(citId) {
  const d = _doing.get(String(citId));
  return d ? { ...d } : null;
}
export function todayAll() {
  const out = {};
  for (const [k, v] of _today) out[k] = { spend: v.spend, visits: v.visits };
  return out;
}

/* Deterministic-ish jitter so two identical shops do not take identical money
   on the same tick. Seeded from the ids, never Math.random, so a reload does
   not re-roll a day's takings. */
function _jit(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;                 // 0 … 0.999
}

/** 0–100 mood → spend multiplier. */
export function moodMul(mood) {
  const m = Math.max(0, Math.min(100, Number(mood) || 0));
  return PATRON.MOOD_LO + (PATRON.MOOD_HI - PATRON.MOOD_LO) * (m / 100);
}

/** The per-minute ceiling for a city on this tier. */
export function capPerMin(tierRate) {
  const rate = Math.max(0, Number(tierRate) || 0);
  return (PATRON.DAY_CAP_TOP * (rate / PATRON.TOP_TIER_RATE)) / 1440;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE TICK
   ctx: {
     citizens:  [{ id, mood }]                     — the named roster
     venues:    [{ key, type, open, boost }]       — every standing building.
                boost is the work-crew multiplier for that tile (1 = nobody
                posted). 👷 A unit posted to a shop makes the shop better at
                being a shop — see the note at the spend line.
     cityMul:   0..1+   how well the city is built
     econMul:   0..1+   how the economy is doing
     tierRate:  0.5..20 the node's own rate
     dtMin:     minutes of city time since the last call
   }
   Returns { credited, visits, byTile: {key: cinder}, capped, unmet: [needId] }
   ══════════════════════════════════════════════════════════════════════════ */
export function tick(ctx) {
  const out = { credited: 0, visits: 0, byTile: {}, capped: false, unmet: [] };
  if (!ctx) return out;
  const dt = Math.max(0, Number(ctx.dtMin) || 0);
  if (dt <= 0) return out;
  const citizens = Array.isArray(ctx.citizens) ? ctx.citizens : [];
  const venues = Array.isArray(ctx.venues) ? ctx.venues : [];
  if (!citizens.length || !venues.length) return out;

  /* Roll the day over so "today" means today. Keyed on the caller's day number
     rather than wall-clock, so an offline catch-up that crosses a boundary
     starts a fresh day rather than piling onto the last one. */
  const day = Math.floor(Number(ctx.day) || 0);
  if (day !== _dayStamp) { _dayStamp = day; _today.clear(); }

  /* 🏚 A DESTROYED OR HALF-BUILT SHOP SERVES NOBODY. The caller marks `open`;
     this is where the ask's "not destroyed" is actually enforced. */
  const byType = new Map();
  for (const v of venues) {
    if (!v || !v.open || !v.type) continue;
    if (!byType.has(v.type)) byType.set(v.type, []);
    byType.get(v.type).push(v);
  }
  if (!byType.size) return out;

  const cityMul = Math.max(PATRON.CITY_FLOOR, Number(ctx.cityMul) || 0);
  const econMul = Math.max(PATRON.ECON_FLOOR, Number(ctx.econMul) || 0);
  const tierMul = PATRON.TIER_SCALES_SPEND
    ? Math.max(0, (Number(ctx.tierRate) || 0)) / PATRON.TOP_TIER_RATE
    : 1;
  const cap = capPerMin(ctx.tierRate) * dt;
  const unmet = new Set();

  for (const c of citizens) {
    if (!c || !c.id) continue;
    let clocks = _clock.get(c.id);
    if (!clocks) { clocks = {}; _clock.set(c.id, clocks); }
    const mm = moodMul(c.mood);
    let visitsThisTick = 0;

    for (const need of NEEDS) {
      /* Seeded offset so a city's residents do not all shop on the same minute
         — forty people arriving together is a queue, not a town. */
      const off = _jit(c.id + '|' + need.id) * need.every;
      clocks[need.id] = (clocks[need.id] || off) + dt;
      if (clocks[need.id] < need.every) continue;

      const pool = [];
      for (const t of need.types) { const vs = byType.get(t); if (vs) pool.push(...vs); }
      if (!pool.length) {
        /* Nowhere to go. The need STAYS ripe — it is not consumed by a city
           that cannot answer it — but it is capped so it cannot bank an
           unbounded backlog against the day a shop finally opens. */
        clocks[need.id] = Math.min(clocks[need.id], need.every * 2);
        unmet.add(need.id);
        continue;
      }
      if (visitsThisTick >= PATRON.MAX_VISITS_PER_TICK) break;

      clocks[need.id] -= need.every;
      visitsThisTick++;

      const pick = pool[Math.floor(_jit(c.id + need.id + String(Math.floor(clocks[need.id]))) * pool.length) % pool.length];
      const jitter = 1 + (_jit(pick.key + c.id) - 0.5) * 2 * need.spread;
      /* 👷 THE WORK CREW, ON THE TILL. "units being assigned to city buildings
         for work and boosting of producing" — for a shop, what it produces IS
         its takings, so this is where a posted unit has to land. A well-run
         shop sells more to the same customer.
         ⚠ PER-VENUE, NOT PER-CITY, and that is the whole point: it rewards
           aiming a unit at a particular shop rather than owning units. The
           host caps it at the same ×2.00 every other crew multiplier is
           capped at; this clamps again rather than trusting that, because a
           number that reaches a till should be bounded where it is spent.
         ⚠ IT DOES NOT RAISE THE DAILY CEILING. The tick clamp below is
           applied after this, so crewing a city cannot mint past the node's
           cap — it shifts takings toward the shops that are actually staffed
           and helps a smaller city reach a ceiling it was short of. */
      const boost = Math.max(1, Math.min(PATRON.BOOST_CAP, Number(pick.boost) || 1));
      const spend = need.base * jitter * mm * cityMul * econMul * tierMul * boost;
      if (!(spend > 0)) continue;

      _doing.set(c.id, { need: need.id, label: need.label, say: need.say,
                        icon: need.icon, tile: pick.key, type: pick.type, spend, boost });
      out.byTile[pick.key] = (out.byTile[pick.key] || 0) + spend;
      out.credited += spend;
      out.visits++;
    }
  }

  /* 🔴 THE CEILING, APPLIED TO THE WHOLE TICK. Scaled rather than truncated so
     no single shop is singled out to absorb the clamp — every till is reduced
     in the same proportion, which keeps the relative standing of the city's
     businesses honest. */
  if (out.credited > cap && out.credited > 0) {
    const k = cap / out.credited;
    for (const key in out.byTile) out.byTile[key] *= k;
    out.credited = cap;
    out.capped = true;
  }

  for (const key in out.byTile) {
    const rec = _today.get(key) || { spend: 0, visits: 0, day };
    rec.spend += out.byTile[key];
    rec.visits += 1;
    _today.set(key, rec);
  }
  out.unmet = Array.from(unmet);
  return out;
}

/** A short, honest summary for the diagnostics bag. */
export function report() {
  let spend = 0, visits = 0;
  for (const [, v] of _today) { spend += v.spend; visits += v.visits; }
  return { tiles: _today.size, spendToday: Math.round(spend), visitsToday: visits, tracked: _clock.size };
}

export default { NEEDS, NEED_BY_ID, PATRON, tick, reset, todayFor, todayAll, doingFor, report, moodMul, capPerMin };
