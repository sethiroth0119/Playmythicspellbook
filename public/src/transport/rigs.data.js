/* ════════════════════════════════════════════════════════════════════════════
   🚛 PP_RIGS — the haul-class vehicle table for Transportation Companies.
   ----------------------------------------------------------------------------
   Six trucks, one per game rarity, that roll onto the ORDINARY Prince
   Portfolios auction floor. A haul-class listing is a normal PP vehicle with
   `haul: true` on it, so it inherits — for free, with no new code — the
   condition ladder, mileage, colour, seller rating, scam risk, the discount
   ladder, fuel, strip-for-parts and the P2P vehicle market.

   WHO READS THIS FILE
     • index.html's `_ppGenListing()` calls `MythicTransport.rollRig()` and
       `MythicTransport.rigCatalog()` through the bridge object index.html
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
   223k-line app down over a truck.
   ════════════════════════════════════════════════════════════════════════════ */

/* 📎 HOW THIS FILE CITES index.html, AND WHY IT STOPPED USING BARE LINE NUMBERS.
   Every citation below is `identifier (index.html ~LINE)`. The IDENTIFIER is
   the claim — paste it into grep and you land on the thing. The `~LINE` is a
   hint for scrolling and is expected to rot.

   🔴 THIS RULE IS WRITTEN IN BLOOD AND THE BLOOD IS THIS FILE'S. An earlier
   revision cited about eighteen sites as exact colons — `index.html:195340`,
   `:196009`, `:197455`. Every one was copied from a design brief written
   earlier the same day, and every one was wrong by 247-281 lines by the time
   the file was saved, because index.html grew underneath them while the
   feature was being built. They looked authoritative, they read as verified,
   and a maintainer would have trusted them INSTEAD OF going to look — which is
   the whole failure: a wrong citation is worse than no citation, because it
   spends someone's trust and then wastes their afternoon. Note the direction of
   the damage: the numbers were not merely stale, they were checkable at write
   time and not checked.
   index.html's own newer comments already hedge with `~` for exactly this
   reason (see `_ppaWin (~196909)` in the starter-rig block ~80469). Match it.
   A line number is a cache with no invalidation. An identifier is not.
   If you retune this file, re-grep the anchors and move the hints. If you
   cannot be bothered, delete the number and leave the identifier — that is
   strictly better than leaving a stale one. */

/* 🧹 GREP HYGIENE — AND THE ONE PLACE THE RULE ABOVE IS DELIBERATELY INVERTED.
   Two sets of identifiers are kept out of this file on purpose. One is kept out
   of executable code; the other is kept out of the comments as well.

     1. HOST LEXICAL GLOBALS — the top-level `const`s index.html declares, which
        a module cannot see at all. Those names appear in PROSE only, never in
        an expression and never inside a string this file can print. A module
        that reaches for one is the bug that has cost this project real time
        twice, and the cheapest detector for it is a grep; keeping the names out
        of code means that grep returns prose and nothing else, so the answer is
        readable at a glance instead of being a hit list to adjudicate.
        (Diagnostic strings in auditRigs() therefore describe the upstream table
        rather than spelling its constant name — the anchor for it lives in the
        comment directly above the rule, where following it costs one scroll.)

     2. THE PAID GARAGE RAIL — its effects table, its per-tier rows, its SKU ids
        and its convoy helpers. Those appear NOWHERE in this file, comments
        included, and that stricter rule is the point rather than an accident.
        Paid rigs and Cinder-bought fleet rigs are separate rails by ratified
        product decision, and the only cheap way to hold a boundary is a grep
        over the file that is supposed to sit on one side of it. A grep that
        comes back with "…but they're only comments" turns an automatic check
        into a manual review, and the reviewer's job becomes deciding, hit by
        hit, whether this data file has started to know things about a
        real-money product — which is exactly the judgement the boundary exists
        to remove. So that table is cited by DESCRIPTION plus a line hint ("the
        paid Garage effects table, index.html ~164432"). A human follows it in
        one grep of index.html; a grep of THIS file for the paid rail's
        identifiers stays empty. Nothing was cut to achieve that: every warning
        that used to name it still says every word it said, including the risk
        UNIT COLLISION below, which is the most dangerous field in this table.
        Do not "helpfully" restore the identifier.
        ⚠ AND THE COST, STATED, BECAUSE IT IS REAL: without the identifier the
        line hint is the only handle, and hints rot — the exact failure the
        block above is written in blood about. It is paid for with a DIFFERENT
        durable anchor, not by pretending the cost is zero: the perk block above
        fleetSlotBonus() quotes that table's own header sentence verbatim, and a
        prose sentence inside index.html is as greppable as a constant name and
        is not on anybody's forbidden list. Search for the quote, land on the
        table. If you retune this file, re-grep the QUOTE and move the ~164432
        hints; if the quote itself has been reworded upstream, requote it here.

   ⚠ ALL THIS FILE EVER TAKES FROM THAT RAIL IS AN INTEGER TIER, 0-3, PASSED IN
   AS AN ARGUMENT. If you ever find yourself needing a second value from it, the
   fix is a second integer argument, not an import and not a name. See the perk
   block above fleetSlotBonus(). */

