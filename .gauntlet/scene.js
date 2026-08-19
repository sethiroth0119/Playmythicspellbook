/* ══ THE STANDARD GAUNTLET CITY ══════════════════════════════════════════
   Runs inside the page via page.evaluate. Places a fixed district through the
   SHIPPED __nc.place() → tryPlace() path, so what gets photographed is what a
   player would actually see — not a test-only mesh dump.

   Deterministic: fixed tile list, and makeHousing seeds its archetype off the
   tile coords, so an A/B between rounds compares RENDERS, not layouts.

   🔴 SIX GATES stand between this file and a district, and every one of them
   cost a debugging round to find. THE FIRST THREE ARE STUBBED OR SEQUENCED;
   THE LAST THREE ARE SATISFIED THE WAY A PLAYER SATISFIES THEM, and which is
   which is the whole difference between a harness and a lie. Every one of them
   is named in the returned `gates` array at run time, so the capture JSON says
   out loud what the scene had to do to get the city up.
     1. COST — canAfford/payCost consult MythicCityBridge, NOT game.res. Stub
        getRes/getCinders or nothing is affordable.
     2. CREW SLOTS — bldCommitted() >= bldSlots() refuses the placement outright
        ("every crew is working"). So each batch is followed by bld.finishAll();
        that both frees the slots AND turns scaffold sites into buildings.
     3. ROAD CAP — ROAD_CAP_BASE 40, +10 per FINISHED Supply Depot. Depots cost
        pop, pop comes from housing, so the order below is forced:
        housing → finish → depots → finish → roads.
     4. THE PROGRESSION TREE (/src/progression, wired into tryPlace this
        session). A locked BUILDING is refused outright — which is why this
        scene silently stopped placing every tree, bush, garden and Retail
        Parade in it. The scene grants the nodes through MythicProgress._grant,
        the module's own documented test seam, and LISTS THEM WITH THEIR POINT
        COST in `gates`: a district built on 12 development points is a
        different claim from one built on none, and a reader is entitled to it.
     5. THE MUNICIPAL CEILING — bldOpType() === null && durSec > 2400 s and no
        Construction Co. standing. NOT stubbed: the scene collects the free
        Construction Co. licence and SITES ONE, which is exactly the route the
        refusal text names ("Pick up a Construction Co. at City Hall — it is
        free — and site it first"). That one building is what lets the shops,
        the arena and the med lab exist at all.
     6. THE LONG-ORDER CONFIRM — bldConfirmLong() calls window.confirm for
        anything over ECON.confirmOverSec (1 h). Headless Chromium AUTO-DISMISSES
        a dialog nobody handles, so the answer was "Cancel" and tryPlace returned
        with NO TOAST AT ALL — a refusal invisible even to the `fails` map.
        The scene answers yes, counts the questions, and puts window.confirm back.
   Grid is 0..23; the world origin sits at HALF, so C=12 is under the camera. */
