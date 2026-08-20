/* ══════════════════════════════════════════════════════════════════════════
   🛏 THE HOUSE — Camp Bunkhouse + City Resting House.  (resonance-card-training.md §5-§7)
   ──────────────────────────────────────────────────────────────────────────
   PURE LOGIC. No DOM, no globals, no imports. Everything this file needs is
   handed to it by the host (see CLAUDE.md's globals trap: `Profile`, `game`,
   `BUILDINGS` and friends are top-level `const` in the legacy pages and are
   NOT on window — a module cannot see them and must never pretend it can).

   🔴 WHAT THIS FILE IS NOT
   It is NOT the Resonance model. It does not know what 510 is, it does not
   know what 252 is, and it must never learn. It computes an AMOUNT of
   Resonance earned over time and hands that amount to the model through
   `ctx.resonance.add()`. The budget, the per-stat cap, the conversion to
   stats and the persistence of a spread all live in the OTHER builder's
   module. If a cap ever appears in this file, the House has started deciding
   how strong a card may be, which is exactly the anti-pattern §9 forbids
   ("Raise the 510 cap with city tier — the ceiling must be identical for
   everyone"). The only thing tier is allowed to move is CAPACITY and RATE.

   ⏱ THE IDLE CONTRACT IS BORROWED, NOT INVENTED.
   `collectCdMs` and `accrualCapH` are handed in by the host, which reads them
   from the ONE pair of constants the game already ships
   (`OP_COLLECT_CD_MS = 6h`, `OP_ACCRUAL_CAP_H = 36h`, index.html:77315-77316).
   Defaults here exist only so a standalone test can construct a context; the
   host always passes the real values and `assertIdleContract()` shouts if a
   third policy ever creeps in.
   ══════════════════════════════════════════════════════════════════════════ */

export const RES_PER_HOUR = 14;                 // doc §4: ~14 Resonance per hour, per card
export const HOUR_MS = 3600000;

/* The six training rooms. `stat` is the id the Resonance model is asked to
   credit — the six stats the doc names (HP ATK MAG DEF RES SPD), lowercase,
   which is also how the game's existing `emptyEvs()` keys them. */
export const ROOMS = [
  { id: 'drill',    ico: '🏋️', name: 'Drill Yard',   stat: 'atk', flavour: 'Weights, forms, repetition.' },
  { id: 'sanctum',  ico: '🕯️', name: 'Sanctum',      stat: 'mag', flavour: 'Silence and study.' },
  { id: 'bulwark',  ico: '🛡️', name: 'Bulwark',      stat: 'def', flavour: 'Shield drill under load.' },
  { id: 'warding',  ico: '🌀', name: 'Warding Hall', stat: 'res', flavour: 'Exposure to warded elements.' },
  { id: 'track',    ico: '🏃', name: 'The Track',    stat: 'spd', flavour: 'Distance and footwork.' },
  { id: 'longward', ico: '🛌', name: 'Long Ward',    stat: 'hp',  flavour: 'Rest, food, recovery.' },
];
export const REFLECTION_HALL = { id: 'reflect', ico: '🪞', name: 'Reflection Hall', stat: null,
  flavour: 'The retraining room. Resets a spread for free.' };

/* ══ 🏋 DRILL INTENSITY ══════════════════════════════════════════════════
   Until this existed the House was a faucet: park a card, come back, collect.
   There was no decision in it and nothing the player could get wrong, which
   is also why the camp's `fatigue` / `morale` fields — and the Med-bay
   Medicine sink that clears them — had almost nothing feeding them.

   Monster Rancher's drill is a triangle: a stat rises, stress rises with it,
   and rest is the third corner. Light is what the House has always done and
   is EXACTLY unchanged (rate 1.00, no strain), so every existing billet, save
   and city Resting House behaves identically to before — `int` absent reads
   as 'light'. Hard buys speed with condition.

   🔴 THE RATE MULTIPLIER IS ALLOWED; THE CEILING IS NOT TOUCHED.
   doc §9 forbids raising 510 and reserves CAPACITY and RATE as the only
   things a building may move. Hard drill moves rate and nothing else: it
   changes how long a card takes to reach the same ceiling every player has.
   A player who never drills hard reaches Attuned just as surely, slower.

   ⚠ WHY THE STRAIN NUMBERS ARE WHAT THEY ARE. Over one 6h collect cycle a
     hard drill is +99 Resonance for ~13 fatigue and ~7 morale. Over the full
     36h accrual cap it is +713 for ~79 fatigue — which very nearly maxes the
     0–100 fatigue field on its own. That is deliberate: an unattended
     week-long hard drill should end with an exhausted unit and a Med-bay
     bill, not with a free doubling. */
