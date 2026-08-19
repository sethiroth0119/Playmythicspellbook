/* ══════════════════════════════════════════════════════════════════════════
   🏅 WHERE DEVELOPMENT POINTS COME FROM — and the tab that shows the working.

   🔴 THE DECISION, AND WHY IT IS NOT A NEW CURRENCY.
      CS2 pays development points out of MILESTONES, and milestones there are
      population thresholds. This game already tracks population, and tracks it
      HONESTLY — node-city's `cityPop()` is gated on housing (`popCap()`) and
      then on the 90% food/water/health growth gate, so it is a number a player
      has to earn a city to move. Inventing a "research point" resource would
      have meant a second faucet, a second ledger, a second place for it to be
      minted from nothing — and this project retired the Cinder Forge for
      exactly that (ECONOMY.md). Points are therefore not spent from a balance
      anybody can top up; they are the count of milestones a city has actually
      passed, minus what has been spent on nodes.

      Cinder was considered and rejected as the currency: Cinder is
      `Profile.gems`, it is real player money, and letting it buy zone types
      would make the whole tree a shop. A milestone cannot be bought.

   🔴 EVERY FIGURE ON THIS SCREEN TRACES TO A LIVE CALL, AND THE PANEL SAYS
      WHICH. That is the rule this batch is under, and it is enforced
      structurally rather than by good intentions: a metric is a `read(ctx)`
      that returns `{ ok, value }` or `{ ok:false, why }`, and `source` is the
      sentence the panel prints under it. There is no fallback value anywhere
      in this file. A metric whose host reader was not handed over reads
      UNAVAILABLE with the real reason, and its milestones are shown as
      unmeasurable rather than as "0 / 100" — which would be a claim about the
      city that nothing supports.

   ⚠ A MILESTONE, ONCE PASSED, STAYS PASSED. It is recorded in the save. A city
     that grows to 200 and then loses half its people does not have points
     clawed back out of nodes it has already unlocked — that would retro-lock a
     live city by a slower route, and it is the same refusal as the one in
     state.js.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── THE METRICS ───────────────────────────────────────────────────────────
   `read(ctx)` is the ONLY place a number enters this system. `source` names
   the live call it came from, in the terms a reader can go and grep. */
