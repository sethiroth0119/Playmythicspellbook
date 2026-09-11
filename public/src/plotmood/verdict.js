/* ════════════════════════════════════════════════════════════════════════════
   🙂 PLOT VERDICT — the number behind the face, before any face exists.
   Registers window.MythicPlotVerdict.
   ----------------------------------------------------------------------------
   The ask is Cities: Skylines 2's floating status icons: a frowning house with
   a water drop over it means THAT house has no water. The icon states a REASON,
   not a mood in the abstract.

   This is the half of that with no pixels in it. It answers ONE question for
   ONE tile —

       MythicPlotVerdict.at(x, z)
         -> { score 0..100, face, reason, terms[], sources }

   — and `terms` is a SIGNED CAUSAL LIST that sums to `score` EXACTLY. That
   shape is copied deliberately from MythicLandValue.terms() and
   MythicPollution.explainAt(): a breakdown whose rows do not sum to the total
   they are breaking down is worse than no breakdown, and this project has twice
   had to tear a decorative happiness meter out of a shipped panel. The rule
   that makes this one different is stated once and obeyed everywhere below:

   🔴 EVERY TERM TRACES TO A NUMBER THE CITY ALREADY COMPUTES. Not one weight
      here invents a fact. `game.cov.pct` (the eight NEEDS), `t.damaged`,
      `t.wear`, `insHalted(t)`, `t.svcFed`, `staffingRatio()`, `pwFactorOf()`,
      `wtFactor()`, MythicPollution's exposure response, MythicLandValue's band,
      MythicDemographics' rent burden, and the economy's own
      `Bottleneck.diagnose(firm)` — that is the entire input set. What this file
      owns is the WEIGHTS (`PV` below) and nothing else. A face that is not
      reading a real value is the single worst outcome this feature can have.

   🔴 IT IS READ-ONLY, AND NOT JUST BY CONVENTION. There is no assignment to
      `game`, to any tile, to `game.cov`, to `wellbeing`, or to anything the
      host hands over. That matters because of a loop that already exists:
      coverage feeds morale (citMoodTarget), morale feeds the venue/leisure loop
      at node-city :26448/:33500, and that loop is today damped ONLY by caps. A
      mood that fed back into computeCoverage() would close a third circuit
      through the same damping, and there would be no way to tell a city that is
      genuinely unhappy from one that is oscillating.
      ⚠ REJECTED, and written down because it is the obvious next ask: "let a
        sad block lower its own coverage so unhappiness spreads". No. That is
        the feedback loop above with a different name on it. This layer READS
        the city and is never read BY it — nothing in any tick, payout or
        coverage pass calls anything in this file.

   🔴 A MISSING MODULE CONTRIBUTES EXACTLY 0 AND SAYS SO. Never a plausible
      substitute. /src/landvalue/field.js:41 calls this the branch's most
      expensive lesson: "a guarded read that silently substitutes a plausible
      value is indistinguishable from a working integration". So every optional
      read below produces a term of exactly 0 with `live:false` and a `dead`
      sentence, and `sources()` publishes which of the six optional sources
      answered plus the exact list of term keys that are therefore zeroed. A
      driver stubs a module absent and asserts BOTH halves.

   🔴 NULL AND 0 ARE DIFFERENT ANSWERS ABOUT POWER, and the host says so at
      index.html :26303: `pwFactorOf()` returns null for "the ladder has no
      opinion about this building" and 0 for "the grid gave it nothing". A
      `|| 1` anywhere near it collapses a blackout into a clean bill of health.
      `powerRead()` tests `Number.isFinite`, never truthiness.

   ── ⚠ WHERE THIS FILE LIVES, AND WHY IT IS NOT index.js ────────────────────
   `/src/plotmood/index.js` was ALREADY TAKEN when this landed: a sibling piece
   owns it and `window.MythicPlotMood` for the world-space glyph layer, and
   node-city's own host half (`plotMoodCtx` / `plotMoodAt`, :31226/:31273) calls
   `PM.evaluate(ctx)` — a method that object does not currently carry, so the 😟
   card is dead in the tree as it stands. Overwriting either would have deleted
   another agent's round. So:
     · this file is NEW and collides with nothing;
     · it registers its own global, `window.MythicPlotVerdict`;
     · it exposes `evaluate(ctx)` in the exact shape node-city's card already
       reads, and ATTACHES that one method to `window.MythicPlotMood` only when
       that object exists and does not already have one (see the bottom of the
       file). Additive, guarded, and it defers the moment the owner ships their
       own — so a merge is a one-line decision rather than a conflict.

   ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
     ✗ It does not draw. Not one line of THREE, not one canvas. When the glyph
       lands it must follow /src/water/overlay.js and /src/power/overlay.js —
       ONE mesh and a single CanvasTexture, not a mesh per tile — because a
       24×24 grid is 576 potential draws and both of those headers say why.
     ✗ It does not lengthen NEEDS and does not touch citMoodTarget/ctTerms.
       Those two are cross-checked by ctHtml, which SILENTLY DROPS the whole
       "what that mood is made of" breakdown when they disagree by a tenth of a
       point.
     ✗ It has NO SAVE FIELD. Every fact is derived from state that is already
       persisted — the same contract /src/dossier and /src/landvalue ship under.

   ── THE RAMP, AND WHY IT RIDES EVERY ROW ───────────────────────────────────
   `game.cov.ramp` blends every coverage figure from a neutral 100% over
   DEMAND_RAMP_SEC (180 s) from load — so for three minutes after a load a city
   with no farms reads FED. That is correct for the vitals card (it is
   grandfathering) and it is a trap for this feature, because a screenshot taken
   in that window is a street of smiling houses that are about to starve. So
   `ramping` and `rampLeftSec` ride every answer and head every sweep. A fresh
   city must not be photographable as falsely happy without the photograph
   saying so.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── THE WEIGHTS, AND THE ONE THING THIS FILE OWNS ──────────────────────────
   Every number below is a WEIGHT — how many points off 100 a fully failed input
   costs. None is a fact about the city; the facts are read live. Gathered here
   rather than inlined for the reason /src/landvalue and /src/pollution gather
   theirs: a weight written down twice is a weight that will disagree with
   itself.

   ⚠ THE HOME AND SHOP LADDERS DO NOT SUM TO THE SAME TOTAL, ON PURPOSE. They
     are not two views of one score — CS2 judges a shop and a house by different
     rules (a shop cares about customers and access; a home about services, rent
     and the air) and so does this. Neither is normalised: a plot with three
     things wrong SHOULD be able to bottom out, and rescaling so the worst case
     lands exactly on zero would mean every weight moved whenever a term was
     added. The `clamp` row is the honest way to show an overflow, and it is
     visible in the breakdown when it fires. */
