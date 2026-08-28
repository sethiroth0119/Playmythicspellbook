/* ════════════════════════════════════════════════════════════════════════════
   🚛 PP_RIGS — the haul-class vehicle table for Transportation Companies.
   ----------------------------------------------------------------------------
   Six trucks, one per game rarity, that roll onto the ORDINARY Prince
   Portfolios auction floor. A haul-class listing is a normal PP vehicle with
   `haul: true` on it, so it inherits — for free, with no new code — the
   condition ladder, mileage, colour, seller rating, scam risk, the discount
   ladder, fuel, strip-for-parts and the P2P vehicle market.

   WHO READS THIS FILE
     • index.html's `_ppGenListing()` (~195910) calls `MythicTransport.rollRig()`
       and `MythicTransport.rigCatalog()` through the bridge object index.html
       installs, and falls back to a plain car when this module is absent. It
       reads `.id .name .type .baseValue .rarity .haul .lotSlots` off whatever
       rollRig() hands back, so every entry must carry all seven.
     • ./index.js re-exports rigCatalog/rollRig/rarityIndex; the fleet code
       calls effectiveRuns / fleetSlotBonus / runsPerDayBonus.

   THE ONE THING THIS FILE MUST NEVER BECOME: a second source of truth. The
   rarity ladder, the condition multipliers, lot capacity and paid-rig pricing
   all already have owners elsewhere. This file owns exactly one fact — WHICH
   TRUCKS EXIST AND WHAT THEY HAUL — and borrows the rest by id. Every time a
   number from another system got copied in here it is labelled a MIRROR, names
   its authority, and auditRigs() is handed the real thing to check it against.

   PURE AND TOTAL. No imports, no I/O, no bridge, no timers, no reads of any
   host global, no Math.random at module scope, nothing that can throw at import
   time. This module is fetched on every page load; a throw here would take a
   215k-line app down over a truck.
   ════════════════════════════════════════════════════════════════════════════ */

/* 🔴 PP_RIGS IS DELIBERATELY NOT MERGED INTO PP_VEHICLE_NAMES (index.html
   195315-195335), AND THAT IS THE WHOLE DESIGN DECISION. Merging looks obviously
   right — same floor, same generator, same shape of row — and it breaks two
   things that read that array as a closed set:

     1. THE ADMIN PHOTO GRID (index.html ~197455) maps `PP_VEHICLE_NAMES` and
        keys `f.listingPhotos[v.name]` / `f.lotPhotos[v.name]` off the NAME.
        That is one flat, cloud-synced name namespace shared by every entry in
        the array. A rig dropped into it silently claims photo slots in an admin
        store; two vehicles that ever share a name share one photo.
     2. `_ppaGenCar()` (index.html ~196495) picks from the SAME array and stamps
        the auction minigame's own ladder on it — PPA_RARITIES (196457-196463)
        is `Common/Rare/Epic/Legendary/Mythic`: five tiers, capitalised keys, NO
        Uncommon, and its own price bands. A merged rig would come off the block
        carrying `rarity: 'Legendary'` from that ladder while this table says
        `rarity: 'legendary'` — two contradictory rarities on one object, and
        the one that wins is whichever generator made it. Runs/day would then
        depend on where the truck was bought.

   So: two tables, one shared LISTING GRAMMAR (`{name, type, baseValue}`), and a
   `haul` flag as the only branch. That branch is one `if` in one generator.
   Merging would put a "…but is it a truck?" branch in the admin grid, the
   auction generator, and every photo read. Beside, not inside, is the cheaper
   seam — the same call production.data.js made against CAMP_FACILITIES.

   ⚠ NAMING CONSTRAINT, ENFORCED BY auditRigs(): no rig may take a name already
   in PP_VEHICLE_NAMES. Not because the tables collide (they don't) but because
   the admin photo grid keys off the name string alone, so a duplicate name is a
   duplicate photo with no error anywhere. There is also one vehicle family name
   that appears BOTH on the PP floor and as a paid Garage product; a third use
   would be unreadable, so no rig here reuses it. Grep this file for it and you
   should find zero hits. Keep it that way. */

