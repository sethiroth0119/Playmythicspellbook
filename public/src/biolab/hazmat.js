/* ══════════════════════════════════════════════════════════════════════════
   ☣️ HAZMAT — the suit, the seals, and the exposure that outlives the run.
   ──────────────────────────────────────────────────────────────────────────
   The suit is a FOUR-STEP SEQUENCE, not a toggle. Each step takes real time at
   the airlock, and the sequence breaks if the player walks away mid-donning.
   That is the whole reason the suit reads as a procedure rather than a menu
   click: it costs the one thing an impatient player will not spend, which is
   thirty seconds of standing still while an outbreak is running.

   🔴 THE SUIT'S CONSEQUENCE IS ON THE PRODUCT. Exposure is not damage to an
   avatar with no health bar; it is a number that goes into
   /src/plague/cures.js and comes out as lost purity, lost stability, and a
   contaminated flag that turns a cure into the next outbreak. Anything that
   makes the suit merely cosmetic — an "ignore" button, an auto-suit, a
   difficulty toggle — takes the teeth out of the whole feature. Do not add one.

   ⚠ THE SUIT IS PER-RUN. It does not persist across visits to the lab, on
   purpose. A player who leaves and comes back is a player who has been out in
   the city; the ritual runs again.
   ══════════════════════════════════════════════════════════════════════════ */

export const SEALS = [
  { key: 'legs',    label: 'Step into the suit', icon: '🦵', ms: 2600 },
  { key: 'torso',   label: 'Zip and tape the torso', icon: '🧥', ms: 2600 },
  { key: 'gloves',  label: 'Double glove, cuff-tape', icon: '🧤', ms: 2400 },
  { key: 'hood',    label: 'Hood, respirator, seal check', icon: '🥽', ms: 3200 },
];

export const TUNING = {
  /* Exposure per second in the hot zone with no sealed suit. Sized so a player
     who dashes across the hot zone to reach the dispatch bay picks up a little
     (survivable, and a lesson), while one who actually WORKS a bench unsuited
     blows past the 0.12 contamination threshold in cures.js inside ~12s. */
  RATE_UNSEALED: 0.011,
  // A sealed suit is not immunity — it is a very good filter. A long run still
  // accumulates, which is what stops "suit up once, live in the hot zone".
  RATE_SEALED: 0.0009,
  // Doffing badly. Leaving the hot zone without doffing at the airlock carries
  // contamination out on the suit and onto everything you touch after.
  DOFF_PENALTY: 0.05,
  // How long the player may step away from the airlock mid-donning before the
  // sequence resets. Generous — a stutter should not cost the whole procedure.
  GRACE_MS: 1400,
};

export function emptySuit() {
  return {
    seals: {},            // key -> true
    sealed: false,        // all four
    donning: null,        // { key, startedAt, ms }
    lastAtAirlock: 0,
    exposure: 0,          // 0..1, the number cures.js consumes
    breaches: 0,          // times the player entered hot unsealed
    inHot: false,
    everSealed: false,
    doffed: false,
  };
}

export function sealCount(suit) {
  let n = 0; for (const s of SEALS) if (suit.seals[s.key]) n++;
  return n;
}
export function nextSeal(suit) {
  for (const s of SEALS) if (!suit.seals[s.key]) return s;
  return null;
}

/* Begin (or continue) donning. Returns the seal being worked, or null if the
   suit is already complete. Called on the interact key while at the airlock. */
export function startDon(suit, now) {
  if (suit.sealed) return null;
  if (suit.donning) return suit.donning;
  const s = nextSeal(suit);
  if (!s) return null;
  suit.donning = { key: s.key, label: s.label, icon: s.icon, startedAt: now, ms: s.ms };
  return suit.donning;
}

/* Doff at the airlock. Clean removal drops the suit AND vents most of the
   carried contamination; walking out without doffing does not (see tick). */