export const DRILLS = {
  light: { id: 'light', ico: '🌿', name: 'Light', rate: 1.00, fatiguePerH: 0,   moralePerH: 0,
           blurb: 'Steady work. They stay fresh.' },
  hard:  { id: 'hard',  ico: '🏋️', name: 'Hard',  rate: 1.80, fatiguePerH: 2.2, moralePerH: 1.1,
           blurb: 'Faster gains, paid for in fatigue and morale.' },
};
export const DEFAULT_DRILL = 'light';
export function drillById(id) { return DRILLS[id] || DRILLS[DEFAULT_DRILL]; }

/* 🚫 The refusal. A unit this tired will not START a hard drill — the same
   shape as billetBlock(): ONE function, so the disabled button and the click
   handler can never disagree about the rule. Returns a reason, or null. */
export const FATIGUE_HARD_MAX = 70;
/* …and at 100 an in-progress hard drill stops paying its bonus and runs at
   the light rate instead. It does NOT unbillet itself and does NOT write to
   the profile — this file is pure and stays that way. It flags `spent` and
   the panel says so. A drill that silently kept paying double on a unit at
   maximum fatigue would make the whole cost fictional. */
export const FATIGUE_SPENT = 100;
export function hardDrillBlock(fatigue) {
  const f = Number.isFinite(+fatigue) ? +fatigue : 0;
  if (f >= FATIGUE_HARD_MAX)
    return 'Too worn down to drill hard (fatigue ' + Math.round(f) + '/' + FATIGUE_HARD_MAX + '). Rest them, or treat them at the Med-bay.';
  return null;
}

export function roomById(id) { return ROOMS.find(r => r.id === id) || null; }

/* 🏛 THE TIER TABLE (doc §5). Capacity and rate. NOTHING ELSE.
   `rooms` is how many DISTINCT rooms may be occupied at once — not WHICH
   rooms. Locking specific stats behind tier would mean a Tier 1 player who
   wants SPD cannot train SPD at all, which is a ceiling wearing a hat. The
   player picks any 2 of the 6 at T1; the tier decides how many fronts they
   can run at once. That is breadth, which §5 says the city is allowed to sell.
   `cinderDoc` is the doc's own figure, kept so the city's divided-down cost
   can be checked against it and so the camp can charge the raw number. */
export const TIERS = [
  { tier: 1, capacity: 4,  rooms: 2, rate: 1.00, reflection: false, cinderDoc: 90000 },
  { tier: 2, capacity: 8,  rooms: 4, rate: 1.15, reflection: false, cinderDoc: 240000 },
  { tier: 3, capacity: 14, rooms: 6, rate: 1.30, reflection: false, cinderDoc: 520000 },
  { tier: 4, capacity: 20, rooms: 6, rate: 1.50, reflection: true,  cinderDoc: 1100000 },
];
/* ⛺ The camp Bunkhouse — "the floor. Works with no city." 2 cards, 1 room,
   100% rate, no Reflection Hall, and (see restQuality below) no city coupling
   because there is no city to starve. */
export const BUNKHOUSE = { tier: 0, capacity: 2, rooms: 1, rate: 1.00, reflection: false, cinderDoc: 8000 };

export function tierSpec(tier) {
  const n = Math.max(1, Math.min(TIERS.length, tier | 0));
  return TIERS[n - 1];
}

/* ⭐ REST QUALITY — the city coupling, doc §6, verbatim:
       restQuality = 0.5 + food×0.25 + morale×0.15 + security×0.10
   Each input is a 0-1 fraction and is CLAMPED to 0-1 on the way in: the city's
   own coverage function clamps at COVERAGE_MAX = 1.5, and letting 150% food
   pay 0.375 would push a well-fed city past the doc's ceiling of 1.0.
   ⚠ The doc's PROSE ("half again the rate") and the doc's FORMULA disagree.
     The formula spans 0.5 → 1.0, i.e. a starving city trains at HALF and a
     perfect one trains at the plain 14/hr. The formula is what is implemented,
     because it is the thing that is written as code. Flagged in house.NOTES.md. */
