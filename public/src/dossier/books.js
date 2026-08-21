/* ══════════════════════════════════════════════════════════════════════════
   💰 THE BOOKS — Income, Rent, Upkeep, Resource Cost, Fees Paid.
   ──────────────────────────────────────────────────────────────────────────
   The reference panel prints five money lines per building. This file's whole
   design is about never letting a reader mistake a figure the tick computes
   for a figure a panel made up.

   🔴 A PLAUSIBLE NUMBER IS WORSE THAN NO NUMBER. index.html already made this
      call once, in insTopline: an operation's gross revenue is DELIBERATELY
      absent from the dossier because the parent game folds market and supply
      legs the city cannot see, and any figure printed here would disagree with
      the Just Business ledger.

   🔴 …AND A WRONG REASON IS WORSE THAN A BLANK ROW. This card used to print
      five blanks for a residence and justify them with two sentences that were
      simply false:

        "this city has no tenancy model, nobody pays rent on a house"
        "no tax or civic fee is levied on a building in this city"

      Both were true of index.html alone and neither had been true since
      /src/economy shipped. `households.js` charges rent every economic day
      (`chargeRent`, ECON.household.rentPctOfIncome) and sim.js takes property
      tax OUT of it (ECON.tax.property); /src/demographics prices a dwelling per
      zone and tests every household's rent burden against what its education
      earns. So the card was not being careful, it was being WRONG — and wrong
      in the way that costs most, because the next reader of this file believes
      it about the game as readily as the player believes it about the city.

   ── WHERE EVERY ROW COMES FROM, PER KIND OF BUILDING ────────────────────────
   A RESIDENCE (def.popCap > 0) — /src/demographics + /src/economy:
     Income        REAL — Σ `incomeOf(archetype, education, jobFit)` over the
                   households actually let here, i.e. ECON.labor band wages at
                   the share of seekers this city's firms can absorb, plus
                   pensions and student support. The SAME call, with the same
                   argument, that pipeline.js runs every tick to decide who can
                   stay. It is an earning figure, not a payment from this tile:
                   the Cinder itself arrives as the city's payroll.
     Rent          REAL — `rentOf(zone) × dwellings let here`. Priced off the
                   unskilled wage at this zone's multiplier and the city's live
                   housing tightness. ⚠ The rent that DEBITS a household is
                   `HH.chargeRent()`, charged city-wide out of savings; the row
                   says so and quotes what the tick actually collected.
     Upkeep        UNAVAILABLE, and now for the true reason: the economy charges
                   upkeep to FIRMS (they buy maintenance goods out of their cash
                   surplus — sim.js runFirmUpkeep). No recurring charge is
                   levied on a dwelling at all.
     Resource Cost REAL — ECON.household.subsistence × the residents here. This
                   is the tick's own formula (`rate × pop × days`) restricted to
                   this address's share of the population.
     Fees Paid     REAL — ECON.tax.property against the rent above, which is
                   exactly how sim.js levies it: out of the rent, never on top.

   AN OPERATION / PRODUCER:
     Income        REAL — def.gen.cinder through genOf() × the tile multiplier
                   × city conditions, i.e. the exact number economyTick pays.
                   Plus lot rent for a leased plot.
     Rent          REAL for a leased lot (LOT_RENT_PER_MIN). UNAVAILABLE
                   otherwise: no COMMERCIAL tenancy is modelled — the rent this
                   city charges is residential.
     Upkeep        UNAVAILABLE per tile. An operation's is charged on its
                   LICENCE in Just Business; a firm's is charged on its books.
     Resource Cost REAL — def.use and def.svc.input, in the resources the tick
                   draws. NOT converted to Cinder: index.html's RESOURCES have
                   no price written down anywhere (CLAUDE.md) and inventing an
                   exchange rate to make the column line up would be exactly
                   that. (The economy's own chain resources DO have derived
                   prices, which is why the residence row above can be costed
                   and this one cannot.)
     Fees Paid     UNAVAILABLE per tile — but the rates are named, because this
                   city does levy tax: payroll and corporate on a business's
                   books, property out of rent, sales on household purchases.

   🔴 NOTHING HERE WRITES. Not a balance, not a ledger, not a tick. Every number
      is read back out of a module that already computed it — see ECONOMY.md for
      the four money leaks that all looked correct in review, and note that a
      READER cannot be the fifth.

   ⏱ THE PERIOD IS A CYCLE, NOT A MONTH. CITY_DAY_MIN (20 real minutes) is the
      city's own accounting period — the Ledger tab already projects over it —
      so the rows say "/cycle" rather than borrowing "/mo." from a game with a
      calendar. The economy's day is ECON.clock.dayMin, also 20 today; the two
      are CONVERTED rather than assumed equal, because one of them being
      retuned must move these rows, not silently mis-state them.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── The two optional layers, probed exactly the way the rest of this module
   probes the citizens/streets/zoning seams. Both are ES modules that put
   themselves on `window` (the direction that works — CLAUDE.md's globals
   trap), and a 404 on either must cost the reader a row, not the card.
   ⚠ `ready()` is the difference between "the module is absent" and "the module
     is here but has not run yet", and the rows say which. A panel that renders
     a fault as an empty city is how a broken panel goes on looking healthy —
     household.js draws the same three-way distinction for the roster. */