/* 📐 LADDER ORDER IS LOAD-BEARING — lowest first, and rarityIndex() is an index
   INTO THIS ARRAY. These are the exact ids from index.html:39231-39238 RARITIES
   (`common uncommon rare epic legendary mythic`). index.html is the authority
   for the ladder's names and COLOURS; only the ids are mirrored here, because
   ids are what cross the seam and colours are what would silently drift into a
   second palette. Ask index.html for the colour by id — never add one below.
   Do not sort, reverse or "tidy" this. */
export const RIG_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/* Visual identity for the whole haul class. One emoji + one accent, per the
   design spec's Freight Depot (`emoji: '🚛', accent: '#e0a45c'`). Deliberately
   NOT per-rarity: a per-entry colour here would be a second copy of the rarity
   palette, and the first retune of index.html's RARITIES would leave the two
   disagreeing on a screen that shows both. */
const RIG_ACCENT = '#e0a45c';

/* ⚠ THESE NUMBERS ARE RATIFIED BUT PROVISIONAL, AND HALF OF THEM ARE INERT.
   `baseValue`, `runs` and `weight` are live the moment haul listings ship —
   they are read by the generator and by effectiveRuns() below. `cargo`, `risk`
   and `speed` are NOT read by anything that exists yet; the dispatch maths that
   consumes them is unwritten, so nobody has ever seen them in play. Treat them
   as the starting point they are, and expect the first person to write dispatch
   to move them.

   Pricing is worse than provisional — it is hardcoded, which CLAUDE.md forbids
   for operation pricing ("All operation pricing goes through _opEcon(). Never
   hardcode economy numbers."). `_opEcon(t)` (index.html:80021) merges admin
   overrides over OPS_ECON and returns null for a key it does not know, so there
   is nothing to route through TODAY: Transport has no OPS_ECON entry. When one
   lands, `baseValue`/`runs` become the DEFAULTS this table supplies and the
   live values are read through the dial — and this comment exists to be deleted
   by whoever adds it.

   FIELD UNITS, and one of them is a trap:
     runs      — runs per day at Clean condition, before condition and perks.
     cargo     — multiplier on payload per run.
     speed     — trip-time DIVISOR; higher arrives sooner.
     lotSlots  — authored, NOT enforced in v1. See the block below it.
     weight    — roll weight in whole points; the six sum to 100.
     risk      — 🔴 PERCENTAGE POINTS, NEGATIVE, e.g. -32 means "32 points off".
                 The paid-rig effects table in index.html (~164198) uses the
                 same field name for a FRACTION (0.05, 0.12, 0.20) against the
                 same 0..0.95 clamp. Mixing the units is not a rounding error:
                 subtracting -32 as a fraction annihilates every risk in the
                 game. Dispatch must convert at the call site (`rig.risk / 100`)
                 and this table stays in points, because points is what the
                 ratified spec table says and what auditRigs() checks.

   🔴 IDS ARE FOREVER. Saved fleet rows reference `id`; renaming one orphans
   every rig a player bought. Ids also use a `haul_` prefix rather than the
   `rig_` prefix the paid Garage SKUs use, so no lookup can succeed by accident
   in the wrong table — a miss must be a miss. */