export const REST_FLOOR = 0.5;
export const REST_WEIGHTS = { food: 0.25, morale: 0.15, security: 0.10 };
const clamp01 = v => { const n = +v; return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };

export function restQuality(v) {
  v = v || {};
  return REST_FLOOR
    + clamp01(v.food)     * REST_WEIGHTS.food
    + clamp01(v.morale)   * REST_WEIGHTS.morale
    + clamp01(v.security) * REST_WEIGHTS.security;
}

/* The SAME arithmetic, itemised, for the panel. The bar is explicit that an
   invisible penalty is indistinguishable from a bug and that this project has
   shipped that mistake before — so the number and its three causes are always
   rendered from this one function. `lost` is what each term is FAILING to pay,
   which is the actionable half: "food is costing you 0.19" is a sentence a
   player can act on; "restQuality 0.63" is not. */
export function restBreakdown(v) {
  v = v || {};
  const rows = [
    { k: 'food',     ico: '🍽️', label: 'Food coverage', val: clamp01(v.food),     w: REST_WEIGHTS.food,
      fix: 'Build a Food Truck, Grocery or Cannery — the district is short of rations.' },
    { k: 'morale',   ico: '😊', label: 'City morale',    val: clamp01(v.morale),   w: REST_WEIGHTS.morale,
      fix: 'Morale is low. Feed the city, add greenery, a Restaurant or a Club.' },
    { k: 'security', ico: '🛡️', label: 'Security',       val: clamp01(v.security), w: REST_WEIGHTS.security,
      fix: 'Security is low. A Police Station, Watchtower or garrison steadies it.' },
  ].map(r => ({ ...r, gain: r.val * r.w, lost: (1 - r.val) * r.w }));
  const q = REST_FLOOR + rows.reduce((s, r) => s + r.gain, 0);
  // The single biggest thing dragging the rate down, or null when the city is fine.
  let worst = null;
  for (const r of rows) if (r.lost > 0.02 && (!worst || r.lost > worst.lost)) worst = r;
  return { quality: q, floor: REST_FLOOR, rows, worst, max: REST_FLOOR + REST_WEIGHTS.food + REST_WEIGHTS.morale + REST_WEIGHTS.security };
}

/* ── the persisted shape ────────────────────────────────────────────────
   Deliberately small and flat: it rides the city's per-tile save object and
   the camp's Profile blob as plain JSON, and every field is read back with a
   default (loadHouse below). Absent-tolerant is a hard requirement — this
   project has shipped a silent save bug three times.
     billets[] : { card, room, pend, hrs, int }
        card — the collection id (string). The card OBJECT is resolved by the
               host at collect time and handed to the Resonance model, so the
               model keys cards however it likes and this file never guesses.
        pend — Resonance earned and not yet banked into the model (float).
        hrs  — RAW hours accrued since the last collect. This, not `pend`, is
               what the 36h cap is measured against, because `pend` moves at a
               rate that changes with rest quality and would make the cap mean
               a different amount of time in a starving city.
        int  — drill intensity, 'light' | 'hard' (DRILLS). ABSENT READS AS
               'light', which is the pre-drill behaviour exactly, so every
               save written before drills existed loads unchanged.
     lastAt      — wall-clock ms up to which this House has been PAID.
     lastCollect — wall-clock ms of the last collect (the 6h gate). */
export function newHouse() { return { billets: [], lastAt: Date.now(), lastCollect: 0 }; }

export function loadHouse(raw) {
  const h = newHouse();
  if (!raw || typeof raw !== 'object') return h;
  const now = Date.now();
  // ⚠ A future-dated stamp (clock skew, a doctored save) must not create
  //   negative time and must not park the House permanently unpaid.
  h.lastAt = Number.isFinite(+raw.lastAt) && +raw.lastAt > 0 ? Math.min(now, +raw.lastAt) : now;
  h.lastCollect = Number.isFinite(+raw.lastCollect) && +raw.lastCollect > 0 ? Math.min(now, +raw.lastCollect) : 0;
  const seen = new Set();
  for (const b of (Array.isArray(raw.billets) ? raw.billets : [])) {
    if (!b || !b.card || seen.has(b.card)) continue;      // one card, one bed
    if (!roomById(b.room)) continue;                      // a room that no longer exists
    seen.add(b.card);
    h.billets.push({
      card: String(b.card), room: String(b.room),
      pend: Number.isFinite(+b.pend) && +b.pend > 0 ? +b.pend : 0,
      hrs:  Number.isFinite(+b.hrs)  && +b.hrs  > 0 ? +b.hrs  : 0,
      // Anything unrecognised (an older save, a hand-edit, a drill id we
      // removed) falls back to light rather than throwing — an unknown
      // intensity must never make a bed stop paying.
      int:  DRILLS[b.int] ? String(b.int) : DEFAULT_DRILL,
    });
  }
  return h;
}