export const PV = {
  base: 100,

  /* Per-tile truth. Charged for EVERY kind, because these are facts about the
     structure rather than opinions about the neighbourhood. */
  any: {
    damaged: 45,      // t.damaged — the building has failed outright
    wear:    12,      // t.wear 0..100, decayTick's own counter, pro rata
    power:   18,      // (1 - powerFactor), home ladder. Shops pay more, below.
    ground:   6,      // wtFactor(k) below 1 — thin aquifer under this plot
  },

  /* 🏡 A HOME. Six of the eight NEEDS, weighted the way node-city already
     weights them elsewhere: food and water are emergencies, light and deathcare
     are complaints. Deathcare is 4 for exactly the reason citMoodTarget gives
     it 0.05 — "a city with no graveyard is short of a civic service, not
     starving". */
  home: {
    food: 16, water: 16, health: 12, safety: 12, light: 8, deathcare: 4,
    pollution: 20,    // MythicPollution response 0..1 — the strongest single
                      // thing that can be wrong with an address
    rent: 10,         // the LAND: MythicLandValue band index, normalised
    afford: 14,       // the HOUSEHOLD: MythicDemographics rentBurden
  },
  /* 🏪 A SHOP / OFFICE / WORKS. Judged on whether the business can trade.
     `customers` is the largest because "no customers" is the CS2 icon this
     ruleset exists to be able to draw, and because it is the one failure a
     player cannot diagnose by looking at the building. */
  shop: {
    power: 22,        // a dark shop is shut; a dark house is merely unpleasant
    customers: 22,    // firm.idleForDemand — the economy's own idle fraction
    inputs: 16,       // the binding constraint out of Bottleneck.diagnose
    stock: 18,        // t.svcFed — what the service pre-pass actually delivered
    staff: 20,        // staffingRatio() on a building that declares `crew`
    halted: 25,       // insHalted(t) — an input at zero, so it made nothing
    broke: 20,        // rung BANKRUPT / cause NO_CASH
    pollution: 10,    // a shop minds the air less than the people upstairs do
    address: 8,       // BONUS, not a penalty: a good band is footfall
  },

  /* Where a rent burden stops being comfortable and where it becomes eviction.
     Both read off /src/demographics' own figure (rent / income per economic
     day); pipeline.js step 2 uses the same ratio to decide who leaves, so these
     are the shoulders of a curve the city already walks. */
  rent: { easy: 0.30, hard: 0.70 },

  /* The five faces. `at` is the FLOOR of the band, tested top down; the last
     one is unbounded so 0 and 100 both land somewhere. */
  faces: [
    { id: 'glad',    at: 80,   ico: '😄', label: 'Thriving' },
    { id: 'content', at: 60,   ico: '🙂', label: 'Content' },
    { id: 'meh',     at: 40,   ico: '😐', label: 'Getting by' },
    { id: 'unhappy', at: 20,   ico: '🙁', label: 'Unhappy' },
    { id: 'angry',   at: -1e9, ico: '😠', label: 'Furious' },
  ],

  /* A term must cost at least this much before it is allowed to BE the reason.
     Without it a plot at 99.8 gets a frowning cause printed over it because one
     need read 0.999 — which is how a status icon becomes noise. */
  reasonFloor: 1.5,
};

/* ── THE REASONS ────────────────────────────────────────────────────────────
   🔴 A FROWN MUST BE ACTIONABLE. Every id carries a `fix` naming a thing the
   player can build or do. "Unhappy" with no cause is a happiness bar with extra
   steps.
   ⚠ The fixes are TYPED HERE, and that is a deliberate narrow exception to this
     codebase's "derive it, never retype it" rule. node-city's own
     demogGrowth().fixFor derives its advice from BUILDINGS' svc.need and is the
     right pattern where a need maps to a building; half of these (no customers,
     high rent, understaffed, out of cash) map to no building at all, so there
     is nothing to derive from. The six that DO map to a service keep the same
     icons NEED_META uses, so the card and the vitals row agree by eye. */
export const REASONS = {
  ok:           { ico: '🙂', label: 'Nothing wrong here', fix: '' },
  site:         { ico: '🏗', label: 'Still going up', fix: 'Nothing stands here yet.' },
  damaged:      { ico: '🧯', label: 'Wrecked', fix: 'Repair it — a damaged building produces nothing at all.' },
  worn:         { ico: '🏚', label: 'Falling apart', fix: 'It needs maintenance before wear reaches 100 and it fails.' },
  no_power:     { ico: '⚡', label: 'No power', fix: 'Generation is short of demand. Build a plant, or run cable to this block.' },
  no_food:      { ico: '🍱', label: 'Nothing to eat nearby', fix: 'Build a Farm, a Grocery or a Food Truck.' },
  no_water:     { ico: '💧', label: 'No water', fix: 'Build a Purifier or a Water Station.' },
  no_health:    { ico: '🩹', label: 'No clinic in reach', fix: 'Build a Clinic.' },
  no_safety:    { ico: '🛡️', label: 'Nobody is keeping order', fix: 'Build a Police Station or a Fire Station.' },
  no_light:     { ico: '💡', label: 'Dark streets', fix: 'Build Streetlights on this block.' },
  no_deathcare: { ico: '🪦', label: 'Nowhere to bury the dead', fix: 'Build a Graveyard.' },
  dry_ground:   { ico: '🕳', label: 'Thin ground water', fix: 'The aquifer under this plot is poor — open the 💧 Water panel.' },
  polluted:     { ico: '☁', label: 'Poisoned air', fix: 'Shut the source, or move it downwind — open the ☁ Pollution panel.' },
  high_rent:    { ico: '💸', label: 'Expensive address', fix: 'This land is dear. Cheaper plots are away from the amenities.' },
  cant_afford:  { ico: '🧾', label: 'They cannot afford to live here', fix: 'Rent is above what these households earn. Better jobs, or cheaper land.' },
  no_customers: { ico: '💤', label: 'No customers', fix: 'Nobody is buying. It needs footfall — housing nearby, and a road to it.' },
  no_input:     { ico: '📦', label: 'Starved of inputs', fix: 'Its suppliers are short. Trace the chain upstream.' },
  understocked: { ico: '🥫', label: 'Understocked', fix: 'The service pre-pass could not deliver its inputs.' },
  understaffed: { ico: '👷', label: 'Understaffed', fix: 'Hire workers, or build housing so there are some.' },
  broke:        { ico: '💸', label: 'Out of cash', fix: 'It cannot pay for inputs or wages. It is failing, not blocked.' },
  bad_address:  { ico: '🏚', label: 'A poor pitch', fix: 'Low-value land draws no trade. Raise it — frontage, amenity, transit.' },
};