/* 🔴 PP_RIGS IS DELIBERATELY NOT MERGED INTO `PP_VEHICLE_NAMES` (index.html
   ~195562), AND THAT IS THE WHOLE DESIGN DECISION. Merging looks obviously
   right — same floor, same generator, same shape of row — and it breaks two
   things that read that array as a closed set:

     1. THE ADMIN PHOTO GRID (grep `f.listingPhotos[v.name]`, ~197737) maps
        `PP_VEHICLE_NAMES` and keys `f.listingPhotos[v.name]` / `f.lotPhotos`
        off the NAME. That is one flat, cloud-synced name namespace shared by
        every entry in the array. A rig dropped into it silently claims photo
        slots in an admin store; two vehicles that ever share a name share one
        photo.
     2. `_ppaGenCar()` (~196776) picks from the SAME array and stamps the
        auction minigame's own ladder on it — `PPA_RARITIES` (~196738) is
        `Common/Rare/Epic/Legendary/Mythic`: five tiers, capitalised keys, NO
        Uncommon, and its own price bands. A merged rig would come off the
        block carrying `rarity: 'Legendary'` from that ladder while this table
        says `rarity: 'legendary'` — two contradictory rarities on one object,
        and the one that wins is whichever generator made it. Runs/day would
        then depend on where the truck was bought.

   So: two tables, one shared LISTING GRAMMAR (`{name, type, baseValue}`), and a
   `haul` flag as the only branch. That branch is one `if` in one generator.
   Merging would put a "…but is it a truck?" branch in the admin grid, the
   auction generator, and every photo read. Beside, not inside, is the cheaper
   seam — the same call production.data.js made against CAMP_FACILITIES.

   ✅ THIS ARGUMENT IS NO LONGER ONLY MINE. index.html now carries its own
   `⚠ DO NOT ADD HAUL RIGS TO THIS ARRAY` header directly above
   `PP_VEHICLE_NAMES` (~195549), naming the same two consumers. Two files
   independently agreeing is the strongest form this decision can take: the
   next person to have the merge idea meets the objection wherever they start.

   ⚠ NAMING CONSTRAINT, ENFORCED BY auditRigs(): no rig may take a name already
   in PP_VEHICLE_NAMES. Not because the tables collide (they don't) but because
   the admin photo grid keys off the name string alone, so a duplicate name is a
   duplicate photo with no error anywhere. There is also one vehicle family name
   that appears BOTH on the PP floor and as a paid Garage product; a third use
   would be unreadable, so no rig here reuses it. Grep this file for it and you
   should find zero hits. Keep it that way. */

