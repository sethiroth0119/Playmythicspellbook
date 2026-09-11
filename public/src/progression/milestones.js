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
      that returns `{ ok, value }` or `{ ok:false, why }`, and every row
      carries a sentence saying where its number came from. There is no
      fallback value anywhere in this file. A metric whose host reader was not
      handed over reads UNAVAILABLE with the real reason, and its milestones
      are shown as unmeasurable rather than as "0 / 100" — which would be a
      claim about the city that nothing supports.

   🔴 AND THE AUDIENCE IS SPLIT IN TWO, BECAUSE ONE FIELD WAS DOING BOTH JOBS.
      THE BUG: `source` was the maintainer's cross-reference AND the player's
      caption at the same time, and panel.js prints it verbatim. So the
      Milestones tab said "Population — node-city cityPop(), handed over as
      ctx.pop()" to a player, and the Achievements tab said
      "trigger: builtCount() ≥ 1". A call signature on a game screen.
      The rule above is not the defect and is kept whole; the AUDIENCE was
      wrong. Every row therefore carries two fields now:

        `source` / `how` — the PLAYER's caption. Prose, in the game's own
                           nouns, and it still has to answer "where did this
                           number come from". This is the one the panel
                           prints; a caption that stops naming its origin is
                           the same regression by a slower route.
        `trace`          — the MAINTAINER's cross-reference: the exact live
                           call, in the terms a reader can go and grep, which
                           is what kept this file auditable and is why it is
                           preserved rather than deleted. NOTHING renders it.
                           report() in index.js does not copy it into the view
                           model at all, so it cannot leak back onto a screen
                           by somebody adding one more field to a row.

      `why` is split the same way: the player gets a sentence, and the raw
      value or the thrown error goes to console.warn, which is where a
      maintainer was going to look anyway. String(NaN) in particular must
      never reach a caption — the commonest degraded read there is would
      otherwise print the token NaN at a player.

   ⚠ A MILESTONE, ONCE PASSED, STAYS PASSED. It is recorded in the save. A city
     that grows to 200 and then loses half its people does not have points
     clawed back out of nodes it has already unlocked — that would retro-lock a
     live city by a slower route, and it is the same refusal as the one in
     state.js.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── THE METRICS ───────────────────────────────────────────────────────────
   `read(ctx)` is the ONLY place a number enters this system. `source` is what
   the PLAYER reads; `trace` is the live call, for whoever has to audit it. */