/* ── STATE ─────────────────────────────────────────────────────────────────
   `H` is the hand-over from node-city. THE GLOBALS TRAP (CLAUDE.md): `game`,
   `BUILDINGS`, `key`, `bldSite`, `insHalted`, `pwFactorOf`, `wtFactor`,
   `staffingRatio` and `isRoadTile` are top-level `const` in node-city's module
   script — LEXICAL bindings, invisible to an ES module. `mount(ctx)` IS the
   hand-over and every member of it is a READER.
   The six OPTIONAL sources are different: MythicPollution, MythicLandValue,
   MythicDemographics, MythicTenants, MythicEconomy and MythicZoning are real
   `window` properties, so they are read off `window` at call time — which is
   also what lets a driver delete one mid-session and prove the zero. */
let H = null;
let mounted = false;

/* Which optional source answered on the LAST call. Rebuilt per call rather than
   cached: a module can 404, and a module can also mount late, and a cached
   "dead" would outlive the truth. */
let LIVE = freshLive();
function freshLive() {
  return { pollution: null, landvalue: null, demographics: null,
           tenants: null, economy: null, zoning: null, power: null, water: null };
}

const cl01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/* /src/landvalue's band count, asked ONCE. `bands()` compiles a tenant set per
   band and is far too expensive to call per tile — but the count is what
   normalises the band index to 0..1, and hardcoding 5 would make this file lie
   the day a sixth band lands. Asked once, and re-asked if the module was not up
   the first time. */
let _bandN = 0;
function bandCount(L) {
  if (_bandN > 0) return _bandN;
  try { const b = L.bands(); if (b && b.length) _bandN = b.length; } catch (e) {}
  return _bandN > 0 ? _bandN : 5;
}

/* ── CLASSIFYING A TILE ─────────────────────────────────────────────────────
   Home, shop or civic — and NOT from a list of type names retyped in this file.
     1. /src/zoning's live zone under the tile, if the player painted one.
        `ZONE_BY_ID[id].cat` is 'res' | 'com' | 'off' | 'ind'.
     2. else /src/zoning's ADOPT_BY_TYPE, the SHIPPED grandfather map from
        building type to zone — the only authored type→category table there is.
     3. else `def.popCap` — node-city's own test for "people live here", which
        is the same one pmKindOf() (:31137) uses. Derived from the row, so a new
        residential building is classified correctly with no edit here.
     4. else 'civic'.
   ⚠ A PAINTED ZONE BEATS THE BUILDING'S OWN ADOPTION ROW, because re-zoning is
     the player saying what this land is for and the building will follow on the
     next develop pass. */
function kindOf(x, z, t, def) {
  let cat = null;
  try {
    const Z = window.MythicZoning;
    if (Z && Z.zoneAt) {
      LIVE.zoning = 'live';
      const id = Z.zoneAt(x, z);
      const d = (id && Z.ZONE_BY_ID) ? Z.ZONE_BY_ID[id] : null;
      if (d && d.cat) cat = d.cat;
      if (!cat && Z.ADOPT_BY_TYPE) {
        const a = Z.ADOPT_BY_TYPE[t.type];
        const ad = (a && Z.ZONE_BY_ID) ? Z.ZONE_BY_ID[a] : null;
        if (ad && ad.cat) cat = ad.cat;
      }
    } else LIVE.zoning = 'absent';
  } catch (e) { LIVE.zoning = 'refused'; }
  if (cat === 'res') return 'home';
  if (cat === 'com' || cat === 'off' || cat === 'ind') return 'shop';
  if (!cat && def && (def.popCap | 0) > 0) return 'home';
  return 'civic';
}

/* ── THE FIRM ON A TILE ─────────────────────────────────────────────────────
   Two routes, and the order matters. /src/tenants owns WHOSE NAME is on the
   building and joins the tenancy to the live firm; /src/economy owns the firm.
   Asking tenants first means a leased plot reports its actual tenant; falling
   through to `f.tileKey` means a firm founded by the develop pass — which does
   not go through the tenant auction — is still found. A tile with neither is
   not a failure: it is a building nobody trades out of, and it scores civic. */
function firmAt(x, z, k) {
  let id = null;
  try {
    const T = window.MythicTenants;
    if (T && T.tenantAt) {
      LIVE.tenants = 'live';
      const ten = T.tenantAt(x, z);
      if (ten && ten.firm && ten.firm.id != null) id = ten.firm.id;
    } else LIVE.tenants = 'absent';
  } catch (e) { LIVE.tenants = 'refused'; }
  try {
    const E = window.MythicEconomy;
    if (!E || !E.ready || !E.ready() || !E.firms) { LIVE.economy = 'absent'; return null; }
    LIVE.economy = 'live';
    for (const f of (E.firms() || [])) {
      if (id != null ? f.id === id : String(f.tileKey || '') === k) return f;
    }
  } catch (e) { LIVE.economy = 'refused'; }
  return null;
}

/* ── THE POWER READ ─────────────────────────────────────────────────────────
   🔴 THE `|| 1` TRAP, WRITTEN OUT LONGHAND SO IT CANNOT COME BACK.
   `pwFactorOf(x, z)` has THREE answers and they are three different facts:
       a finite number ≥ 0   the demand ladder priced this building. 0 is a REAL
                             answer and means blackout — it must produce the
                             FULL penalty, which `|| 1` silently turns into no
                             penalty at all.
       null                  the ladder has no opinion here (no /src/power, or
                             it refused, or this tile is not on its list). The
                             correct stand-in is the CITY average, which is
                             exactly what node-city's own `pwFactorAt()` does —
                             so this agrees with the host instead of inventing a
                             second answer.
       nothing finite        no grid model answered at all. The term is EXACTLY
                             0 and says so. That is "unknown", not "powered".
   `which` rides the row so a reader can tell a metered tile from a city
   average — the difference between "this block is browning out" and "the whole
   city is". */