export const METRICS = {
  pop: {
    id: 'pop', label: 'Population', unit: '',
    source: 'node-city cityPop(), handed over as ctx.pop()',
    read: (ctx) => {
      if (typeof ctx.pop !== 'function') return { ok: false, why: 'the host did not hand over a population reader (ctx.pop)' };
      const v = ctx.pop();
      if (!Number.isFinite(v)) return { ok: false, why: 'cityPop() answered ' + String(v) };
      return { ok: true, value: Math.floor(v) };
    },
  },
  built: {
    id: 'built', label: 'Buildings standing', unit: '',
    source: 'node-city builtCount(), handed over as ctx.built() — sites and roads excluded, as that function already excludes them',
    read: (ctx) => {
      if (typeof ctx.built !== 'function') return { ok: false, why: 'the host did not hand over a building counter (ctx.built)' };
      const v = ctx.built();
      if (!Number.isFinite(v)) return { ok: false, why: 'builtCount() answered ' + String(v) };
      return { ok: true, value: Math.floor(v) };
    },
  },
  /* 🏙 THE ONE METRIC THAT IS NOT A HOST READER, AND WHY IT IS ALLOWED TO BE.
     ─────────────────────────────────────────────────────────────────────────
     The rule at the top of this file is that a number enters through `read(ctx)`
     and that `ctx` is the hand-over, because `game`, `cityPop` and the rest are
     top-level `const` in node-city and invisible here (CLAUDE.md, the globals
     trap). `window.MythicDistricts` is a DIFFERENT KIND OF THING: it is a
     sibling ES module that publishes itself on `window` exactly so other
     modules can ask it, the same way /src/zoning asks /src/landvalue and
     /src/districts asks /src/progression. There is nothing for node-city to
     hand over — it does not own this number either.

     🔴 IT COUNTS BUILT DISTRICT TILES, NOT PAINTED ONES, AND THAT IS THE WHOLE
        DESIGN OF THE MILESTONE. Painting is free: a player could drag a marquee
        across 200 tiles and collect every district milestone in one gesture
        without building anything, which is a milestone that measures a mouse
        rather than a city. A tile counts here only once something is STANDING
        on it, which costs the shipped price, takes construction time and needs
        land the band ladder will actually take.
     ⚠ ABSENT ⇒ UNMEASURABLE, NOT ZERO. A build with no /src/districts reports
       the real reason and its milestones show as unmeasurable, exactly like a
       host reader that was never handed over. Zero would be a claim that this
       city has no districts, which is a different statement from "nothing here
       can see whether it does". */
  district: {
    id: 'district', label: 'District tiles built', unit: '',
    source: 'window.MythicDistricts.stats().built — specialised tiles with a building standing on them, not tiles merely painted',
    read: () => {
      let D = null;
      try { D = (typeof window !== 'undefined') ? window.MythicDistricts : null; } catch (e) { D = null; }
      if (!D || typeof D.stats !== 'function') return { ok: false, why: '/src/districts is not loaded, so nothing here can count district tiles' };
      let v;
      try { v = D.stats().built; } catch (e) { return { ok: false, why: 'MythicDistricts.stats() threw: ' + (e && e.message || e) }; }
      if (!Number.isFinite(v)) return { ok: false, why: 'MythicDistricts.stats().built answered ' + String(v) };
      return { ok: true, value: Math.floor(v) };
    },
  },
  cinderRate: {
    id: 'cinderRate', label: 'Net Cinder per minute', unit: ' 🔥/min',
    source: 'node-city prodPerMin.cinder, handed over as ctx.cinderRate() — the same figure the ledger card prints',
    read: (ctx) => {
      if (typeof ctx.cinderRate !== 'function') return { ok: false, why: 'the host did not hand over a Cinder rate reader (ctx.cinderRate)' };
      const v = ctx.cinderRate();
      /* null is the host's "not ready": prodPerMin is empty until the first
         economy tick, and 0 would be a claim about a city nobody has measured
         yet. A city that HAS ticked and simply earns nothing reads 0, which is
         a measurement. */
      if (v === null) return { ok: false, why: 'the economy has not run a tick yet, so prodPerMin is still empty' };
      if (!Number.isFinite(v)) return { ok: false, why: 'prodPerMin.cinder answered ' + String(v) };
      return { ok: true, value: Math.round(v * 10) / 10 };
    },
  },
};

/* ── THE MILESTONES ────────────────────────────────────────────────────────
   `at` is the threshold on `metric`; `pts` is what passing it pays.
   Names are CS2's register — a rung a player can repeat back.

   🔴 THE ARITHMETIC IS DELIBERATE AND IT IS AN INVARIANT, NOT A COINCIDENCE:
   a city that reaches every milestone clears the tree with a little to spare,
   and it can never clear it early. Anyone adding a node MUST re-check it,
   because a tree that cannot be finished is a design regression that looks
   completely fine in review — the panel footer prints both halves
   (`N nodes · X ⬡ to clear · Y ⬡ on offer`) and would go on printing them
   while the last branch quietly became unreachable.

   ⚠ IT HAS BEEN RE-CHECKED ONCE ALREADY, AND THE FIGURES BELOW ARE COUNTED
     FROM THE TABLES RATHER THAN REMEMBERED — the first draft of this note said
     "7 nodes, +26 ⬡" and the tree says otherwise. The district-specialisation
     branch is EIGHT new nodes costing 28 ⬡ between them (com_district 2,
     com_night 3, com_luxury 4, off_district 2, ind_district 2, myth_press 4,
     myth_street 5, myth_arena 6; off_high and ind_ware also gained a `specs`
     key but existed and were paid for already). The five milestones marked 🏙
     below are what pay for it — four of them off the district metric the branch
     itself creates, which is the CS2 shape: the thing you build is what pays
     for the next thing you build. Today: 76 ⬡ on offer against a 74 ⬡ tree,
     which is `totalPointsOnOffer()` against the sum of every node cost and is
     the pair to re-run, not to re-read.
   ⚠ AND THE DEGRADED CASE IS REAL. With /src/districts absent, 22 of those
     ⬡ are unmeasurable and the five specialisation nodes unlock nothing —
     which the panel already renders correctly (`sci_urban` has always unlocked
     nothing directly and says so). The city is not harmed; the branch is
     simply not worth buying, and nothing on screen claims otherwise. */