export const METRICS = {
  pop: {
    id: 'pop', label: 'Population', unit: '',
    source: 'Counted from the people living in your city.',
    trace: 'node-city cityPop(), handed over as ctx.pop()',
    read: (ctx) => {
      if (typeof ctx.pop !== 'function') return { ok: false, why: 'this city has not handed over a population count this session' };
      const v = ctx.pop();
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('population count', v) };
      return { ok: true, value: Math.floor(v) };
    },
  },
  built: {
    id: 'built', label: 'Buildings standing', unit: '',
    source: 'Counted from the finished buildings standing in your city. Sites still under construction and roads are not counted.',
    trace: 'node-city builtCount(), handed over as ctx.built() — sites and roads excluded, as that function already excludes them',
    read: (ctx) => {
      if (typeof ctx.built !== 'function') return { ok: false, why: 'this city has not handed over a building count this session' };
      const v = ctx.built();
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('building count', v) };
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
    source: 'Counted from the district plots that have a building standing on them — land you have only painted does not count.',
    trace: 'window.MythicDistricts.stats().built — specialised tiles with a building standing on them, not tiles merely painted',
    read: () => {
      let D = null;
      try { D = (typeof window !== 'undefined') ? window.MythicDistricts : null; } catch (e) { D = null; }
      if (!D || typeof D.stats !== 'function') return { ok: false, why: 'the districts feature is not loaded in this build, so nothing here can count district plots' };
      let v;
      try { v = D.stats().built; } catch (e) { return { ok: false, why: readerThrew('district plot count', e) }; }
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('district plot count', v) };
      return { ok: true, value: Math.floor(v) };
    },
  },
  cinderRate: {
    id: 'cinderRate', label: 'Net Cinder per minute', unit: ' 🔥/min',
    source: 'Read off your city ledger — the Cinder the city earns each minute, after what it burns.',
    trace: 'node-city prodPerMin.cinder, handed over as ctx.cinderRate() — the same figure the ledger card prints',
    read: (ctx) => {
      if (typeof ctx.cinderRate !== 'function') return { ok: false, why: 'this city has not handed over a Cinder rate this session' };
      const v = ctx.cinderRate();
      /* null is the host's "not ready": prodPerMin is empty until the first
         economy tick, and 0 would be a claim about a city nobody has measured
         yet. A city that HAS ticked and simply earns nothing reads 0, which is
         a measurement. */
      if (v === null) return { ok: false, why: 'your city economy has not run yet, so there is nothing to measure' };
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('Cinder rate', v) };
      return { ok: true, value: Math.round(v * 10) / 10 };
    },
  },

  /* ══════════════════════════════════════════════════════════════════════
     FIVE MORE THINGS A CITY CAN BE MEASURED ON.
     ══════════════════════════════════════════════════════════════════════
     Every one is a host reader handed over at mount, for the same reason the
     four above are: a metric that re-derived its own number would eventually
     disagree with the panel that shows it, and the player would be told they
     had not reached something they are looking at.
     ⚠ ABSENT ⇒ UNMEASURABLE, NEVER 0. Repeated here because it is the rule
       that keeps a milestone honest: 0 is a claim about a city, and "this
       build cannot see that" is a different sentence. The panel prints the
       reason. ══════════════════════════════════════════════════════════ */

  /* 💼 People in work. Distinct from `pop`, and that gap IS the interest: a
     city can grow its population without growing its payroll, and this is the
     metric that notices. */
  employed: {
    id: 'employed', label: 'Residents in work', unit: '',
    source: 'Counted from your named residents who hold a seat at a building — people, not job openings.',
    trace: 'node-city citizens with a job tile, handed over as ctx.employed()',
    read: (ctx) => {
      if (typeof ctx.employed !== 'function') return { ok: false, why: 'this city has not handed over an employment count this session' };
      const v = ctx.employed();
      if (v === null) return { ok: false, why: 'your residents have not been assigned to work yet, so there is nothing to count' };
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('employment count', v) };
      return { ok: true, value: Math.floor(v) };
    },
  },

  /* 😊 How the city feels, averaged across the residents who feel it. */
  mood: {
    id: 'mood', label: 'Average resident mood', unit: ' / 100',
    source: 'Averaged across every named resident — the same mood their own card shows.',
    trace: 'node-city mean of citizens[].mood, handed over as ctx.mood()',
    read: (ctx) => {
      if (typeof ctx.mood !== 'function') return { ok: false, why: 'this city has not handed over a mood reading this session' };
      const v = ctx.mood();
      /* An empty city has no mood — not a mood of zero, which would read as a
         miserable town when there is nobody in it to be miserable. */
      if (v === null) return { ok: false, why: 'nobody lives here yet, so there is no mood to average' };
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('mood', v) };
      return { ok: true, value: Math.round(v * 10) / 10 };
    },
  },

  /* 👷 Units posted to buildings. The one metric on this list a player moves
     by a deliberate act rather than by growing — you do not drift into having
     a crew, you go and post one. */
  crewPosted: {
    id: 'crewPosted', label: 'Units posted to work', unit: '',
    source: 'Counted from the units you have posted into buildings — enlisted but unposted units do not count.',
    trace: 'node-city CREW.state() entries carrying a post, handed over as ctx.crewPosted()',
    read: (ctx) => {
      if (typeof ctx.crewPosted !== 'function') return { ok: false, why: 'this city has not handed over a work crew count this session' };
      const v = ctx.crewPosted();
      if (v === null) return { ok: false, why: 'the work crew has not loaded in this build, so nothing here can count posted units' };
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('posted crew count', v) };
      return { ok: true, value: Math.floor(v) };
    },
  },

  /* 🔥 Lifetime Cinder the city's buildings have banked.
     🔴 LIFETIME, AND DELIBERATELY NOT "TODAY". Patronage keeps a per-day
        figure and it was the obvious thing to hang these on — but a milestone
        on a counter that resets is one a player can watch themselves LOSE
        after a day rolls over, and it would be reached by a fluke afternoon
        rather than by building something. `t.earn` only ever goes up. */
  earned: {
    id: 'earned', label: 'Cinder earned by your buildings', unit: ' 🔥',
    source: 'Added up across every building in your city, over its whole life — the same lifetime figure each building shows on its Ledger tab.',
    trace: 'node-city sum of tile.earn, handed over as ctx.earned()',
    read: (ctx) => {
      if (typeof ctx.earned !== 'function') return { ok: false, why: 'this city has not handed over a lifetime earnings figure this session' };
      const v = ctx.earned();
      if (v === null) return { ok: false, why: 'your city economy has not run yet, so nothing has been banked to count' };
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('lifetime earnings', v) };
      return { ok: true, value: Math.floor(v) };
    },
  },

  /* 🎓 Residents who went further than self-taught. Pays for the school
     ladder the same way the district milestones pay for districts. */
  schooled: {
    id: 'schooled', label: 'Residents with schooling', unit: '',
    source: 'Counted from residents who have finished any school — self-taught residents do not count.',
    trace: 'node-city citizens above the base rung, handed over as ctx.schooled()',
    read: (ctx) => {
      if (typeof ctx.schooled !== 'function') return { ok: false, why: 'this city has not handed over a schooling count this session' };
      const v = ctx.schooled();
      if (v === null) return { ok: false, why: 'nobody lives here yet, so there is no schooling to count' };
      if (!Number.isFinite(v)) return { ok: false, why: notANumber('schooling count', v) };
      return { ok: true, value: Math.floor(v) };
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

  /* ══════════════════════════════════════════════════════════════════════
     🔴 THE FOURTEEN BELOW ALSO REPAIR THE INVARIANT THE NOTE ABOVE WARNS
     ABOUT — IT HAD ALREADY BROKEN.
     ══════════════════════════════════════════════════════════════════════
     That note says a tree that cannot be finished "is a design regression
     that looks completely fine in review", and predicts the panel would go on
     printing both halves while the last branch quietly became unreachable.
     That is exactly what happened. Measured before this block was written:

         36 nodes · 91 ⬡ to clear · 76 ⬡ on offer      ← short by 15

     The tree grew past the milestones that pay for it and nothing failed,
     because nothing compares the two numbers. It does now: totalPointsOnOffer()
     against the sum of every node cost is asserted in the gate (U32), so the
     next node added without a milestone to pay for it goes red instead of
     silently stranding a branch.

     After this block: 104 ⬡ on offer against a 91 ⬡ tree — thirteen spare.
     ⚠ THAT SLACK IS LARGER THAN THE OLD TWO ⬡ ON PURPOSE, and the old figure
       is the reason. At 76 against 74 a player who never reached ONE hard
       milestone had a node they could never buy, permanently, with nothing on
       screen explaining why — the same silent-stranding failure the note
       above describes, arriving by a different road. Thirteen is enough to
       absorb a couple of misses and small enough that the milestones still
       have to be worked for.
     ⚠ AND THE NEW NODES ARE WORTH 1–3 ⬡ RATHER THAN 2–7. Fourteen milestones
       into a fixed-size tree is arithmetic, not modesty: at the old scale
       they would have been worth 50 ⬡ and left 35 spare, which is a tree that
       finishes itself while the player is still reading it.

     ⚠ THEY ARE ALSO THE ANSWER TO "MAKE THE GAME MORE FUN", WHICH IS WHY
       THEY MEASURE FIVE NEW THINGS RATHER THAN ADDING MORE POPULATION RUNGS.
       Every milestone in the list above is reached by WAITING — population and
       building count both climb on their own once a city is set up. The ones
       below are reached by DOING: employing people, keeping them happy,
       posting units to work, running shops that take money, and sending
       residents to school. ══════════════════════════════════════════════ */

  // ── 💼 the payroll. A city can grow its population without growing this. ──
  { id: 'ms_job_10',   metric: 'employed', at: 10,  pts: 2, name: 'First Payroll',
    desc: 'Ten residents who go somewhere in the morning.' },
  { id: 'ms_job_50',   metric: 'employed', at: 50,  pts: 2, name: 'The City Works',
    desc: 'Fifty in work at once — the payroll is a thing you manage now.' },
  { id: 'ms_job_200',  metric: 'employed', at: 200, pts: 3, name: 'Full Employment',
    desc: 'Two hundred residents in work. Almost nobody is waiting for a seat.' },

  // ── 😊 …and whether they are glad about it. ──
  { id: 'ms_mood_60',  metric: 'mood', at: 60, pts: 1, name: 'Content',
    desc: 'The average resident is more pleased than not.' },
  { id: 'ms_mood_80',  metric: 'mood', at: 80, pts: 2, name: 'A City That Likes You',
    desc: 'Eighty out of a hundred, averaged across everyone living here. Happy residents also spend more.' },

  /* ── 👷 the work crew. Deliberately starts at ONE: the whole feature is
     invisible until a player posts their first unit, and a 2 ⬡ milestone for
     doing it once is the cheapest possible signpost to it. ── */
  { id: 'ms_crew_1',   metric: 'crewPosted', at: 1,  pts: 1, name: 'Boots on the Ground',
    desc: 'One of your units posted into a building, lifting what it makes.' },
  { id: 'ms_crew_10',  metric: 'crewPosted', at: 10, pts: 2, name: 'A Working Crew',
    desc: 'Ten units at work across the city, each lifting the building it stands in.' },
  { id: 'ms_crew_25',  metric: 'crewPosted', at: 25, pts: 3, name: 'Everyone Has a Post',
    desc: 'Twenty-five posted at once — every trade you own is doing something.' },

  // ── 🔥 money the buildings themselves brought in, over the city's life. ──
  { id: 'ms_earn_1k',  metric: 'earned', at: 1000,   pts: 1, name: 'Open for Business',
    desc: 'A thousand Cinder taken across the counter, all of it earned by buildings you placed.' },
  { id: 'ms_earn_100k',metric: 'earned', at: 100000, pts: 2, name: 'The High Street',
    desc: 'A hundred thousand banked. Your shops are a real economy, not a rounding error.' },
  { id: 'ms_earn_1m',  metric: 'earned', at: 1000000, pts: 3, name: 'A Million Through the Tills',
    desc: 'One million Cinder earned by your city over its life.' },

  // ── 🎓 the school ladder, paid for the way districts pay for districts. ──
  { id: 'ms_edu_10',   metric: 'schooled', at: 10,  pts: 1, name: 'Night School',
    desc: 'Ten residents who went further than self-taught.' },
  { id: 'ms_edu_50',   metric: 'schooled', at: 50,  pts: 2, name: 'An Educated City',
    desc: 'Fifty schooled residents — the technical jobs finally have someone to take them.' },
  { id: 'ms_edu_150',  metric: 'schooled', at: 150, pts: 3, name: 'A University Town',
    desc: 'A hundred and fifty. There is nothing you could build that this city could not staff.' },
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
    how: 'Counted from the finished buildings standing in your city.',
    trace: 'builtCount() ≥ 1, through the Buildings standing metric',
    test: (ctx, v) => metricAtLeast(v, 'built', 1) },
  { id: 'ach_planner', name: 'Town Planner', ico: '🗺',
    desc: 'Zone twenty-five plots of land.',
    how: 'Counted from the plots of land you have zoned on the map.',
    trace: 'window.MythicZoning.stats().zoned ≥ 25',
    test: (ctx) => {
      const Z = (typeof window !== 'undefined') && window.MythicZoning;
      if (!Z || typeof Z.stats !== 'function') return { ok: false, why: 'the zoning feature is not loaded in this build, so nothing here can count zoned plots' };
      const n = (Z.stats() || {}).zoned | 0;
      return { ok: true, done: n >= 25, at: n + ' / 25 plots zoned' };
    } },
  { id: 'ach_chartered', name: 'Chartered', ico: '📜',
    desc: 'Hold three City Hall operation licences at once.',
    how: 'Read from the licences your city holds at City Hall.',
    trace: 'the operations manifest, via ctx.licences()',
    test: (ctx) => {
      if (typeof ctx.licences !== 'function') return { ok: false, why: 'this city has not handed over its list of licences this session' };
      const held = ctx.licences();
      if (!Array.isArray(held)) return { ok: false, why: 'City Hall has not reported which licences you hold yet' };
      return { ok: true, done: held.length >= 3, at: held.length + ' / 3 licences held' };
    } },
  { id: 'ach_lab', name: 'Laboratory Opened', ico: '🔬',
    desc: 'Hold the Research Facility licence — the door to the research branch.',
    how: 'Read from whether your city holds the Research Facility licence at City Hall.',
    trace: 'ctx.hasLicence("research"), read off the operations manifest',
    test: (ctx) => {
      if (typeof ctx.hasLicence !== 'function') return { ok: false, why: 'this city has not handed over its list of licences this session' };
      const r = ctx.hasLicence('research');
      if (r == null) return { ok: false, why: 'City Hall has not reported which licences you hold yet' };
      return { ok: true, done: !!r, at: r ? 'held' : 'not held' };
    } },
  { id: 'ach_specialist', name: 'Specialist', ico: '🎓',
    desc: 'Unlock every node in any one category.',
    how: 'Counted from the nodes you have unlocked in each branch of this tree.',
    trace: 'the unlocked set this module owns, through the category roll-up',
    test: (ctx, v) => {
      if (!v || !Array.isArray(v.cats)) return { ok: false, why: 'the development tree has not been read yet' };
      const best = v.cats.reduce((a, c) => (c.done > (a ? a.done : -1) ? c : a), null);
      if (!best) return { ok: false, why: 'the development tree has not been read yet' };
      const full = v.cats.find((c) => c.total > 0 && c.done >= c.total);
      return { ok: true, done: !!full, at: (full ? full.name : best.name + ' ' + best.done + ' / ' + best.total) };
    } },
  { id: 'ach_metropolis', name: 'Metropolis', ico: '🌆',
    desc: 'Reach eight hundred residents.',
    how: 'Counted from the people living in your city.',
    trace: 'cityPop() ≥ 800, through the Population metric',
    test: (ctx, v) => metricAtLeast(v, 'pop', 800) },
];