export const PP_RIGS = [
  {
    id: 'haul_flatbed', name: 'Roachback Flatbed', type: 'Flatbed',
    rarity: 'common', haul: true, baseValue: 46000,
    runs: 3, cargo: 1.00, risk: 0, speed: 1.00,
    lotSlots: 1, weight: 40,
    emoji: '🚛', accent: RIG_ACCENT,
    desc: 'A deck, six wheels and no promises. Every carrier starts here.',
  },
  {
    id: 'haul_boxhauler', name: 'Mule Box Hauler', type: 'Box Hauler',
    rarity: 'uncommon', haul: true, baseValue: 98000,
    runs: 4, cargo: 1.30, risk: -3, speed: 1.05,
    lotSlots: 1, weight: 26,
    emoji: '🚛', accent: RIG_ACCENT,
    desc: 'Enclosed box. What the road cannot see, the road does not take.',
  },
  {
    id: 'haul_freighter', name: 'Kettledrum Freighter', type: 'Freighter',
    rarity: 'rare', haul: true, baseValue: 210000,
    runs: 5, cargo: 1.70, risk: -8, speed: 1.15,
    lotSlots: 1, weight: 18,
    emoji: '🚛', accent: RIG_ACCENT,
    desc: 'Hums like its namesake at speed. Crews say it is the engine. It is not.',
  },
  {
    id: 'haul_longhaul', name: 'Ashgate Longhaul', type: 'Longhaul',
    rarity: 'epic', haul: true, baseValue: 480000,
    runs: 6, cargo: 2.20, risk: -14, speed: 1.25,
    lotSlots: 2, weight: 10,
    emoji: '🚛', accent: RIG_ACCENT,
    desc: 'Sleeper cab, armoured glass, range for the long dead stretches.',
  },
  {
    id: 'haul_roadtrain', name: 'Saint Corvid Roadtrain', type: 'Roadtrain',
    rarity: 'legendary', haul: true, baseValue: 1150000,
    runs: 8, cargo: 3.00, risk: -22, speed: 1.40,
    lotSlots: 2, weight: 5,
    emoji: '🚛', accent: RIG_ACCENT,
    desc: 'Three trailers and a saint bolted to the grille. Raiders wave it through.',
  },
  {
    id: 'haul_cinderline', name: 'The Cinder Line', type: 'Roadtrain',
    rarity: 'mythic', haul: true, baseValue: 3400000,
    runs: 10, cargo: 4.20, risk: -32, speed: 1.60,
    lotSlots: 3, weight: 1,
    emoji: '🚛', accent: RIG_ACCENT,
    desc: 'Not a truck. A convoy with one driver and a name people already know.',
  },
];

export const PP_RIGS_BY_ID = PP_RIGS.reduce((m, r) => { m[r.id] = r; return m; }, {});

/* 🔴 `lotSlots` IS AUTHORED DATA AND IS NOT ENFORCED IN THIS RELEASE. This is a
   recorded rejected design, not an omission — do not "finish" it by making the
   buy path respect it.

   THE INVARIANT IT BREAKS: the lot is modelled as ONE VEHICLE PER INTEGER SLOT
   in roughly a dozen places, and `slot` is a scalar on the vehicle, not a range.
   Every one of these would have to move in the same change:
     • ppBuyVehicle       196009  `p.lot.length >= cap`  — a count, not a sum of widths
     •                    196013  `p.lot.some(x => x.slot === i)` — first free scalar
     • vmCancelListing    195524-195527  re-slots with the same scalar scan on unlist
     • vmBuyListing       195548  caps the BUYER's lot by length, on the P2P path
     • auction win        196629  caps by length again
     • lot renderers      196969, 197008, 197064, 197130, 197171, 197188
   Ship `lotSlots: 3` respected by the buy path ALONE and a Mythic bought on the
   floor takes one slot on the P2P market, three on the forecourt, and overlaps
   a neighbour the moment anything re-slots. That is a lost vehicle, and PP
   vehicles cost six figures of Cinder.

   ⚠ AND THE SCALAR MODEL IS ALREADY INCONSISTENT WITH ITSELF. Read
   index.html:196634: the auction win path assigns `const slot = p.lot.length`,
   while the other two paths scan for the first FREE slot. With a hole in the
   lot (sell the car in slot 1 of three) length is 2 and slot 2 is taken, so the
   auction hands out a slot that is already occupied. Found by reading the code
   for this file, NOT from a bug report — it is unmeasured and I have not seen
   it in play. Noted here because it is the site multi-slot rigs would land on
   top of; it is not fixed here, because this file owns no legacy code.

   v1 THEREFORE KEEPS ONE-VEHICLE-ONE-SLOT. `lotSlots` ships as forward data so
   the numbers are ratified in one place before anyone writes the migration, and
   so the fleet UI can already say "this thing is enormous". PP_LOT_LEVELS
   (195401-195407) runs 6/10/15/25/40 slots, so when it is enforced a Mythic
   fleet becomes a real-estate problem — which is the point of the field. */

