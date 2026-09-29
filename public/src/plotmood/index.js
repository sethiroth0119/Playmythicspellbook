/* ════════════════════════════════════════════════════════════════════════════
   🙂 PLOT MOOD — how each building feels, and WHY, over the building itself.
   ----------------------------------------------------------------------------
   Cities: Skylines 2 puts a small icon over a building that states a REASON —
   a frowning house with a water drop is a house with no water. That is the
   whole design: the glyph is not a mood in the abstract, it is a named defect
   with a fix, and it changes the moment the city changes.

   🔴 EVERY NUMBER HERE IS ONE THE CITY ALREADY COMPUTES. Nothing in this file
      invents a happiness figure, and that is the single most important line in
      the header: a decorative emoji that is not reading a real value is a
      happiness bar with extra steps, and this project has twice had to tear one
      out of a shipped panel. The six signals, and where each comes from:

        water    MythicWater.servedAt(k)      — the SAME connectivity walk the
                                                tick charges the city for
        power    MythicPower.factorAt(x,z)    — the demand ladder's own answer
                                                for this tile
        road     game.tiles + isRoadTile      — the four orthogonal neighbours
        dark     litKeys()                    — node-city's Chebyshev-2 lamp
                                                model, host-owned, and the ONLY
                                                radius service model it has
        roadcap  roadUsed() / roadCap()       — the weighted road meter, which
                                                is what a road CLASS conversion
                                                actually moves (see below)
        need:*   game.cov.pct[n]              — the eight NEEDS, computed once
                                                per coverage tick by the host

      `score` is the MINIMUM of those terms and `reason` is the id of whichever
      one produced it. So the face and the sentence under it can never disagree,
      and there is no seventh number blending them.

   ⚠ WHAT IS DELIBERATELY *NOT* HERE: A PER-PLOT ROAD-CLASS MOOD.
     A road class changes exactly one thing in the shipped game: `capWeight`,
     which /src/roads/tuning.js is explicit is a MAINTENANCE BURDEN and not
     throughput. /src/landvalue declines traffic and congestion in as many
     words ("✗ CONGESTION / TRAFFIC"), and nothing else reads `t.rc` at all
     outside the mesh recipes. So "this shop is on an alley and unhappy" would
     be a number invented in this file. The honest reading of a class
     conversion is the one it really makes — the city-wide road meter — and
     that is `roadcap`. If a future round gives a class a local effect, this is
     the file that should read it.

   ⚠ AND CITY SERVICES ARE CITY-WIDE IN THIS GAME. `game.cov.pct` is one figure
     for the whole board; node-city has no service catchment except the lamp.
     Calling a NEED "local" here would be the same invention as above, so a
     need reason says what it is: the city is short, everywhere.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `THREE`, `scene`,
      `litKeys`, `roadUsed`, `bldSite` and the tile→world mapping are top-level
      `const`/`function` in node-city's module script — LEXICAL bindings, not
      properties of `window`. This module reads none of them by itself; mount()
      IS the hand-over, and what crosses it is READ-ONLY. There is no tile
      writer, no payCost, no addRes and no save field: every fact is derived
      from state that is already persisted, so a 404 on this module costs the
      glyph layer and nothing else.

   ── 🚀 PERFORMANCE, AND WHAT THE APPROACH COSTS ────────────────────────────
   A 24×24 board is 576 potential glyphs. A mesh per tile is 576 draw calls for
   a decoration. /src/water/overlay.js and /src/power/overlay.js both solved the
   same problem with ONE mesh and one CanvasTexture, and both say so in their
   headers — but their picture lies flat on the GROUND, and this one has to sit
   ABOVE the building it describes or it is occluded by the roof it belongs to.
   A raised ground-plane would put every glyph a full parallax offset away from
   its own tile at the game's 20–30° camera, which is worse than useless: it
   would attribute defects to the wrong buildings.

   So: ONE `THREE.Points`, one draw call, one 4×4 CanvasTexture ATLAS, and a
   per-point `cell` attribute that picks the glyph out of it in the fragment
   shader. Points are camera-facing by construction, so there is no billboard
   maths and no per-frame work of any kind — the geometry is rebuilt only when
   `repaint()` runs, and `repaint()` runs only when the signature changes.
   Cost, measured by `verify()`: 1 object, 1 draw call, ≤576 points, one
   256×256 texture. Turning it on costs what turning on one lamp costs.
   (`makeFall()` in node-city already ships THREE.Points, so gl_PointSize is
   known to work in this renderer and in SwiftShader.)

   ── ⏱ WHEN IT RECOMPUTES — this is P4's whole subject ──────────────────────
   NOT every frame, and NOT on a timer. `invalidate()` is O(1): it bumps a
   generation counter and sets a dirty flag, and that is all any placement seam
   pays. `beat()` — the one line added to the host's 0.5 s HUD tick — is
   `if (!dirty) return false`. The recompute happens at most once per beat, and
   the texture/geometry upload happens only if `sig()` changed, so a placement
   that moves nothing repaints nothing.
   `moodAtKey()` recomputes on demand if the generation moved, so a console or
   a driver reading straight after a placement gets the truth without waiting
   for the beat. That split is deliberate: the CHEAP thing is on the hot path,
   the correct thing is on the read.

   ── ⚠ THE ONE-TICK LATENCY ON `water` AND `power`, WRITTEN DOWN AS A DESIGN ─
   Four of the six signals are recomputed by THIS file, from state that is true
   the instant the player's hand comes off the mouse: `road` and `dark` walk
   game.tiles, `roadcap` reads the meter, `need:*` reads the coverage table the
   host already published. Those clear on the next beat — inside 0.5 s, and
   inside one `moodAtKey()` call for a console or a driver.
   `water` and `power` DO NOT. `MythicWater.servedAt` and `MythicPower.factorAt`
   are readers over a solved state, and neither module re-solves on an edit:
   the connectivity walk and the demand ladder both run inside node-city's
   economyTick pre-passes, once a second, from a SNAPSHOT the host composes
   (pop, wells, users, homes, outfalls / loads, plants, the interconnector).
   So laying a main invalidates this file instantly and the reason clears on
   the first HOST BEAT after the solve.
   ⚠ THE HOST INVALIDATES ON *BOTH* BEATS AND SYNCS ONLY ON THE 2 s ONE, AND
     THE SPLIT IS LOAD-BEARING IN BOTH DIRECTIONS.
     · The eager `sync()` sits at the tail of vitalsTick (2 s) because
       economyTick does not write game.cov.pct — computeCoverage() does, from
       inside vitalsTick, which runs AFTER economyTick in both of node-city’s
       loops. Synced on the earlier beat, sync() rebuilt this file’s memo from
       the PREVIOUS beat’s coverage and stamped it with the CURRENT generation,
       so the cacheGen !== gen safety net below could never correct it:
       measured, 8/8 beats disagreed with game.cov.pct while the layer was open
       and 0/8 while it was shut.
     · `invalidate()` sits at the tail of BOTH. It was moved off economyTick
       together with the sync, and that was a second staleness bug, opposite in
       shape: animate() runs economyTick every 1 s and vitalsTick every 2 s, so
       HALF of all economy beats stand alone — and MythicPower.solve() runs
       inside economyTick. With no invalidate there, `power` (and `water`) sat a
       full second behind their own solvers while node-city’s dossier went on
       reading MythicPower.factorAt LIVE beside the face this file chose from
       the memo. Measured: 11/16 lone economy beats disagreed with factorAt,
       against a control of 0/16 on the paired beats. A live percentage under a
       stale face is the one thing the top of this header forbids.
     Why the asymmetry is correct rather than convenient: invalidate() is
     `gen++; dirty = true` and NOTHING else, so an extra one costs a counter;
     and a recompute it provokes early is re-invalidated by the vitals beat the
     moment computeCoverage() rewrites game.cov.pct, so the need:* terms cannot
     be served stale. sync() has no such correction — it FORCES the recompute
     and stamps it fresh — which is precisely why it may not move back.
     PLACEMENT is unaffected by any of this: every seam invalidates the instant
     the player’s hand comes off the mouse, and a read recomputes on demand.

   🔴 THE REJECTED FIX, AND WHY. The first design had `recompute()` force those
      two modules to re-solve before reading them. It cannot be done honestly
      from here: the snapshot is the HOST's, this module is handed a read-only
      hand-over by contract (see the globals-trap note above), and faking a
      snapshot would produce a `servedAt` derived from different inputs than
      the one the tick charged the city for — two different stories about the
      same pipe, which is the exact failure this file's header opens with.
      Pushing a re-solve entry point onto /src/water and /src/power instead
      would put a full connectivity walk on the player's drag, per commit.
   ⚠ WHAT IT COSTS A TEST, AND THIS IS THE PART THAT BIT. A read taken BETWEEN
     a placement and the next tick is a stale answer behind a fresh generation
     counter — the recompute really did run, it simply asked a module that has
     not re-solved yet. .gauntlet/drive-moodreact.mjs therefore steps the clock
     immediately after EVERY placement, controls included, so that no before/
     after pair can straddle a solve. Two control rows and one scaffold row in
     that harness failed intermittently for exactly this reason before the rule
     was written down.

   ── 🎨 THE PAINTER IS REPLACEABLE, AND IT WAS REPLACED ─────────────────────
   `setPainter(fn)` swaps the drawing half without touching any of the above.
   The scoring and the invalidation are one concern and the glyph is another;
   they were built by different hands in the same round and the seam is here so
   the merge is mechanical.
   🔴 AS SHIPPED, `/src/plotmood/overlay.js` TAKES IT (`window.MythicPlotIcons`),
      so the THREE.Points cloud described above is NEVER CREATED in a normal
      boot and `verify().objects` is 0 by design — the picture is one indexed
      quad batch on their side, which handles the WebGPU renderer and can draw
      a face and a reason side by side, neither of which a square gl_PointCoord
      sprite can. The cloud stays here as the fallback for a build where that
      file 404s, and because a module whose only painter lives in another file
      cannot be tested on its own. Anything measuring "the glyph" must measure
      MythicPlotIcons; measuring this file's `mesh()` measures a painter that
      nothing installed and reports a confident, wrong zero — which is exactly
      what .gauntlet/drive-moodreact.mjs's first run did.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── THE TUNING TABLE. Every number this feature owns, behind one name — the
      `_opEcon()` / `ECON` / `POWER` / `ROADS` pattern (CLAUDE.md). Nothing else
      in this file may hold a bare figure. ── */
