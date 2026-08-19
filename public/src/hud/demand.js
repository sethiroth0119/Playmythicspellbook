/* ============================================================================
   📊 ZONE DEMAND — the model behind the four arrows.
   ============================================================================
   BAR.md reference frame 4 asks for one arrow-shaped meter per demand type with
   a SIGNED CAUSAL LIST beside it. The hard part is not the arrow.

   🔴 THE ONE RULE THIS FILE EXISTS TO KEEP: every line in every causal list is
      READ OFF A LIVE MODEL, and carries the module it came from. Nothing here
      invents a reason, and nothing here invents a number to put in a reason.
      A term whose source module is absent is NOT emitted with a default — it is
      simply missing from the list, and if a whole category has no live term the
      meter says so in words rather than drawing a plausible bar. This project
      has already had to rip out one panel that confidently contradicted the
      panel next to it; a short list is the cheap way not to be the second.

   WHAT IS DELIBERATELY NOT HERE:
     · TAXES. BAR.md's transcription of the reference lists "+ Taxes" as a
       commercial cause. There is no tax rate anywhere in node-city — frApplyTax
       is the main app's civic tax on a different ledger — so a tax line here
       would be a number with nothing behind it. Omitted, and this comment is
       why, so the next reader does not "restore" it from the reference.
     · GAS STATION AVAILABILITY, and the rest of the reference's per-service
       coverage causes. node-city models seven NEEDS (food, water, power,
       safety, light, health, leisure) and none of them is fuel retail.
     · LAND VALUE. Nothing computes it.

   TWO DIFFERENT DERIVATIONS, ON PURPOSE:
     · RESIDENTIAL is not derived here at all. /src/demographics already
       publishes exactly this object — an attractiveness scalar, a signed cause
       list and a binding-limit verdict — and re-deriving it would be a second
       opinion about the same city. We print theirs.
     · COMMERCIAL / OFFICE / INDUSTRIAL have no such model, so the meter IS the
       list: the value is the midpoint plus the signed weights of the terms
       below it, every one of which quotes a live figure. The panel says so in
       as many words, so no player is asked to trust an unexplained bar.
   ============================================================================ */

/* The reference's colours, but taken from /src/zoning's own zone table at read
   time when it is loaded, so the meter and the map can never disagree about
   what "commercial blue" is. These are the fallbacks for a page with no zoning
   module, and they are the r_row / c_low / o_low / i_mfg swatches. */
const FALLBACK_COL = { res: '#63bd4a', com: '#63b4ee', off: '#3ec6b4', ind: '#dcb63c' };
const META = {
  res: { name: 'Residential', ico: '🏠' },
  com: { name: 'Commercial',  ico: '🛒' },
  off: { name: 'Office',      ico: '🧠' },
  ind: { name: 'Industrial',  ico: '🏭' },
};
export const CAT_ORDER = ['res', 'com', 'off', 'ind'];

const clamp01 = (v) => (isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const n0 = (v) => Math.round(Number(v) || 0);
const n1 = (v) => (Math.round((Number(v) || 0) * 10) / 10);
const pc = (v) => Math.round(clamp01(v) * 100) + '%';
/* 🔴 A FORMATTER THAT CANNOT PRINT "0" FOR SOMETHING THAT IS NOT ZERO. n1()
   rounds to one decimal, which is how the panel came to say "Residents wanted 0
   of goods … satisfaction is 0%" in the same sentence — a self-contradiction
   that was really a rounding artefact sitting on top of a missing weight. Any
   quantity small enough that n1() would flatten it gets two significant figures
   instead, so a 0.04 reads as 0.04 and the reader can see for themselves that
   it is not a shortage. */
function qty(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 100) return String(Math.round(n));
  if (a >= 1) return String(Math.round(n * 10) / 10);
  return String(Number(a.toPrecision(2)) * (n < 0 ? -1 : 1));
}

function win() { try { return typeof window === 'undefined' ? null : window; } catch (e) { return null; } }
function mod(name) { const w = win(); if (!w) return null; try { return w[name] || null; } catch (e) { return null; } }
function call(o, fn, dflt) { try { return o && typeof o[fn] === 'function' ? o[fn]() : dflt; } catch (e) { return dflt; } }