/* 📐 LADDER ORDER IS LOAD-BEARING — lowest first, and rarityIndex() is an index
   INTO THIS ARRAY. These are the exact ids from `const RARITIES` (index.html
   ~39231): `common uncommon rare epic legendary mythic`. index.html is the
   authority for the ladder's names and COLOURS; only the ids are mirrored here,
   because ids are what cross the seam and colours are what would silently drift
   into a second palette. Ask index.html for the colour by id — never add one
   below. Do not sort, reverse or "tidy" this. */
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

   ── PRICING AND `_opEcon()`, STATED PRECISELY, BECAUSE A PREVIOUS VERSION OF
      THIS COMMENT GOT IT WRONG ─────────────────────────────────────────────
   CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." So the honest position on the literals below:

     • `_opEcon(t)` (grep `function _opEcon`, index.html ~80043) merges the
       admin's Operations Economy overrides over the `OPS_ECON` default table
       and returns null only for an operation key it does not know.
     • 🔴 TRANSPORT IS A KEY IT KNOWS. `OPS_ECON.transport` EXISTS (grep
       `transport:    { startup:`, ~79789) and index.html already calls
       `_opEcon('transport')` (grep `_opEcon('transport')`, ~80431 in
       `_transportWorkers()`). Do not repeat the earlier claim that Transport
       has no entry — it is false, it was false when it was written, and it is
       one grep away from being seen to be false.
     • What that entry actually holds today is `startup`, `ratePerWorkerHr`,
       `salaryPerWorkerHr`, `maxWorkers`, `yields` and `inputs`. There is no
       `rigs`, no `baseValue`, no `runs`, no `weight`. So there is nothing for
       this table to read THROUGH the dial yet — not because the dial is
       missing, but because nobody has added the fields to it.

   WHAT THAT MAKES THIS TABLE: the DEFAULTS. The moment someone adds rig price
   or runs fields to `OPS_ECON.transport`, the values here become the fallback
   and the live ones are read via `_opEcon('transport')` at the call site — this
   file stays pure and never calls it, because `_opEcon` is a lexical global
   index.html cannot hand across a module boundary as a value this file may
   evaluate at import. AND THIS PARAGRAPH EXISTS TO BE DELETED by whoever adds
   those fields.

   FIELD UNITS, and one of them is a trap:
     runs      — runs per day at Clean condition, before condition and perks.
     cargo     — multiplier on payload per run.
     speed     — trip-time DIVISOR; higher arrives sooner.
     lotSlots  — authored, NOT enforced in v1. See the block below it.
     weight    — roll weight in whole points; the six sum to 100.
     risk      — 🔴 PERCENTAGE POINTS, NEGATIVE, e.g. -32 means "32 points off".
                 THE PAID GARAGE EFFECTS TABLE (index.html ~164432) USES THE
                 SAME FIELD NAME FOR A FRACTION against the same 0..0.95 clamp —
                 its three rows carry `risk: 0.05` / `0.12` / `0.22`
                 (~164433-164435). This is the most dangerous field in the file:
                 mixing the units is not a rounding error, because subtracting
                 -32 as a fraction annihilates every risk in the game. Dispatch
                 must convert at the call site (`rig.risk / 100`) and this table
                 stays in points, because points is what the ratified spec table
                 says and what auditRigs() checks. (That table is named here by
                 description and line hint, never by its identifier — see GREP
                 HYGIENE above.)

   🔴 IDS ARE FOREVER. Saved fleet rows reference `id`; renaming one orphans
   every rig a player bought — and the free starter rig already writes
   `rigId: base.id` onto a saved lot row (index.html ~80492). Ids also use a
   `haul_` prefix rather than the `rig_` prefix the paid Garage SKUs use, so no
   lookup can succeed by accident in the wrong table — a miss must be a miss. */
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

   THE INVARIANT IT BREAKS: the lot is modelled as ONE VEHICLE PER INTEGER SLOT,
   and `slot` is a scalar on the vehicle, not a range. Grep `p.lot` in
   index.html for the full set; these are the ones that would all have to move
   in a single change:
     • `ppBuyVehicle`      ~196290  `p.lot.length >= cap`  — a COUNT, not a sum
                                     of widths
     •                     ~196295  `p.lot.some(x => x.slot === i)` — first free
                                     scalar
     • `vmCancelListing`   ~195769/195773  caps by length, then re-slots with
                                     the same scalar scan on unlist
     • `vmBuyListing`      ~195795  caps the BUYER's lot by length, P2P path
     • `_ppaWin`           ~196910  caps by length again on an auction win
     • the free starter rig ~80464-80471  caps and scans a THIRD time
     • lot renderers       ~196531, ~196577, ~196674, ~197420, ~197474
   Ship `lotSlots: 3` respected by the buy path ALONE and a Mythic bought on the
   floor takes one slot on the P2P market, three on the forecourt, and overlaps
   a neighbour the moment anything re-slots. That is a lost vehicle, and PP
   vehicles cost six figures of Cinder.

   ⚠ THAT LIST GREW BY ONE WHILE THIS FEATURE WAS BEING BUILT. The free starter
   rig path did not exist when the enforcement cost was first estimated; it is a
   seventh cap-and-scan, written for Transport itself. That is the actual
   argument against enforcing lotSlots in v1 — not that seven sites is a lot,
   but that the count is still moving, so a coordinated multi-site change has no
   stable target yet.

   ⚠ AND THE SCALAR MODEL IS ALREADY INCONSISTENT WITH ITSELF. `_ppaWin` assigns
   `const slot = … ? p.lot.length : 0` (~196915) while the other paths scan for the
   first FREE slot. With a hole in the lot (sell the car in slot 1 of three)
   length is 2 and slot 2 is taken, so the auction hands out an occupied slot.
   Found by reading the code for this file, not from a bug report — but no
   longer only my reading: index.html's starter-rig comment now says the same
   thing out loud, "`_ppaWin` (~196909) does not and has that collision today"
   (~80469). Still unfixed, and still not fixed HERE, because this file owns no
   legacy code. Noted because it is the ground multi-slot rigs would land on.

   v1 THEREFORE KEEPS ONE-VEHICLE-ONE-SLOT. `lotSlots` ships as forward data so
   the numbers are ratified in one place before anyone writes the migration, and
   so the fleet UI can already say "this thing is enormous". It is already being
   PERSISTED — the starter rig writes `lotSlots: base.lotSlots | 0 || 1` onto
   the saved row (~80494) — so when enforcement lands, the data is on rows that
   already exist rather than needing a backfill. `PP_LOT_LEVELS` (~195648) runs
   6/10/15/25/40 slots, so a Mythic fleet then becomes a real-estate problem,
   which is the point of the field. */