export function saveHouse(h) {
  if (!h || !Array.isArray(h.billets) || (!h.billets.length && !h.lastCollect)) return null;
  return {
    lastAt: Math.round(h.lastAt || Date.now()),
    lastCollect: Math.round(h.lastCollect || 0),
    billets: h.billets.map(b => ({ card: b.card, room: b.room, pend: +(b.pend || 0).toFixed(3),
                                   hrs: +(b.hrs || 0).toFixed(4), int: DRILLS[b.int] ? b.int : DEFAULT_DRILL })),
  };
}

/* ── the accrual engine ─────────────────────────────────────────────────
   ONE function pays Resonance, and it is driven by a monotonic wall-clock
   watermark (`lastAt`). That is the whole anti-double-pay design:

     • the live tick calls advance() with the simulated ms of the tick and
       pushes lastAt forward by that much, never past Date.now();
     • coming back from an absence calls settle(), which pays exactly
       Date.now() - lastAt and then sets lastAt = Date.now().

   Because both paths move the same watermark and neither can move it past
   now, a city that ticked while you watched has nothing left to settle, and
   five reloads in a row pay once. It is also why a fast-forward test works:
   step() feeds simulated minutes, the watermark saturates at now, and the
   Resonance is genuinely earned.
   ⚠ `capH` (36h) is measured per billet on RAW hours since the last collect,
     so a player who leaves for a week is paid for 36 hours — and the UI is
     told (`capped`) so the cap is visible rather than a mystery. */
export function advance(h, ms, opts) {
  const o = opts || {};
  const rate = Number.isFinite(+o.tierRate) ? +o.tierRate : 1;
  const rq = Number.isFinite(+o.restQuality) ? +o.restQuality : 1;
  const capH = Number.isFinite(+o.accrualCapH) ? +o.accrualCapH : 36;
  const perHour = Number.isFinite(+o.perHour) ? +o.perHour : RES_PER_HOUR;
  const dtH = Math.max(0, +ms || 0) / HOUR_MS;
  /* 🏋 The host supplies current fatigue per card. This file stays PURE — it
     never reaches for a profile — but it still has to know when a hard drill
     has exhausted its subject, because a bonus that keeps paying past the
     point the cost was supposed to bite is not a cost at all. No reader
     supplied (the city half today, any test) reads as 0 fatigue, i.e. the
     drill always pays, which is the pre-drill behaviour. */
  const strainOf = (typeof o.strainOf === 'function') ? o.strainOf : null;
  const out = { hours: dtH, gained: 0, capped: 0, strain: [] };
  if (!h || !Array.isArray(h.billets)) return out;
  for (const b of h.billets) {
    const room = roomById(b.room); if (!room) continue;
    const allow = Math.max(0, capH - (b.hrs || 0));
    const use = Math.min(dtH, allow);
    if (use <= 0) { b.capped = true; out.capped++; continue; }
    b.capped = (use < dtH);
    if (b.capped) out.capped++;
    b.hrs = (b.hrs || 0) + use;

    const drill = drillById(b.int);
    let fat = 0;
    if (strainOf && drill.fatiguePerH > 0) { try { fat = +strainOf(b.card) || 0; } catch (e) { fat = 0; } }
    // Exhausted: the hard bonus stops, the bed keeps working at the light
    // rate, and the panel is told (`spent`) so the player can see WHY the
    // numbers changed rather than discovering it in a spreadsheet.
    b.spent = (drill.fatiguePerH > 0 && fat >= FATIGUE_SPENT);
    const dRate = b.spent ? DRILLS.light.rate : drill.rate;

    const g = use * perHour * rate * rq * dRate;
    b.pend = (b.pend || 0) + g;
    out.gained += g;

    /* Strain is REPORTED, not applied. Writing fatigue and morale means
       touching Profile.units, which is exactly the reach this file refuses to
       make (see the header). The host applies what is reported, once, against
       the same watermark that paid the Resonance — so the cost can never be
       double-charged, or skipped independently of the gain. */
    if (!b.spent && drill.fatiguePerH > 0) {
      out.strain.push({ card: b.card, hours: use,
                        fatigue: use * drill.fatiguePerH, morale: use * drill.moralePerH });
    }
  }
  return out;
}