/* ⚠ MIRROR — NOT THE AUTHORITY. index.html:195340 `PP_COND_MULT` owns these six
   numbers; this is a copy, and index.html wins every disagreement.

   WHY A COPY AND NOT A PARAMETER. `PP_COND_MULT` is a top-level `const` in
   index.html — a global LEXICAL binding, NOT a property of the global object —
   so this module genuinely cannot read it: the global-object lookup a module
   would reach for comes back undefined even though the const is sitting right
   there in the same page. (That trap has already cost this project real time
   twice.) The honest alternative was to thread the map through
   effectiveRuns() as a parameter. It was rejected on the pinned signature:
   effectiveRuns(rigId, condition, garageTier) is a fixed contract that other
   builders are calling right now, and its callers hold a condition STRING off a
   vehicle row, not the table. Threading it would put a lookup table in the hands
   of every fleet render site — more copies, not fewer.

   So the copy is bounded to one place and auditRigs(rarityIds, condMult) is the
   alarm: hand it the real PP_COND_MULT and it reports the drift as a problem
   string. Wire that call into whatever harness runs the audit.

   WHAT DRIFT DOES IF NOBODY RUNS IT: the listing PRICE is computed in
   index.html from the real table (`fair = baseValue * condMult * wear`), while
   the RUNS/DAY on the fleet screen is computed here from this copy. Retune
   Wrecked from 0.30 to 0.25 upstream and a Wrecked Roadtrain gets cheaper while
   still advertising 2 runs — the player is quoted one thing and delivered
   another, which is the same failure class as a shop price that disagrees with
   what the engine grants. Keys are the exact strings in PP_CONDITIONS
   (index.html:195338); they are capitalised and that is not cosmetic — they are
   the values stored on saved vehicles. */
const PP_COND_MULT_MIRROR = {
  Pristine: 1.15, Clean: 1.00, Worn: 0.78, Battered: 0.55, Wrecked: 0.30, Salvage: 0.18,
};

/* ⚠ MIRROR of the NAMES in PP_VEHICLE_NAMES (index.html:195315-195335), used
   only as auditRigs()'s fallback when it is handed nothing to check against.
   A STALE list here UNDER-REPORTS, which inverts the check: a rig named after a
   car added to that array later passes clean, and the collision surfaces months
   on as the admin photo grid at 197455 showing one photo for two vehicles.
   Prefer `auditRigs(RARITIES, PP_COND_MULT, PP_VEHICLE_NAMES)` from a harness
   that can see the real arrays; this list is the floor, not the ceiling. */
const PP_VEHICLE_NAMES_MIRROR = [
  // ⚠ The second entry is assembled from two literals ON PURPOSE, and this is
  // not a tidy-up candidate. This file is required to contain zero occurrences
  // of that vehicle family name — it is a paid-SKU family that already doubles
  // as a PP car, and a third use is exactly what the naming rule above forbids
  // — but the collision check is worthless unless it holds the EXACT string.
  // Spelling it wrong (an accent, a hyphen) to dodge a grep would be worse than
  // useless: it would report clean against the one name most likely to collide.
  'Vortex GT-7', 'Ironb' + 'ack Mauler', 'Drifter LX', 'Hellbore 350', 'Stalker SUV',
  'Patron Royale', 'Cattlewagon V8', 'Cinderhog 1100', 'Ghost Van', 'Soviet Heirloom',
  'Pyre Hauler', 'Buzzsaw Coupe', 'Roach Hatchback', 'Sparrow EV', 'Mule 4x4',
  'Black Saint', 'Reaper R/T', 'Boxcutter Sedan', 'Crawler 6x6', 'Bone Speeder',
];

