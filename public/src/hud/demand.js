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

function win() { try { return typeof window === 'undefined' ? null : window; } catch (e) { return null; } }
function mod(name) { const w = win(); if (!w) return null; try { return w[name] || null; } catch (e) { return null; } }
function call(o, fn, dflt) { try { return o && typeof o[fn] === 'function' ? o[fn]() : dflt; } catch (e) { return dflt; } }

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
    out.push({ sign: '−', w: -0.18 * (1 - st.factor), label: 'Power Shortfall',
      why: 'The grid is serving only ' + pc(st.factor) + ' of what the city asks for, so nothing new runs at full output.',
      src: '/src/power state().factor' });
  }
  const W = mod('MythicWater');
  const ws = call(W, 'state', null);
  if (ws && ws.ok && (ws.shortfall || 0) > 0) {
    const share = ws.draw > 0 ? ws.shortfall / ws.draw : 0;
    out.push({ sign: '−', w: -0.18 * clamp01(share), label: 'Water Shortfall',
      why: 'The wells are ' + n1(ws.shortfall) + ' short of the ' + n1(ws.draw) + ' the city draws.',
      src: '/src/water state().shortfall' });
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

function commercial() {
  const out = [];
  const E = mod('MythicEconomy');
  const snap = call(E, 'snapshot', null);

  if (snap && snap.satisfaction) {
    let sum = 0, n = 0, unmet = 0;
    for (const k of RETAIL_KEYS) {
      const s = snap.satisfaction[k];
      if (s == null || !isFinite(s)) continue;
      sum += s; n++;
      unmet += Number((snap.unmet || {})[k]) || 0;
    }
    if (n > 0) {
      const sat = sum / n;
      if (sat < 0.98) {
        out.push({ sign: '+', w: 0.45 * (1 - sat), label: 'Local Demand',
          why: 'Residents wanted ' + n1(unmet) + ' 🔥 of goods the city’s shops could not sell them. Retail satisfaction across ' + n + ' basket categories is ' + pc(sat) + '.',
          src: '/src/economy snapshot().satisfaction' });
      } else {
        out.push({ sign: '−', w: -0.12, label: 'Shops Are Keeping Up',
          why: 'Every consumer category is served at ' + pc(sat) + '. Nothing on the high street is short.',
          src: '/src/economy snapshot().satisfaction' });
      }
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

  if (comValue != null) {
    const d = comValue - 0.5;
    out.push({ sign: d >= 0 ? '+' : '−', w: 0.3 * d * 2, label: 'Commercial Demand',
      why: 'Commercial demand stands at ' + pc(comValue) + '. Shops that want stock are what industry sells to.',
      src: 'this panel’s commercial meter' });
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
      if (held.indexOf(r.bottleneck.label) < 0) held.push(r.bottleneck.label);
    }
    if (held.length) {
      out.push({ sign: '+', w: 0.1 * Math.min(3, held.length), label: 'Input Shortages',
        why: 'Firms are running short of ' + held.slice(0, 3).join(', ') + '. Every one of those is something a works in this city could make instead of buying in.',
        src: '/src/economy bottlenecks()' });
    }
  }
  const gaps = (function () { try { return E && E.structuralGaps ? E.structuralGaps() : null; } catch (e) { return null; } })();
  if (Array.isArray(gaps) && gaps.length) {
    const wanted = gaps.filter((g) => (g.consumers | 0) > 0);
    if (wanted.length) {
      out.push({ sign: '+', w: 0.08 * Math.min(3, wanted.length), label: 'Supply Chain Gaps',
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