export function doff(suit) {
  suit.seals = {};
  suit.sealed = false;
  suit.donning = null;
  suit.doffed = true;
  // A clean doff vents the surface contamination. It never zeroes exposure —
  // what the batch already caught, it caught.
  suit.exposure = +Math.max(0, suit.exposure * 0.55).toFixed(4);
  return suit;
}

/* ── the per-frame update ──────────────────────────────────────────────────
   `atAirlock` and `inHot` come from stations.js; this file never asks where
   anything is. Returns the events the HUD should announce, so the caller does
   not have to diff the state itself. */
export function tick(suit, dtMs, ctx) {
  const now = ctx.now || Date.now();
  const dt = Math.max(0, +dtMs || 0);
  const events = [];

  // ── donning progress
  if (suit.donning) {
    if (ctx.atAirlock) {
      suit.lastAtAirlock = now;
      if (now - suit.donning.startedAt >= suit.donning.ms) {
        suit.seals[suit.donning.key] = true;
        events.push({ kind: 'seal', key: suit.donning.key, label: suit.donning.label });
        suit.donning = null;
        if (sealCount(suit) === SEALS.length) {
          suit.sealed = true;
          suit.everSealed = true;
          suit.doffed = false;
          events.push({ kind: 'sealed' });
        }
      }
    } else if (now - (suit.lastAtAirlock || 0) > TUNING.GRACE_MS) {
      /* 🔴 WALKING AWAY BREAKS THE SEAL YOU WERE MID-WAY THROUGH — but it does
         NOT undo the seals already done. Punishing a stutter by resetting the
         whole procedure teaches players to resent the airlock rather than
         respect it. */
      events.push({ kind: 'interrupted', key: suit.donning.key });
      suit.donning = null;
    }
  } else if (ctx.atAirlock) {
    suit.lastAtAirlock = now;
  }

  // ── exposure
  const wasIn = suit.inHot;
  suit.inHot = !!ctx.inHot;
  if (suit.inHot) {
    if (!wasIn && !suit.sealed) {
      suit.breaches++;
      events.push({ kind: 'breach' });
    }
    const rate = suit.sealed ? TUNING.RATE_SEALED : TUNING.RATE_UNSEALED;
    suit.exposure = +Math.min(1, suit.exposure + rate * (dt / 1000)).toFixed(4);
  } else if (wasIn && suit.sealed && !ctx.atAirlock) {
    /* Left the hot zone still suited and NOT through the airlock. The suit's
       outside is dirty and it is now in the clean half of the room. */
    suit.exposure = +Math.min(1, suit.exposure + TUNING.DOFF_PENALTY).toFixed(4);
    events.push({ kind: 'trackedOut' });
  }

  return events;
}

/* Can this station be worked right now? The single gate every hot bench asks.
   Returns a refusal STRING rather than a boolean so the HUD can say why —
   "you need the suit" and "your suit is not finished" are different problems
   and a player who cannot tell them apart just gets stuck. */
export function gate(suit, station) {
  if (!station) return 'Nothing here.';
  if (!station.hot) return null;
  if (suit.sealed) return null;
  const n = sealCount(suit);
  if (suit.donning) return 'Finish sealing the suit at the airlock first.';
  if (n > 0) return 'Suit incomplete — ' + n + ' of ' + SEALS.length + ' seals. Back to the airlock.';
  return '☣️ ' + station.name + ' is in the hot zone. Suit up at the airlock before you touch it.';
}

export function exposureBand(x) {
  const v = +x || 0;
  if (v <= 0.001) return { key: 'clean', label: 'CLEAN', color: '#86e08a' };
  if (v < 0.06) return { key: 'trace', label: 'TRACE', color: '#d8d06a' };
  if (v < 0.12) return { key: 'elevated', label: 'ELEVATED', color: '#e0a860' };
  if (v < 0.35) return { key: 'contaminated', label: 'CONTAMINATED', color: '#ff8a5a' };
  return { key: 'critical', label: 'CRITICAL', color: '#ff5b6e' };
}