function powerRead(x, z) {
  let f = null, which = null;
  const raw = H.pwFactorOf(x, z);
  if (Number.isFinite(raw) && raw >= 0) { f = raw; which = 'tile'; LIVE.power = 'tile'; }
  else {
    const city = H.game.power && H.game.power.factor;
    if (Number.isFinite(city)) { f = city; which = 'city'; LIVE.power = 'city'; }
    else LIVE.power = 'absent';
  }
  return { f, which };
}

/* ── THE OPTIONAL READS. `null` means the source did not answer, and every
      caller turns that into a term of EXACTLY 0 with a `dead` sentence rather
      than into a plausible middle. ── */
function pollutionRead(x, z) {
  try {
    const P = window.MythicPollution;
    if (!P || !P.ready || !P.ready() || !P.explainAt) { LIVE.pollution = 'absent'; return null; }
    const e = P.explainAt(x, z);
    if (!e || !Number.isFinite(e.response)) { LIVE.pollution = 'refused'; return null; }
    LIVE.pollution = 'live';
    return { response: cl01(e.response), exposure: e.exposure, dominant: e.dominant,
             blame: (e.blame || []).slice(0, 2) };
  } catch (e) { LIVE.pollution = 'refused'; return null; }
}
function bandRead(x, z) {
  try {
    const L = window.MythicLandValue;
    if (!L || !L.ready || !L.ready()) { LIVE.landvalue = 'absent'; return null; }
    const b = L.bandAt(x, z);
    if (!b || !Number.isFinite(b.i)) { LIVE.landvalue = 'refused'; return null; }
    LIVE.landvalue = 'live';
    const n = bandCount(L) - 1;
    return { i: b.i, id: b.id, name: b.name, t: n > 0 ? b.i / n : 0,
             premium: Math.round(L.premiumAt(x, z)) };
  } catch (e) { LIVE.landvalue = 'refused'; return null; }
}
function residentsRead(k) {
  try {
    const D = window.MythicDemographics;
    if (!D || !D.ready || !D.ready() || !D.residents) { LIVE.demographics = 'absent'; return null; }
    const r = D.residents(k);
    LIVE.demographics = 'live';
    /* ok:false is "nobody lives here", which is a REAL answer and not a dead
       source — /src/demographics' own header says to read it that way. */
    if (!r || !r.ok) return { ok: false, why: r ? r.why : 'no record' };
    return r;
  } catch (e) { LIVE.demographics = 'refused'; return null; }
}

/* ════════════════════════════════════════════════════════════════════════════
   THE SCORER
   ══════════════════════════════════════════════════════════════════════════ */

/* A term row, in MythicLandValue.terms()'s shape: { k, ico, label, v, src,
   live, dead }. `v` is SIGNED, in score points. `live:false` means the source
   could not be asked and `v` is therefore EXACTLY 0 — never a stand-in.
   ⚠ `v` IS NEVER ROUNDED. Two roundings of one figure must not be able to
     disagree, and the residual check (|Σv − score| ≈ 0) is only worth running
     if the sum is exact by construction. Consumers round for display. */
const row = (k, ico, label, v, src, live, why, extra) =>
  Object.assign({ k, ico, label, v: Number.isFinite(v) ? v : 0, src,
                  live: live !== false,
                  dead: live === false ? (why || 'not available') : null }, extra || {});

/* A dead row: value EXACTLY 0, naming the source that is missing. */
const deadRow = (k, ico, label, src, why) => row(k, ico, label, 0, src, false, why);