function ecoLayer() {
  try {
    const E = (typeof window !== 'undefined') ? window.MythicEconomy : null;
    if (!E || typeof E.ready !== 'function' || !E.ready()) return null;
    return E;
  } catch (e) { return null; }
}
function demogLayer() {
  try {
    const D = (typeof window !== 'undefined') ? window.MythicDemographics : null;
    if (!D || typeof D.ready !== 'function' || !D.ready()) return null;
    return D;
  } catch (e) { return null; }
}
function safe(fn, dflt) { try { const v = fn(); return v == null ? (dflt == null ? null : dflt) : v; } catch (e) { return dflt == null ? null : dflt; } }

/* A chain resource's display name and icon. The 258 chain ids are NOT in
   index.html's RESOURCES (CLAUDE.md), so C.resIco/C.resName cannot answer for
   `bread` — chain.js can, and it is already on window for exactly this. Falls
   back to the raw id rather than to a guess. */
function chainRes(id) {
  const d = safe(() => window.MythicResourceChain.byId(id));
  return { name: (d && d.name) || String(id), ico: (d && d.icon) || '' };
}

/* How many ECONOMIC DAYS fit in one accounting CYCLE. Both are 20 real minutes
   today and the temptation is to write 1 — but they are two different systems'
   tuning knobs and the day this stops being true, every money row on this card
   would be wrong by the ratio and nothing would say so. */
function daysPerCycle(ECON, cyc) {
  const dm = ECON && ECON.clock ? +ECON.clock.dayMin : 0;
  return (dm > 0 && cyc > 0) ? cyc / dm : 1;
}

const pct = (v) => (Math.round(v * 1000) / 10) + '%';

/* City-conditions multipliers, read from the vitals→output system rather than
   reimplemented, and guarded exactly the way index.html's insOM() guards it —
   that system is owned elsewhere and this panel must degrade to "1.0" rather
   than throw if it is renamed. */
function omOf(C, t) {
  const o = { res: 1, cin: 1, ok: false };
  try {
    if (typeof C.tileOutputFactor === 'function' && typeof C.cityOutputMultipliers === 'function') {
      const M = C.cityOutputMultipliers();
      o.res = C.tileOutputFactor(t, false, M);
      o.cin = C.tileOutputFactor(t, true, M);
      o.ok = true;
    }
  } catch (e) { /* the panel is not the place to surface another system's fault */ }
  return o;
}

/* The same input gate economyTick applies: a generator with ANY input at zero
   produces nothing at all this tick. A halted building's income is 0, and the
   panel says which input stopped it. */