/* Live tick. `dtMin` is the economy tick's own simulated minutes, so the House
   runs on exactly the clock the rest of the city runs on. */
export function tick(h, dtMin, opts) {
  if (!h) return null;
  const ms = Math.max(0, +dtMin || 0) * 60000;
  const r = advance(h, ms, opts);
  h.lastAt = Math.min(Date.now(), (h.lastAt || Date.now()) + ms);
  return r;
}

/* Absence catch-up. Pays the gap between the watermark and now.
   Returns null when there is nothing owed, so a caller can stay quiet. */
export function settle(h, opts) {
  if (!h) return null;
  const now = Date.now();
  const gap = Math.max(0, now - (h.lastAt || now));
  h.lastAt = now;
  if (gap < 1000) return null;
  const r = advance(h, gap, opts);
  r.awayMs = gap;
  r.awayCapped = gap > ((opts && +opts.accrualCapH || 36) * HOUR_MS);
  return r;
}

export function collectReadyIn(h, collectCdMs) {
  const cd = Number.isFinite(+collectCdMs) ? +collectCdMs : 6 * HOUR_MS;
  if (!h || !h.lastCollect) return 0;                    // never collected → ready
  return Math.max(0, (h.lastCollect + cd) - Date.now());
}

/* 🎁 COLLECT — the ONLY place Resonance leaves this file, and it leaves
   through the model's own `add()`. Whatever `add()` returns is the truth:
   if the card is Attuned the model grants 0 and the surplus is REPORTED as
   wasted rather than being quietly dropped or, worse, quietly stored so a
   tier could "unlock" it later. That report is the visible proof that a
   Tier 4 House cannot push a card past the ceiling.
   `force` skips the 6h gate — used by tests and by the "collect on demolish"
   path, never by the button. */
export function collect(h, ctx, force) {
  const R = ctx && ctx.resonance;
  const out = { ok: false, reason: '', rows: [], granted: 0, wasted: 0, cdLeft: 0 };
  if (!h || !h.billets.length) { out.reason = 'empty'; return out; }
  const cd = collectReadyIn(h, ctx && ctx.collectCdMs);
  if (cd > 0 && !force) { out.reason = 'cooldown'; out.cdLeft = cd; return out; }
  if (!R || typeof R.add !== 'function') { out.reason = 'nomodel'; return out; }
  for (const b of h.billets) {
    const room = roomById(b.room); if (!room) continue;
    const whole = Math.floor(b.pend || 0);
    if (whole <= 0) continue;
    const card = (ctx.cardById ? ctx.cardById(b.card) : null) || { id: b.card };
    /* 🔑 THE CARD KEY IS THE MODEL'S, NOT THE HOUSE'S. /src/resonance/index.js
       keys a spread `'u:<cardId>'` / `'h:<heroId>'` (index.html's `_rezKey`) and
       rejects anything that is not a string. The House does not know that
       convention and must not learn it — the host supplies `cardKey`, and the
       raw collection id is only a last resort for a host that supplied none. */
    const key = (ctx.cardKey ? ctx.cardKey(card) : null) || b.card;
    let given = 0;
    try { given = +R.add(key, room.stat, whole, { source: ctx.source || 'house' }) || 0; } catch (e) { given = 0; }
    given = Math.max(0, Math.min(whole, given));
    b.pend -= whole;                                   // the fractional remainder rides on
    b.hrs = 0;                                         // the 36h window restarts
    b.capped = false;
    out.rows.push({ card: b.card, name: card.name || b.card, room: room.id, roomName: room.name,
                    stat: room.stat, asked: whole, given, wasted: whole - given });
    out.granted += given; out.wasted += (whole - given);
  }
  h.lastCollect = Date.now();
  out.ok = true;
  return out;
}

/* ── billet management ──────────────────────────────────────────────── */
export function distinctRooms(h) {
  const s = new Set(); for (const b of (h && h.billets) || []) s.add(b.room); return s;
}
/* Why a card may NOT be billeted here. Returns null when it may.
   Kept as one function so the button's disabled state and the click handler
   can never disagree about the rule. */