function scoreTile(x, z) {
  const k = H.key(x, z);
  const t = H.game.tiles[k];
  const cov = (H.game.cov && H.game.cov.pct) || {};
  const def = H.BUILDINGS[t.type] || null;
  const terms = [];
  const kind = kindOf(x, z, t, def);
  const A = PV.any;

  terms.push(row('base', '🏙', 'A plot with nothing wrong with it', PV.base, 'host'));

  /* ── THE PER-TILE TRUTH, FIRST AND FOR EVERY KIND ────────────────────────
     Read before any neighbourhood opinion: a wrecked building with no power
     does not need to be told about the rent. */
  if (t.damaged) {
    terms.push(Object.assign(
      row('damaged', REASONS.damaged.ico, 'The building has failed', -A.damaged, 'host'),
      { reason: 'damaged' }));
  } else {
    const wear = Math.max(0, Math.min(100, Number(t.wear) || 0));
    terms.push(Object.assign(
      row('wear', REASONS.worn.ico, 'Wear ' + Math.round(wear) + '%', -(wear / 100) * A.wear, 'host'),
      { reason: 'worn' }));
  }

  const pw = powerRead(x, z);
  const pWeight = kind === 'shop' ? PV.shop.power : A.power;
  if (pw.f === null) {
    terms.push(deadRow('power', REASONS.no_power.ico, 'Power', 'power', 'no grid model answered'));
  } else {
    terms.push(Object.assign(
      row('power', REASONS.no_power.ico,
          'Power at ' + Math.round(pw.f * 100) + '%' +
          (pw.which === 'city' ? ' (city average — the ladder had no opinion here)' : ''),
          -(1 - Math.min(1, pw.f)) * pWeight, 'host', true, null,
          { which: pw.which, factor: pw.f }),
      { reason: 'no_power' }));
  }

  /* 💧 `wtFactor(k)` is the per-tile EXTRACTION multiplier /src/water hands the
     tick. Only a value BELOW 1 is a penalty; small on purpose, because thin
     ground is a siting fact and not a grievance.

     🔴 …AND THE SOURCE IS ASKED SEPARATELY, WHICH IS THE WHOLE FIX HERE.
        node-city's `wtFactor()` (:26407) returns EXACTLY 1 in two completely
        different situations: the aquifer under this plot is nominal, and
        `_wtFac` is null because /src/water never mounted or its pre-pass has
        not run. The first revision of this block tested `Number.isFinite(wt)`
        and therefore recorded `LIVE.water = 'live'` in both — so `sources()`
        reported a live water model on a build where /src/water had 404'd. The
        TERM was still 0 (that half was never wrong), but the report was a
        confident false claim, and landvalue/field.js:41 names exactly this
        class as the branch's most expensive lesson: a guarded read that
        silently substitutes a plausible value is indistinguishable from a
        working integration. `Number.isFinite(wt)` cannot tell the two apart
        because the host already collapsed them; only the module itself can, so
        the module itself is asked.
     ⚠ THE MODULE IS ASKED, NOT THE NUMBER. `MythicWater.ready()` is the same
       mount predicate /src/landvalue's field.js uses for its own optional
       reads, and it is read off `window` at call time — which is what lets a
       driver delete it mid-session and prove the zero. */
  const wt = H.wtFactor(k);
  let waterUp = false;
  try { const WM = window.MythicWater; waterUp = !!(WM && WM.ready && WM.ready()); }
  catch (e) { waterUp = false; }
  if (!waterUp) {
    LIVE.water = 'absent';
    terms.push(deadRow('ground', REASONS.dry_ground.ico, 'Ground water', 'water',
      '/src/water is not answering — wtFactor() reads 1 whether the aquifer is nominal or the module is gone, and those are different facts'));
  } else if (Number.isFinite(wt)) {
    LIVE.water = 'live';
    terms.push(wt < 1
      ? Object.assign(row('ground', REASONS.dry_ground.ico,
          'Ground water at ' + Math.round(wt * 100) + '% of nominal',
          -(1 - Math.max(0, wt)) * A.ground, 'water'), { reason: 'dry_ground' })
      : row('ground', REASONS.dry_ground.ico, 'Ground water nominal', 0, 'water'));
  } else {
    LIVE.water = 'refused';
    terms.push(deadRow('ground', REASONS.dry_ground.ico, 'Ground water', 'water', 'the water model returned nothing finite'));
  }

  /* ── THE RULESETS ─────────────────────────────────────────────────────── */
  if (kind === 'home') homeTerms(terms, x, z, k, cov);
  else if (kind === 'shop') shopTerms(terms, x, z, k, t, def);
  else civicTerms(terms, t, def);

  /* ── THE SUM, AND THE CLAMP THAT KEEPS IT HONEST ─────────────────────────
     🔴 THE SCORE IS THE SUM. It is not computed separately and then compared
     against the rows — it IS `terms.reduce(+v)`, so the residual is zero by
     construction and cannot drift when a term is added. A face and a breakdown
     that disagree is the exact defect this shape exists to make impossible.
     The clamp is a REAL ROW rather than a silent Math.min: a plot 18 points
     worse than the scale can express should say so, and a reader adding up the
     visible rows must still land on the printed number. */
  const sum = (rows) => rows.reduce((a, r) => a + r.v, 0);
  let score = sum(terms);
  if (score < 0 || score > 100) {
    const to = score < 0 ? 0 : 100;
    terms.push(row('clamp', '📏', score < 0
      ? 'Held at 0 — this plot is ' + Math.round(-score) + ' points worse than the scale goes'
      : 'Held at 100 — the scale stops here', to - score, 'host'));
    score = sum(terms);
  }

  /* ── THE REASON: THE WORST SINGLE ROW ────────────────────────────────────
     Not a category sum and not a hand-written priority order. The face says HOW
     bad, the reason says WHAT, and "what" is whichever term costs the most
     right now — which is also the one whose `fix` buys the player the most.
     `base` and `clamp` can never be it. */
  let worst = null;
  for (const r of terms) {
    if (r.k === 'base' || r.k === 'clamp') continue;
    if (r.v >= -PV.reasonFloor) continue;
    if (!worst || r.v < worst.v) worst = r;
  }
  const rid = worst ? (worst.reason || worst.k) : 'ok';
  const R = REASONS[rid] || REASONS.ok;

  return {
    ok: true, x, z, key: k, type: t.type, name: def ? def.name : t.type, kind,
    score, face: faceOf(score),
    reason: rid, reasonIco: R.ico, reasonLabel: R.label, reasonFix: R.fix,
    reasonPoints: worst ? worst.v : 0,
    reasonDetail: (worst && worst.detail != null) ? worst.detail : null,
    terms,
    ramping: H.ramping(), rampLeftSec: H.rampLeftSec(),
    sources: { ...LIVE },
  };
}

/* ── 🏡 THE HOME LADDER ─────────────────────────────────────────────────────
   Six of the eight NEEDS. `power` is charged above (it is per-tile truth, not a
   neighbourhood service) and `leisure` is DELIBERATELY ABSENT: node-city
   already runs a venue/leisure loop at :26448/:33500 damped only by caps, and a
   term reading leisure coverage would put a second reader on that wire for no
   advice the other six do not already give. Said out loud rather than left as
   an omission somebody re-adds next round. */