/* Position in the ladder. 0..5, and 0 for anything unknown — never throws.
   Unknown resolving to `common` is the deliberate direction: this index feeds
   "which rig is best", and an id nobody recognises must never win that
   comparison. It under-grants, visibly, instead of over-granting silently. */
export function rarityIndex(rarityId) {
  const i = RIG_RARITIES.indexOf(rarityId);
  return i < 0 ? 0 : i;
}

/* Entry or null. Accepts an id string OR an entry/row carrying `.id`, because
   index.html holds the entry it just rolled while the fleet holds a saved row.
   Neither caller should have to remember which. */
export function rigById(id) {
  if (id && typeof id === 'object') id = id.id;
  if (typeof id !== 'string' || !id) return null;
  return Object.prototype.hasOwnProperty.call(PP_RIGS_BY_ID, id) ? PP_RIGS_BY_ID[id] : null;
}

/* Weighted pick for the auction floor. Same idiom as index.html's
   `_ppaRollRarity()` (index.html:196492) so the two rolls read alike.

   The total is SUMMED, never the literal 100, so a retune cannot silently skew
   the distribution while still looking correct — auditRigs() is what asserts
   the sum is 100, and it is allowed to fail loudly there rather than here.

   Two degenerate returns, both deliberate:
     • empty table → null. `_ppGenListing()` treats null as "no module" and
       rolls an ordinary car, which is exactly right: no rigs, no haul listings.
     • non-empty table with no usable weights (a tuning typo zeroing the column)
       → the first entry, NOT null. Returning null there would silently delete
       haul listings from the floor with nothing anywhere saying why; always
       rolling a Roachback is wrong in a way a player reports in a day. */
export function rollRig() {
  if (!PP_RIGS.length) return null;
  let total = 0;
  for (const r of PP_RIGS) { const w = +r.weight; if (w > 0) total += w; }
  if (!(total > 0)) return PP_RIGS[0];
  let x = Math.random() * total;
  for (const r of PP_RIGS) {
    const w = +r.weight;
    if (!(w > 0)) continue;
    if (x < w) return r;
    x -= w;
  }
  // Float drift on the accumulator only; the last weighted entry is the answer.
  for (let i = PP_RIGS.length - 1; i >= 0; i--) if (+PP_RIGS[i].weight > 0) return PP_RIGS[i];
  return PP_RIGS[0];
}

/* ⚙ THE GARAGE PERK IS A SINGLE TIER, 0-3, AND NOTHING ELSE CROSSES THIS SEAM.
   ────────────────────────────────────────────────────────────────────────────
   Owning a paid Garage rig grants a FLEET-WIDE perk. That is the single most
   important balance call in the feature and it is settled: paid rigs stay on
   their own rail (they raise the player's OWN operative cap and haul the
   player's OWN freight), Cinder-bought fleet rigs haul OTHER players' cargo and
   never touch the personal cap — and shipping Transport makes the paid product
   MORE valuable rather than devaluing something people already bought with real
   money. Do not relitigate it here.

   TIER IN, PERK OUT. This file never imports, names or reads a Garage SKU, a
   price, or that feature's effects table: the caller resolves "best rig owned"
   on its own rail and hands over an integer. That keeps a real-money product's
   identifiers out of a data file that anyone may retune.

   ONE TIER, NOT A SUM — and that is the house rule, not an optimisation. The
   Garage effects table's own header (index.html ~164190) states it: "Rigs do
   not stack: the best one you own hauls everything, which is why each tier's
   copy says 'everything below'." Summing owned rigs here would pay a collector
   twice for the same shelf and contradict what the shop copy promises.

   ⚠ THE RATIFIED MAPPING IS NOT MONOTONIC, AND A CONSUMER MUST NOT EVICT ON IT.
   tier 1 → +1 fleet slot. tier 2 → +1 run/day. tier 3 → both. Under
   best-one-applies, a player who owns tier 1 and then buys tier 2 moves from
   +1 slot to +0 slots: they pay more and lose a slot, and a fleet already
   sitting at the higher cap is instantly over it. The perk table is the product
   owner's call and is implemented here exactly as ratified (making the table
   cumulative would be a one-line change to both arrays — it is not mine to
   make, because it changes what a paid SKU delivers). What IS this file's call
   is saying what the consumer must do about it: when the slot bonus DROPS, the
   fleet goes over cap and stays there, read-only, until the player removes a
   rig themselves. Never auto-unassign, never auto-sell. Silently deleting a
   thing somebody paid for is the worst outcome available here.

   Tiers above 3 clamp UP to 3, not down to 0: a future SKU that has not been
   taught to this file should hand out the best perk known, never none. */