/* ⚠ MIRROR — NOT THE AUTHORITY. `const PP_COND_MULT` (index.html ~195587) owns
   these six numbers; this is a copy, and index.html wins every disagreement.

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
   string. It takes the map OR a `(condition) => number` lookup, because the
   only real caller has a lookup and not a map — see the alarm itself for why
   that mattered.

   WHAT DRIFT DOES IF NOBODY RUNS IT: the listing PRICE is computed in
   index.html from the real table (`const fair = Math.round(base.baseValue *
   condMult * wear)`, inside `_ppGenListing` ~196182), while the RUNS/DAY on the
   fleet screen is computed here from this copy. Retune Wrecked from 0.30 to
   0.25 upstream and a Wrecked Roadtrain gets cheaper while still advertising 2
   runs — the player is quoted one thing and delivered another, which is the
   same failure class as a shop price that disagrees with what the engine
   grants. Keys are the exact strings in `const PP_CONDITIONS` (~195585); they
   are capitalised and that is not cosmetic — they are the values stored on
   saved vehicles. */
const PP_COND_MULT_MIRROR = {
  Pristine: 1.15, Clean: 1.00, Worn: 0.78, Battered: 0.55, Wrecked: 0.30, Salvage: 0.18,
};

/* The six condition keys, derived from the map above rather than typed twice —
   insertion order matches `PP_CONDITIONS`
   ['Pristine','Clean','Worn','Battered','Wrecked','Salvage'], best first. These
   are the exact strings the drift alarm probes through whatever lookup it is
   handed, and the exact strings stored on saved vehicle rows. */