export function billetBlock(h, spec, roomId) {
  if (!h) return 'No House.';
  if (!roomById(roomId)) return 'That room does not exist.';
  if (h.billets.length >= spec.capacity) return 'Full — ' + spec.capacity + ' bed' + (spec.capacity === 1 ? '' : 's') + ' taken.';
  const rooms = distinctRooms(h);
  if (!rooms.has(roomId) && rooms.size >= spec.rooms)
    return 'This House runs ' + spec.rooms + ' room' + (spec.rooms === 1 ? '' : 's') + ' at once. Empty one first, or upgrade.';
  return null;
}
export function billet(h, cardId, roomId, spec, intensity) {
  const why = billetBlock(h, spec, roomId); if (why) return why;
  if (h.billets.some(b => b.card === cardId)) return 'Already resting here.';
  h.billets.push({ card: String(cardId), room: roomId, pend: 0, hrs: 0,
                   int: DRILLS[intensity] ? String(intensity) : DEFAULT_DRILL });
  return null;
}
/* Switch an existing bed between Light and Hard. Returns a reason, or null.
   ⚠ Changing intensity does NOT reset `hrs` and does NOT bank `pend`: the 36h
     window and the earned-but-unbanked Resonance both belong to the BED, not
     to how hard it was being worked. Resetting either here would hand the
     player a free cap refresh for the price of two clicks. */
export function setDrill(h, cardId, intensity, fatigue) {
  const b = h && h.billets.find(x => x.card === cardId);
  if (!b) return 'Not resting here.';
  const d = DRILLS[intensity]; if (!d) return 'No such drill.';
  if (d.fatiguePerH > 0) { const why = hardDrillBlock(fatigue); if (why) return why; }
  b.int = d.id;
  return null;
}
export function unbillet(h, cardId) {
  const i = h.billets.findIndex(b => b.card === cardId);
  if (i < 0) return null;
  return h.billets.splice(i, 1)[0];
}

/* 🪞 REFLECTION HALL (T4) — a FREE reset, doc §5/§9 ("Make resets expensive"
   is listed as an anti-pattern). The reset itself belongs to the model; the
   House only decides that this building is allowed to ask for one. */
export function canReflect(spec) { return !!(spec && spec.reflection); }
export function reflect(ctx, cardId) {
  const R = ctx && ctx.resonance;
  if (!R || typeof R.reset !== 'function') return 'nomodel';
  const card = (ctx.cardById ? ctx.cardById(cardId) : null) || { id: cardId };
  const key = (ctx.cardKey ? ctx.cardKey(card) : null) || cardId;
  try { R.reset(key, { source: 'reflection' }); } catch (e) { return 'failed'; }
  return null;
}

/* Read a card's spread for display. Same key rule; absent-tolerant, because the
   model may not be loaded and a panel must still draw. */
export function spreadOf(ctx, cardId) {
  const R = ctx && ctx.resonance;
  if (!R || typeof R.get !== 'function') return null;
  const card = (ctx.cardById ? ctx.cardById(cardId) : null) || { id: cardId };
  const key = (ctx.cardKey ? ctx.cardKey(card) : null) || cardId;
  try { return R.get(key) || null; } catch (e) { return null; }
}

/* 📊 What one billet is earning RIGHT NOW, per hour, fully itemised. This is
   what the panel prints; deriving it anywhere else is how a panel starts
   lying about the economy behind it. */
export function billetRate(spec, restQ, perHour, intensity) {
  const base = Number.isFinite(+perHour) ? +perHour : RES_PER_HOUR;
  const d = drillById(intensity);
  return { base, tierRate: spec.rate, restQuality: restQ, drill: d, drillRate: d.rate,
           perHour: base * spec.rate * restQ * d.rate };
}

/* ⚠ THE THIRD-IDLE-POLICY ALARM. Three builders are working against the same
   two constants this round. If a host ever hands this file numbers that are
   not the game's own, say so loudly rather than shipping a House that quietly
   runs on its own clock. Returns a warning string, or null. */
export function assertIdleContract(ctx) {
  const cd = ctx && +ctx.collectCdMs, cap = ctx && +ctx.accrualCapH;
  const bad = [];
  if (!(cd === 6 * HOUR_MS)) bad.push('collectCdMs=' + cd + ' (expected OP_COLLECT_CD_MS = 21600000)');
  if (!(cap === 36)) bad.push('accrualCapH=' + cap + ' (expected OP_ACCRUAL_CAP_H = 36)');
  return bad.length ? 'House idle contract mismatch: ' + bad.join(' · ') : null;
}

export function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}