export const MOOD = {
  /* A term at or above `happyAt` is not worth a glyph at all: a board where
     every content building carries a smiley is a board where the frowns do not
     read. Anything under `crossAt` is a frown; between them is a neutral face.
     Chosen against `game.cov.pct`, whose own panel bands start calling a need
     short at 0.85 — the same threshold, so the card and the glyph agree. */
  happyAt: 0.85,
  crossAt: 0.60,
  /* Below this a NEED counts as a defect worth naming. Same 0.85 for the same
     reason; it is written twice because they are two decisions that happen to
     agree today and either could move. */
  needFloor: 0.85,
  /* A power factor under this is the demand ladder shedding this tile. 0.999
     rather than 1 is /src/power's own test in `factorAt` — copied, not
     re-derived, so a retune there cannot leave this reading a different tile
     state than the panel does. */
  powerShed: 0.999,
  /* THE ROAD METER, AND WHY IT IS A RAMP RATHER THAN A LINE.
     The first cut fired at `used >= cap` — the meter's own refusal point — on
     the argument that the glyph should appear exactly when the player's next
     road would be refused. Measured, THAT THRESHOLD IS UNREACHABLE: both
     tryPlace and /src/roads' conversion refuse *before* crossing it
     (`used + delta > cap`), so a 17-tile spine converted to Highway stops at
     38/40 and the term could never fire on any city. A test that had only
     asserted the code path would have passed on a dead branch.
     So it ramps over the last tenth of the meter, which is the honest reading
     anyway: the pressure is real from 0.90 up, and at 1.0 nothing more can be
     paved at all. Both ends are here because both are decisions. */
  roadCapWarn: 0.90,
  roadCapAt: 1.0,
  /* Draw a glyph over a CONTENT building too? No, and the reason is the
     reference screenshot: CS2 shows a face over a building that has something
     to say. A board where all 200 houses carry a smiley is a board where the
     six that carry a water drop do not read, and it is also 200 points of
     geometry for no information. The flag exists because it is the one
     tunable a playtest would actually want to flip. */
  drawHappy: false,

  /* Scores for the boolean terms. They are not weights and nothing multiplies
     them: each is "how well is this tile doing on this axis", 0..1, and the
     worst one wins. A tile with no water is at 0 because a house with no water
     is not partly fine. */
  s: { water: 0.00, road: 0.15, dark: 0.45, roadcap: 0.50 },

  glyph: {
    px: 64,          // one atlas cell, in texels. 4×4 cells ⇒ a 256² texture.
    cols: 4,
    size: 26,        // on-screen point size at 1 unit of depth, in device px
    lift: 0.34,      // how far the glyph floats above the building's own top.
                     // 0.34 is SH, node-city's standard storey height — one
                     // storey of clear air, so the glyph never touches a roof
                     // ridge and never drifts free of the building either.
    minY: 0.55,      // …and a floor, for road tiles and flat lots with no mesh
  },
};