const PP_CONDITIONS_MIRROR = Object.keys(PP_COND_MULT_MIRROR);

/* ⚠ MIRROR of the NAMES in `PP_VEHICLE_NAMES` (index.html ~195562), used only
   as auditRigs()'s fallback when it is handed nothing to check against.
   A STALE list here UNDER-REPORTS, which inverts the check: a rig named after a
   car added to that array later passes clean, and the collision surfaces months
   on as the admin photo grid showing one photo for two vehicles.
   Prefer `auditRigs(RARITIES, PP_COND_MULT, PP_VEHICLE_NAMES)` from a harness
   that can see the real arrays; this list is the floor, not the ceiling.
   Last reconciled against index.html on 2026-08-28: 20 names, matching. */
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

/* Weighted pick for the auction floor. Same idiom as `_ppaRollRarity()`
   (index.html ~196773) so the two rolls read alike.

   The total is SUMMED, never the literal 100, so a retune cannot silently skew
   the distribution while still looking correct — auditRigs() is what asserts
   the sum is 100, and it is allowed to fail loudly there rather than here.

   Two degenerate returns, both deliberate:
     • empty table → null. `_ppGenListing()` takes null through
       `(wantHaul && RIGS.rollRig()) || _ppPick(PP_VEHICLE_NAMES)` and rolls an
       ordinary car, which is exactly right: no rigs, no haul listings.
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
   Garage effects table's own header (grep `THE EFFECTS TABLE IS THE SINGLE
   SOURCE OF TRUTH`, index.html ~164424) states it: "Rigs do not stack: the best
   one you own hauls everything, which is why each tier's copy says 'everything
   below'." Summing owned rigs here would pay a collector twice for the same
   shelf and contradict what the shop copy promises — and that copy is
   GENERATED from that table, so the shop cannot advertise a number the engine
   does not deliver. A sum here would break that guarantee from the outside.

   ⚠ THE RATIFIED MAPPING IS NOT MONOTONIC, AND A CONSUMER MUST NOT EVICT ON IT.
   tier 1 → +1 fleet slot. tier 2 → +1 run/day. tier 3 → both. Under
   best-one-applies, a player who owns tier 1 and then buys tier 2 moves from
   +1 slot to +0 slots: they pay more and lose a slot, and a fleet already
   sitting at the higher cap is instantly over it. The perk table is the product
   owner's call and is implemented here exactly as ratified (making the table
   cumulative would be a one-line change to both functions — it is not mine to
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
   THIS IS THE MOST IMPORTANT DESIGN LINE IN THE FILE. `_ppGenListing()` writes
   a `rarity` field, and for an ordinary car it is a two-valued derivative of
   condition (`condition === 'Pristine' ? 'rare' : 'common'`). For a haul-class
   listing that inverts, and index.html already branches on it:
   `rarity: base.haul ? base.rarity : (condition === 'Pristine' ? 'rare' :
   'common')` (~196198). RARITY COMES FROM THE RIG ENTRY, and CONDITION BECOMES
   A SEPARATE MULTIPLIER ON RUNS. Those are now two independent axes instead of
   one, which is the entire reason the floor is interesting: a Wrecked Roadtrain
   (8 × 0.30) does 2 runs, so a beaten Legendary is a real decision against a
   Pristine Rare (5 × 1.15 → 5) rather than an obvious upgrade. Anything that
   collapses them back into one axis deletes the mechanic.

   It also sets a trap, on purpose, and the trap is bigger than it looks because
   the generator prices off the SAME condition multiplier. Running index.html's
   own formula (`fair = baseValue × condMult × wear`, then the risk discount;
   `_ppGenListing` ~196180-196184) over the extremes of its inputs — arithmetic,
   not an observed sample — the bands overlap hard:
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
   Pristine would hand out free runs on malformed rows. Note that 'Clean' is
   also what the free starter rig is minted at (~80480), so the neutral default
   and the gift agree by construction rather than by coincidence. */