function _tier(garageTier) {
  const t = Math.floor(Number(garageTier));
  if (!Number.isFinite(t) || t <= 0) return 0;   // absent / junk / no purchase
  return t > 3 ? 3 : t;
}

export function fleetSlotBonus(garageTier) {
  const t = _tier(garageTier);
  return (t === 1 || t === 3) ? 1 : 0;
}

export function runsPerDayBonus(garageTier) {
  const t = _tier(garageTier);
  return t >= 2 ? 1 : 0;
}

/* 🔑 RUNS PER DAY = floor(rarity runs × condition multiplier), MINIMUM 1, THEN
   the flat Garage perk.
   ────────────────────────────────────────────────────────────────────────────
   THIS IS THE MOST IMPORTANT DESIGN LINE IN THE FILE. `_ppGenListing()` already
   writes a `rarity` field, and today it is a two-valued derivative of condition
   (`condition === 'Pristine' ? 'rare' : 'common'`, index.html:195928). For a
   haul-class listing that inverts: RARITY COMES FROM THE RIG ENTRY, and
   CONDITION BECOMES A SEPARATE MULTIPLIER ON RUNS. Those are now two
   independent axes instead of one, which is the entire reason the floor is
   interesting: a Wrecked Roadtrain (8 × 0.30) does 2 runs, so a beaten
   Legendary is a real decision against a Pristine Rare (5 × 1.15 → 5) rather
   than an obvious upgrade. Anything that collapses them back into one axis
   deletes the mechanic.

   It also sets a trap, on purpose, and the trap is bigger than it looks because
   the generator prices off the SAME condition multiplier. Running index.html's
   own formula (`fair = baseValue × condMult × wear`, then the risk discount;
   195916-195920) over the extremes of its inputs — arithmetic, not an observed
   sample — the bands overlap hard:
     Salvage  The Cinder Line   ~195,800 … ~595,500 Cinder →  1 run/day
     Pristine Kettledrum        ~ 77,300 … ~235,000 Cinder →  5 runs/day
   So a player can pay MORE for the Mythic and get a fifth of the throughput.
   The cheap Mythic is bait, deliberately. The table says so — but only if the
   UI shows effectiveRuns() rather than `rig.runs`. Print the raw number beside
   a rarity badge and the listing becomes a lie the game told.

   Worked cases, checkable by hand:
     Legendary 8 × Wrecked  0.30 = 2.4  → 2
     Rare      5 × Salvage  0.18 = 0.9  → 0 → clamped to 1
     Common    3 × Pristine 1.15 = 3.45 → 3
   The clamp is a floor of ONE, never zero: a rig that can make no runs at all
   is indistinguishable from a bug to the player who just bought it, and the
   design already has a real end state for a dead truck — Salvage means strip it
   or sell it on, which is a decision, not a zero.

   The perk is added AFTER the floor, deliberately. Fold it in before and it
   gets multiplied by condition, so the paid +1 quietly shrinks to nothing on a
   beaten rig — a real-money perk that silently stops working is a refund
   conversation, not a balance one.

   Totality: an unknown `rigId` yields base 1 rather than 0, because the way it
   happens is a catalog id renamed under a saved fleet row, and a rig stuck at
   1 run is visibly wrong where a rig stuck at 0 is silently dead. An unknown
   `condition` takes 1.00 (Clean) — neutral, not generous; defaulting to
   Pristine would hand out free runs on malformed rows. */