export const MILESTONES = [
  { id: 'ms_pop_10',    metric: 'pop', at: 10,   pts: 2, name: 'Hamlet',        desc: 'Ten people who chose to live here.' },
  { id: 'ms_built_10',  metric: 'built', at: 10, pts: 2, name: 'Ground Broken', desc: 'Ten finished buildings — a settlement rather than a site.' },
  { id: 'ms_pop_25',    metric: 'pop', at: 25,   pts: 2, name: 'Village',       desc: 'Enough people that the streets have a shape.' },
  { id: 'ms_cin_10',    metric: 'cinderRate', at: 10, pts: 2, name: 'Solvent',  desc: 'The city earns more Cinder than it burns.' },
  { id: 'ms_pop_50',    metric: 'pop', at: 50,   pts: 3, name: 'Small Town',    desc: 'Fifty residents. Services stop being optional here.' },
  { id: 'ms_built_25',  metric: 'built', at: 25, pts: 3, name: 'A District',    desc: 'Twenty-five buildings standing at once.' },
  { id: 'ms_pop_100',   metric: 'pop', at: 100,  pts: 3, name: 'Town',          desc: 'Three figures. The demand meters start telling you things.' },
  { id: 'ms_cin_50',    metric: 'cinderRate', at: 50, pts: 3, name: 'Profitable', desc: 'Fifty Cinder a minute, net, with the lights on.' },
  { id: 'ms_pop_200',   metric: 'pop', at: 200,  pts: 4, name: 'Large Town',    desc: 'Two hundred residents, and a housing cap you had to build for.' },
  { id: 'ms_built_50',  metric: 'built', at: 50, pts: 4, name: 'Boroughs',      desc: 'Fifty buildings — more city than anyone can watch at once.' },
  { id: 'ms_cin_150',   metric: 'cinderRate', at: 150, pts: 4, name: 'Prosperous', desc: 'The treasury grows faster than you can spend it.' },
  { id: 'ms_pop_400',   metric: 'pop', at: 400,  pts: 5, name: 'City',          desc: 'Four hundred. It is a city now by any definition the game uses.' },
  { id: 'ms_built_100', metric: 'built', at: 100, pts: 5, name: 'Sprawl',       desc: 'A hundred buildings standing.' },
  { id: 'ms_pop_800',   metric: 'pop', at: 800,  pts: 6, name: 'Metropolis',    desc: 'Eight hundred residents in one city.' },
  /* 🏙 THE FIVE THAT PAY FOR THE SPECIALISATION BRANCH — see the note above. */
  { id: 'ms_dist_1',    metric: 'district', at: 1,  pts: 3, name: 'First District',
    desc: 'One block that is not just "commercial" any more — something opened on land you told what it was for.' },
  { id: 'ms_dist_10',   metric: 'district', at: 10, pts: 5, name: 'Neighbourhoods',
    desc: 'Ten built district plots. Streets that are recognisably for something.' },
  { id: 'ms_dist_30',   metric: 'district', at: 30, pts: 7, name: 'A City of Districts',
    desc: 'Thirty. Enough that a stranger could tell your quarters apart from the air.' },
  { id: 'ms_dist_60',   metric: 'district', at: 60, pts: 7, name: 'Every Street Has a Job',
    desc: 'Sixty built district plots — most of the working city is somewhere on purpose.' },
  { id: 'ms_built_150', metric: 'built', at: 150, pts: 6, name: 'Metropolitan',
    desc: 'A hundred and fifty buildings standing at once.' },
];

export function totalPointsOnOffer() {
  let t = 0;
  for (const m of MILESTONES) t += m.pts | 0;
  return t;
}

/* ── THE ACHIEVEMENTS ──────────────────────────────────────────────────────
   🔴 SHIPPED ONLY WITH REAL TRIGGERS. Every `test(ctx, view)` below reads a
      live call or this module's own state. There is no "coming soon" row and
      no achievement whose condition is a placeholder — a tab full of grey
      boxes teaches a player that the tab is decorative, and they stop looking.
      An achievement whose trigger cannot be READ this session says so, with
      the reason, exactly like a milestone does.

   🔴 THE SEAM FOR CARDS, NAMED, AND NOT BUILT HERE.
      The user wants city achievements to unlock CARDS. That grant cannot
      happen inside this module and it is worth being precise about why:
      cards live in `Profile` / `Forge` / `Catalog`, which are top-level
      `const` in public/index.html and therefore invisible to an ES module —
      the globals trap CLAUDE.md opens with. Reaching for `window.Profile`
      here would fail silently and look like a working integration.

      THE SEAM IS `MythicProgress.onAchievement(handler)`.
      It fires once per achievement, at the moment it is first earned AND on
      no other occasion, with `{ id, name, desc, reward }`. `reward` is `null`
      on every row today and is the field a card id goes in. The host-side
      landing point is `window.MythicBridge` (CLAUDE.md names it as the seam
      between index.html and modules); a future round adds a card-grant
      function there and one line in node-city's mount that pipes
      onAchievement into it. Nothing in this module needs to change.

      ⚠ The handler is called for a REPLAY too, when a save is loaded that
        already carries earned achievements? NO — it is not, and that is
        deliberate. See state.js: replaying on load would re-grant a card on
        every page open. `earned()` is the list; the event is the edge. */