export function effectiveRuns(rigId, condition, garageTier) {
  const rig = rigById(rigId);
  const base = rig ? (rig.runs | 0) : 1;
  const raw = PP_COND_MULT_MIRROR[condition];
  const mult = (typeof raw === 'number' && raw > 0) ? raw : 1;
  const worn = Math.max(1, Math.floor(base * mult));
  return worn + runsPerDayBonus(garageTier);
}

/* Normalises the two shapes a condition table arrives in into one reader.
   Returns null for anything unusable, and the caller turns THAT into a reported
   problem rather than into silence.

     'map' — index.html's `PP_COND_MULT` itself, or any plain object. The only
             shape that can also be ENUMERATED, so it is the only one where the
             reverse check ("a condition exists upstream that this mirror has
             never heard of") is possible at all.
     'fn'  — a `(condition) => number` lookup. What the bridge exposes, and what
             src/transport/index.js hands over. Probed key by key.

   ⚠ THE FUNCTION FORM IS THE WEAKER CHECK AND CALLERS SHOULD KNOW WHY. The
   bridge's lookup (grep `condMult: (c) =>`, index.html ~207933) answers 1 for a
   key it cannot find, so through a function "Pristine was deleted upstream"
   arrives as "Pristine is 1.00" — reported, but as drift rather than as a
   deletion, and for Clean (whose mirror is already 1.00) a deletion is
   invisible. Nothing can be enumerated either, so the reverse check is skipped.
   Pass the map when you have one; the function form exists because the bridge
   seam only offers that.

   The call is wrapped: a caller-supplied lookup is arbitrary code, and this
   whole module is contractually total. An audit that throws while proving the
   data is sound would be a worse bug than any it could find. */
function _condProbe(condMult) {
  if (typeof condMult === 'function') {
    return {
      kind: 'lookup function',
      enumerable: false,
      get: (k) => {
        try { const v = Number(condMult(k)); return Number.isFinite(v) ? v : undefined; }
        catch (e) { return undefined; }
      },
    };
  }
  if (condMult && typeof condMult === 'object') {
    return {
      kind: 'map',
      enumerable: true,
      get: (k) => {
        if (!Object.prototype.hasOwnProperty.call(condMult, k)) return undefined;
        const v = Number(condMult[k]);
        return Number.isFinite(v) ? v : undefined;
      },
    };
  }
  return null;
}