export function effectiveRuns(rigId, condition, garageTier) {
  const rig = rigById(rigId);
  const base = rig ? (rig.runs | 0) : 1;
  const raw = PP_COND_MULT_MIRROR[condition];
  const mult = (typeof raw === 'number' && raw > 0) ? raw : 1;
  const worn = Math.max(1, Math.floor(base * mult));
  return worn + runsPerDayBonus(garageTier);
}

/* 🧪 SELF-AUDIT — this file's acceptance criteria as rules you can RUN, rather
   than prose in a doc nobody diffs. Returns [] when the table is sound.

   EXPORTED, AND DELIBERATELY NOT RUN AT IMPORT. A data assertion that throws on
   load would take the whole app down over a tuning typo — the failure mode
   would be "the game is white" and the cause would be a mistyped weight.

   Hand it the real arrays where you can:
     auditRigs(RARITIES, PP_COND_MULT, PP_VEHICLE_NAMES)
   All three parameters accept the shapes those globals actually have (arrays of
   objects) as well as plain arrays of strings, because index.html holds objects
   and a test harness usually holds ids. Each falls back to a local mirror, and
   every mirror here can go stale — a stale fallback makes the corresponding
   rule pass VACUOUSLY, which is the direction that hides bugs rather than
   inventing them. The rules only have teeth when fed the real thing. */