function homeTerms(terms, x, z, k, cov) {
  const need = (id, ico, label, w) => {
    const v = cov[id];
    if (!Number.isFinite(v)) {
      /* ⚠ AN UNMEASURED NEED READS AS MET, NOT AS FAILED. citMoodTarget makes
         the same call for the same reason: docking every plot on the first
         frame after a load would be this term inventing a complaint. */
      terms.push(row('need_' + id, ico, label + ' — not measured yet', 0, 'host'));
      return;
    }
    terms.push(Object.assign(
      row('need_' + id, ico, label + ' ' + Math.round(v * 100) + '%',
          -(1 - Math.min(1, v)) * w, 'host'),
      { reason: 'no_' + id }));
  };
  need('food', REASONS.no_food.ico, 'Food coverage', PV.home.food);
  need('water', REASONS.no_water.ico, 'Water coverage', PV.home.water);
  need('health', REASONS.no_health.ico, 'Health coverage', PV.home.health);
  need('safety', REASONS.no_safety.ico, 'Safety coverage', PV.home.safety);
  need('light', REASONS.no_light.ico, 'Street light coverage', PV.home.light);
  need('deathcare', REASONS.no_deathcare.ico, 'Deathcare coverage', PV.home.deathcare);

  const pol = pollutionRead(x, z);
  terms.push(!pol
    ? deadRow('pollution', REASONS.polluted.ico, 'Air quality', 'pollution', '/src/pollution is not answering')
    : Object.assign(
        row('pollution', REASONS.polluted.ico,
            'Pollution exposure ' + Math.round(pol.response * 100) + '%',
            -pol.response * PV.home.pollution, 'pollution'),
        { reason: 'polluted', detail: (pol.blame && pol.blame.length) ? pol.blame : null }));

  const band = bandRead(x, z);
  terms.push(!band
    ? deadRow('rent', REASONS.high_rent.ico, 'What this address costs', 'landvalue', '/src/landvalue is not answering')
    : Object.assign(
        row('rent', REASONS.high_rent.ico, band.name + ' land (' + band.premium + ' ₵ premium)',
            -band.t * PV.home.rent, 'landvalue'),
        { reason: 'high_rent', detail: band.id }));

  const res = residentsRead(k);
  if (!res) {
    terms.push(deadRow('afford', REASONS.cant_afford.ico, 'Rent against income', 'demographics', '/src/demographics is not answering'));
  } else if (!res.ok || !Number.isFinite(res.rentBurden)) {
    /* Nobody has moved in yet, or the burden could not be priced. A real answer
       and worth exactly 0 — an empty house has nobody in it to be unhappy. */
    terms.push(row('afford', REASONS.cant_afford.ico,
      res.ok ? 'Rent burden not priced yet' : (res.why || 'Nobody lives here yet'), 0, 'demographics'));
  } else {
    const b = res.rentBurden;
    const over = cl01((b - PV.rent.easy) / (PV.rent.hard - PV.rent.easy));
    terms.push(Object.assign(
      row('afford', REASONS.cant_afford.ico,
          'Rent is ' + Math.round(b * 100) + '% of what they earn', -over * PV.home.afford, 'demographics'),
      { reason: 'cant_afford', detail: res.wealth ? res.wealth.label : null }));
  }
}

/* ── 🏪 THE SHOP / OFFICE / WORKS LADDER ────────────────────────────────────
   The economy already diagnoses a firm properly: Bottleneck.diagnose returns a
   constraint table sorted worst-first, a classified cause and a `fix` sentence.
   This RE-DERIVES NONE OF IT. It reads the diagnosis and turns the two rows a
   plot icon can usefully draw into terms:
     · `__demand__`     → "no customers", CS2's icon, and `firm.idleForDemand`
                          is literally the number for it.
     · everything else  → the binding constraint, whatever it is, carrying the
                          economy's own label through verbatim.
   ⚠ THE FIRM'S OWN `idleForDemand` IS THE VALUE, not the row's `1 - pct`
     reconstruction of it, because diagnose() only PUBLISHES that row when idle
     > 0.01 — reading the row would make the term vanish just below that
     threshold instead of going smoothly to zero. */
function shopTerms(terms, x, z, k, t, def) {
  workTerms(terms, t, def);

  const f = firmAt(x, z, k);
  let diag = null;
  if (f) { try { diag = window.MythicEconomy.diagnose(f.id); } catch (e) { diag = null; } }

  if (!f) {
    terms.push(deadRow('customers', REASONS.no_customers.ico, 'Orders on the books', 'economy',
      'no firm trades out of this tile — /src/economy or /src/tenants is absent, or nothing has been founded here'));
    terms.push(deadRow('inputs', REASONS.no_input.ico, 'Supply chain', 'economy', 'no firm on this tile'));
    terms.push(deadRow('broke', REASONS.broke.ico, 'Solvency', 'economy', 'no firm on this tile'));
  } else {
    const idle = cl01(f.idleForDemand);
    terms.push(Object.assign(
      row('customers', REASONS.no_customers.ico,
          idle > 0.005 ? ('Idle for want of orders ' + Math.round(idle * 100) + '% of the time')
                       : 'Selling everything it makes',
          -idle * PV.shop.customers, 'economy'),
      { reason: 'no_customers' }));

    /* The binding constraint EXCLUDING the demand row (charged above). The
       economy's own worst-first ordering is preserved, so this file never
       decides which input is the problem. */
    let bind = null;
    for (const r of ((diag && diag.rows) || [])) {
      if (r.key === '__demand__') continue;
      if (!bind || r.pct < bind.pct) bind = r;
    }
    terms.push(!bind
      ? row('inputs', REASONS.no_input.ico, 'No constraint table yet', 0, 'economy')
      : Object.assign(
          row('inputs', (diag && diag.cause && diag.cause.ico) || REASONS.no_input.ico,
              bind.label + ' at ' + Math.round(bind.pct * 100) + '%',
              -(1 - cl01(bind.pct)) * PV.shop.inputs, 'economy'),
          { reason: 'no_input', detail: (diag && diag.cause) ? diag.cause.fix : bind.label }));

    const bankrupt = f.rung === 'BANKRUPT' || !!(diag && diag.cause && diag.cause.key === 'NO_CASH');
    terms.push(Object.assign(
      row('broke', REASONS.broke.ico, bankrupt ? 'Bankrupt — it cannot pay' : 'Solvent',
          bankrupt ? -PV.shop.broke : 0, 'economy'),
      { reason: 'broke' }));
  }

  const pol = pollutionRead(x, z);
  terms.push(!pol
    ? deadRow('pollution', REASONS.polluted.ico, 'Air quality', 'pollution', '/src/pollution is not answering')
    : Object.assign(
        row('pollution', REASONS.polluted.ico,
            'Pollution exposure ' + Math.round(pol.response * 100) + '%',
            -pol.response * PV.shop.pollution, 'pollution'),
        { reason: 'polluted', detail: (pol.blame && pol.blame.length) ? pol.blame : null }));

  /* 🏷 THE ADDRESS IS A BONUS FOR A SHOP AND A COST FOR A HOME, out of the SAME
     band. That asymmetry is the whole point of judging the two differently: the
     thing that makes a flat expensive is the thing that makes the shop
     downstairs busy. Signed positive, and the only positive term in the file
     besides `base` — so a prime-pitch shop can rise above the neutral 100 and
     be held there by the clamp row, visibly. */
  const band = bandRead(x, z);
  terms.push(!band
    ? deadRow('address', REASONS.bad_address.ico, 'The pitch', 'landvalue', '/src/landvalue is not answering')
    : row('address', '🏷', band.name + ' pitch (' + band.premium + ' ₵ premium)',
          band.t * PV.shop.address, 'landvalue'));
}

