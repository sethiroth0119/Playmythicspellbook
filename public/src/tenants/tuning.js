/* ════════════════════════════════════════════════════════════════════════════
   🏢 TENANTS — the one tuning table. The `_opEcon()` pattern (CLAUDE.md).
   ----------------------------------------------------------------------------
   🔴 READ THIS BEFORE ADDING A NUMBER. This project has twice had panel content
      deleted for inventing figures, and a progression tree once advertised
      building unlocks that nothing checked. So this table is split into two
      halves and the split is the whole discipline:

      · WEIGHTS (`bid.w`) — a PREFERENCE model. They say how much a company
        cares about a thing it can measure. They are the same species of number
        as /src/landvalue's `stencilRef 110 / reach 60 / wealth 45 / transit 35
        / water 25`, and they live here for the same reason: one table, one
        place to argue about them, never a literal at a call site.
      · FICTION (`pool`) — how many companies exist in the world that are not
        in this city yet. That is not measurable from a save; it is a design
        knob, exactly like /src/naming's word lists. It is labelled as fiction
        HERE and in the panel, and NOTHING that ranks a bid is drawn from it.

      Everything the bid actually MEASURES comes from a live sibling module and
      is named in `bid.sources` below with the call that answers it. A factor
      with no call behind it is not in this file — see `OMITTED`.
   ════════════════════════════════════════════════════════════════════════════ */

export const TEN = {
  /* ── CATCHMENT ────────────────────────────────────────────────────────────
     How far a lot's customers, competitors and transit are counted over.
     ⚠ ASKED, NOT COPIED. `radiusOf()` in bid.js reads /src/landvalue's own
       `tuning.radius` at call time and only falls back to this when that module
       is absent. Two modules holding two "6"s is how they come to disagree the
       day one of them is retuned. */
  radiusFallback: 6,

  /* ── 🎲 THE CANDIDATE POOL — fiction, and labelled as such ───────────────
     "Suppose you've zoned 50 commercial properties but there are 200 companies
      wanting locations." That ratio is the feature: the pool must be LARGER
     than the lots or there is no competition, only allocation.

     `perLot` is that ratio. `floor` keeps a pool alive on a board with one
     zoned tile, so the first lot a player paints still has a contest on it.
     Neither number enters a bid; they decide how many bidders there are, not
     which one wins. */
  pool: { perLot: 3, floor: 6, maxPerWant: 64 },

  /* ── 📏 COMPANY SIZE ──────────────────────────────────────────────────────
     A company's SCALE. Drawn deterministically per candidate (see pool.js), and
     it is FICTION in the same sense a name is: nothing in the save measures how
     big a company that has never opened is.

     🔴 IT DOES EXACTLY ONE THING AND NOT THE OTHER ONE.
        · It moves the RENT term of the bid — `rentBearing`. A national chain is
          less deterred by an expensive lot than a one-shop independent, which
          is the whole of "Land Value $850/m² might attract luxury apartments,
          corporate headquarters, banks" and "$90/m² might attract warehouses,
          discount retailers": the CHEAP lot is where the small operator can
          still outbid, and the dear lot is where only scale can.
        · It does NOT set the building's level. The level a building reaches is
          the level its FIRM reached through /src/economy/firms.js `levelCheck`
          — seven gates, every one of them measured. "The building upgrades
          because THE BUSINESS ITSELF SUCCEEDED" is the user's rule and a size
          tag would be a way of faking it. `ambition` below is a CEILING on how
          far this tenant will push its plot, never a floor. */
  sizes: [
    { i: 1, id: 'indep',    ico: '🌱', name: 'Independent',    rentBearing: 1.00, needs: 0.20, ambition: 2, w: 5 },
    { i: 2, id: 'chain',    ico: '🏬', name: 'Regional Chain', rentBearing: 0.55, needs: 0.45, ambition: 4, w: 3 },
    { i: 3, id: 'national', ico: '🏙', name: 'National Chain', rentBearing: 0.30, needs: 0.70, ambition: 5, w: 2 },
  ],
  /* 🔴 `needs` EXISTS BECAUSE THE FIRST VERSION WAS BROKEN AND DRIVING IT SAID SO.
     With `rentBearing` as the only size term, every other term of the bid is
     identical across the three sizes — so the National Chain, which is deterred
     LEAST by rent, won every lot in the city. Measured: four lots let, four
     National Chains, on a board with a 5:3:2 draw. Size was a decoration.

     `needs` is the counter-force, and it is the half of the brief that was
     missing: "$90/m² might attract warehouses, discount retailers, factories,
     SMALL BUSINESSES". A chain is not looking for cheap ground, it is looking
     for VOLUME — it will not open where the catchment is too thin to fill it.
     So the customers term is scored as `min(1, catchment ÷ needs)`: a corner
     shop is satisfied by a fifth of the city's best catchment and a national
     chain is not satisfied until it has seven tenths of it.

     The two terms then pull opposite ways and the lot decides which wins:
       · thin catchment, cheap ground  → the independent outbids everyone
       · rich catchment, dear ground   → only scale can carry the rent
     Both numbers are FICTION about a company, disclosed here and in the panel,
     and neither of them is a fact about the city. Every fact in the bid is
     measured; these two decide which company those facts suit.

  /* ── ⚖ THE BID ────────────────────────────────────────────────────────────
     Six signed terms. Each is normalised to roughly −1..+1 from a LIVE
     measurement, then multiplied by its weight, and `bid.js` asserts that the
     rows sum to the total exactly — the same contract /src/landvalue's
     `terms()` ships under, and for the same reason: a causal list that does not
     add up is a decoration.

     Positive terms pull a company toward a lot. Negative ones push it away. */
  bid: {
    w: {
      customers:   40,   // how much of the city's population is on the doorstep
      income:      25,   // how much better off they are than the city average
      transit:     15,   // does the network that actually carries riders reach it
      rent:        30,   // what the ground costs, borne against company scale
      competition: 25,   // the same trade already standing within the catchment
      saturation:  45,   // the trade's EXISTING shops are already idle for orders
    },
    /* The live call behind every one of them. Printed in the panel and returned
       by `sources()`, so a reader can check the claim rather than trust it. */
    sources: {
      customers:   'MythicDemographics.residents(tileKey).residents, summed over housing in the catchment ÷ city population',
      income:      'MythicDemographics.residents(tileKey).income, catchment mean ÷ city mean, centred on 1',
      transit:     'MythicTransit.jobAccess().served × a served stop inside the catchment',
      rent:        'MythicLandValue.valueAt(x,z) ÷ the city’s dearest lot, × the share of the rent this company bears at this volume',
      competition: 'standing tiles of the same building type inside the catchment ÷ compFull',
      saturation:  'mean firm.idleForDemand over MythicEconomy.firms() already selling this output',
    },
    /* The catchment count at which competition is scored 1.0 — i.e. "this
       street is already full of them". Four of the same shop within six tiles
       is a saturated pitch by inspection; it is a weight-scale, not a claim
       about the world, and it is here rather than at the call site. */
    compFull: 4,
    /* A bid below this does not get made. A company with nothing to gain does
       not sign a lease — this is what leaves a lot VACANT when the trade is
       already over-supplied, rather than always handing it to the least-bad
       bidder. It is the number "bad zoning has consequences" runs through. */
    reserve: 0,
  },

  /* ── ⌛ WHAT AN EMPTY LOT ACTUALLY IS — read this before adding a timer ───
     There is NO re-letting cooldown here, and its absence is a decision.

     The obvious build is "a business fails, the lot sits empty for N days".
     It would be a LIE in this city, and the reason is written down in
     node-city's own source: `ecoBuildings()` is gated on `bldSite`, never on
     `bldBusy`, and its header states the invariant — "a tile may be ABSENT
     until its first completion, and is PRESENT forever after. It is NEVER
     withdrawn." A standing shopfront therefore ALWAYS has a firm in the
     economy's books; `syncBuildings` re-founds one at the next 4-second sync
     (ECON's charter-fund header calls that "a pump, not a one-off"). Drawing
     that building as empty for three days would be a claim the books contradict.

     So the two honest states are the ones this module actually ships:
       · CHURN — the business died and a different company took the pitch. Real,
         recorded in the ledger, and visible as a NAME that changed.
       · NO BIDDER — nobody will take the pitch at all, because the trade is
         over-supplied and every bid comes in under `bid.reserve`. THAT is where
         "vacancies increase" really lands, and it is measurable: a zoned lot
         that never develops, and a failed lot that finds no successor.
     ────────────────────────────────────────────────────────────────────── */

  /* Which distress rungs the world marks. firms.js owns the ladder; this only
     says which rungs are worth drawing a mark for. */
  mark: {
    struggling: ['LAYOFFS', 'DEBT', 'DEFAULT'],
    ico: { ok: '', struggling: '⚠', failed: '⌛', grown: '⭐' },
  },
};