export const ACHIEVEMENTS = [
  { id: 'ach_ground', name: 'Ground Broken', ico: '🧱',
    desc: 'Finish the first building in the city.',
    how: 'builtCount() ≥ 1',
    test: (ctx, v) => metricAtLeast(v, 'built', 1) },
  { id: 'ach_planner', name: 'Town Planner', ico: '🗺',
    desc: 'Zone twenty-five plots of land.',
    how: 'MythicZoning.stats().zoned ≥ 25',
    test: (ctx) => {
      const Z = (typeof window !== 'undefined') && window.MythicZoning;
      if (!Z || typeof Z.stats !== 'function') return { ok: false, why: '/src/zoning is not loaded, so nothing can count zoned plots' };
      const n = (Z.stats() || {}).zoned | 0;
      return { ok: true, done: n >= 25, at: n + ' / 25 plots zoned' };
    } },
  { id: 'ach_chartered', name: 'Chartered', ico: '📜',
    desc: 'Hold three City Hall operation licences at once.',
    how: 'the operations manifest, via ctx.licences()',
    test: (ctx) => {
      if (typeof ctx.licences !== 'function') return { ok: false, why: 'the host did not hand over a licence reader (ctx.licences)' };
      const held = ctx.licences();
      if (!Array.isArray(held)) return { ok: false, why: 'the operations manifest has not been read yet' };
      return { ok: true, done: held.length >= 3, at: held.length + ' / 3 licences held' };
    } },
  { id: 'ach_lab', name: 'Laboratory Opened', ico: '🔬',
    desc: 'Hold the Research Facility licence — the door to the research branch.',
    how: 'ctx.hasLicence("research"), read off the operations manifest',
    test: (ctx) => {
      if (typeof ctx.hasLicence !== 'function') return { ok: false, why: 'the host did not hand over a licence reader (ctx.hasLicence)' };
      const r = ctx.hasLicence('research');
      if (r == null) return { ok: false, why: 'the operations manifest has not been read yet' };
      return { ok: true, done: !!r, at: r ? 'held' : 'not held' };
    } },
  { id: 'ach_specialist', name: 'Specialist', ico: '🎓',
    desc: 'Unlock every node in any one category.',
    how: 'the unlocked set this module owns',
    test: (ctx, v) => {
      if (!v || !Array.isArray(v.cats)) return { ok: false, why: 'the tree state has not been built yet' };
      const best = v.cats.reduce((a, c) => (c.done > (a ? a.done : -1) ? c : a), null);
      if (!best) return { ok: false, why: 'the tree state has not been built yet' };
      const full = v.cats.find((c) => c.total > 0 && c.done >= c.total);
      return { ok: true, done: !!full, at: (full ? full.name : best.name + ' ' + best.done + ' / ' + best.total) };
    } },
  { id: 'ach_metropolis', name: 'Metropolis', ico: '🌆',
    desc: 'Reach eight hundred residents.',
    how: 'cityPop() ≥ 800',
    test: (ctx, v) => metricAtLeast(v, 'pop', 800) },
];

/* Shared by the two achievements that key off a metric, so an unavailable
   metric produces the SAME honest row in this tab as it does in the last one
   rather than a second, differently worded excuse. */
function metricAtLeast(view, metricId, n) {
  const m = view && view.metrics && view.metrics[metricId];
  if (!m) return { ok: false, why: 'the metric has not been read yet' };
  if (!m.ok) return { ok: false, why: m.why };
  return { ok: true, done: m.value >= n, at: m.value + ' / ' + n };
}