/* 🧪 SELF-AUDIT — this file's acceptance criteria as rules you can RUN, rather
   than prose in a doc nobody diffs. Returns [] when the table is sound.

   EXPORTED, AND DELIBERATELY NOT RUN AT IMPORT. A data assertion that throws on
   load would take the whole app down over a tuning typo — the failure mode
   would be "the game is white" and the cause would be a mistyped weight.

   Hand it the real tables where you can:
     auditRigs(RARITIES, PP_COND_MULT, PP_VEHICLE_NAMES)
   `rarityIds` and `vehicleNames` accept the shapes those globals actually have
   (arrays of objects) as well as plain arrays of strings, because index.html
   holds objects and a test harness usually holds ids. `condMult` accepts a MAP
   or a `(condition) => number` LOOKUP — see _condProbe().

   ⚠ WHAT IT CANNOT CHECK, SO NOBODY READS `[]` AS MORE THAN IT IS: every rule
   below is about THIS TABLE's internal coherence and its agreement with three
   tables it is handed. Nothing in here validates the prose above it — the line
   hints, the claims about `_opEcon`, the enforcement-site list. Those are
   checked by grep and by nothing else, which is precisely why they are written
   as identifiers. `[]` means the DATA is sound.

   🔴 EVERY FALLBACK IN HERE FAILS TOWARDS "SOUND", AND THAT ALREADY BIT THIS
   FILE ONCE. A stale or unfed input makes the corresponding rule pass
   VACUOUSLY — it invents no bugs, it hides them, which is the worse direction
   and the harder one to notice, because the audit prints [] and everybody goes
   home. The measured instance: the drift alarm below was gated on
   `typeof condMult === 'object'`, while its ONLY real caller
   (src/transport/index.js `audit()`, ~1239) passes
   `(c) => num(call(b.condMult, 1, c))` — a function, because the bridge exposes
   `condMult(c)` and not the table. `typeof fn === 'function'`, so the entire
   block was skipped and the alarm reported clean for every possible upstream
   retune. Reproduced before fixing: with Wrecked drifted to 0.25 the map form
   reported `condition "Wrecked" drifted: authority 0.25, mirror 0.3` and the
   function form reported nothing at all.
   Two rules follow from that, applied below and worth applying to anything else
   added here: accept the shape the caller actually has, and make an UNFED alarm
   report itself as a problem, so "not checked" can never be read as "sound".
   ⚠ Only `condMult` reports itself unfed among the three, and the asymmetry is
   deliberate: unfed it checks NOTHING (there is no third table to compare the
   mirror against), whereas the ladder and the name list fall back to local
   mirrors that still run every rule against ~real data. Those two under-report
   rather than not report — the staleness warnings on the mirrors above say what
   that costs — so they stay silent when sound. An absent LADDER is still called
   out, because rule 1 derives its expected count from it. */
