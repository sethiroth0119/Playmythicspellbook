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
  const done = () => { try { nc.build.finishAll('gauntlet capture'); } catch (e) {} };
  /* ⚠ done() runs after EVERY placement, not per batch: bldSlots() is the
     municipal 2 free crew, so the THIRD order in a row is refused outright. */
  const P = async (t, x, z) => {
    try { await nc.place(t, x, z); } catch (e) {}
    done();
    if (!nc.game.tiles[x + ',' + z]) fails[t] = (fails[t] || 0) + 1;
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

  /* ── 2. depots, to buy road capacity ──────────────────────────────────── */
  for (const [x, z] of [[C+7,C+7],[C+8,C+7],[C+7,C+8],[C+8,C+8],[C+9,C+7],[C+9,C+8]]) {
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
    ['gasstation', C+1, C+1], ['forge', C+3, C+3],
    ['farm', C-3, C+2], ['tree', C-1, C+1], ['bush', C-2, C+3],
    ['arena', C+6, C-6], ['medlab', C+5, C-2], ['shop', C+6, C-2],
    ['tree', C-5, C+5], ['bush', C-6, C+5], ['garden', C-7, C+5],
    ['fountain', C-2, C-2],
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

  return { placed: tiles.length, fails, crowd, parked: parkedN,
           sites: tiles.filter(t => t.bld).length,
           types: Object.entries(tiles.reduce((a, t) => (a[t.type] = (a[t.type]||0)+1, a), {})) };
})()
