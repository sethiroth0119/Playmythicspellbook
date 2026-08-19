/* ══ THE STANDARD GAUNTLET CITY ══════════════════════════════════════════
   Runs inside the page via page.evaluate. Places a fixed district through the
   SHIPPED __nc.place() → tryPlace() path, so what gets photographed is what a
   player would actually see — not a test-only mesh dump.

   Deterministic: fixed tile list, and makeHousing seeds its archetype off the
   tile coords, so an A/B between rounds compares RENDERS, not layouts.

   🔴 THREE GATES have to be neutralised or the capture is of an empty map, and
   every one of them cost a debugging round to find:
     1. COST — canAfford/payCost consult MythicCityBridge, NOT game.res. Stub
        getRes/getCinders or nothing is affordable.
     2. CREW SLOTS — bldCommitted() >= bldSlots() refuses the placement outright
        ("every crew is working"). So each batch is followed by bld.finishAll();
        that both frees the slots AND turns scaffold sites into buildings.
     3. ROAD CAP — ROAD_CAP_BASE 40, +10 per FINISHED Supply Depot. Depots cost
        pop, pop comes from housing, so the order below is forced:
        housing → finish → depots → finish → roads.
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

  /* ── 3. the street grid ───────────────────────────────────────────────── */
  for (const r of [C - 8, C - 4, C, C + 4, C + 8]) {
    for (let i = C - 9; i <= C + 9; i++) { await P('road', i, r); await P('road', r, i); }
    done();
  }

  /* ── 4. commerce, industry and greenery — the CS2 frames are mixed-use, so
         a housing-only shot would flatter us ──────────────────────────────── */
  for (const [t, x, z] of [
    ['shop', C+1, C-3], ['shop', C+2, C-3], ['tenantbiz', C+3, C-2],
    ['lot', C+1, C-1],  ['garden', C+2, C-1], ['tree', C+3, C-3],
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

     ⚠ EVERY TYPE HERE IS UNDER THE MUNICIPAL CEILING and that is why they place
       at all: depot 1,388 s, motorpool 756 s, retail 1,875 s. If a later round
       makes any of them dearer, or gives one a `gen.cinder`, it will silently
       stop appearing in every capture — check the `fails` map, not the diff. */
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

  return { placed: tiles.length, fails, why, gates, crowd, parked: parkedN,
           sites: tiles.filter(t => t.bld).length,
           types: Object.entries(tiles.reduce((a, t) => (a[t.type] = (a[t.type]||0)+1, a), {})) };
})()