function haltedInput(C, t) {
  const def = C.BUILDINGS[t.type];
  if (!def || !def.gen || !def.use) return null;
  for (const u in def.use) {
    let have = 1;
    try { have = C.haveOf(u); } catch (e) { have = 1; }
    if (have <= 0) return u;
  }
  return null;
}

/* The business the economy founded ON THIS TILE, if any. `tileKey` is the
   economy's own link back to node-city and the only honest way to say "this
   building's books" — matching by name or by industry would attach the wrong
   firm the moment a city has two bakeries. */
function firmOnTile(E, k) {
  if (!E || typeof E.firms !== 'function') return null;
  return safe(() => E.firms().find(f => f && f.tileKey != null && String(f.tileKey) === String(k)) || null);
}
/* What to CALL that business. `f.name` is whatever founded it — node-city passes
   the building's own blueprint name, so a landlord firm on a Housing tile is
   called "Housing", which reads as nonsense in a sentence about a business. The
   industry's own label is the one that means something ("Property Company"). */
function firmLabel(E, f) {
  if (!f) return 'the business here';
  const meta = safe(() => E.industries[f.ind]);
  return (meta && meta.name) || String(f.name || f.ind || 'the business here');
}
/* 🏠 THE RENT THAT ACTUALLY LANDS ON THIS ADDRESS, and it is a restriction of
   the tick's own line rather than an allocation invented here: sim.js
   runShopping credits `net / landlords.length` to EVERY landlord firm in the
   city, so a tile whose firm is one of them received exactly that. Returns null
   unless this tile really is one of them — a housing tile with no firm behind it
   banks nothing and must not be shown a share of somebody else's rent. */
function landlordShare(E, snap, firm) {
  if (!E || !snap || !snap.flow || !firm || firm.ind !== 'landlord') return null;
  const n = safe(() => E.firms().filter(f => f && f.ind === 'landlord').length, 0);
  if (!(n > 0)) return null;
  const tax = (E.ECON && E.ECON.tax) ? +E.ECON.tax.property : 0;
  const net = Math.max(0, +snap.flow.rent || 0) * (1 - (Number.isFinite(tax) ? tax : 0));
  return { each: net / n, n, net };
}