/* ── THE REASON CATALOGUE. `id` is what a test asserts on and what a save would
      carry if this ever had one, so it must never be renamed. `fix` is the
      actionable half: a frown the player cannot act on is a frown that only
      tells them they are losing. ── */
export const REASONS = {
  ok:      { ico: '🙂', label: 'Content',                     fix: '',                                                         cell: 0 },
  meh:     { ico: '😐', label: 'Getting by',                  fix: '',                                                         cell: 1 },
  water:   { ico: '💧', label: 'No mains water',              fix: 'Run a main from a Waterworks to this block.',              cell: 2 },
  power:   { ico: '⚡', label: 'Off the grid',                fix: 'Run a power line to this block, or add generation.',       cell: 3 },
  road:    { ico: '🛣', label: 'No road access',              fix: 'Pave a road onto one of the four sides.',                  cell: 4 },
  dark:    { ico: '💡', label: 'Unlit after dark',            fix: 'A 💡 Street Light within 2 tiles lights this block.',      cell: 5 },
  roadcap: { ico: '🛤', label: 'Roads near what the city can maintain', fix: 'A 📦 Supply Depot raises the cap, or downgrade an avenue.', cell: 6 },
  food:    { ico: '🍞', label: 'Not enough food',             fix: 'A farm feeds a kitchen; a kitchen feeds the city.',        cell: 7 },
  health:  { ico: '🏥', label: 'No health cover',             fix: 'Build a clinic.',                                          cell: 8 },
  safety:  { ico: '🛡', label: 'Unsafe',                      fix: 'Barracks, a motor pool or more light.',                    cell: 9 },
  light:   { ico: '🌙', label: 'The city is short of light',  fix: 'More 💡 Street Lights.',                                   cell: 10 },
  leisure: { ico: '🎵', label: 'Nothing to do',               fix: 'A club, a park or a pitch.',                               cell: 11 },
  deathcare:{ico: '🪦', label: 'The dead are not being buried', fix: 'A graveyard, and plots in it.',                          cell: 12 },
};
/* The eight NEEDS map onto the catalogue above; `water` and `power` are named
   twice on purpose — the LOCAL reading (is this tile connected) is a different
   fact from the CITY reading (is there enough to go round), and they are told
   apart by the reason id: `water` vs `need:water`. */