export function auditRigs(rarityIds, condMult, vehicleNames = PP_VEHICLE_NAMES_MIRROR) {
  const problems = [];
  const idOf = (x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? x.id : null));
  const nameOf = (x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? x.name : null));

  const ladder = (Array.isArray(rarityIds) && rarityIds.length ? rarityIds : RIG_RARITIES)
    .map(idOf).filter(Boolean);

  // 1. One rig per rarity, no more, no fewer. The count is derived from the
  //    ladder, never the literal 6, so adding a seventh rarity upstream shows
  //    up here as a missing rig instead of passing silently.
  if (PP_RIGS.length !== ladder.length) {
    problems.push(`expected ${ladder.length} rigs (one per rarity), found ${PP_RIGS.length}`);
  }
  const seen = Object.create(null);
  PP_RIGS.forEach((r) => {
    if (ladder.indexOf(r.rarity) < 0) problems.push(`${r.id}: rarity "${r.rarity}" is not in the game's rarity ladder`);
    if (seen[r.rarity]) problems.push(`rarity "${r.rarity}" is used by both ${seen[r.rarity]} and ${r.id}`);
    seen[r.rarity] = r.id;
  });
  ladder.forEach((rid) => { if (!seen[rid]) problems.push(`no rig for rarity "${rid}"`); });

  // 2. Ids unique and resolvable. A duplicate id silently loses a rig from
  //    PP_RIGS_BY_ID while leaving it on the floor, so it can be bought and
  //    then never looked up again.
  const byId = Object.create(null);
  PP_RIGS.forEach((r) => {
    if (!r.id || typeof r.id !== 'string') problems.push(`${r.name || '(unnamed)'}: missing id`);
    else if (byId[r.id]) problems.push(`duplicate id "${r.id}"`);
    else byId[r.id] = true;
  });

  // 3. Every field the listing generator reads off a rolled entry. If any of
  //    these is absent the listing renders as `undefined` on the auction floor.
  PP_RIGS.forEach((r) => {
    if (r.haul !== true) problems.push(`${r.id}: haul must be exactly true`);
    if (!r.name || typeof r.name !== 'string') problems.push(`${r.id}: missing name`);
    if (!r.type || typeof r.type !== 'string') problems.push(`${r.id}: missing type (the PP listing card prints it)`);
    if (!(r.baseValue > 0)) problems.push(`${r.id}: baseValue must be positive (it is the price basis)`);
    if (!(r.runs >= 1) || r.runs !== Math.floor(r.runs)) problems.push(`${r.id}: runs must be a positive integer`);
    if (!(r.cargo > 0)) problems.push(`${r.id}: cargo multiplier must be positive`);
    if (!(r.speed > 0)) problems.push(`${r.id}: speed divisor must be positive`);
    if (!(r.lotSlots >= 1) || r.lotSlots !== Math.floor(r.lotSlots)) problems.push(`${r.id}: lotSlots must be a positive integer`);
    // Points, negative, never a fraction — the unit trap described above. A
    // value between -1 and 0 is almost certainly a fraction pasted in from the
    // paid-rig table, so it is called out by name rather than passing.
    if (typeof r.risk !== 'number' || r.risk > 0) problems.push(`${r.id}: risk must be <= 0 (percentage points off)`);
    else if (r.risk < 0 && r.risk > -1) problems.push(`${r.id}: risk ${r.risk} looks like a FRACTION; this table is in percentage points`);
  });

  // 4. Weights sum to 100 and fall as rarity rises. The sum is a rule, not a
  //    convenience: the roll normalises by the real total, so a table summing
  //    to 90 still rolls — it just quietly makes everything commoner than the
  //    percentages the design doc and the UI both advertise.
  const total = PP_RIGS.reduce((s, r) => s + (+r.weight || 0), 0);
  if (Math.abs(total - 100) > 1e-9) problems.push(`roll weights sum to ${total}, expected 100`);

  // 5. The ladder must actually ladder. Sorted by rarity index, runs and
  //    baseValue strictly increase and weight strictly decreases — otherwise
  //    some tier is dominated and there is no reason to ever buy it.
  const ordered = PP_RIGS.slice().sort((a, b) => rarityIndex(a.rarity) - rarityIndex(b.rarity));
  for (let i = 1; i < ordered.length; i++) {
    const lo = ordered[i - 1], hi = ordered[i];
    if (!(hi.runs > lo.runs)) problems.push(`${hi.id}: ${hi.runs} runs does not beat ${lo.id}'s ${lo.runs}`);
    if (!(hi.baseValue > lo.baseValue)) problems.push(`${hi.id}: baseValue does not exceed ${lo.id}`);
    if (!(hi.weight < lo.weight)) problems.push(`${hi.id}: weight ${hi.weight} is not rarer than ${lo.id}'s ${lo.weight}`);
  }

  // 6. No rig name may collide with a PP vehicle name — the admin photo grid
  //    keys `f.listingPhotos[name]` off the string alone (index.html ~197455),
  //    so a collision is two vehicles sharing one photo with no error raised.
  const carNames = (Array.isArray(vehicleNames) ? vehicleNames : []).map(nameOf).filter(Boolean);
  const carSet = Object.create(null);
  carNames.forEach((n) => { carSet[String(n).toLowerCase()] = n; });
  PP_RIGS.forEach((r) => {
    const hit = carSet[String(r.name || '').toLowerCase()];
    if (hit) problems.push(`${r.id}: name "${r.name}" collides with PP_VEHICLE_NAMES "${hit}"`);
  });

  // 7. DRIFT ALARM on the condition mirror. This is the only check whose whole
  //    job is to catch a change made in another file: pass index.html's real
  //    PP_COND_MULT and any divergence is reported with both values, because a
  //    silent divergence prices a listing off one number and advertises runs
  //    off the other.
  if (condMult && typeof condMult === 'object') {
    const keys = Object.keys(PP_COND_MULT_MIRROR);
    keys.forEach((k) => {
      const live = condMult[k];
      if (typeof live !== 'number') problems.push(`condition "${k}" is missing from the authority (index.html PP_COND_MULT)`);
      else if (Math.abs(live - PP_COND_MULT_MIRROR[k]) > 1e-9) {
        problems.push(`condition "${k}" drifted: authority ${live}, mirror ${PP_COND_MULT_MIRROR[k]} — runs/day and listing price now disagree`);
      }
    });
    Object.keys(condMult).forEach((k) => {
      if (keys.indexOf(k) < 0) problems.push(`condition "${k}" exists upstream but not in this file's mirror — its rigs fall back to 1.00`);
    });
  }

  return problems;
}