/* ── 🏛 THE CIVIC LADDER ────────────────────────────────────────────────────
   A Clinic, a Graveyard, a Power Station, a mine, the Node Anchors. Judged ONLY
   on whether the thing works — damaged, worn, powered (all charged above), fed,
   staffed, halted. Deliberately NOT on coverage: a Clinic docked for poor
   health coverage is the model marking its own homework, and it would put a
   frowning face on the one building the player has already built to fix it.
   Deliberately NOT on rent or customers either — nobody shops at a graveyard. */
function civicTerms(terms, t, def) { workTerms(terms, t, def); }

/* The three rows a WORKING building has in common, shared by the shop and civic
   ladders so the two cannot drift. Weights come out of PV.shop for both,
   because they describe the same physical failures. */
function workTerms(terms, t, def) {
  const halted = H.insHalted(t);
  terms.push(halted
    ? Object.assign(row('halted', REASONS.no_input.ico,
        'No ' + halted + ' in the yard — it made nothing this tick', -PV.shop.halted, 'host'),
        { reason: 'no_input', detail: halted })
    : row('halted', REASONS.no_input.ico, 'Inputs on hand', 0, 'host'));

  /* `t.svcFed` is what node-city's service pre-pass ACTUALLY delivered to this
     building (index.html :27201) and is the same figure the inspect panel
     prints as "% stocked". Absent means the building has no svc block. */
  if (def && def.svc && Number.isFinite(t.svcFed)) {
    const fed = cl01(t.svcFed);
    terms.push(Object.assign(
      row('stock', REASONS.understocked.ico, Math.round(fed * 100) + '% stocked',
          -(1 - fed) * PV.shop.stock, 'host'), { reason: 'understocked' }));
  } else terms.push(row('stock', REASONS.understocked.ico, 'Not a serviced building', 0, 'host'));

  if (def && def.crew) {
    const s = cl01(H.staffingRatio());
    terms.push(Object.assign(
      row('staff', REASONS.understaffed.ico, 'Staffed at ' + Math.round(s * 100) + '%',
          -(1 - s) * PV.shop.staff, 'host'), { reason: 'understaffed' }));
  } else terms.push(row('staff', REASONS.understaffed.ico, 'Needs no crew', 0, 'host'));
}

export function faceOf(score) {
  const s = Number.isFinite(score) ? score : 0;
  for (const f of PV.faces) if (s >= f.at) return { id: f.id, ico: f.ico, label: f.label };
  return { id: 'angry', ico: '😠', label: 'Furious' };
}

/* ── WHICH TILES ARE JUDGED AT ALL ──────────────────────────────────────────
   A road has no mood. Nor does a tree, and nor does a SCAFFOLD — `bldSite(t)`
   is node-city's own "nothing standing yet" gate, and a construction site is
   not a building the player can be told anything useful about.
   ⚠ THIS IS WHY `sweep()` CAN PROMISE NO NULL SCORES: it only visits tiles that
     pass here, so every row it returns is a real judgement rather than a
     placeholder. `at()` on a rejected tile returns ok:false with a `why` — it
     does NOT return 0, because 0 is "furious" and a road is not furious. */
