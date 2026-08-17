/* ══════════════════════════════════════════════════════════════════════════
   💰 THE BOOKS — Income, Rent, Upkeep, Resource Cost, Fees Paid.
   ──────────────────────────────────────────────────────────────────────────
   The reference panel prints five money lines per building. This city can
   answer three of them for real and cannot answer two, and the whole design of
   this file is about never letting a reader mistake which is which.

   🔴 A PLAUSIBLE NUMBER IS WORSE THAN NO NUMBER. index.html already made this
      call once, in insTopline: an operation's gross revenue is DELIBERATELY
      absent from the dossier because the parent game folds market and supply
      legs the city cannot see, and any figure printed here would disagree with
      the Just Business ledger. Same rule, applied to the same panel:

        Income          REAL   — def.gen.cinder through genOf() x the tile
                               multiplier x city conditions, i.e. the exact
                               number economyTick will pay. Plus lot rent for a
                               leased plot, which is a real Cinder inflow.
        Rent            REAL for a leased lot (LOT_RENT_PER_MIN). UNAVAILABLE
                               everywhere else — this city has no tenancy
                               model, nobody pays rent on a house.
        Building Upkeep UNAVAILABLE — there is no recurring per-building charge
                               in this game at all. What a building does cost
                               over time is REPAIR after wear, and that is
                               stated instead of dressed up as an upkeep fee.
                               An operation's upkeep is charged on its LICENCE,
                               in Just Business, not on this tile.
        Resource Cost   REAL   — def.use and def.svc.input, in the resources
                               the tick actually draws. NOT converted to Cinder:
                               "no resource price is written down anywhere"
                               (CLAUDE.md) and inventing an exchange rate to
                               make the column line up would be exactly that.
        Fees Paid       UNAVAILABLE — this city levies no tax on a building.
                               frApplyTax() is the parent game's civic tax and
                               does not read a city tile.

   ⏱ THE PERIOD IS A CYCLE, NOT A MONTH. CITY_DAY_MIN (20 real minutes) is the
      city's own accounting period — the Ledger tab already projects over it —
      so the rows say "/cycle" rather than borrowing "/mo." from a game with a
      calendar. Handed over in ctx; never written down here.
   ══════════════════════════════════════════════════════════════════════════ */

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
  const unavailable = [];

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
  } else {
    rows.push({ label: 'Income', value: '—', cls: 'fl', un: true,
      sub: 'this building sells nothing — it earns no Cinder of its own' });
  }

  /* ── RENT ───────────────────────────────────────────────────────────────── */
  if (t.type === 'lot') {
    rows.push({ label: 'Rent', value: t.tenant ? fmtCin(C, lotRent) : '—',
      cls: t.tenant ? 'up' : 'fl', un: !t.tenant,
      sub: t.tenant ? 'paid to you by ' + String(t.tenant).slice(0, 32)
                    : 'vacant — nothing is leased here yet' });
  } else {
    unavailable.push('Rent');
    rows.push({ label: 'Rent', value: '—', cls: 'fl', un: true,
      sub: 'not charged — the only tenancy this city models is a leased Plot' });
  }

  /* ── BUILDING UPKEEP ────────────────────────────────────────────────────── */
  let opRow = null;
  try { opRow = C.opsRowForKey ? C.opsRowForKey(k) : null; } catch (e) { opRow = null; }
  if (opRow) {
    unavailable.push('Building Upkeep');
    rows.push({ label: 'Building Upkeep', value: 'on the licence', cls: 'fl', un: true,
      sub: 'wages and investments for this operation are settled in Just Business, not on this tile' });
  } else {
    unavailable.push('Building Upkeep');
    rows.push({ label: 'Building Upkeep', value: 'none', cls: 'fl', un: true,
      sub: 'this city charges no recurring upkeep; a building’s only running cost is repair after wear' });
  }

  /* ── RESOURCE COST ──────────────────────────────────────────────────────── */
  const draws = [];
  if (def.use) for (const r in def.use) {
    draws.push({ r, v: t.damaged ? 0 : def.use[r] * mult * om.res * cyc });
  }
  if (def.svc && def.svc.input) {
    draws.push({ r: def.svc.input, v: t.damaged ? 0 : def.svc.rate * mult * cyc });
  }
  if (draws.length) {
    rows.push({ label: 'Resource Cost',
      value: draws.map(d => '<span class="dn">−' + C.rate(d.v) + '</span> ' + safeIco(C, d.r)).join(' · '),
      raw: true, cls: 'dn',
      sub: 'drawn from the city stock every cycle — in goods, not Cinder: this game writes down no resource price' });
  } else {
    rows.push({ label: 'Resource Cost', value: '—', cls: 'fl', un: true,
      sub: 'it consumes nothing to run' });
  }

  /* ── FEES PAID ──────────────────────────────────────────────────────────── */
  unavailable.push('Fees Paid');
  rows.push({ label: 'Fees Paid', value: '—', cls: 'fl', un: true,
    sub: 'no tax or civic fee is levied on a building in this city' });

  /* ── LIFETIME, and this one is MEASURED, not projected ──────────────────── */
  const earn = Math.max(0, +t.earn || 0), spent = Math.max(0, +t.spent || 0);
  const lifetime = (earn || spent)
    ? { earn, spent, net: earn - spent, ok: true }
    : { ok: false };

  if (unavailable.length) {
    notes.push(unavailable.join(', ') + ' ' + (unavailable.length === 1 ? 'is' : 'are') +
      ' shown as unavailable because this city does not model ' +
      (unavailable.length === 1 ? 'it' : 'them') + ' at all — a plausible figure here would be invented.');
  }

  return { rows, notes, cycle: cyc, mult, om, halted: halt, income, lifetime };
}

function fmtCin(C, v) { return (v >= 0 ? '+' : '−') + C.rate(Math.abs(v)) + ' 🔥'; }
function safeRes(C, r) { try { return C.resName(r); } catch (e) { return String(r); } }
function safeIco(C, r) { try { return C.resIco(r); } catch (e) { return ''; } }
