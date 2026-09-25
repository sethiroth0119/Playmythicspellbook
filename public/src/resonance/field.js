/* ============================================================================
 * ⚔ PATH B — THE FIELD.                            round 8 / piece: resonance
 * ----------------------------------------------------------------------------
 * "Cards gain Resonance from battles, and the spread follows what the card
 *  actually did." — resonance-card-training.md §4
 *
 *   What the card did          Resonance gained
 *   ─────────────────────────  ────────────────
 *   Dealt physical damage      ATK
 *   Dealt magical damage       MAG
 *   Absorbed physical hits     DEF
 *   Absorbed magical hits      RES
 *   Moved a lot, struck first  SPD
 *   Survived at low health     HP
 *
 * ⭐ THIS SHIPS BEFORE THE HOUSE, ON PURPOSE (doc §10, "ship step 2 before
 * step 5"). Nothing in this file knows a building exists. A player who never
 * opens the city still fully attunes their deck — it just takes longer and
 * follows the shape of how they play. That is the fairness guarantee, and it
 * is why the House gets to be a convenience instead of a gate.
 *
 * HOW IT ACTUALLY WORKS
 * A battle opens a LEDGER. Every damaging event index.html routes here adds
 * to a per-card, per-role tally of raw involvement (damage points, tiles,
 * near-death survivals). Nothing is written to a profile mid-battle — a match
 * you rage-quit or a replay you re-watch must not pay. At battle end,
 * `settle()` turns each card's involvement into a WHOLE number of Resonance
 * and hands it back; index.js is what writes it.
 *
 * THE RATE, AND WHY IT IS THIS SMALL
 * A card earns between BATTLE_MIN and BATTLE_MAX Resonance per battle, split
 * across the roles it actually performed. At the ceiling that is 64 battles
 * for a full 510 spread; a card that barely participated earns 1. The House
 * (~14/hr, ~36h) buys PRECISION and BREADTH — you pick the stat and you train
 * twenty cards at once. The field buys nothing you didn't earn and gives you
 * no say in where it lands. Both reach the same 510. Neither can exceed it.
 *
 * ⚠ THIS FILE IS PURE. It holds a ledger and nothing else: no DOM, no globals,
 * no profile access, no save. It cannot break a battle because a battle never
 * reads anything back out of it.
 * ==========================================================================*/

import { STATS } from './model.js';

/* How much raw involvement counts as "one unit" of having done the job.
   Damage divisors are in HP; a 25-damage hit is one unit of work either way,
   dealt or eaten. Tuned against the existing catalog: unit ATK sits around
   10–30 and moves land 15–45, so a single decent hit is ~1 unit. */
const DIVISOR = {
  atk: 25,   // physical damage dealt
  mag: 25,   // magical damage dealt
  def: 25,   // physical damage absorbed
  res: 25,   // magical damage absorbed
  spd: 6,    // tiles moved (a first strike is worth STRUCK_FIRST_TILES tiles)
  hp: 1,     // each survival at/under LOW_HP_FRACTION
};

const STRUCK_FIRST_TILES = 3;   // "moved a lot, STRUCK FIRST" — both feed SPD
const LOW_HP_FRACTION    = 0.30; // "survived at low health"

export const BATTLE_MIN = 1;    // showed up and did something at all
export const BATTLE_MAX = 8;    // 510 / 8 ≈ 64 battles for a full spread

/** Which channel a damage type belongs to.
 *  index.html's damage types are a wide, historical set — 'physical', 'melee',
 *  'magic', 'magical', 'spell', 'trap', 'grave', 'location', 'surface',
 *  'status', 'weather', 'event', 'gem', 'ice', 'recoil', 'crush', undefined…
 *  Only the ones that are unambiguously a physical blow or unambiguously a
 *  spell train DEF/RES. Everything else (poison ticks, terrain, weather) is
 *  real damage but it is not "absorbing a hit", so it trains nothing on the
 *  defensive axis. It still counts toward HP if you live through it at low
 *  health, which is exactly what surviving a burn tick at 3 HP is. */
export function channelOf(damageType) {
  const t = String(damageType || '').toLowerCase();
  if (t === 'physical' || t === 'melee' || t === 'crush') return 'physical';
  if (t === 'magic' || t === 'magical' || t === 'spell') return 'magical';
  return 'other';
}

function blankRoles() {
  return { atk: 0, mag: 0, def: 0, res: 0, spd: 0, hp: 0 };
}

export class Ledger {
  constructor() {
    this.cards = Object.create(null);   // cardKey -> raw role tallies
    this.dealtBy = Object.create(null); // cardKey -> true once it has dealt damage
    this.struckFirst = Object.create(null); // cardKey -> true once credited initiative
    this.events = 0;
    this.dropped = 0;
    this.startedAt = Date.now();
  }

  _roles(key) {
    let r = this.cards[key];
    if (!r) { r = this.cards[key] = blankRoles(); }
    return r;
  }