/* ════════════════════════════════════════════════════════════════════════════
   🚫 THE FACTORS THE BRIEF NAMED THAT ARE NOT SCORED, AND WHY
   ----------------------------------------------------------------------------
   The user's list is: traffic, population, income, rent, nearby competitors,
   transit, parking, tourism, crime, taxes, customer demographics. Six of those
   are scored above. These five are not, and every one of them is a deliberate
   omission with a checkable reason — "a bid factor with nothing behind it is
   exactly the fabrication this project has twice had to remove."

   This list is PUBLISHED (`MythicTenants.omitted()`) and printed in the panel.
   An omission the player cannot see is indistinguishable from an oversight.
   ════════════════════════════════════════════════════════════════════════════ */
export const OMITTED = [
  { id: 'traffic', name: 'Traffic',
    why: '/src/streets has a real 24-bucket traffic ring (streets/traffic.js), but the module registers NO window global — `grep -rn "window\\." public/src/streets` finds one hit and it is a comment. There is no seam to ask, and inventing a second traffic model beside a real one is worse than not scoring it.' },
  { id: 'parking', name: 'Parking',
    why: '/src/parking draws kerbside bays and registers no global either. Same finding, same call.' },
  { id: 'tourism', name: 'Tourism',
    why: 'Nothing in the city models a visitor. There is no tourist, no arrival, no stay and no spend — the whole population is resident households in /src/demographics.' },
  { id: 'crime', name: 'Crime',
    why: 'Nothing models crime. There is a police station tile with a coverage need and no offence anywhere behind it, so a "crime" term would be a re-skin of police coverage wearing a name it has not earned.' },
  { id: 'taxes', name: 'Taxes',
    why: 'MODELLED but city-uniform. `ECON.tax.corporate` / `.payroll` / `.property` are real and firms.js really pays them — and they are identical on every lot in the city, so they shift every bid by the same amount and cannot separate two lots. Scoring them would add a row that always reads the same and never changes a ranking.' },
];

export default TEN;