const NEED_CELL = { food: 7, water: 2, power: 3, safety: 9, light: 10, health: 8, leisure: 11, deathcare: 12 };

let H = null;                 // the host hand-over
let mounted = false;
let gen = 0;                  // bumped by invalidate(); the memo key
let cacheGen = -1;
let cache = null;             // Map(k → mood)
let dirty = true;
let lastSig = '';
let lastWhy = 'boot';
let painter = null;           // the drawing half; see setPainter()
let stats = { repaints: 0, invalidations: 0, beats: 0, skipped: 0, lastMs: 0 };

const W = () => (typeof window !== 'undefined' ? window : {});

/* ════════════════════════════════════════════════════════════════════════════
   THE SCORER
   ════════════════════════════════════════════════════════════════════════════ */

/* Does this tile get a face at all? Decor, walls and lots have nobody in them
   to have an opinion, and a SITE is a hole in the ground — the same `bldSite`
   asymmetry node-city applies to popCap, crew, light and every service supply.
   ⚠ THIS IS THE SCAFFOLD/BUILDING DISTINCTION AND IT IS LOAD-BEARING. A timed
     order writes `t.bld` and nothing else: the building does not exist, it
     supplies nothing, and the neighbour it was meant to fix must keep its
     frown until bldFinish. Every service reading below therefore comes from a
     host function that already excludes sites (litKeys, economyTick's supply
     loop), and this function keeps sites out of the roster entirely. */