export function booksOf(C, k) {
  const t = C.game.tiles[k];
  if (!t) return null;
  const def = C.BUILDINGS[t.type] || {};
  const p = String(k).split(',');
  const x = +p[0], z = +p[1];
  const cyc = +C.CITY_DAY_MIN || 20;

  let mult = 1;
  try {
    mult = C.tileMult(x, z, t, C.staffingRatio(),
      (C.game.power && Number.isFinite(C.game.power.factor)) ? C.game.power.factor : 1);
  } catch (e) { mult = 1; }
  if (!Number.isFinite(mult)) mult = 1;

  const om = omOf(C, t);
  const halt = haltedInput(C, t);
  const dead = !!(t.damaged || halt);
  const rows = [];
  const notes = [];
  /* 🔴 THREE REASONS A ROW CAN BE BLANK, AND THEY ARE NEVER POOLED. This was
     ONE list called `unavailable`, and the footnote it built said every blank
     row was blank "because this city does not model it at all" — which turned a
     missing module and an empty house into a claim about the game's design.
     That is the same class of error the header records: the blank was fine, the
     REASON was invented.
       unmodelled  nothing anywhere computes this for a building
       unreadable  something does, but the module that owns it is not here
       notyet      the model has an answer and it is "nothing, yet" */
  const unmodelled = [];
  const unreadable = [];

  const isHome = def.popCap > 0;
  const E = ecoLayer();
  const DG = demogLayer();
  const ECON = E ? E.ECON : null;
  const snap = E ? safe(() => E.snapshot()) : null;
  const days = daysPerCycle(ECON, cyc);
  const firm = firmOnTile(E, k);

  /* The residence facts, gathered once. `R.ok === false` is a real answer with
     a sentence in it (this land is not zoned for housing); `R === null` means
     the layer is not here at all, and the two must never print the same. */
  const R = isHome && DG ? safe(() => DG.residents(k)) : null;
  const rep = isHome && DG ? safe(() => DG.report()) : null;
  const let_ = (R && R.ok) ? (R.occupied | 0) : 0;
  const heads = (R && R.ok) ? Math.max(0, +R.residents || 0) : 0;
  const rentCycle = (R && R.ok && let_ > 0) ? (+R.rent || 0) * let_ * days : 0;
  const share = landlordShare(E, snap, firm);
  const incomeCycle = (R && R.ok) ? Math.max(0, +R.income || 0) * days : 0;

  /* ── INCOME ─────────────────────────────────────────────────────────────
     genOf() is the SAME function every other rate readout goes through — it
     is what turns def.gen.cinder (authored per minute) into the per-hour rate
     the tick actually pays. Reading def.gen.cinder raw here is how a panel
     ends up advertising a rate a player cannot reproduce. */
  let income = 0, incomeKnown = false;
  if (def.gen && def.gen.cinder != null) {
    incomeKnown = true;
    income += dead ? 0 : C.genOf(def, 'cinder') * mult * om.cin * cyc;
  }
  let lotRent = 0;
  if (t.type === 'lot' && t.tenant) {
    incomeKnown = true;
    let f = 1;
    try { f = C.tileOutputFactor(t, true); } catch (e) { f = 1; }
    if (!Number.isFinite(f)) f = 1;
    lotRent = C.cinderRate(C.LOT_RENT_PER_MIN) * f * cyc;
    income += lotRent;
  }
  if (incomeKnown) {
    rows.push({ label: 'Income', value: fmtCin(C, income), cls: income > 0 ? 'up' : 'fl',
      /* ⚠ THE MULTIPLIER IS NAMED, because without it a legitimate 0.00 reads
         as a rounding bug. On an understaffed city staffingRatio() is 0, so
         tileMult is 0 and the honest income of every crewed building really is
         nothing — printing "+0.00 🔥" with no explanation was the first thing
         that looked broken in the real render. The number quoted is the same
         ×mult the Efficiency Factors card decomposes. */
      sub: dead ? (t.damaged ? 'nothing while it is damaged'
                             : 'halted — the city has no ' + safeRes(C, halt))
                : 'what the tick pays, at this tile’s ×' + mult.toFixed(2) + ' multiplier' +
                  (income <= 0 ? ' — which is why it is nothing right now' : '') });
  } else if (isHome) {
    /* 🏠 A HOME'S INCOME IS ITS HOUSEHOLDS'. The building sells nothing and
       that was never the interesting half — the reference panel's Income line
       against a residence is what the people inside it earn. */
    rows.push(residentIncomeRow(DG, R, rep, incomeCycle, let_, cyc, C, snap, days));
  } else {
    rows.push({ label: 'Income', value: '—', cls: 'fl', un: true,
      sub: 'this building sells nothing — it earns no Cinder of its own' });
  }

  /* 🧍💸 WHAT THE CITY'S RESIDENTS SPENT ACROSS THIS COUNTER.
     ------------------------------------------------------------------
     The Income row above is the TILE's own production — def.gen.cinder put
     through genOf() and paid by node-city's tick. For a shop that is the
     wrong half of the question and, until this row existed, the only half
     on the panel: a Grocery with a full crew and real customers printed
     'this building sells nothing — it earns no Cinder of its own', which is
     false about the business standing on it.

     🔴 THE FIGURES ARE THE SIMULATION'S, NOT AN ESTIMATE. `revenueDay` and
        `customersDay` are kept by /src/economy/firms.js and are the same
        numbers the Econ panel prints. Multiplying a price by a population
        here would produce a plausible figure that drifts from the ledger
        the moment anything is retuned — the two-systems-disagreeing defect
        this package polices hardest.
     ⚠ AND IT IS A DIFFERENT KIND OF CINDER FROM THE ROW ABOVE. This is
       money residents were PAID and then spent, moving inside the economy's
       closed loop; the Income row is what the city tick banks for the
       player. They are not added together anywhere, and the labels say so.
     ⚠ A shop with a payroll and no takings is the SHIPPED state of any
       trade whose supply chain the city cannot feed yet (see round0j's dark
       list in tools/economy-tests). The empty case says WHY rather than
       printing a bare zero that reads as a bug. */
  if (firm && (firm.kind === 'retail' || firm.kind === 'service')) {
    const took = Math.max(0, +firm.revenueDay || 0);
    const cust = Math.max(0, Math.round(+firm.customersDay || 0));
    const crew = ['unskilled', 'skilled', 'technical', 'advanced']
      .reduce((s, b) => s + ((firm.workers && firm.workers[b]) | 0), 0);
    rows.push({ label: 'Customer spend', value: took > 0 ? fmtCin(C, took) : '—',
      cls: took > 0 ? 'up' : 'fl', un: took <= 0,
      sub: took > 0
        ? cust + ' customer' + (cust === 1 ? '' : 's') + ' a day · ' + crew +
          ' on the payroll — residents spending wages, inside the economy'
        : 'no takings yet — nothing this trade sells can be supplied by the city' });
  }
  /* Belt and braces: a residence that ALSO generates (nothing in BUILDINGS does
     today) gets both lines rather than one of them silently winning. */
  if (isHome && incomeKnown) {
    const r = residentIncomeRow(DG, R, rep, incomeCycle, let_, cyc, C, snap, days);
    r.label = 'Resident Income';
    rows.push(r);
  }

  /* ── RENT ───────────────────────────────────────────────────────────────── */
  if (t.type === 'lot') {
    rows.push({ label: 'Rent', value: t.tenant ? fmtCin(C, lotRent) : '—',
      cls: t.tenant ? 'up' : 'fl', un: !t.tenant,
      sub: t.tenant ? 'paid to you by ' + String(t.tenant).slice(0, 32)
                    : 'vacant — nothing is leased here yet' });
  } else if (isHome) {
    if (!DG) {
      unreadable.push('Rent');
      rows.push({ label: 'Rent', value: '—', cls: 'fl', un: true,
        sub: 'the housing layer (/src/demographics) is not mounted in this build, so what a dwelling here lets for cannot be read — it is missing, not unmodelled' });
    } else if (!R || !R.ok) {
      rows.push({ label: 'Rent', value: '—', cls: 'fl', un: true,
        sub: (R && R.why) ? String(R.why) : 'the housing layer did not answer for this tile' });
    } else if (let_ <= 0) {
      /* NOT a blank: the asking rent for a dwelling in this zone is a real
         figure whether or not anyone has taken one yet, and printing it is the
         difference between "no model" and "no tenant". */
      rows.push({ label: 'Rent', value: '—', cls: 'fl',
        sub: 'nothing is let here yet — a dwelling in ' + esc0(R.zone && R.zone.name) + ' asks ' +
             C.rate((+R.rent || 0) * days) + ' 🔥 per cycle, and this address has ' +
             (R.homes | 0) + ' of them standing empty' });
    } else {
      const b = R.rentBurden;
      rows.push({ label: 'Rent', value: fmtCin(C, rentCycle), cls: 'up',
        sub: let_ + ' of ' + (R.homes | 0) + ' dwellings let, at ' + C.rate((+R.rent || 0) * days) +
             ' 🔥 each per cycle — priced off the unskilled wage at ' + esc0(R.zone && R.zone.name) +
             '’s multiplier' + (rep && rep.rentIndex ? ' and the city’s housing tightness ×' + (+rep.rentIndex).toFixed(2) : '') +
             (b != null ? ', which is ' + pct(b) + ' of what the lead household here earns' : '') +
             '. ⚠ This is what the housing model charges for the address; the Cinder that MOVES is charged city-wide out of household savings' +
             (snap && snap.flow ? ' — ' + C.rate(+snap.flow.rent || 0) + ' 🔥 of it in the last economic day' : '') +
             (share ? ', and the net of that was split across the city’s ' + share.n + ' property companies, so the one on this address banked ' +
                      C.rate(share.each * days) + ' 🔥 per cycle' : '') + '.' });
    }
  } else {
    unmodelled.push('Rent');
    rows.push({ label: 'Rent', value: '—', cls: 'fl', un: true,
      sub: 'no commercial tenancy is modelled — the rent this city charges is residential (on a dwelling’s household) or the lease on a Plot' });
  }

  /* ── BUILDING UPKEEP ────────────────────────────────────────────────────── */
  let opRow = null;
  try { opRow = C.opsRowForKey ? C.opsRowForKey(k) : null; } catch (e) { opRow = null; }
  unmodelled.push('Building Upkeep');
  if (opRow) {
    rows.push({ label: 'Building Upkeep', value: 'on the licence', cls: 'fl', un: true,
      sub: 'wages and investments for this operation are settled in Just Business, not on this tile' });
  } else if (firm) {
    rows.push({ label: 'Building Upkeep', value: 'on the business', cls: 'fl', un: true,
      sub: 'not levied on the tile: the ' + esc0(firmLabel(E, firm)) + ' the economy runs at this address buys maintenance goods out of its own cash surplus each day, and the bill sits on its books rather than on the building' });
  } else if (isHome) {
    rows.push({ label: 'Building Upkeep', value: 'none', cls: 'fl', un: true,
      sub: 'no recurring charge is levied on a dwelling — the economy charges upkeep to businesses, never to a home. What a house does cost over time is repair after wear' });
  } else {
    rows.push({ label: 'Building Upkeep', value: 'none', cls: 'fl', un: true,
      sub: 'no recurring per-tile upkeep exists in this city; a building’s only running cost is repair after wear' });
  }

  /* ── RESOURCE COST ──────────────────────────────────────────────────────── */
  const draws = [];
  if (def.use) for (const r in def.use) {
    draws.push({ r, v: t.damaged ? 0 : def.use[r] * mult * om.res * cyc, chain: false });
  }
  if (def.svc && def.svc.input) {
    draws.push({ r: def.svc.input, v: t.damaged ? 0 : def.svc.rate * mult * cyc, chain: false });
  }
  /* 🍞 A HOME CONSUMES THROUGH THE PEOPLE IN IT, and the tick says so in one
     line: `ECON.household.subsistence[id] × pop × days`. Restricting that to
     this address's residents is the same formula with a smaller pop, which is
     why it can be printed — it is not an allocation of a city total, it is the
     term itself. */
  let subCost = 0, subPriced = false;
  if (isHome && ECON && ECON.household && ECON.household.subsistence && heads > 0) {
    for (const id in ECON.household.subsistence) {
      const units = ECON.household.subsistence[id] * heads * days;
      if (!(units > 0)) continue;
      const meta = chainRes(id);
      draws.push({ r: id, v: units, chain: true, ico: meta.ico, name: meta.name });
      const price = E && typeof E.price === 'function' ? +E.price(id) : NaN;
      if (Number.isFinite(price) && price > 0) { subCost += units * price; subPriced = true; }
    }
  }
  if (subPriced) {
    /* 💰 THE ONE RESOURCE ROW THAT CAN BE A MONEY ROW, and the reference panel
       wants it to be. The basket is chain resources, and chain resources have a
       DERIVED price (prices.js, off the recipe graph) — so this column can be
       stated in Cinder without anybody writing a price down, which is the
       distinction CLAUDE.md draws and the reason the producer branch below
       still refuses to. The units are in the caption; six of them side by side
       overran the value column, and two of the six share an icon (🍞 Bread and
       🍞 Prepared Meals), so an icon list was unreadable as well as too wide. */
    const chain = draws.filter(d => d.chain);
    const other = draws.filter(d => !d.chain);
    rows.push({ label: 'Resource Cost', value: fmtCin(C, -subCost), cls: 'dn',
      sub: 'what ' + Math.round(heads) + ' resident' + (heads === 1 ? '' : 's') + ' eat, drink and burn per cycle: ' +
        chain.map(d => C.rate(d.v) + ' ' + d.name).join(' · ') +
        (other.length ? ' — plus the building’s own draw of ' + other.map(d => C.rate(d.v) + ' ' + safeRes(C, d.r)).join(' · ') : '') +
        '. Priced at the market rates the economy derives (the tick adds a local freight premium on top), paid out of household savings; ' +
        'what a household cannot cover the treasury does, and what neither covers the seller eats.' });
  } else if (draws.length) {
    rows.push({ label: 'Resource Cost',
      value: draws.map(d => '<span class="dn">−' + C.rate(d.v) + '</span> ' +
        (d.chain ? (d.ico || '') : safeIco(C, d.r))).join(' · '),
      raw: true, cls: 'dn',
      sub: (isHome
        ? 'what the residents here draw per cycle — the economy layer is not mounted, so it cannot be priced in Cinder from this panel'
        : 'drawn from the city stock every cycle — in goods, not Cinder: index.html writes down no price for these') });
  } else if (isHome) {
    rows.push({ label: 'Resource Cost', value: '—', cls: 'fl',
      sub: heads > 0
        ? 'the economy layer is not mounted, so the subsistence basket its residents draw cannot be read'
        : 'nobody lives here yet, so nothing is being consumed at this address' });
  } else {
    rows.push({ label: 'Resource Cost', value: '—', cls: 'fl', un: true,
      sub: 'it consumes nothing to run' });
  }

  /* ── FEES PAID ──────────────────────────────────────────────────────────── */
  const taxT = ECON && ECON.tax ? ECON.tax : null;
  if (isHome && rentCycle > 0 && taxT && taxT.property != null) {
    /* 🔴 OUT OF THE RENT, NEVER ON TOP OF IT. sim.js runShopping documents this
       as the property-tax leak the audit caught on day one: taxing on top and
       crediting the treasury as well conjures the slice out of nothing. The row
       is computed the same way round as the tick computes it, so a reader can
       check one against the other. */
    rows.push({ label: 'Fees Paid', value: fmtCin(C, -rentCycle * taxT.property), cls: 'dn',
      sub: 'property tax, ' + pct(taxT.property) + ' of the rent above — taken OUT of the rent, never on top of it, so the landlord receives the rest' +
        (taxT.sales != null ? '. Residents also pay ' + pct(taxT.sales) + ' sales tax on what they buy, which is levied on the city’s shopping rather than against this address' : '') });
  } else {
    /* An empty house pays no property tax because it collects no rent, which is
       the model working — it is neither an unmodelled row nor an unreadable
       one, so it goes in neither list and earns no footnote. */
    const vacant = isHome && DG && R && R.ok && let_ <= 0;
    if (!taxT) unreadable.push('Fees Paid');
    else if (!vacant) unmodelled.push('Fees Paid');
    const rates = taxT
      ? 'this city does levy tax — ' + pct(taxT.payroll) + ' on wages and ' + pct(taxT.corporate) +
        ' on profit, on a business’s books; ' + pct(taxT.property) + ' out of rent; ' + pct(taxT.sales) +
        ' on household purchases — but none of it is charged against a tile, so no figure belongs on this line'
      : 'the economy layer is not mounted, so this city’s tax rates cannot be read from here';
    rows.push({ label: 'Fees Paid', value: '—', cls: 'fl', un: true,
      sub: vacant
        ? 'nothing is let here, so no rent is charged and no property tax falls out of it'
        : rates });
  }

  /* ── LIFETIME, and this one is MEASURED, not projected ──────────────────── */
  const earn = Math.max(0, +t.earn || 0), spent = Math.max(0, +t.spent || 0);
  const lifetime = (earn || spent)
    ? { earn, spent, net: earn - spent, ok: true }
    : { ok: false };

  if (unmodelled.length) {
    notes.push(unmodelled.join(', ') + ' ' + (unmodelled.length === 1 ? 'is' : 'are') +
      ' blank because nothing in this city computes ' + (unmodelled.length === 1 ? 'it' : 'them') +
      ' PER BUILDING — not because the figure was withheld, and not because the city has no such concept. ' +
      'Every other row is a number the tick itself produces.');
  }
  if (unreadable.length) {
    notes.push(unreadable.join(', ') + ' could not be READ: the module that owns ' +
      (unreadable.length === 1 ? 'it' : 'them') + ' is not mounted in this build. That is a gap in the panel, not in the city.');
  }
  if (isHome && R && R.ok && let_ > 0) {
    notes.push('Rent and Income here are the housing model’s own figures, in Cinder per economic day and priced off the same wage table the city pays; they decide who can afford to live at this address. The Cinder that actually changes hands does so city-wide, in the economy’s audited day.');
  }
  if (isHome && !DG && !E) {
    notes.push('Neither the housing nor the economy layer is mounted in this build, so this address’s books cannot be read at all. That is a missing module, not an empty house.');
  }

  return { rows, notes, cycle: cyc, mult, om, halted: halt, income, lifetime,
    /* The read seam a driver checks against, so a test does not have to parse
       the markup back into numbers. */
    residence: isHome ? { ok: !!(R && R.ok), let: let_, heads, days,
      rentCycle, incomeCycle, subCost: subPriced ? subCost : null,
      feeCycle: (rentCycle > 0 && taxT) ? rentCycle * taxT.property : 0 } : null };
}

