/* ══════════════════════════════════════════════════════════════════════════
   📰 JOB FAIR — the employment bulletin

   PURE. No DOM, no globals. Takes the economy's own labour market and firm
   list and returns the bulletin, so tools/jobfair-tests/run.mjs can drive it.

   ── WHY THIS IS A READOUT AND NOT A NEW ECONOMY ───────────────────────────
   The reported problem is "NPCs are not consistently getting jobs". The hiring
   engine already exists and is correct: households.hire() fills vacancies band
   by band, gated by labourSupply() — the count of residents QUALIFIED for each
   band — and ECON.labor.fillOrder runs advanced → unskilled so the hardest
   jobs claim the scarcest graduates first.

   So a business sitting empty next to idle residents is not a bug. It is the
   simulation saying "nobody here can do that job", and saying it silently.
   The brief's own words are "do not leave businesses empty without explaining
   the reason", and that is what this file computes. Re-implementing the
   matching would have replaced a working engine with a second, untested one
   and left the actual complaint — invisibility — exactly where it was.

   ⚠ EDUCATION LEVELS ARE A VIEW OVER THE FOUR BANDS, NOT A FIFTH SYSTEM. The
     brief asks for levels 0–4; the economy has four labour bands. Inventing a
     parallel education model would mean two sources of truth for one question
     and they would drift. The map below is one-way and total.
   ══════════════════════════════════════════════════════════════════════════ */

/* Band → the brief's education level. `unskilled` covers levels 0 and 1: the
   economy does not distinguish "no schooling" from "basic schooling" when
   hiring, so claiming it does on screen would be a lie the simulation cannot
   back up. It is labelled for what it is. */
export const EDU = {
  unskilled: { level: 1, min: 0, name: 'Basic Education',
    blurb: 'Retail, restaurants, delivery, general labour', ico: '📗' },
  skilled:   { level: 2, name: 'High School / Skilled',
    blurb: 'Manufacturing, mechanics, transport, security', ico: '📘' },
  technical: { level: 3, name: 'Technical / College',
    blurb: 'Engineering, banking, management, medical technicians', ico: '📕' },
  advanced:  { level: 4, name: 'University / Advanced',
    blurb: 'Doctors, scientists, researchers, executives', ico: '🎓' },
};
/* High to low — the order the engine actually fills in, so the bulletin reads
   in the same order the hiring happens. */
export const BANDS = ['advanced', 'technical', 'skilled', 'unskilled'];

export function eduOf(band) { return EDU[band] || EDU.unskilled; }
const n = (v) => { const x = Number(v); return isFinite(x) && x > 0 ? Math.floor(x) : 0; };

/**
 * The bulletin.
 * @param market {vacancies, employed, qualified} — MythicEconomy.labourMarket()
 * @param firms  [{ id, name, ind, band, openings }]
 * @param selected Set of firm ids the player ticked (priority), or null
 */
export function bulletin(market, firms, selected) {
  const vac = (market && market.vacancies) || {};
  const emp = (market && market.employed) || {};
  const qual = (market && market.qualified) || null;

  const rows = (firms || []).filter(f => f && n(f.openings) > 0).map(f => {
    const band = EDU[f.band] ? f.band : 'unskilled';
    return {
      id: f.id, name: f.name || f.id,
      /* The seam supplies a display name ("Healthcare") beside the id
         ("clinic"). Taking the id first printed the internal key on a page
         meant to read as a newspaper. */
      industry: f.industry || f.ind || '',
      band, edu: eduOf(band), openings: n(f.openings),
      wage: n(f.wage),
      picked: !!(selected && selected.has && selected.has(f.id)),
    };
  });

  /* Sort: the player's picks first (they asked for them), then by how badly
     the job is stuck — an opening nobody can fill is the one worth reading. */
  rows.sort((a, b) => (b.picked - a.picked) || (b.edu.level - a.edu.level) || (b.openings - a.openings));

  const totals = {
    businessesHiring: rows.length,
    openPositions: rows.reduce((s, r) => s + r.openings, 0),
    employed: BANDS.reduce((s, b) => s + n(emp[b]), 0),
    qualified: qual ? BANDS.reduce((s, b) => s + n(qual[b]), 0) : null,
    vacancies: BANDS.reduce((s, b) => s + n(vac[b]), 0),
  };

  return { rows, totals, shortages: shortages(market, firms) };
}

/**
 * 🔴 THE PART THE BRIEF IS ACTUALLY ASKING FOR.
 * Per band: how many openings, how many qualified people, and therefore
 * whether the gap is a SCHOOLING problem or simply nobody applying yet.
 *
 * ⚠ QUALIFIED WORKERS CASCADE DOWNWARD. Someone qualified for `advanced` can
 *   also take a `skilled` job, and fillOrder spends them from the top. So the
 *   supply available to a band is everyone at that band OR ABOVE, minus what
 *   the higher bands have already claimed — computing it per-band in isolation
 *   would overstate the shortage at the bottom and understate it at the top.
 */
export function shortages(market, firms) {
  const qual = (market && market.qualified) || null;
  const want = {};
  for (const b of BANDS) want[b] = 0;
  (firms || []).forEach(f => {
    if (!f || n(f.openings) <= 0) return;
    const band = EDU[f.band] ? f.band : 'unskilled';
    want[band] += n(f.openings);
  });

  const out = [];
  if (!qual) return out;
  let carried = 0;                     // graduates left over from higher bands
  for (const band of BANDS) {          // advanced → unskilled, the fill order
    const supply = n(qual[band]) + carried;
    const need = want[band];
    const filled = Math.min(need, supply);
    carried = supply - filled;         // the surplus drops to the next band down
    if (need > filled) {
      out.push({
        band, edu: eduOf(band), openings: need, available: supply,
        short: need - filled,
        reason: supply === 0
          ? 'nobody in the city has this level of schooling'
          : 'not enough residents have finished this level of schooling',
      });
    }
  }
  return out;
}

/**
 * Which firms the manual fair should serve first.
 * The player's ticks win; everything else keeps the engine's own order.
 */
export function priorityOrder(firms, selected) {
  const picked = [], rest = [];
  (firms || []).forEach(f => {
    if (!f) return;
    ((selected && selected.has && selected.has(f.id)) ? picked : rest).push(f);
  });
  const byBand = (a, b) => (eduOf(b.band).level - eduOf(a.band).level);
  return picked.sort(byBand).concat(rest.sort(byBand));
}

/** One line a citizen would post about their own news. */
export function broadcastLine(kind, name, firmName, reason) {
  const who = name || 'A citizen';
  if (kind === 'hired') return who + ': "' + firmName + ' hired me! Took long enough — it finally paid off."';
  if (kind === 'fired') return who + ': "Just got let go from ' + firmName +
    (reason ? ' — ' + reason : '') + '. Guess I am checking the Job Fair tomorrow."';
  return who + ': "Still looking for work."';
}

export default { EDU, BANDS, eduOf, bulletin, shortages, priorityOrder, broadcastLine };