/* 🚰 THE HOST'S OWN SERVICE COVERAGE — `game.cov.pct`, through node-city's
   `window.__nc` diagnostics seam, which is the only handle an ES module has on
   it (`game` is a top-level const in a module script and is not on window).
   This is the SAME object the status-bar dots and the Vital Signs card are
   drawn from, which is the whole reason it is read here rather than re-derived:
   see the water note in utilityTerms. */
function hostCoverage() {
  const w = win();
  try {
    const g = w && w.__nc && w.__nc.game;
    const p = g && g.cov && g.cov.pct;
    return p && typeof p === 'object' ? p : null;
  } catch (e) { return null; }
}

/* /src/zoning's swatch for a category — the first zone declared with that cat,
   which is the one the palette shows first. */
function catColour(cat) {
  const Z = mod('MythicZoning');
  try {
    const z = (Z && Z.ZONES || []).find((x) => x.cat === cat);
    if (z && typeof z.col === 'number') return '#' + z.col.toString(16).padStart(6, '0');
  } catch (e) {}
  return FALLBACK_COL[cat];
}

/* Zoned-but-empty land, per category. This is the one term every non-residential
   category shares: land already zoned and not yet taken up is the city telling
   you it does not want more of that zone yet. */
function zoneLand(cat) {
  const Z = mod('MythicZoning');
  if (!Z) return null;
  const st = call(Z, 'stats', null);
  if (!st || !st.per) return null;
  let zoned = 0;
  try {
    for (const z of Z.ZONES) if (z.cat === cat) zoned += st.per[z.id] || 0;
  } catch (e) { return null; }
  /* stats() reports developed/empty for the WHOLE city, not per category, so the
     honest per-category figure is the zoned count and the citywide take-up rate
     — never a per-category "empty" that was not measured. */
  const total = st.zoned || 0;
  const takeUp = total > 0 ? (st.developed || 0) / total : null;
  return { zoned, total, takeUp, empty: st.empty || 0 };
}

/* ── the shared suppressors ────────────────────────────────────────────────
   Power and water shortfalls hold back every kind of development, and both
   modules publish a shortfall directly. Nothing is inferred. */
function utilityTerms(out) {
  const P = mod('MythicPower');
  const st = call(P, 'state', null);
  if (st && st.ok && isFinite(st.factor) && st.factor < 0.999) {
    out.push({ sign: '−', w: -0.18 * (1 - st.factor), label: 'Grid Delivery Shortfall',
      why: 'The transmission grid is delivering only ' + pc(st.factor) + ' of what the city asks for, so nothing new runs at full output. This is the WIRES, not generation — the power dot on the status bar is supply against demand, and the two can differ when a line is the bottleneck.',
      src: '/src/power state().factor' });
  }
  /* 💧 TWO WATER MODELS, ONE SCREEN — and this panel used to carry the second
     verdict. The round-6 critic caught it at a glance: the meter said "Water
     Shortfall 100%" while the status bar 400px above it read WATER 410M with a
     green water dot, and both were reading a live model.
     They are not the same model, and /src/broadcast/sources.js `fromWater()`
     already had to settle exactly this — the comment there is the authority and
     this follows it rather than restating a second opinion:
       · /src/water's `shortfall` is draw MINUS CAPACITY — a PRODUCTION fact
         about the hydrology ("we are asking the ground for more than it
         yields"). A city can out-pump its aquifers for a long time with every
         tap still running, because the taps are fed from STOCK.
       · node-city's `game.cov.pct.water` is the SERVICE fact — the one the
         status bar, the Vital Signs card and the population gate are all drawn
         from ("are the taps running").
     So the SERVICE number is what suppresses development, because that is the
     number the rest of the screen is showing the player; and the hydrology gets
     its own separate line under its own name, saying what it actually means. A
     reader can now see both facts and neither contradicts the other.
     ⚠ `demandKnown` false means node-city never handed the module its
       per-citizen drink rate, so `draw` is missing the whole population term and
       a shortfall fraction built on it is meaningless. Same gate broadcast
       uses: not published at all. */
  const cov = hostCoverage();
  const served = cov && isFinite(cov.water) ? cov.water : null;
  if (served != null && served < 0.999) {
    out.push({ sign: '−', w: -0.18 * clamp01(1 - served), label: 'Water Service Shortfall',
      why: 'The taps are meeting ' + pc(served) + ' of what the city asks for. This is the same coverage figure the status bar’s water dot and the Vital Signs card are drawn from.',
      src: 'node-city game.cov.pct.water' });
  }
  const W = mod('MythicWater');
  const ws = call(W, 'state', null);
  if (ws && ws.ok && ws.demandKnown && ws.draw > 0 && (ws.shortfall || 0) > 0) {
    const share = clamp01(ws.shortfall / ws.draw);
    /* ⚠ WORDED FOR capacity === 0 AS WELL. A city with no waterworks at all has
       capacity 0 and therefore a 100% "shortfall", and calling that
       over-extraction would be a third wrong story: nothing is being extracted.
       "Production" covers both — no wells, and wells that cannot keep up. */
    out.push({ sign: '−', w: -0.08 * share, label: 'Water Production Shortfall',
      why: 'The city’s own waterworks can raise ' + qty(ws.capacity) + ' a minute against the ' + qty(ws.draw) +
           ' it draws, so ' + pc(share) + ' of the draw has no local production behind it.' +
           (served != null ? ' The taps are still at ' + pc(served) + ' — that is the status bar’s figure, fed from the city’s water store. This line is about the ground, not the tap.'
                           : ' This is the hydrology, not the tap: service coverage is its own figure.'),
      src: '/src/water state().capacity vs .draw' });
  }
}