  /** The single entry point index.html emits into. Never throws. */
  record(ev) {
    if (!ev || typeof ev !== 'object') { this.dropped++; return false; }
    const key = ev.card;
    if (!key || typeof key !== 'string') { this.dropped++; return false; }
    switch (ev.k) {
      case 'dealt':   return this._dealt(key, ev);
      case 'hit':     return this._hit(key, ev);
      case 'move':    return this._move(key, ev);
      default:        this.dropped++; return false;
    }
  }

  /* ⚔ Dealt physical damage → ATK.  ✦ Dealt magical damage → MAG. */
  _dealt(key, ev) {
    const dmg = Math.max(0, Number(ev.dmg) || 0);
    const ch = channelOf(ev.type);
    const r = this._roles(key);
    if (dmg > 0 && ch === 'physical') r.atk += dmg;
    else if (dmg > 0 && ch === 'magical') r.mag += dmg;
    else if (dmg <= 0 || ch === 'other') { /* landed, but trains no offensive axis */ }
    /* ⚡ "…struck first". Credited ONCE per card per battle, on the first blow
       it lands against a foe that has not yet dealt damage of its own.
       🔴 THE `!this.dealtBy[ev.foe]` TEST ALONE IS ALWAYS TRUE IN PvE. `dealtBy`
       is only ever keyed by a PLAYER card — the emit site upstream is
       `owner === 'player'` guarded — so an AI foe is never in it and the credit
       fired on EVERY swing, forever. Measured before this guard: ten attacks by
       one Orc that never moved put spd at 30 and settled 63% of the battle's
       Resonance into SPD. Three of the four archetypes then stalled at 504/510,
       six points short of Attuned, with half the budget in a stat that buys two
       tiles — which handed the Tier-4 Reflection Hall a monopoly on finishing a
       card and broke the doc's "everyone can reach the cap". */
    if (dmg > 0 && ev.foe && !this.dealtBy[ev.foe] && !this.struckFirst[key]) {
      r.spd += STRUCK_FIRST_TILES;
      this.struckFirst[key] = true;
    }
    if (dmg > 0) this.dealtBy[key] = true;
    this.events++;
    return true;
  }

  /* 🛡 Absorbed physical → DEF.  ◈ Absorbed magical → RES.
     ❤ Still standing at low health → HP. */
  _hit(key, ev) {
    const dmg = Math.max(0, Number(ev.dmg) || 0);
    const ch = channelOf(ev.type);
    const r = this._roles(key);
    if (dmg > 0 && ch === 'physical') r.def += dmg;
    else if (dmg > 0 && ch === 'magical') r.res += dmg;
    const hpAfter = Number(ev.hpAfter), maxHp = Number(ev.maxHp);
    if (isFinite(hpAfter) && isFinite(maxHp) && maxHp > 0
        && hpAfter > 0 && hpAfter <= maxHp * LOW_HP_FRACTION) {
      r.hp += 1;
    }
    this.events++;
    return true;
  }

  /* 👢 Moved a lot → SPD. */
  _move(key, ev) {
    const tiles = Math.max(0, Number(ev.tiles) || 0);
    if (tiles > 0) this._roles(key).spd += tiles;
    this.events++;
    return true;
  }

  /** Raw involvement, for probes and for the report. Read-only snapshot. */
  raw() {
    const out = {};
    for (const k in this.cards) out[k] = Object.assign({}, this.cards[k]);
    return out;
  }

  /**
   * Turn the ledger into whole Resonance per card.
   *
   * involvement_role = raw_role / DIVISOR[role]
   * budget           = clamp(round(sum(involvement)), BATTLE_MIN, BATTLE_MAX)
   * split            = budget × (involvement_role / sum), largest-remainder
   *
   * Largest-remainder rather than plain rounding so the split always sums to
   * exactly `budget` — otherwise a three-role card silently loses a point to
   * rounding and the numbers a player can add up wouldn't add up.
   *
   * Deterministic: same ledger in, same bags out, every time.
   */
  settle() {
    const out = {};
    for (const key in this.cards) {
      const raw = this.cards[key];
      const inv = {}; let sum = 0;
      for (const s of STATS) {
        const v = (raw[s] || 0) / DIVISOR[s];
        inv[s] = v; sum += v;
      }
      if (sum <= 0) continue;                     // fielded but did nothing
      const budget = Math.max(BATTLE_MIN, Math.min(BATTLE_MAX, Math.round(sum)));
      const bag = {}; const rem = []; let used = 0;
      for (const s of STATS) {
        const exact = budget * (inv[s] / sum);
        const floor = Math.floor(exact);
        bag[s] = floor; used += floor;
        rem.push([s, exact - floor]);
      }
      rem.sort((a, b) => b[1] - a[1] || STATS.indexOf(a[0]) - STATS.indexOf(b[0]));
      for (let i = 0; used < budget; i++, used++) bag[rem[i % rem.length][0]]++;
      out[key] = bag;
    }
    return out;
  }
}

export default { Ledger, channelOf, BATTLE_MIN, BATTLE_MAX };