function judged(t) {
  if (!t || !H) return null;
  const def = H.BUILDINGS[t.type];
  if (!def) return null;
  if (H.bldSite(t)) return null;
  if (H.isRoadTile(t)) return null;
  const home = (def.popCap | 0) > 0;
  const biz = !!(def.gen || def.svc || def.prod || (def.crew | 0) > 0);
  if (!home && !biz) return null;              // decor, walls, lamps, lots
  return { def, home, biz };
}

/* The four orthogonal neighbours, exactly as node-city's own road-need gate
   reads them. `noRoadNeed` is the host's flag on the BUILDINGS row and is
   honoured rather than second-guessed. */
function hasRoad(x, z) {
  const g = H.game.tiles;
  return H.isRoadTile(g[H.key(x + 1, z)]) || H.isRoadTile(g[H.key(x - 1, z)]) ||
         H.isRoadTile(g[H.key(x, z + 1)]) || H.isRoadTile(g[H.key(x, z - 1)]);
}

/* One pass over the board. Everything expensive that is shared between tiles —
   the lamp set, the road meter, the coverage table — is read ONCE here and
   handed down, because litKeys() walks every tile and calling it per tile is
   576 walks of 576 tiles. */
function recompute() {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const out = new Map();
  if (!H) { cache = out; cacheGen = gen; return out; }

  let lit = null;
  try { lit = H.litKeys(); } catch (e) { lit = null; }
  const cov = (H.game.cov && H.game.cov.pct) || {};
  let capFrac = 0;
  try { capFrac = H.roadUsed() / Math.max(1, H.roadCap()); } catch (e) { capFrac = 0; }
  /* 1 while there is headroom, sliding to MOOD.s.roadcap as the meter fills.
     See the tuning note: a hard line at 1.0 is a branch no city can reach. */
  const capScore = capFrac <= MOOD.roadCapWarn ? 1
    : Math.max(MOOD.s.roadcap, 1 - (1 - MOOD.s.roadcap) *
        (capFrac - MOOD.roadCapWarn) / Math.max(1e-6, MOOD.roadCapAt - MOOD.roadCapWarn));

  /* The two neighbour modules, resolved ONCE per pass and guarded. Absent is a
     legal state and means "this axis is not modelled in this build" — never a
     defect, so an absent module can never produce a frown. */
  const WA = (() => { try { return W().MythicWater || null; } catch (e) { return null; } })();
  const PW = (() => { try { return W().MythicPower || null; } catch (e) { return null; } })();

  for (const k in H.game.tiles) {
    const t = H.game.tiles[k];
    const j = judged(t);
    if (!j) continue;
    const c = k.indexOf(',');
    const x = +k.slice(0, c), z = +k.slice(c + 1);

    /* Every term is (score, reasonId). The worst wins; ties keep the FIRST,
       which is why the local, actionable, physical terms are tested before the
       city-wide ones — "you have no water main" is a better sentence than "the
       city is 84% covered for water", and both can be true at once. */
    /* 🔎 EVERY TERM IS KEPT, not just the winner. /src/landvalue publishes a
       signed causal list for the same reason: a reader that only ever sees the
       worst term cannot tell "the water came back" from "something else got
       worse and took the lead", and a driver asserting on the winner alone
       would pass on exactly that confusion. The winner is `reason`; `terms` is
       the whole derivation, worst first, and the two can never disagree
       because the winner is picked out of the same list. */
    const terms = [];
    let best = 1, why = 'ok';
    const bid = (s, id) => { terms.push({ k: id, s: +s.toFixed(4) }); if (s < best) { best = s; why = id; } };

    if (WA) {
      let served = true;
      try { served = WA.servedAt(k) !== false; } catch (e) { served = true; }
      bid(served ? 1 : MOOD.s.water, 'water');
    }
    if (PW) {
      let f = 1;
      try { const r = PW.factorAt(x, z); f = (r && isFinite(r.factor)) ? r.factor : 1; } catch (e) { f = 1; }
      bid(f < MOOD.powerShed ? Math.max(0, Math.min(1, f)) : 1, 'power');
    }
    if (!j.def.noRoadNeed) bid(hasRoad(x, z) ? 1 : MOOD.s.road, 'road');
    if (lit) bid(lit.has(k) ? 1 : MOOD.s.dark, 'dark');
    bid(capScore, 'roadcap');

    /* The city needs. A home is judged on the services people live on; a
       business on the ones a working building needs. Power and water are NOT
       in either list — they are read per tile above, and a city-wide figure
       laid on top of a per-tile fact is how a tile comes to carry two
       different stories about the same supply. */
    const needs = j.home ? ['food', 'health', 'safety', 'light', 'leisure', 'deathcare']
                         : ['safety', 'light'];
    for (const n of needs) {
      const v = cov[n];
      if (!isFinite(v)) continue;
      bid(v < MOOD.needFloor ? Math.max(0, Math.min(1, v)) : 1, 'need:' + n);
    }
    terms.sort((a, b) => a.s - b.s || (a.k < b.k ? -1 : 1));

    const rid = why.indexOf('need:') === 0 ? why.slice(5) : why;
    const face = best >= MOOD.happyAt ? 'ok' : best >= MOOD.crossAt ? 'meh' : 'bad';
    const R = REASONS[rid] || REASONS.ok;
    out.set(k, {
      k, x, z, type: t.type,
      kind: j.home ? 'home' : 'biz',
      score: +best.toFixed(4),
      reason: why === 'ok' ? 'ok' : why,
      terms,
      face,
      ico: face === 'ok' ? REASONS.ok.ico : face === 'meh' ? REASONS.meh.ico : R.ico,
      label: why === 'ok' ? REASONS.ok.label : R.label,
      fix: why === 'ok' ? '' : R.fix,
      cell: face === 'ok' ? REASONS.ok.cell : face === 'meh' ? REASONS.meh.cell : (NEED_CELL[rid] != null && why.indexOf('need:') === 0 ? NEED_CELL[rid] : R.cell),
    });
  }
  cache = out; cacheGen = gen;
  stats.lastMs = +(((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0).toFixed(2);
  return out;
}

function table() {
  if (cacheGen !== gen || !cache) return recompute();
  return cache;
}

/* The signature the repaint is gated on. It is over what is DRAWN — the tile,
   the glyph cell and the height band — and nothing else, so a score that
   wobbled in the fourth decimal without changing the picture uploads nothing.
   Same gate, same reason, as /src/water/overlay.js's `lastSig`. */
function sig(m) {
  const parts = [];
  for (const v of m.values()) if (v.face !== 'ok' || MOOD.drawHappy) parts.push(v.k + ':' + v.cell);
  parts.sort();
  return parts.join('|');
}

/* ════════════════════════════════════════════════════════════════════════════
   THE PAINTER — one THREE.Points, one atlas, one draw call.
   ════════════════════════════════════════════════════════════════════════════ */
let obj = null, geo = null, mat = null, atlas = null, atlasTex = null;
const topCache = new Map();   // tile key + type + lvl → world-space top, in units

function buildAtlas(THREE) {
  const px = MOOD.glyph.px, cols = MOOD.glyph.cols;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = px * cols;
  const g = cvs.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, cvs.width, cvs.height);
  const ids = Object.keys(REASONS);
  for (const id of ids) {
    const r = REASONS[id];
    const cx = (r.cell % cols) * px, cy = Math.floor(r.cell / cols) * px;
    /* A disc behind the glyph, because an emoji drawn straight onto a sky or a
       pale roof loses its outline and reads as a smudge. Same argument the
       phone feed makes for its chips. */
    g.save();
    g.beginPath();
    g.arc(cx + px / 2, cy + px / 2, px * 0.44, 0, Math.PI * 2);
    g.fillStyle = 'rgba(14,16,20,0.82)';
    g.fill();
    g.lineWidth = px * 0.05;
    g.strokeStyle = id === 'ok' ? 'rgba(120,220,140,0.95)' : id === 'meh' ? 'rgba(230,200,110,0.95)' : 'rgba(240,120,110,0.95)';
    g.stroke();
    g.font = Math.round(px * 0.52) + 'px system-ui, "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.fillText(r.ico, cx + px / 2, cy + px / 2 + px * 0.02);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  atlas = cvs;
  return tex;
}

/* How high the glyph floats. The building's OWN mesh decides — a Research Spire
   and a shed must not both get a glyph at storey height — and the box is
   measured once per (tile, type, level) because Box3.setFromObject walks the
   whole group and doing it per repaint on a built-up board is the one thing
   here that could actually cost a frame. */
function topOf(THREE, t, k) {
  const ck = k + '|' + t.type + '|' + (t.lvl | 0);
  const hit = topCache.get(ck);
  if (hit !== undefined) return hit;
  let y = MOOD.glyph.minY;
  try {
    if (t.mesh) {
      const b = new THREE.Box3().setFromObject(t.mesh);
      if (!b.isEmpty() && isFinite(b.max.y)) y = Math.max(MOOD.glyph.minY, b.max.y);
    }
  } catch (e) { y = MOOD.glyph.minY; }
  topCache.set(ck, y);
  return y;
}

const VERT = [
  'attribute float cell;',
  'varying float vCell;',
  'uniform float uSize;',
  'uniform float uPix;',
  'void main() {',
  '  vCell = cell;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = max(4.0, uSize * uPix / max(0.001, -mv.z));',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');

const FRAG = [
  'uniform sampler2D uMap;',
  'uniform float uCols;',
  'varying float vCell;',
  'void main() {',
  '  vec2 uv = gl_PointCoord;',
  '  uv.y = 1.0 - uv.y;',
  '  float col = mod(vCell, uCols);',
  '  float row = floor(vCell / uCols);',
  '  vec2 t = (vec2(col, row) + uv) / uCols;',
  '  vec4 c = texture2D(uMap, t);',
  '  if (c.a < 0.04) discard;',
  '  gl_FragColor = c;',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

function ensureObject() {
  const THREE = H.THREE;
  if (obj) return true;
  atlasTex = buildAtlas(THREE);
  if (!atlasTex) return false;
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geo.setAttribute('cell', new THREE.BufferAttribute(new Float32Array(0), 1));
  mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: atlasTex },
      uCols: { value: MOOD.glyph.cols },
      uSize: { value: MOOD.glyph.size },
      /* Device pixel ratio is baked in at mount rather than read per frame:
         this material has no per-frame hook by design, and a DPR change is a
         resize, which re-mounts nothing today and is not worth a listener. */
      uPix: { value: (typeof window !== 'undefined' && window.devicePixelRatio) || 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    /* depthTest OFF, depthWrite OFF. The glyph is an ANNOTATION: a status icon
       that disappears behind the tower it is describing has failed at the one
       job it has. CS2 draws these over the scene for the same reason. */
    depthTest: false,
    depthWrite: false,
  });
  obj = new THREE.Points(geo, mat);
  obj.name = 'mythic-plot-mood';
  obj.frustumCulled = false;    // the bounding sphere of a rebuilt cloud is stale
  obj.renderOrder = 9000;
  obj.visible = true;
  H.scene.add(obj);
  return true;
}

/* The default painter. Replaceable — see setPainter(). */
function paintPoints(m) {
  if (!H || !H.THREE || !H.scene) return false;
  if (!ensureObject()) return false;
  const THREE = H.THREE;
  const pos = [], cells = [];
  for (const v of m.values()) {
    if (v.face === 'ok' && !MOOD.drawHappy) continue;
    const t = H.game.tiles[v.k];
    if (!t) continue;
    const w = H.worldOf(v.x, v.z);
    pos.push(w.x, topOf(THREE, t, v.k) + MOOD.glyph.lift, w.z);
    cells.push(v.cell);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('cell', new THREE.BufferAttribute(new Float32Array(cells), 1));
  geo.setDrawRange(0, cells.length);
  geo.attributes.position.needsUpdate = true;
  geo.attributes.cell.needsUpdate = true;
  return true;
}

/* ════════════════════════════════════════════════════════════════════════════
   THE API
   ════════════════════════════════════════════════════════════════════════════ */
const API = {
  ready: () => mounted,

  mount(ctx) {
    if (mounted) return true;
    if (!ctx || !ctx.game || !ctx.BUILDINGS || !ctx.key) return false;
    for (const need of ['isRoadTile', 'bldSite', 'litKeys', 'roadUsed', 'roadCap', 'worldOf'])
      if (typeof ctx[need] !== 'function') { console.warn('[PlotMood] mount is missing ' + need); return false; }
    H = ctx;
    painter = paintPoints;
    mounted = true;
    gen++; dirty = true;
    return true;
  },

  /* ── ⚡ THE HOT PATH. O(1), and it must stay O(1): this is called from every
        placement seam in the game, including inside a road drag that lays
        twenty tiles in one gesture. It does no work — it only records that the
        work is owed. ── */
  invalidate(why) {
    if (!mounted) return false;
    gen++;
    dirty = true;
    lastWhy = String(why || 'city');
    stats.invalidations++;
    return true;
  },

  /* ── The host's 0.5 s HUD beat. The FIRST line is the whole contract. ── */
  beat() {
    if (!mounted) return false;
    stats.beats++;
    if (!dirty) { stats.skipped++; return false; }
    dirty = false;
    return API.repaint();
  },

  /* Recompute and, only if the picture actually moved, redraw. */
  repaint(force) {
    if (!mounted) return false;
    const m = table();
    const s = sig(m);
    if (!force && s === lastSig) { stats.skipped++; return false; }
    lastSig = s;
    stats.repaints++;
    try { return !!(painter && painter(m)); } catch (e) { console.warn('[PlotMood] paint', e); return false; }
  },

  /* ── The reads. Recompute on demand if a seam invalidated since the last
        pass, so a driver or a console never sees a stale answer just because
        the HUD beat has not come round yet. ── */
  moodAtKey(k) { return mounted ? (table().get(String(k)) || null) : null; },
  moodAt(x, z) { return API.moodAtKey(H ? H.key(x, z) : (x + ',' + z)); },
  all() { return mounted ? Array.from(table().values()) : []; },

  report() {
    if (!mounted) return { ok: false, why: 'not mounted' };
    const m = table();
    const by = {};
    let happy = 0, meh = 0, bad = 0;
    for (const v of m.values()) {
      by[v.reason] = (by[v.reason] || 0) + 1;
      if (v.face === 'ok') happy++; else if (v.face === 'meh') meh++; else bad++;
    }
    /* The road meter, reported beside the counts because `roadcap` is the one
       term whose source is a CITY figure a reader cannot see on the tile. A
       frown nobody can trace to a number is the failure this whole file is
       written against, so the number travels with it. */
    let road = null;
    try { const u = H.roadUsed(), c = H.roadCap(); road = { used: u, cap: c, frac: +(u / Math.max(1, c)).toFixed(3) }; } catch (e) { road = null; }
    return { ok: true, judged: m.size, happy, meh, bad, byReason: by, road,
             gen, dirty, lastWhy, drawn: geo ? (geo.drawRange.count | 0) : 0, stats: { ...stats } };
  },

  layer(on) { if (obj) obj.visible = on !== false; return !!(obj && obj.visible); },
  layerVisible() { return !!(obj && obj.visible); },
  mesh: () => obj,
  atlasCanvas: () => atlas,
  setPainter(fn) { painter = (typeof fn === 'function') ? fn : paintPoints; lastSig = ''; return true; },
  tuning: MOOD, REASONS,

  /* 🔍 The self-check, printed only when it fails — same contract as
     /src/power's verify() and /src/roads'. Silence is a pass. */
  verify() {
    if (!mounted) return { ok: false, why: 'not mounted' };
    const bad = [];
    const m = table();
    for (const v of m.values()) {
      if (!isFinite(v.score)) bad.push(v.k + ': score is not finite');
      if (v.score < 0 || v.score > 1) bad.push(v.k + ': score ' + v.score + ' is outside 0..1');
      if (!v.reason) bad.push(v.k + ': no reason');
      if (v.face !== 'ok' && !v.fix) bad.push(v.k + ': reason "' + v.reason + '" has no fix to offer');
      const t = H.game.tiles[v.k];
      if (t && H.bldSite(t)) bad.push(v.k + ': a construction SITE was judged — the scaffold guard is broken');
    }
    /* The cost line, so "one draw call" is a measurement and not a claim. */
    return { ok: !bad.length, problems: bad.slice(0, 20), judged: m.size,
             objects: obj ? 1 : 0, drawCalls: obj && obj.visible ? 1 : 0,
             points: geo ? (geo.drawRange.count | 0) : 0,
             atlasPx: atlas ? atlas.width : 0, lastMs: stats.lastMs };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicPlotMood = API;
    /* node-city may finish booting before or after this module evaluates —
       module scripts are deferred and import order is not guaranteed — so the
       host calls mount() when IT is ready and this line only announces that the
       API exists. Same handshake /src/water, /src/power and /src/landvalue use. */
    if (typeof window.__ncPlotMoodReady === 'function') window.__ncPlotMoodReady(API);
  }
} catch (e) {}

export default API;
