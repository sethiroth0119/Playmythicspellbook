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

  /* 🚗 SPAWN THE CROWD. Round 1's critic scored vehicles 1/10 and citizens 2/10
     on the evidence that "not one vehicle and not one pedestrian reaches the
     film" — and that was THE HARNESS's fault, not the builder's. Agents are
     spawned by manageAgents(), which the shipped code only calls from animate()
     and from a handful of state changes; rAF never fires in headless capture,
     so the city was photographed empty every time and a whole round was spent
     judging assets that exist and were never on screen.
     Call it directly, twice: the first pass needs computeLinks() to have run so
     endpoints resolve, and desiredAgentCounts() ramps with population. */
  try { nc.manageAgents(); } catch (e) {}
  await new Promise(r => setTimeout(r, 400));
  try { nc.manageAgents(); } catch (e) {}

  const tiles = Object.values(nc.game.tiles);
  let crowd = { total: 0 };
  try {
    crowd = { total: nc.agents().length, want: nc.counts(),
              byKind: nc.agents().reduce((a, g) => (a[g.kind] = (a[g.kind]||0)+1, a), {}) };
  } catch (e) { crowd = { err: String(e) }; }

  return { placed: tiles.length, fails, crowd,
           sites: tiles.filter(t => t.bld).length,
           types: Object.entries(tiles.reduce((a, t) => (a[t.type] = (a[t.type]||0)+1, a), {})) };
})()