(async () => {
  const nc = window.__nc; if (!nc) return 'no __nc';
  const B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders   = async () => 9e9;  B.getRes  = async () => 9e9;
           B.addCinders   = async () => true; }

  const C = 12;
  const fails = {};
  /* 🔴 WHY, NOT JUST HOW MANY. For ten rounds this scene reported `fails` as a
     bare count — {retail: 3, shop: 3, arena: 1, …} — and every reader of that
     JSON, human and agent, assumed one cause (the municipal ceiling) for all of
     them. Measured, there were four different causes and two of them were
     nothing to do with duration. tryPlace() already writes a refusal sentence
     that says both what is wrong AND how to fix it; `toast` routes it through
     window.__ncToastSink when one is installed (index.html ~29345, put there
     for /src/zoning's bulk runs). So the reason is CAPTURED, never re-derived:
     a second copy of the gate logic in the harness is how a harness starts
     disagreeing with the game it is photographing. */
  const why = {};
  /* Which gates this scene had to satisfy to build the district, in the scene's
     own words. A scene that quietly opens a lock is indistinguishable from a
     scene that never met one. */
  const gates = [];
  let _sink = null;
  /* ⏳ THE LONG-ORDER CONFIRM, answered. bldConfirmLong() asks window.confirm
     for any order over ECON.confirmOverSec (3600 s) — and in headless Chromium
     an unhandled dialog is AUTO-DISMISSED, i.e. answered "Cancel". That is not
     a rule the game is enforcing, it is the absence of a player: tryPlace then
     returned having emitted no toast at all, so the refusal did not even show
     up as a reason in the map above. Shop / arena / med lab were ALL refused
     here after the municipal ceiling was properly satisfied, and the symptom
     was a silent nothing.
     ⚠ Restored at the end of the run — a scene that leaves a stubbed confirm
       behind would make every later driver in the same page answer yes to
       questions it never saw. */
  const _confirm0 = window.confirm;
  let _confirmed = 0;
  window.confirm = () => { _confirmed++; return true; };
  window.__ncToastSink = (msg, cls) => { if (cls === 'bad' && _sink) _sink.push(msg); };
  const done = () => { try { nc.build.finishAll('gauntlet capture'); } catch (e) {} };
  /* ⚠ done() runs after EVERY placement, not per batch: bldSlots() is the
     municipal 2 free crew, so the THIRD order in a row is refused outright. */
  const P = async (t, x, z) => {
    _sink = [];
    try { await nc.place(t, x, z); } catch (e) { _sink.push('threw: ' + e); }
    const msgs = _sink; _sink = null;
    done();
    if (!nc.game.tiles[x + ',' + z]) {
      fails[t] = (fails[t] || 0) + 1;
      const r = (msgs[0] || 'refused silently — no toast (tryPlace returned before any gate spoke)').slice(0, 150);
      (why[t] ||= {})[r] = (why[t][r] || 0) + 1;
    }
  };
  const fill = async (x0, x1, z0, z1, ty) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { await P(ty, x, z); }
  };

  /* ── 0. THE PROGRESSION TREE ────────────────────────────────────────────
     🔴 THIS IS WHY THE DISTRICT HAD NO SHOPS AND NO PLANTING. /src/progression
     gained a placement gate in tryPlace this session, and from that moment the
     standard scene stopped placing three Retail Parades, three trees, two
     bushes, two gardens and the fountain — silently, because a refusal is a
     toast and nobody was listening to toasts. The `fails` map recorded a count
     and ten rounds of readers attributed all of it to the municipal ceiling.

     GRANTED, NOT STUBBED. `_grant` is the module's own documented test seam
     ("it grants a node without spending, so a driver can prove a downstream
     gate opens without first simulating 400 residents"). The gate still runs;
     the scene is a city that DID the research. What is not honest is doing that
     quietly, so every node is listed with its point cost in `gates`, and the
     total is the price of admission for this district.

     ⚠ req chains are included explicitly (civ_services before civ_parks,
       sci_lab before sci_genetics). _grant does not walk them for you, and a
       node whose parent is missing is a downstream reader's problem, not this
       file's, the day one of them starts checking. */
  {
    const Pg = window.MythicProgress;
    const WANT = [
      ['civ_services',  1, 'clinic / fire / police — the req of Parks'],
      ['civ_parks',     1, 'garden, fountain, tree, bush'],
      ['com_high',      2, 'the three Retail Parades of the high street'],
      ['civ_landmark',  3, 'the Duel Arena'],
      ['sci_lab',       1, 'the req of Applied Genetics'],
      ['sci_genetics',  4, 'the Med Lab'],
      /* 🏢 ROUND 17. `office` is gated on off_low, which is the node that
         already opened the `o_low` Office park zone — the building and its
         zone unlock together because they are the same decision. Without this
         grant the three Office Blocks in block 6 are refused by
         MythicProgress.buildingBlockedBy and the district goes back to having
         no office in it, which is the hole round 17 exists to close. */
      ['off_low',       2, 'the Office Block and the o_low Office park zone'],
      /* ⛏ THE EXTRACTION ROUND. `deepmine` and `alloyworks` joined the node
         that already opens `scrapmine` and `quarry`; without this grant block 7
         is refused by MythicProgress.buildingBlockedBy and the two new mines
         never reach a frame — which is precisely how three trees, two bushes,
         two gardens, a fountain and three Retail Parades disappeared out of
         this scene for ten rounds without anyone noticing. */
      ['ind_extract',   1, 'the Deep Mine and the Strategic Minerals Works'],
    ];
    if (!Pg) gates.push('progression: MODULE ABSENT — nothing gated, nothing granted');
    else {
      let pts = 0; const got = [];
      for (const [id, cost, what] of WANT) {
        let ok = false; try { ok = Pg._grant(id); } catch (e) { ok = false; }
        if (ok) { pts += cost; got.push(id + ' (' + cost + 'dp: ' + what + ')'); }
        else got.push(id + ' (GRANT FAILED)');
      }
      gates.push('progression: granted ' + pts + ' development points of research via _grant — ' + got.join('; '));
    }
  }

  /* ── 1. housing, in blocks, first: it is the only pop source ───────────── */
  await fill(C - 7, C - 5, C - 7, C - 5, 'housing');
  await fill(C - 3, C - 1, C - 7, C - 5, 'housing');
  await fill(C + 1, C + 3, C - 7, C - 5, 'housing');
  await fill(C - 7, C - 5, C - 3, C - 1, 'housing');
  await fill(C - 3, C - 1, C - 3, C - 1, 'housing');
  await fill(C - 7, C - 5, C + 1, C + 3, 'housing');

  /* ── 2. depots, to buy road capacity ──────────────────────────────────────
     🔴 AND THE THREE IN THE ZONING BLOCK ARE BOUGHT HERE, NOT WITH THE REST OF
     THAT BLOCK, because ROAD_CAP_BASE is 40 and each FINISHED depot adds 10 —
     so how many depots stand before step 3 decides how much of the street grid
     exists at all. With six, the cap is 100 and the grid runs out mid-way
     through the third row: rows z = 16 and z = 20 and columns x = 16 and x = 20
     were NEVER BUILT in any capture this harness has taken, which is why the
     standard city is a cross rather than a grid, and why block 5's retail row
     fronted open grass the first time it was placed. Nine depots buy 130.
     ⚠ THE THREE ARE AT THEIR FINAL ZONING-BLOCK TILES, not somewhere temporary.
       Placing them here and moving them later would be two different cities. */
  for (const [x, z] of [[C+7,C+7],[C+8,C+7],[C+7,C+8],[C+8,C+8],[C+9,C+7],[C+9,C+8],
                        [C+1,C+1],[C+2,C+1],[C+3,C+1]]) {
    await P('depot', x, z); done();
  }

  /* ── 2b. THE CONSTRUCTION CO. — the one building that unlocks the rest ────
     🔴 EVERY CINDER EARNER IN THIS GAME SITS ABOVE THE MUNICIPAL CEILING. The
     free Municipal Works crew takes nothing longer than ECON's
     municipal.maxSec (40:00), and the shop is 2:02:01, the med lab 1:28:29,
     the arena 3:23:16. Block 4 has been asking for all three since round 1 and
     getting all three refused, and the refusal text has always said what to do
     about it: "Pick up a 🏗 Construction Co. at City Hall — it is free — and
     site it first."

     So the scene does that, through the shipped path and nothing else:
       · the licence is COLLECTED at zero price by opsAcquireFree — the very
         function opsCityHall() calls when a player clicks PLACE on a card they
         do not yet hold, and the same one the node-holder boot grant uses. It
         is reached through __nc.build.acquire, which exists for exactly this.
       · the building is then PLACED with the ordinary nc.place() every other
         line in this file uses. It is an op, so it is exempt from the ceiling
         itself (op_construction computes to ~15 min) — the bootstrap closes.
     After it stands, bldCoTiles() is non-empty and the ceiling no longer binds.

     ⚠ IT IS A REAL BUILDING IN THE DISTRICT, not a fixture parked off camera:
       a machine-shop yard at (C+5, C+1), directly across the x = C+4 street
       from the three Supply Depots of block 5, so it extends that industrial
       row rather than contaminating the retail one.
     ⚠ IT ALSO RAISES bldSlots() AND bldSpeed(). Neither matters here — every
       placement is followed by finishAll() — but it is why this cannot simply
       move later in the file: a scene that sites it after block 4 would still
       photograph a district with no shops in it. */
  {
    let lic = null;
    try { lic = await nc.build.acquire('construction'); } catch (e) { lic = { ok: false, reason: String(e) }; }
    await P('op_construction', C + 5, C + 1); done();
    /* 🔴 SITING AN OP OPENS THE DOSSIER. opsSite's success path ends with
       openInspect(pk) — reasonable for a player, fatal for a capture: the panel
       is ~1000x700 of opaque chrome across the middle of a 1600x900 frame and
       the FIRST capture taken after this block landed photographed the
       Construction Co.'s dossier instead of the city. Closed the way a player
       closes it (Escape / the x button both call this). */
    try { nc.closeInspect(); } catch (e) {}
    const co = Object.values(nc.game.tiles).filter(t => t.type === 'op_construction').length;
    gates.push('municipal ceiling: Construction Co. licence ' +
      ((lic && lic.ok) ? ('acquired free (' + lic.reason + ')') : 'NOT acquired') +
      ', ' + co + ' sited — the shipped route the refusal text names. ' +
      (co ? 'Shop / arena / med lab are buildable from here.' : 'THE CEILING STILL BINDS.'));
  }

  /* ── 3. the street grid ───────────────────────────────────────────────── */
  for (const r of [C - 8, C - 4, C, C + 4, C + 8]) {
    for (let i = C - 9; i <= C + 9; i++) { await P('road', i, r); await P('road', r, i); }
    done();
  }

  /* ── 4. commerce, industry and greenery — the CS2 frames are mixed-use, so
         a housing-only shot would flatter us ──────────────────────────────── */
  /* ⚠ ['tenantbiz', C+3, C-2] USED TO BE HERE AND IS NOT A BUILDING. `tenantbiz`
     is a MESH NAME — the recipe buildMesh() uses for a `lot` that has a tenant
     on it — and there has never been a BUILDINGS entry for it. So tryPlace()
     hit `const def = BUILDINGS[placeType]; if (!def) return;` and returned
     before a single gate spoke: no toast, no tile, and the only trace was a
     bare 1 in the `fails` map. It was in the standard city for eleven rounds
     and it never once drew anything. The leased plot it was meant to be is now
     made properly, at the bottom of this block. */
  for (const [t, x, z] of [
    ['shop', C+1, C-3], ['shop', C+2, C-3],
    ['lot', C+1, C-1],  ['garden', C+2, C-1], ['tree', C+3, C-3],
    ['lot', C+3, C-2],
    /* ⚠ ['gasstation', C+1, C+1] and ['forge', C+3, C+3] USED TO BE HERE and
       are removed, not moved. Both are far above the municipal build ceiling
       (see block 5) and have been refused on every capture this harness has
       ever taken, so they occupied two tiles of the standard city on paper and
       none of it in the render — while colliding with two of the tiles block 5
       now uses. If a future scene grows a Construction Co., put them back
       somewhere block 5 is not. */
    ['farm', C-3, C+2], ['tree', C-1, C+1], ['bush', C-2, C+3],
    ['arena', C+6, C-6], ['medlab', C+5, C-2], ['shop', C+6, C-2],
    ['tree', C-5, C+5], ['bush', C-6, C+5], ['garden', C-7, C+5],
    ['fountain', C-2, C-2],
  ]) { await P(t, x, z); done(); }
  done();

  /* 🪧 THE LEASED PLOT. A `lot` with a tenant on it renders as `tenantbiz` — a
     small commercial unit — and that is the only way that mesh ever reaches a
     city. Leasing is a real player action; the only reason the scene cannot
     click it is that the button opens pickPlayerModal(), a live player search.
     So it makes the same two calls the inspect handler makes when the picker
     resolves: MythicCityBridge.leasePlot (the shipped bridge call, mocked here
     exactly as every other bridge call in this capture is) and then
     __nc.repaint(key) — which IS the handler's dropTileMesh/buildMesh/placeMeshAt
     line, exposed on the seam for precisely this. Nothing is re-derived.
     ⚠ Guarded end to end: a bridge that refuses leaves an ordinary vacant lot,
       which is what the district had before, and says so in `gates`. */
  {
    const lk = (C + 3) + ',' + (C - 2);
    const lt = nc.game.tiles[lk];
    let leased = null;
    if (lt && lt.type === 'lot') {
      try { leased = await window.MythicCityBridge.leasePlot(lk, 'Gauntlet Holdings'); } catch (e) { leased = null; }
      if (leased && leased.tenant) { lt.tenant = leased.tenant; try { nc.repaint(lk); } catch (e) {} }
    }
    gates.push('tenant business: lot ' + lk + ' ' +
      ((leased && leased.tenant) ? ('leased to ' + leased.tenant + ' — renders as tenantbiz')
                                 : 'NOT leased — it stays a vacant lot'));
  }

  /* ── 5. THE ZONING BLOCK (round 11) ────────────────────────────────────────
     Rubric dimension 11 asks whether a viewer can tell residential from
     commercial from industrial FROM THE AIR. Until this round the standard city
     could not answer the question, and not because the buildings were poor:

       · 54 of the 172 tiles are housing and the six Supply Depots are the only
         non-residential BUILDINGS that actually go up. Everything in list 4
         above — three shops, the tenant business, the gas station, the Trust,
         the arena, the med lab — is REFUSED, every time. They are all above the
         40-minute municipal build ceiling (C.municipal.maxSec = 2400 s: shop
         7,321 s, arena 12,196 s) and this city has no Construction Co., so the
         order gate turns them away before a tile is ever written. Read the
         `fails` map in the capture JSON; it has said so for ten rounds.
         ⚠ ROUND 12: the shops, the arena and the med lab DO go up now — block 2b
           sites a Construction Co., which is what the refusal always told the
           reader to do. And `tenantbiz` was never refused by anything: it is a
           mesh name, not a building, so tryPlace returned at `if (!def) return`
           and eleven rounds of this list contained a line that drew nothing.
       · AND THE SIX DEPOTS ARE OFF CAMERA. They sit at (C+7…C+9, C+7…C+8),
         which is world (7.5…9.5, 7.5…8.5) — between the aerial camera and its
         target, BELOW the view ray, and behind the district camera entirely.
         Worked out from the framing maths in capture.mjs, then checked in the
         render: neither frame contains a single one of them.

     So the district that has been photographed for ten rounds is housing, a
     vacant lot, two gardens and some trees. This block is the mixed use the
     frames were always supposed to contain, put where the camera is actually
     looking: (C+1…C+3, C+1…C+3) is world (1.5…3.5, 1.5…3.5), which lands at
     roughly frame centre in the aerial and in the near half of the district
     shot.

     THE LAYOUT IS THE POINT, not the buildings. Three rows, back to front:
       z = C+1   three Supply Depots — flat sheds, dock aprons, hazard chevrons
                 (placed up in block 2: see the road-cap note there)
       z = C+2   two Motor Pools — surface car parks, nothing standing on them
       z = C+3   three Retail Parades — wall-to-wall, fascia band, forecourt,
                 fronting the z = C+4 street — which only exists because block 2
                 now buys enough road cap to reach it
     A viewer reading down that block crosses industrial, then open ground use,
     then a high street, then (across the road) the housing — which is exactly
     the comparison the rubric asks for, in one frame, at the default camera.

     ⚠ EVERY TYPE HERE IS UNDER THE MUNICIPAL CEILING: depot 1,388 s, motorpool
       756 s, retail 1,875 s. THAT WAS NOT ENOUGH, AND THIS COMMENT SAID IT WAS.
       🔴 The three Retail Parades — the entire high street this block was built
       to demonstrate — NEVER PLACED. Not once, in any capture of round 11. The
       ceiling was satisfied and a SECOND gate refused them: /src/progression
       wants High-Density Commercial (2 dp), and a locked building is turned away
       by tryPlace before duration is ever considered. So what this block
       actually put on film was three depots and three car parks: industrial,
       then parking, then nothing — the opposite half of the comparison it
       exists to make. Read block 0; the node is granted there now.
       The general lesson is the one this comment already had and got wrong:
       CHECK THE REFUSAL, NOT THE DURATION. `why` in the returned object carries
       the game's own sentence for every tile that did not place, and a count
       with no reason beside it is what let this stand for a whole round. */
  for (const [t, x, z] of [
    /* Three car parks, not two with a tree between them. A single tile of bays
       is a grey square at the aerial camera; three contiguous tiles are 24 bays,
       an aisle and three planted islands, which is the only version of this that
       reads as GROUND USE rather than as an empty plot. (The Decoration tree
       that used to sit in the middle also put a 0.6-wide blossom crown across
       the block's centre line, i.e. across the thing being demonstrated.) */
    ['motorpool', C+1, C+2], ['motorpool', C+2, C+2], ['motorpool', C+3, C+2],
    ['retail', C+1, C+3], ['retail', C+2, C+3], ['retail', C+3, C+3],
  ]) { await P(t, x, z); done(); }
  done();

  /* ── 6. THE OFFICE ROW (round 17) ────────────────────────────────────────
     🔴 THERE WAS NO OFFICE BUILDING IN THIS GAME UNTIL THIS ROUND, so there has
     never been one in a gauntlet frame either — and rubric dimension 11 asks
     whether a viewer can tell the land uses apart from the air. The block above
     lets a viewer cross industrial → open ground use → high street → housing.
     This row adds the fourth land use to the SAME street: three Office Blocks
     at z = C+3, x = C+5..C+7, fronting the z = C+4 carriageway from the far
     side of the x = C+4 junction, i.e. directly in line with the three Retail
     Parades at x = C+1..C+3. Reading east along that one frontage a viewer now
     crosses a parade of single-storey shopfronts and then three freestanding
     glazed blocks four times their height with car parks in front of them,
     which is the comparison the rubric actually asks for and the frontage
     camera is pointed at.
     ⚠ THE TILES ARE INSIDE THE EXISTING BOUNDING BOX (block 5's depots reach
       x = C+9), so the aerial / street / district framings — which capture.mjs
       derives from that box and which the README requires to be unchanged since
       round 0 — do not move.
     ⚠ EACH HAS ROAD FRONTAGE: (C+5..C+7, C+4) are all carriageway from step 3. */
  for (const [t, x, z] of [
    ['office', C+5, C+3], ['office', C+6, C+3], ['office', C+7, C+3],
  ]) { await P(t, x, z); done(); }
  done();

  /* ── 7. THE EXTRACTION ROW ───────────────────────────────────────────────
     🔴 THE SURVEY GRADED 52 DEPOSITS AND 19 OF THEM HAD NO BUILDING. These are
     the five tiles that close 18 of the 19, and they are here for the same
     reason the office row is: a land use nothing in this harness has ever
     photographed cannot be judged on dimension 11 ("can a viewer tell the land
     uses apart from the air"). Read west→east along z = C+5, fronting the same
     z = C+4 carriageway the office row backs onto, a viewer now crosses open
     water basins, a shaft tower and silo, leach ponds and tanks, a cut cane
     field and — where the ground allows it — a rift collar.
     ⚠ THE TILES ARE INSIDE THE EXISTING BOUNDING BOX (block 2's depots reach
       x = C+9, z = C+8), so the aerial / street / district framings, which
       capture.mjs derives from that box and which the README requires to be
       unchanged since round 0, do not move.
     ⚠ EACH HAS ROAD FRONTAGE: (C+5..C+9, C+4) are all carriageway from step 3.

     🔴 AND THIS BLOCK IS THE FIRST IN THIS FILE WHOSE REFUSALS ARE A RESULT
        RATHER THAN A FAULT. All five are gated by the GROUND now
        (ecoGroundRefusal → MythicEconomy.pickAvailable → endowment.js), so on a
        node whose survey says NONE for every seam a building works, that
        building is refused and the game's own sentence lands in `why`. A `fails`
        entry here is not necessarily a bug in the scene — read `why`, and read
        `groundSurvey` below, which prints what this node actually carries. */
  for (const [t, x, z] of [
    ['waterintake', C+5, C+5], ['deepmine', C+6, C+5], ['alloyworks', C+7, C+5],
    ['canecroft', C+8, C+5], ['riftbore', C+9, C+5],
  ]) { await P(t, x, z); done(); }
  done();
  /* What the ground under this scene actually carries, straight out of the
     shipped gate rather than re-derived — so a reader can tell a refusal that
     is the RULE WORKING from a refusal that is the scene being wrong. */
  try {
    const E = window.MythicEconomy;
    if (E && E.ready()) {
      const rows = {
        waterintake: ['rawWater'],
        deepmine: ['goldOre', 'silverOre', 'platinumOre', 'rareMinerals', 'quartz'],
        alloyworks: ['lithium', 'cobalt', 'titanium', 'tungsten', 'rareEarthMinerals'],
        canecroft: ['sugarCrops', 'seeds'],
        riftbore: ['anomalousMatter', 'realityMatter', 'soulEnergy', 'dimensionalMaterial', 'realityFragments'],
      };
      const survey = {};
      for (const k in rows) survey[k] = E.pickAvailable(rows[k]) || 'NONE — the ground refuses this building';
      gates.push('ground gate: ' + JSON.stringify(survey));
    } else gates.push('ground gate: economy not mounted — the gate fails OPEN, all five placeable');
  } catch (e) { gates.push('ground gate: threw ' + e); }

  /* 🚗 SPAWN THE CROWD — AND THEN ACTUALLY STEP IT.
     Round 1 found that manageAgents() is only called from animate() and a few
     state changes, and rAF never fires here, so the city was photographed
     empty. Calling it directly fixed the CENSUS and nothing else: round 2
     reported 29 agents and still produced zero visible vehicles and zero
     visible citizens across three frames. Measured this round, the reason is
     three separate things, none of them the art:

       1. THE CROWD WAS SPAWNED INTO A CITY THAT DID NOT EXIST YET.
          bld.finishAll() itself calls manageAgents(), and scene.js calls
          finishAll() after EVERY placement (see the crew-slot gate above), so
          the census was already satisfied when the road network was two tiles
          long. Measured: all 29 agents sat on the first three road keys ever
          laid — 3 unique positions out of 100 road tiles, all in one corner.
       2. NOTHING EVER STEPPED THEM. agentTick(dt) runs from animate() only.
          Measured: 2 rAF callbacks in 2 wall seconds, 6 of 29 agents moving.
          So every one of them was parked at path index 0 forever.
       3. EVERY ONE OF THEM WAS INVISIBLE. cullAgents() hides agents past
          QUALITY.cull, the governor drops to the 'potato' tier under
          SwiftShader (cull 15, against an 18-unit district), and it last ran
          with the BOOT camera. capture.mjs then moves the camera by hand and
          calls renderer.render() directly, so the stale visible=false rode
          straight into all three screenshots. Measured: 29/29 invisible, and a
          with-agents / without-agents pixel diff of ZERO on the aerial frame.

     So: bin the crowd that construction spawned, re-census it against the
     FINISHED network, and then run the tick the way animate() would. */
  for (const a of nc.agents().slice()) { try { nc.despawnAgent(a); } catch (e) {} }
  try { nc.manageAgents(); } catch (e) {}
  await new Promise(r => setTimeout(r, 200));
  try { nc.manageAgents(); } catch (e) {}

  /* Step at a fixed 1/30 s — animate() clamps dt to .25 and this box renders at
     ~0.6 fps, so borrowing the real clock would teleport agents a quarter of a
     tile a frame and skip the tile-transition bookkeeping.
     STOP AT A GOOD MOMENT rather than after a fixed count: enterChance is .9
     for a civilian, so a long enough run puts most of the crowd indoors
     (state 'inside' → visible = false) and photographs an empty street for a
     third round. The exit test is the honest one — spread out, mostly outdoors
     — and it picks a real moment of the simulation, it does not stage one. */
  let stepped = 0, spread = 0, out = 0;
  try {
    for (let blk = 0; blk < 60; blk++) {
      for (let i = 0; i < 15; i++) { nc.agentTick(1 / 30); stepped++; }
      const A = nc.agents();
      out = A.filter(a => a.state !== 'inside').length;
      spread = new Set(A.map(a => a.mesh.position.x.toFixed(1) + ',' + a.mesh.position.z.toFixed(1))).size;
      if (blk >= 8 && spread >= 14 && out >= A.length * 0.8) break;
    }
  } catch (e) {}
  /* Put the player back where the page found them. */
  try { nc.closeInspect(); } catch (e) {}
  window.confirm = _confirm0;
  window.__ncToastSink = null;
  gates.push('long-order confirm: answered yes ' + _confirmed +
             ' time' + (_confirmed === 1 ? '' : 's') + ' (window.confirm restored afterwards)');
  const tiles = Object.values(nc.game.tiles);
  let crowd = { total: 0 };
  try {
    crowd = { total: nc.agents().length, want: nc.counts(), stepped, spread, outdoors: out,
              byKind: nc.agents().reduce((a, g) => (a[g.kind] = (a[g.kind]||0)+1, a), {}) };
  } catch (e) { crowd = { err: String(e) }; }
  /* 🅿 The standing fleet. It is NOT an agent — no tick, no path — so it is
     reported separately and it is the half of the vehicle count that survives
     any framing, including one pointed at a street the traffic happens not to
     be on this second. */
  let parkedN = -1;
  try { parkedN = window.MythicParking ? window.MythicParking.count() : -1; } catch (e) {}

  /* 🔒 THE DETERMINISM FINGERPRINT, returned by every run so the claim in
     README ("two boots compare renders, not layouts") is checkable from any
     capture rather than by a special tool nobody runs.
       · `tileHash` is the LAYOUT — every key, type, level, rotation and tenant.
         IT MUST BE IDENTICAL between two boots of one commit. If it ever is
         not, an A/B between rounds is comparing two different cities and every
         pixel figure taken from it is void.
       · `meshHash` is every mesh in the scene, agents excluded, by world
         position and full vertex checksum. It is EXPECTED TO DIFFER, and that
         is a game-side property, not a harness bug: buildMesh passes (tx, tz)
         but only housing, tree, bush and garden read it, so `farm`, `lot`,
         `shop` and `machineshop` re-roll from Math.random on every boot —
         about 19 meshes out of 1,982 — and the sun and moon discs move a few
         thousandths because the clock is pinned to an HOUR, not to an instant.
         Reported anyway: a number that is allowed to move still tells you HOW
         MUCH moved, and a sudden jump in `staticMeshes` beside it is a real
         signal. */
  const _h = (str) => { let x = 2166136261;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return (x >>> 0).toString(16); };
  let layout = { err: 'not computed' };
  try {
    const { scene, THREE } = nc.three();
    const skipUu = new Set();
    for (const a of nc.agents()) a.mesh.traverse(o => skipUu.add(o.uuid));
    const rows = [];
    scene.traverse(o => {
      if (skipUu.has(o.uuid) || (!o.isMesh && !o.isPoints && !o.isLine)) return;
      const g = o.geometry;
      o.updateWorldMatrix(true, false);
      const pos = o.getWorldPosition(new THREE.Vector3());
      let cs = 0;
      if (g && g.attributes && g.attributes.position) {
        const arr = g.attributes.position.array;
        for (let i = 0; i < arr.length; i++) cs = (cs * 31 + Math.round(arr[i] * 1000)) | 0;
      }
      rows.push([o.type, pos.x.toFixed(3), pos.y.toFixed(3), pos.z.toFixed(3), cs].join('|'));
    });
    rows.sort();
    const tk = Object.entries(nc.game.tiles).sort()
      .map(([k, t]) => k + ':' + t.type + ':' + t.lvl + ':' + (t.rot | 0) + ':' + (t.tenant || '')).join(' ');
    layout = { tileHash: _h(tk), meshHash: _h(rows.join('\n')), staticMeshes: rows.length };
  } catch (e) { layout = { err: String(e) }; }

  return { placed: tiles.length, fails, why, gates, layout, crowd, parked: parkedN,
           sites: tiles.filter(t => t.bld).length,
           types: Object.entries(tiles.reduce((a, t) => (a[t.type] = (a[t.type]||0)+1, a), {})) };
})()