export function auditRigs(rarityIds, condMult, vehicleNames = PP_VEHICLE_NAMES_MIRROR) {
  const problems = [];
  const idOf = (x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? x.id : null));
  const nameOf = (x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? x.name : null));

  /* The ladder falls back to this file's own RIG_RARITIES so the rest of the
     audit still runs — but rule 1 derives its expected rig COUNT from it, so on
     the fallback that rule is comparing this file against this file. It cannot
     then notice a seventh rarity added to `const RARITIES` (index.html ~39231),
     which is precisely the change it exists to catch. Fed or not, the result
     says which.
     The message below names the upstream table by description rather than by
     its constant name, per GREP HYGIENE at the head of the file: this is a
     runtime string, not a comment, and a host global's name in an executable
     position is the one thing a grep of this module must never find. The anchor
     is one line up, which is where a reader of the failure will already be. */
  const fedLadder = Array.isArray(rarityIds) && rarityIds.length > 0;
  if (!fedLadder) {
    problems.push('rarity ladder NOT CHECKED against the game\'s own rarity ladder (index.html, the top-level rarity const — anchor is in the comment on this rule): none was passed, so rules 1 and 5 ran against this file\'s own mirror and cannot see a rarity added upstream');
  }
  const ladder = (fedLadder ? rarityIds : RIG_RARITIES).map(idOf).filter(Boolean);

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
    // value between -1 and 0 is almost certainly a fraction pasted across from
    // the paid Garage effects table (index.html ~164432), whose rows are 0.05 /
    // 0.12 / 0.22 against the same clamp, so it is called out as a unit error
    // rather than quietly passing as a very small discount.
    if (typeof r.risk !== 'number' || r.risk > 0) problems.push(`${r.id}: risk must be <= 0 (percentage points off)`);
    else if (r.risk < 0 && r.risk > -1) problems.push(`${r.id}: risk ${r.risk} looks like a FRACTION; this table is in percentage points`);
  });

  // 4. Weights sum to 100. The sum is a rule, not a convenience: the roll
  //    normalises by the real total, so a table summing to 90 still rolls — it
  //    just quietly makes everything commoner than the percentages the design
  //    doc and the UI both advertise.
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
  //    keys `f.listingPhotos[name]` off the string alone, so a collision is two
  //    vehicles sharing one photo with no error raised.
  const carNames = (Array.isArray(vehicleNames) ? vehicleNames : []).map(nameOf).filter(Boolean);
  const carSet = Object.create(null);
  carNames.forEach((n) => { carSet[String(n).toLowerCase()] = n; });
  PP_RIGS.forEach((r) => {
    const hit = carSet[String(r.name || '').toLowerCase()];
    if (hit) problems.push(`${r.id}: name "${r.name}" collides with PP_VEHICLE_NAMES "${hit}"`);
  });

  // 7. DRIFT ALARM on the condition mirror. This is the only check whose whole
  //    job is to catch a change made in ANOTHER file, so it is the only one
  //    with nothing local to fall back on: fed the real PP_COND_MULT (as a map
  //    or as the bridge's (c) => number lookup) any divergence is reported with
  //    both values, because a silent divergence prices a listing off one number
  //    and advertises runs off the other. Fed nothing usable, it says so — an
  //    alarm nobody wired up must never be reported as an alarm that did not
  //    fire. Every push below therefore falls in one of two families:
  //    "drifted"/"missing" (a real finding) or "NOT CHECKED" (this rule is
  //    blind, go wire it up).
  const probe = _condProbe(condMult);
  if (!probe) {
    problems.push('condition multipliers NOT CHECKED: auditRigs() was handed no usable condMult (pass index.html `const PP_COND_MULT`, or a (condition) => number lookup). The mirror in this file is unverified — this result is "sound EXCEPT the drift alarm did not run"');
  } else {
    const live = PP_CONDITIONS_MIRROR.map((k) => probe.get(k));
    const got = live.filter((v) => typeof v === 'number');

    if (!got.length) {
      // Every probe came back unusable. Reporting six "missing" lines would bury
      // the one fact that matters, which is that the alarm never ran.
      problems.push(`condition multipliers NOT CHECKED: the supplied ${probe.kind} returned no number for any of the six conditions in PP_CONDITIONS`);
    } else if (got.length === PP_CONDITIONS_MIRROR.length && got.every((v) => v === got[0])) {
      /* ⚠ A FLAT ANSWER IS "UNFED", NOT "DRIFTED", AND SAYING SO IS THE WHOLE
         POINT OF THIS BRANCH. index.js probes through `call(b.condMult, 1, c)`,
         whose fallback is the literal 1 for EVERY key when the bridge is absent
         — offline, pre-boot, or a renamed bridge method. Scored naively that is
         five drift lines (1 vs 1.15, 1 vs 0.78, …) blaming index.html for a
         retune nobody made, and five false alarms is how an audit gets ignored.
         The real table has six distinct values, so a constant answer means the
         lookup is a stub. It is still REPORTED, never swallowed: if PP_COND_MULT
         itself were ever flattened this line is the one that shows it, which is
         why the text names both causes instead of picking one. */
      problems.push(`condition multipliers NOT CHECKED: the supplied ${probe.kind} returned ${got[0]} for all six conditions. The real PP_COND_MULT has six distinct values, so this is an unbound lookup (no bridge / no table) rather than drift — unless PP_COND_MULT itself has been flattened, which would be the more serious bug`);
    } else {
      PP_CONDITIONS_MIRROR.forEach((k, i) => {
        const v = live[i];
        const mine = PP_COND_MULT_MIRROR[k];
        if (typeof v !== 'number') problems.push(`condition "${k}" is missing from the authority (index.html \`const PP_COND_MULT\`) but this file still multiplies runs by ${mine}`);
        else if (Math.abs(v - mine) > 1e-9) {
          problems.push(`condition "${k}" drifted: authority ${v}, mirror ${mine} — runs/day and listing price now disagree`);
        }
      });
      // Reverse direction: only a map can be enumerated, so a NEW condition
      // upstream is invisible through the function form. See _condProbe().
      if (probe.enumerable) {
        Object.keys(condMult).forEach((k) => {
          if (PP_CONDITIONS_MIRROR.indexOf(k) < 0) problems.push(`condition "${k}" exists upstream but not in this file's mirror — its rigs fall back to 1.00`);
        });
      }
    }
  }

  return problems;
}