/* One residence Income row, in the four states it can be in — and they are
   four, not two, because "the module is absent", "the module has nothing to say
   about this tile", "nobody lives here" and "here is the number" are four
   different facts and a reader who cannot tell them apart cannot act on any of
   them. */
function residentIncomeRow(DG, R, rep, incomeCycle, let_, cyc, C, snap, days) {
  if (!DG) {
    return { label: 'Income', value: '—', cls: 'fl', un: true,
      sub: 'the housing layer (/src/demographics) is not mounted in this build, so what the people here earn cannot be read — it is missing, not unmodelled' };
  }
  if (!R || !R.ok) {
    return { label: 'Income', value: '—', cls: 'fl', un: true,
      sub: (R && R.why) ? String(R.why) : 'the housing layer did not answer for this tile' };
  }
  if (let_ <= 0 || !(incomeCycle > 0)) {
    const occ = rep && rep.homes > 0 ? Math.round((rep.occupancy || 0) * 100) : null;
    return { label: 'Income', value: '—', cls: 'fl',
      sub: 'no household is let at this address yet' +
        (occ != null ? ' — the city’s housing is ' + occ + '% occupied, so the model has not put anybody here' : '') +
        '. The dwellings are real and their beds count; they are simply empty.' };
  }
  const fits = R.households.map(h => h.jobFit).filter(v => Number.isFinite(v));
  const fit = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : null;
  return { label: 'Income', value: fmtCin(C, incomeCycle), cls: 'up',
    sub: 'what the ' + R.households.length + ' household' + (R.households.length === 1 ? ' here earns' : 's here earn') +
      ' per cycle — band wages for the work their education qualifies them for' +
      (fit != null ? ', at the ' + pct(fit) + ' job fit this city’s vacancies give them' : '') +
      ', plus pensions and student support. ⚠ Earned, not paid by this building: wages reach residents as the city’s payroll' +
      (snap && snap.flow ? ', ' + C.rate(+snap.flow.wages || 0) + ' 🔥 of it in the last economic day' : '') + '.' };
}

function fmtCin(C, v) { return (v >= 0 ? '+' : '−') + C.rate(Math.abs(v)) + ' 🔥'; }
function safeRes(C, r) { try { return C.resName(r); } catch (e) { return String(r); } }
function safeIco(C, r) { try { return C.resIco(r); } catch (e) { return ''; } }
/* The card escapes every `sub` on its way into the DOM (index.js facRow), so
   this is only ever guarding against a null reaching String() — not against
   markup. Doing it twice would print &amp; at the player. */
function esc0(s) { return String(s == null ? '' : s); }