/* ── the labour market, read once ──────────────────────────────────────────
   qualified = how many residents /src/demographics says are QUALIFIED for a
   band; employed/vacancies = what /src/economy's firms actually filled and
   posted. A surplus of qualified people over filled jobs in a band is the real
   signal that the city wants the kind of workplace that hires that band. */
function labour() {
  const E = mod('MythicEconomy');
  const lm = call(E, 'labourMarket', null);
  if (!lm || !lm.qualified) return null;
  const q = lm.qualified.bands || lm.qualified || {};
  const emp = lm.employed || {}, vac = lm.vacancies || {};
  const band = (k) => ({ q: Number(q[k]) || 0, e: Number(emp[k]) || 0, v: Number(vac[k]) || 0 });
  return { low: band('unskilled'), mid: band('skilled'), tech: band('technical'), adv: band('advanced') };
}
/* Surplus of qualified residents over jobs actually held, as a share of the
   qualified pool. Positive = people looking for that kind of work. */
function slack(b) {
  if (!b || b.q <= 0) return null;
  return (b.q - b.e) / b.q;
}

/* ════════════════════════════════════════════════════════════════════════════
   RESIDENTIAL — printed, not derived. See the header.
   ════════════════════════════════════════════════════════════════════════════ */
function residential() {
  const D = mod('MythicDemographics');
  if (!D || !call(D, 'ready', false)) {
    return { value: null, causes: [], note: 'The people of this city have not been counted yet — /src/demographics is not loaded, so nothing here can say who wants to live here.' };
  }
  let rep = null;
  try { rep = D.report(); } catch (e) { rep = null; }
  if (!rep || !rep.ok) {
    return { value: null, causes: [], note: (rep && rep.why) || 'The demographic model returned nothing this tick.' };
  }
  const causes = (rep.causes || []).map((c) => ({
    sign: c.sign, label: c.label, why: c.why, src: '/src/demographics causes',
  }));
  return {
    value: clamp01(rep.attract),
    causes,
    limit: rep.limitText || '',
    stat: [
      { k: 'Population', v: n0(rep.population) },
      { k: 'Homes', v: n0(rep.homes) },
      { k: 'Occupancy', v: pc(rep.occupancy) },
      { k: 'Net / day', v: (rep.netPerDay > 0 ? '+' : '') + n1(rep.netPerDay) },
    ],
    note: 'This meter is /src/demographics’ own attractiveness figure — the mean, over every household type that looked at every zone, of how willing they were to move in. The list beside it is that module’s signed cause list, printed verbatim.',
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   COMMERCIAL — "rises with residents and with local industrial output".
   ════════════════════════════════════════════════════════════════════════════ */
/* The basket categories a SHOP or a restaurant serves. Taken from
   /src/economy/households.js BASKET by its own `ind` field: every industry here
   is kind retail or service in recipes.js. Utilities, transport and housing are
   excluded because no commercial zone answers them. */
const RETAIL_KEYS = ['food', 'clothing', 'electronics', 'restaurants', 'entertainment', 'cards', 'luxury', 'healthcare'];

/* 🏷 WHAT ONE UNIT OF THIS CATEGORY COSTS, at today's price, taken as the
   CHEAPEST thing in the category's own resource list. This is the yardstick the
   magnitude gate below is measured against, and it is a live price rather than
   a threshold: `MythicEconomy.basket` is /src/economy/households.js BASKET and
   `price(id)` is Prices.priceOf. Returns null when the economy cannot price the
   category, and a category that cannot be priced is left out of the gate rather
   than guessed at. */
function unitPrice(key) {
  const E = mod('MythicEconomy');
  try {
    const b = (E && E.basket || []).find((x) => x && x.key === key);
    if (!b || !Array.isArray(b.res) || !b.res.length) return null;
    let min = Infinity;
    for (const id of b.res) {
      const pz = Number(E.price(id));
      if (isFinite(pz) && pz > 0 && pz < min) min = pz;
    }
    return isFinite(min) ? min : null;
  } catch (e) { return null; }
}

/* 🔴 THE TERM THAT PINNED COMMERCIAL AT 100%, AND WHAT IT NOW MEASURES.
   ─────────────────────────────────────────────────────────────────────────
   BEFORE: `sat` was the UNWEIGHTED mean of per-category satisfaction, and
   satisfaction is take ÷ want — so it collapses to 0 at ANY size of want. One
   category that wanted 0.04 Cinder and got none dragged the mean to the floor
   as hard as food wanting five hundred would, produced the panel's single
   largest weight (+0.45), and printed a sentence that contradicted itself in
   nine words: "Residents wanted 0 … satisfaction is 0%". Commercial sat pinned
   at 100%, and because "+ Commercial Demand (Industrial)" cites this very
   meter, the error propagated into a second arrow with no independent check.

   AFTER, two changes and they fix two different halves of it:
     1. WEIGHTED. The share is Σ unmet ÷ Σ want across the basket — a
        want-weighted satisfaction, so a category is heard in proportion to how
        much of the city's shopping it actually is. `want` is the denominator
        /src/economy now publishes (households.js `wantDemand`); it was always
        computed and never left the module, which is why the ratio was being
        read without it.
     2. GATED ON MAGNITUDE, NOT ON THE RATIO BEING ZERO. The unmet Cinder is
        converted to UNITS OF GOODS at the cheapest live price in each category,
        and a shortage smaller than ONE unit is not a shortage — it is a rounding
        remainder on the last transaction of the day. One unit is not a tuning
        constant: it is the smallest quantity of anything this economy can trade.
   The returned object is deliberately explicit rather than a formatted string,
   so the caller cannot print a sentence the numbers do not support. */
function retailShortfall(snap) {
  if (!snap || !snap.satisfaction) return null;
  const sat = snap.satisfaction, um = snap.unmet || {}, wt = snap.want || null;
  let want = 0, unmet = 0, units = 0, wantUnits = 0, n = 0, priced = 0;
  for (const k of RETAIL_KEYS) {
    const s = sat[k];
    if (s == null || !isFinite(s)) continue;
    n++;
    const u = Math.max(0, Number(um[k]) || 0);
    unmet += u;
    /* The want, preferring the published figure. The fallback is exact for any
       category that fell short (want = unmet ÷ (1 − satisfaction)) and simply
       unavailable for one that did not — an older /src/economy therefore makes
       the share read high rather than making up a number, and the unit gate
       below still holds the line. */
    const wPub = wt ? Number(wt[k]) : NaN;
    const w = isFinite(wPub) && wPub >= 0 ? wPub : (s < 1 ? u / (1 - s) : NaN);
    if (isFinite(w)) want += w;
    const up = unitPrice(k);
    if (up != null) { priced++; units += u / up; if (isFinite(w)) wantUnits += w / up; }
  }
  if (!n) return null;
  return { n, want, unmet, units, wantUnits, priced, wantKnown: !!wt,
           share: want > 0 ? clamp01(unmet / want) : 0 };
}

function commercial() {
  const out = [];
  const E = mod('MythicEconomy');
  const snap = call(E, 'snapshot', null);

  const rs = retailShortfall(snap);
  if (rs) {
    const served = Math.max(0, rs.want - rs.unmet);
    /* ⚠ BOTH CONDITIONS, and each covers a case the other cannot. A city short
       of a real share of a tiny basket still fails the unit test; a city short
       of many units out of an enormous basket still fails the share test and is
       correctly reported as coping. */
    if (rs.units >= 1 && rs.share > 0.02) {
      out.push({ sign: '+', w: 0.45 * rs.share, label: 'Local Demand',
        why: 'Residents wanted ' + qty(rs.want) + ' 🔥 of goods across ' + rs.n +
             ' basket categories and the shops could only serve ' + qty(served) + ' 🔥 of it — ' +
             pc(rs.share) + ' went unserved, about ' + qty(rs.units) + ' units of goods nobody could buy.',
        src: '/src/economy snapshot().want / .unmet' });
    } else if (rs.wantUnits < 1) {
      /* ⚠ AND THIS IS THE BRANCH THE OLD CODE GOT WRONG, SO IT SAYS SO OUT LOUD.
         A basket that adds up to less than one unit of goods is not a city whose
         shops are coping — it is a city with no consumer economy yet. Calling it
         "shops are keeping up" would be the mirror image of the bug: satisfaction
         really is 0%, and the reason it is 0% is that there is nothing there. */
      out.push({ sign: '−', w: -0.12, label: 'Almost Nobody Is Shopping Yet',
        why: 'The whole retail basket came to ' + qty(rs.want) + ' 🔥 this shopping round — less than the price of one unit of anything in it. ' +
             'Satisfaction reads ' + pc(1 - rs.share) + ', but there is nothing there to satisfy: a want that small is a rounding remainder, not a shortage, and it is not a reason to zone shops.',
        src: '/src/economy snapshot().want / .unmet' });
    } else if (rs.units < 1) {
      out.push({ sign: '−', w: -0.12, label: 'Shops Are Keeping Up',
        why: rs.unmet <= 0
          ? 'Every category in the basket was served in full — residents wanted ' + qty(rs.want) +
            ' 🔥 of goods this shopping round and got all of it.'
          : 'Nothing on the high street is short by even a single unit of goods: residents wanted ' +
            qty(rs.want) + ' 🔥 and ' + qty(served) + ' 🔥 of that was served. Unmet want of ' +
            qty(rs.unmet) + ' 🔥 is under the price of one unit of anything in the basket.',
        src: '/src/economy snapshot().want / .unmet' });
    } else {
      out.push({ sign: '−', w: -0.12, label: 'Shops Are Keeping Up',
        why: 'The shops served ' + qty(served) + ' 🔥 of the ' + qty(rs.want) +
             ' 🔥 residents wanted — ' + pc(1 - rs.share) + ' of the basket. Nothing on the high street is meaningfully short.',
        src: '/src/economy snapshot().want / .unmet' });
    }
  }

  const L = labour();
  const s = slack(L && L.low);
  if (s != null) {
    if (s > 0.02) out.push({ sign: '+', w: 0.3 * clamp01(s), label: 'Low-skill Labor Availability',
      why: n0(L.low.q) + ' residents are qualified for unskilled work and ' + n0(L.low.e) + ' hold it — ' + n0(L.low.q - L.low.e) + ' are looking. Shops hire from that pool.',
      src: '/src/economy labourMarket() + /src/demographics ladder()' });
    else out.push({ sign: '−', w: -0.3 * clamp01(-s), label: 'Low-skill Labor Availability',
      why: 'Unskilled jobs already outnumber the residents qualified to take them (' + n0(L.low.e) + ' held against ' + n0(L.low.q) + ' qualified). A new shop would have nobody to staff it.',
      src: '/src/economy labourMarket() + /src/demographics ladder()' });
  }

  const D = mod('MythicDemographics');
  let rep = null; try { rep = D && D.ready && D.ready() ? D.report() : null; } catch (e) { rep = null; }
  if (rep && rep.ok && isFinite(rep.netPerDay) && Math.abs(rep.netPerDay) > 0.05) {
    const g = rep.netPerDay > 0;
    out.push({ sign: g ? '+' : '−', w: (g ? 0.2 : -0.2) * clamp01(Math.abs(rep.netPerDay) / Math.max(8, rep.population * 0.02)),
      label: g ? 'Customers Arriving' : 'Customers Leaving',
      why: 'The city is ' + (g ? 'gaining ' : 'losing ') + n1(Math.abs(rep.netPerDay)) + ' residents a day. Every one of them is somebody the shops sell to.',
      src: '/src/demographics report().netPerDay' });
  }

  const land = zoneLand('com');
  if (land && land.zoned > 0 && land.takeUp != null && land.takeUp < 0.9) {
    out.push({ sign: '−', w: -0.25 * (1 - land.takeUp), label: 'Commercial Land Already Zoned',
      why: land.zoned + ' tiles are zoned commercial and only ' + pc(land.takeUp) + ' of the city’s zoned land has been taken up. There is nothing to gain by zoning more until it is.',
      src: '/src/zoning stats()' });
  }

  utilityTerms(out);
  return { causes: out, note: 'Commercial demand rises with residents and with what those residents could not buy. Every term below is a live reading; the meter is the midpoint plus their signed weights.' };
}

/* ════════════════════════════════════════════════════════════════════════════
   INDUSTRIAL — "rises with commercial demand".
   ════════════════════════════════════════════════════════════════════════════ */
function industrial(comValue) {
  const out = [];
  const E = mod('MythicEconomy');

  /* ⚠ THE ONE TERM IN THIS FILE THAT IS NOT AN INDEPENDENT READING. It cites
     the commercial meter, so any error there arrives here doubled and with no
     second opinion to catch it — which is exactly what happened when the
     unweighted Local Demand term pinned commercial at 100%. `src` says so in as
     many words, deliberately, so a reader auditing this arrow is sent to the
     meter above it rather than to a module. */
  if (comValue != null) {
    const d = comValue - 0.5;
    out.push({ sign: d >= 0 ? '+' : '−', w: 0.3 * d * 2, label: 'Commercial Demand',
      why: 'Commercial demand stands at ' + pc(comValue) + '. Shops that want stock are what industry sells to.',
      src: 'this panel’s commercial meter (not an independent reading)' });
  }

  /* What the city's own firms cannot get. cityReport() is /src/economy's
     bottleneck analysis — the same one the Economy card prints. */
  const bn = (function () { try { return E && E.bottlenecks ? E.bottlenecks(8) : null; } catch (e) { return null; } })();
  if (Array.isArray(bn) && bn.length) {
    /* A shop with no customers is a bottleneck too, and it is the opposite
       signal — cityReport() sorts those to the bottom for exactly that reason,
       and this filter is the same distinction read rather than re-made. */
    const held = [];
    for (const r of bn) {
      if (!r || !r.bottleneck) continue;
      if ((r.cause && r.cause.key) === 'NO_DEMAND' || r.bottleneck.key === '__demand__') continue;
      /* ⚠ AND NOT `workers`. It is a real bottleneck and it is on the same list,
         but it is not something a works can be built to MAKE — printing it under
         a label that says "worth making here" is the same sign-reads-backwards
         mistake in a different coat. The labour shortage already has three
         honest homes on this panel: the two Labor Availability terms and the
         residential meter. */
      if (r.bottleneck.key === 'workers') continue;
      if (held.indexOf(r.bottleneck.label) < 0) held.push(r.bottleneck.label);
    }
    if (held.length) {
      /* 🔴 A SIGN THAT READ BACKWARDS. This line used to be "+ Input Shortages",
         which is defensible in the maths — a shortage of inputs really does push
         industrial demand UP — and misleading on screen, because every player
         reads the word SHORTAGE as a minus. The convention this list keeps is
         that the LABEL describes what the player sees and the SIGN describes
         which way the meter moves, so a "+" must name a REASON TO ZONE. Renamed
         rather than re-signed: flipping the sign would have made the meter
         wrong, and the underlying fact — firms cannot get these — is unchanged
         and still spelled out in the sentence underneath. */
      out.push({ sign: '+', w: 0.1 * Math.min(3, held.length), label: 'Inputs Worth Making Here',
        why: 'Firms are running short of ' + held.slice(0, 3).join(', ') + '. Every one of those is something a works in this city could make instead of buying in.',
        src: '/src/economy bottlenecks()' });
    }
  }
  const gaps = (function () { try { return E && E.structuralGaps ? E.structuralGaps() : null; } catch (e) { return null; } })();
  if (Array.isArray(gaps) && gaps.length) {
    const wanted = gaps.filter((g) => (g.consumers | 0) > 0);
    if (wanted.length) {
      /* Same convention as the line above: a "+" names the reason to zone, not
         the deficiency behind it. */
      out.push({ sign: '+', w: 0.08 * Math.min(3, wanted.length), label: 'Imports Worth Replacing',
        why: wanted.length + ' resource' + (wanted.length === 1 ? '' : 's') + ' that firms here consume has no producer anywhere in this city — ' +
             wanted.slice(0, 3).map((g) => g.res).join(', ') + '. Until something makes them they have to be bought in.',
        src: '/src/economy structuralGaps()' });
    }
  }

  const L = labour();
  const s = slack(L && L.mid);
  if (s != null) {
    if (s > 0.02) out.push({ sign: '+', w: 0.25 * clamp01(s), label: 'Skilled Labor Availability',
      why: n0(L.mid.q) + ' residents are qualified for skilled work and ' + n0(L.mid.e) + ' hold it. A works could hire the difference.',
      src: '/src/economy labourMarket() + /src/demographics ladder()' });
    else out.push({ sign: '−', w: -0.25 * clamp01(-s), label: 'Skilled Labor Availability',
      why: 'There are already more skilled posts than residents qualified to fill them (' + n0(L.mid.e) + ' held against ' + n0(L.mid.q) + ' qualified).',
      src: '/src/economy labourMarket() + /src/demographics ladder()' });
  }

  /* 🛣 THE EXPORT GATE. Industry that cannot ship is industry nobody wants to
     build, and /src/outside already owns the verdict — this reads it, it does
     not re-derive what "connected" means. */
  const O = mod('MythicOutside');
  const ost = call(O, 'state', null);
  if (ost && ost.connected === false) {
    out.push({ sign: '−', w: -0.3, label: 'City Is Cut Off',
      why: 'Nothing can leave the city — ' + (ost.reason || 'the highway link is broken') + ' Goods made here have nowhere to go.',
      src: '/src/outside state().connected' });
  }

  const land = zoneLand('ind');
  if (land && land.zoned > 0 && land.takeUp != null && land.takeUp < 0.9) {
    out.push({ sign: '−', w: -0.22 * (1 - land.takeUp), label: 'Industrial Land Already Zoned',
      why: land.zoned + ' tiles are zoned for industry and the city has taken up only ' + pc(land.takeUp) + ' of everything it has zoned.',
      src: '/src/zoning stats()' });
  }

  utilityTerms(out);
  return { causes: out, note: 'Industrial demand rises with commercial demand and with what the city cannot yet make for itself. It falls when nothing can be shipped out.' };
}

/* ════════════════════════════════════════════════════════════════════════════
   OFFICE — clean work. There is no "office" industry kind in recipes.js, so
   this is read entirely off the LABOUR side: an office is what a city builds
   when it has educated residents and nowhere for them to work.
   ════════════════════════════════════════════════════════════════════════════ */
function office() {
  const out = [];
  const L = labour();
  if (L) {
    const hi = { q: L.tech.q + L.adv.q, e: L.tech.e + L.adv.e };
    const s = hi.q > 0 ? (hi.q - hi.e) / hi.q : null;
    if (s != null) {
      if (s > 0.02) out.push({ sign: '+', w: 0.4 * clamp01(s), label: 'High-skill Labor Availability',
        why: n0(hi.q) + ' residents are qualified for technical or advanced work and only ' + n0(hi.e) + ' hold it. That is who an office park hires.',
        src: '/src/economy labourMarket() + /src/demographics ladder()' });
      else out.push({ sign: '−', w: -0.4 * clamp01(-s), label: 'High-skill Labor Availability',
        why: 'Every technical and advanced post the city posts is already filled, and there are ' + n0(hi.q) + ' qualified residents against ' + n0(hi.e) + ' in work. An office would stand empty.',
        src: '/src/economy labourMarket() + /src/demographics ladder()' });
    }
  }

  const D = mod('MythicDemographics');
  let rep = null; try { rep = D && D.ready && D.ready() ? D.report() : null; } catch (e) { rep = null; }
  if (rep && rep.ok && Array.isArray(rep.education) && rep.adults > 0) {
    /* The top two education bands, whatever /src/demographics calls them — the
       order is the module's eduOrder(), lowest first, so the tail is the top. */
    const top = rep.education.slice(-2);
    const share = top.reduce((a, e) => a + (Number(e.v) || 0), 0) / rep.adults;
    const labels = top.map((e) => e.label).join(' and ');
    if (share > 0.28) out.push({ sign: '+', w: 0.25 * clamp01((share - 0.28) / 0.4), label: 'An Educated Population',
      why: pc(share) + ' of adults are ' + labels + '. A city with that many of them is a city that can staff a research park.',
      src: '/src/demographics report().education' });
    else out.push({ sign: '−', w: -0.25 * clamp01((0.28 - share) / 0.28), label: 'Few Educated Residents',
      why: 'Only ' + pc(share) + ' of adults are ' + labels + '. Office work needs a bigger pool than that.',
      src: '/src/demographics report().education' });
  }

  const land = zoneLand('off');
  if (land && land.zoned > 0 && land.takeUp != null && land.takeUp < 0.9) {
    out.push({ sign: '−', w: -0.22 * (1 - land.takeUp), label: 'Office Land Already Zoned',
      why: land.zoned + ' tiles are zoned for offices and the city has taken up only ' + pc(land.takeUp) + ' of everything it has zoned.',
      src: '/src/zoning stats()' });
  }

  utilityTerms(out);
  return { causes: out, note: 'Nothing in the economy models an "office industry", so this meter is read off the labour market instead: it rises when the city has educated residents with nowhere to work and falls when every skilled post is already filled.' };
}

/* Midpoint + signed weights, clamped. The midpoint is the ONLY number in this
   file with no source, and it is not a claim about the city — it is where a
   meter sits when nothing has been reported about it. A category with no live
   term at all returns null instead, and the panel draws "not modelled". */
function fold(res) {
  const causes = res.causes || [];
  if (!causes.length) return { value: null, causes: [], note: res.note };
  let v = 0.5;
  for (const c of causes) v += Number(c.w) || 0;
  return { value: clamp01(v), causes: causes.slice().sort((a, b) => Math.abs(b.w) - Math.abs(a.w)), note: res.note };
}

/** The whole panel, in one call. Safe on a page where none of the sibling
    modules loaded: every category then reports value:null with a plain reason. */
export function read() {
  const r = residential();
  const c = fold(commercial());
  const o = fold(office());
  const i = fold(industrial(c.value));
  const by = { res: r, com: c, off: o, ind: i };
  return CAT_ORDER.map((id) => ({
    id, name: META[id].name, ico: META[id].ico, col: catColour(id),
    value: by[id].value, causes: by[id].causes || [],
    limit: by[id].limit || '', stat: by[id].stat || [], note: by[id].note || '',
  }));
}

export default { read, CAT_ORDER };