/* Shared by the two achievements that key off a metric, so an unavailable
   metric produces the SAME honest row in this tab as it does in the last one
   rather than a second, differently worded excuse. */
/* ── THE DEGRADED CAPTIONS ─────────────────────────────────────────────────
   🔴 THE RAW VALUE GOES TO THE CONSOLE, NOT TO THE PLAYER — the second half
      of the audience split at the top of this file. These two used to read
      `'cityPop() answered ' + String(v)` and `'MythicDistricts.stats() threw: '
      + e.message`, both of which the panel prints verbatim: a call signature,
      and on the commonest degraded read of all the literal token NaN, put in
      front of a player. The maintainer loses nothing — the value and the error
      object itself now reach the console, which is strictly more than a
      stringified copy of them was giving.
   ⚠ NEITHER OF THESE EVER COLLAPSES TO 0. They return a `why`, so the caller
     returns `ok:false` and the row renders as unmeasurable. A zero here would
     be a claim about the city that nothing supports (see the header). */
function notANumber(what, v) {
  try { console.warn('[Progress] the ' + what + ' reader answered:', v); } catch (e) {}
  if (v == null) return 'the ' + what + ' came back empty';
  return 'the ' + what + ' came back as something that is not a number';
}
function readerThrew(what, e) {
  try { console.warn('[Progress] the ' + what + ' reader threw:', e); } catch (x) {}
  return 'the ' + what + ' could not be read this session';
}

function metricAtLeast(view, metricId, n) {
  const m = view && view.metrics && view.metrics[metricId];
  if (!m) return { ok: false, why: 'this figure has not been read yet' };
  if (!m.ok) return { ok: false, why: m.why };
  return { ok: true, done: m.value >= n, at: m.value + ' / ' + n };
}