function judgeable(t) {
  if (!t || !H.BUILDINGS[t.type]) return 'no building on this tile';
  if (H.isRoadTile(t)) return 'a road has no mood';
  if (H.BUILDINGS[t.type].decor) return 'decoration has no mood';
  if (H.bldSite(t)) return 'still under construction — nothing stands here yet';
  return null;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PUBLIC API
   ══════════════════════════════════════════════════════════════════════════ */
const API = {
  ready: () => mounted && !!H,
  PV, REASONS, faceOf,

  /* THE ONE CALL. Safe before mount, on a tile that does not exist, and while
     any subset of the six optional modules is 404ing. */
  at(x, z) {
    if (!mounted || !H) {
      return { ok: false, why: 'plot verdict is not mounted', score: null, face: null,
               reason: null, terms: [], sources: freshLive() };
    }
    LIVE = freshLive();
    const xi = x | 0, zi = z | 0;
    const k = H.key(xi, zi);
    const t = H.game.tiles[k];
    const no = judgeable(t);
    if (no) {
      return { ok: false, why: no, x: xi, z: zi, key: k, type: t ? t.type : null,
               score: null, face: null,
               reason: (t && H.bldSite(t)) ? 'site' : null, terms: [],
               ramping: H.ramping(), rampLeftSec: H.rampLeftSec(), sources: { ...LIVE } };
    }
    try { return scoreTile(xi, zi); }
    catch (e) {
      /* A throw must not take the caller down — the consumer is a render path.
         It must also not look like a happy tile, which is why `score` is null
         and not 100. */
      return { ok: false, why: 'plot verdict threw: ' + String((e && e.message) || e),
               x: xi, z: zi, key: k, score: null, face: null, terms: [], sources: { ...LIVE } };
    }
  },

  /* THE WHOLE GRID, one row per judged tile, worst first.
     ⚠ IT SWEEPS `game.tiles`, NOT GRID×GRID. 576 cells against however many are
       actually built is the difference between a diagnostic a driver can run
       every tick and one it runs once; `cells` publishes the ratio. */
  sweep(filter) {
    if (!mounted || !H) return { ok: false, why: 'not mounted', rows: [] };
    const rows = [];
    let skipped = 0;
    /* 🔴 THE SOURCE MAP IS ACCUMULATED, NOT TAKEN OFF THE LAST TILE, and that
       was a real bug for one revision. `at()` resets LIVE per call, and a home
       is the only kind that asks /src/demographics — so a sweep that happened
       to finish on a shop reported `demographics: null` ("never asked") for a
       board full of houses that had asked it 54 times. A sweep's sources are
       the UNION over the board, and 'live' beats 'absent' beats null: one
       answer anywhere means the module is up. */
    const agg = freshLive();
    const fold = () => {
      for (const kk in LIVE) {
        const v = LIVE[kk];
        if (v == null) continue;
        if (agg[kk] == null || (agg[kk] === 'absent' && v !== 'absent')) agg[kk] = v;
      }
    };
    for (const k in H.game.tiles) {
      const c = k.indexOf(',');
      const x = +k.slice(0, c), z = +k.slice(c + 1);
      if (!Number.isFinite(x) || !Number.isFinite(z)) { skipped++; continue; }
      const r = API.at(x, z);
      fold();
      if (!r.ok) { skipped++; continue; }
      if (typeof filter === 'function' && !filter(r)) continue;
      rows.push(r);
    }
    LIVE = agg;                 // so sources() after a sweep answers about the sweep
    rows.sort((a, b) => a.score - b.score);
    return {
      ok: true, rows, judged: rows.length, skipped, cells: Object.keys(H.game.tiles).length,
      /* 🔴 THE RAMP RIDES THE TABLE. See the header: for DEMAND_RAMP_SEC after a
         load, every coverage figure is blended toward a neutral 100%, so a
         sweep taken inside that window photographs a city that has not been
         asked the question yet. A consumer that prints this table without
         printing these two fields is publishing a false smile. */
      ramping: H.ramping(), rampLeftSec: H.rampLeftSec(),
      sources: { ...LIVE },
    };
  },

  /* WHICH SOURCES ANSWERED on the last call, and which term keys are therefore
     EXACTLY 0. A test stubs a module absent and asserts both halves. */
  sources() {
    const s = { ...LIVE };
    const zeroed = [];
    if (s.pollution !== 'live') zeroed.push('pollution');
    if (s.landvalue !== 'live') zeroed.push('rent', 'address');
    if (s.demographics !== 'live') zeroed.push('afford');
    if (s.economy !== 'live') zeroed.push('customers', 'inputs', 'broke');
    if (s.power === 'absent') zeroed.push('power');
    /* `!== 'live'` rather than `=== 'absent'`, to match the four optional reads
       above: 'refused' and never-asked both mean the `ground` row is a 0 that
       measured nothing, and a `zeroed` list that omitted them would be telling
       a reader the term was a measurement. `power` on the line above is the
       deliberate exception — 'city' is a real answer with a real penalty in
       it, so only 'absent' zeroes that one. */
    if (s.water !== 'live') zeroed.push('ground');
    return { ...s, zeroed, mounted };
  },

  /* 🔍 THE SELF-CHECK, REPORTED ONLY WHEN IT FAILS — the discipline
     /src/landvalue and /src/tenants both ship under. It asks the one question
     that can silently invalidate the whole feature: do the rows still sum to
     the score they are breaking down? */
  verify() {
    if (!mounted || !H) return { ok: false, why: 'not mounted' };
    const problems = [];
    const s = API.sweep();
    let worst = 0;
    for (const r of s.rows) {
      const sum = r.terms.reduce((a, t) => a + t.v, 0);
      const d = Math.abs(sum - r.score);
      if (d > worst) worst = d;
      if (d > 1e-6) problems.push(r.key + ': terms sum to ' + sum.toFixed(4) + ' but score is ' + r.score.toFixed(4));
      if (!Number.isFinite(r.score)) problems.push(r.key + ': score is not finite');
      if (r.score < 0 || r.score > 100) problems.push(r.key + ': score ' + r.score + ' is outside 0..100');
      if (r.reason !== 'ok' && !REASONS[r.reason]) problems.push(r.key + ': reason "' + r.reason + '" is not in the catalogue');
      if (r.reason !== 'ok' && !r.reasonFix) problems.push(r.key + ': reason "' + r.reason + '" has no fix to offer');
    }
    return { ok: problems.length === 0, problems: problems.slice(0, 8),
             judged: s.judged, worstResidual: worst };
  },

  /* ── THE ADAPTER FOR node-city's EXISTING CARD ───────────────────────────
     node-city's `plotMoodAt()` (:31273) already calls `PM.evaluate(ctx)` with
     the context `plotMoodCtx()` builds, and `insMoodCard()` (:31304) already
     knows how to print the answer. This maps THIS module's verdict into that
     shape so the shipped card works — one derivation, two readers, which is the
     whole point of splitting the feature this way.
     ⚠ IT TAKES ONLY x/z OFF THE CONTEXT and re-reads everything else itself.
       The alternative — scoring out of the handed context — would mean the card
       and `at()` were two models of one tile that happened to agree today. */
  evaluate(ctx) {
    if (!ctx) return null;
    const v = API.at(ctx.x, ctx.z);
    if (!v.ok) return { face: 'none', id: v.reason || 'none', why: v.why || null };
    const face = v.score < 40 ? 'frown' : v.score < 70 ? 'meh' : 'smile';
    const worst = v.terms.reduce((a, t) =>
      (t.k !== 'base' && t.k !== 'clamp' && (!a || t.v < a.v)) ? t : a, null);
    return {
      face, id: v.reason, glyph: v.face.ico, label: v.reasonLabel,
      value: v.score / 100, valueTxt: Math.round(v.score) + ' / 100',
      fix: v.reasonFix,
      limitedBy: (worst && worst.v < -PV.reasonFloor) ? worst.label : null,
      /* Worst first, and only the rows that actually cost something — a card
         listing "Needs no crew, 0" fourteen times is a card nobody reads. */
      terms: v.terms
        .filter(t => t.k !== 'base' && t.k !== 'clamp' && (t.v < -0.05 || t.v > 0.05))
        .sort((a, b) => a.v - b.v)
        .map(t => ({ id: t.k, ico: t.ico, label: t.label,
                     valueTxt: (t.v > 0 ? '+' : '') + t.v.toFixed(1),
                     face: t.v < -PV.reasonFloor ? 'frown' : t.v < -0.05 ? 'meh' : 'smile' })),
      source: 'the city\'s own coverage, land value, pollution and firm ledgers',
      pill: ctx.status ? ctx.status.key : null,
      score: v.score, kind: v.kind, ramping: v.ramping, sources: v.sources,
    };
  },

  mount(ctx) {
    if (!ctx || !ctx.game || !ctx.BUILDINGS) return false;
    H = ctx;
    LIVE = freshLive();
    _bandN = 0;
    mounted = true;
    return true;
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicPlotVerdict = API;
    /* ⚠ ADDITIVE, GUARDED, AND IT DEFERS. node-city's shipped card calls
       `window.MythicPlotMood.evaluate(ctx)`; the module that owns that global
       is the GLYPH layer and does not carry one, so the card is dead in the
       tree as it stands. This attaches the missing method WITHOUT replacing the
       object, and only when nothing has provided one — so the moment the owner
       ships their own `evaluate`, this line does nothing and the merge is a
       one-line decision instead of a conflict. It never overwrites. */
    const G = window.MythicPlotMood;
    if (G && typeof G.evaluate !== 'function') G.evaluate = (ctx) => API.evaluate(ctx);
  }
} catch (e) {}

export default API;
