/* ════════════════════════════════════════════════════════════════════════════
   🧬 THE LIFEPATH MODEL — an age and a career for a named person, and NOTHING
      that is not traceable to something the city already computes.
   ----------------------------------------------------------------------------
   Read /src/citizen/facts.js's header first; this file is written against it.
   Its rule is that a row with no model behind it says UNAVAILABLE with the real
   reason, never a plausible number. Two rows have said exactly that since the
   panel shipped, and this module is the model that earns them — or, where it
   cannot, leaves them saying it.

   ── THE THREE KINDS OF THING IN HERE, AND THEY ARE NEVER MIXED ─────────────

     FACT       read live off another layer and not touched:
                MythicCitizens.employer(id), MythicEconomy.firm(n).level,
                the workplace tile's `born` stamp, game.cityAge.

     DERIVATION arithmetic over facts, with no free parameters:
                tenure, career grade, the age BAND an age falls in, and the
                whole clock in tuning.js.

     SAMPLE     a draw. There is exactly ONE of them in this module — WHICH
                YEAR inside their age band a citizen was born in — and it is
                marked everywhere it surfaces. The panel prints the age with a
                "≈" for this reason and its source line says the word.

   🔴 THE AGE IS A STRATIFIED SAMPLE OF THE CITY'S OWN AGE PYRAMID, NOT A DRAW
      FROM THIN AIR. /src/demographics has had `byAge()` all along — the city
      HAS an age distribution, in people, per household archetype. What it has
      never had is a per-person age. So:

        · the BAND a citizen is dealt into is whichever band the named roster is
          currently most short of, measured against MythicDemographics.report()
          .ages. That is Hamilton apportionment, and it is what makes the roster
          reproduce the pyramid to within one person per band instead of merely
          resembling it — an independent draw per citizen would be a plausible
          number with sampling noise on it, and 72 people is not enough for that
          noise to be small.
        · the YEAR inside the band is a hash of their id, so it is the same in
          every session and on every machine — the technique citizens.city.js
          uses for names and /src/demographics uses for household draws.
        · what is STORED is not the age. It is the BIRTH STAMP, on game.cityAge,
          in the same seconds `tile.born` uses. The age is (now − born), so it
          advances by itself and no tick has to write anything.

   🔴 WHY CHILDREN ARE OUT OF THE SAMPLE FRAME, AND IT IS NOT A FUDGE.
      The named roster is sized by JOB SLOTS — `citTarget()` in node-city is
      min(citCap, max(CIT.MIN, citJobSlots().length)) — so it is a sample of the
      city's workforce, and a nine-year-old crewing a smelter is precisely the
      plausible lie facts.js exists to refuse. /src/demographics already draws
      the same line for the same reason: `byEducation()` counts adults only,
      "children have not had one yet, and counting them as uneducated would make
      every family district look like a failure of schooling."
      The frame is DERIVED, not listed: a band whose whole year range is below
      workAge is out of frame. Add a band to ECON and it classifies itself.
      ⚠ Both distributions are reported by `distribution()` — the city's full
        pyramid AND the frame — so the exclusion is visible rather than implied.

   🔴 SENIORS ARE IN FRAME. A retired household has workers: 0, but a named
      citizen past retireAge holding a crew seat is somebody working past
      retirement, which is a real thing and which the panel says out loud. It is
      not the same class of statement as a child at a furnace.

   ── THE CAREER ─────────────────────────────────────────────────────────────
   🔴 IT IS NOT A SECOND OPINION ABOUT EMPLOYMENT AND CANNOT BECOME ONE. This
      module never sets a job, never claims a seat, never touches `emp`. Who
      somebody works for is MythicCitizens.employer(id) and the firm behind it,
      full stop; all this adds is WHERE ON THAT EMPLOYER'S OWN LADDER they
      stand. If the employer changes, the career changes with it, because the
      career is computed from the employer and never stored.

   The ladder is ECON.firm.levels — the only rank ladder this game has. A firm
   at level 1 ("Local Business") has one grade; an "Industry Leader" has five.
   So a person's grade is:

       grade = clamp( 1 + floor(tenure / gradeYears), 1, firm.level )

   ⚠ TENURE IS A CEILING, NOT A HIRE DATE, AND THE ROW SAYS SO. The roster keeps
     no hire date and this module will not invent one by stamping "the first
     time I looked", which would make the number depend on when the player
     opened a panel. What CAN be justified is an upper bound out of two real
     stamps:

         tenure = min( years since they turned workAge,
                       age of the building their employer occupies (tile.born) )

     Nobody can have worked at a factory for longer than the factory has stood,
     and nobody can have worked anywhere for longer than they have been of
     working age. Both stamps are already saved by the game. For a firm with no
     tile of its own the ceiling is the age of the city, which is the same
     argument one level out.

     ⚠ REJECTED: a stored hire date, written the first time this layer observed
       the pairing. It needs a tick hook, it makes the number depend on when the
       module mounted, and on a loaded save every citizen's career would restart
       at zero — a career that resets every time you reload is worse than a
       bound that does not.
     ⚠ REJECTED: dropping the firm-level cap so that grades move more. Then a
       corner shop has a regional director in it. The cap is the honest half:
       in a town of level-1 businesses everybody reads "grade 1 of 1", which is
       TRUE, and the row says what their tenure would otherwise have earned.

   The rung length is ECON.demographics.education.graduatePerDay — the game's
   only rate for a person moving up a step — reused rather than duplicated. See
   tuning.js.

   ── WHAT THIS MODULE STORES, AND WHAT IT COSTS ─────────────────────────────
   ONE NUMBER PER NAMED CITIZEN: an integer birth stamp on the game.cityAge
   clock, usually negative (born before the city was founded). At CIT.MAX = 80
   that is 80 integers, ~1.2 KB of save. Everything else — the age, the band,
   the tenure, the grade, the cap — is recomputed from that stamp plus live
   state on every read, exactly as /src/dossier derives residence rather than
   storing it and /src/crowd derives per-tile state from a tile seed.
   The birth stamp is stored rather than derived because it CANNOT be derived:
   it depends on the age pyramid at the moment the person was dealt into it, and
   that pyramid moves. Deriving it live would make a citizen's age jump every
   time a tower filled up.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from '../economy/tuning.js';
/* The same deterministic-draw machinery /src/demographics uses for household
   draws, imported rather than re-typed: one hash, one PRNG, no global state.
   A second copy would drift and every drawn age in the city would move with it. */
import { seedOf, rnd } from '../demographics/archetypes.js';
import { clockOf, bandOfYears, bandLabel } from './tuning.js';

/* ── the seams, every one probed and absence-tolerant (facts.js's pattern) ── */
const W = () => (typeof window !== 'undefined' ? window : null);
function CITS() {
  try { const w = W(); const M = w && w.MythicCitizens; return (M && typeof M.list === 'function') ? M : null; }
  catch (e) { return null; }
}
function DEMOG() {
  try { const w = W(); const D = w && w.MythicDemographics; return (D && typeof D.report === 'function') ? D : null; }
  catch (e) { return null; }
}
function ECONOMY() {
  try { const w = W(); return (w && w.MythicEconomy) || null; } catch (e) { return null; }
}

/* ── state: the ONE stored field, plus whatever a newer build wrote ──────── */
let STAMPS = Object.create(null);     // citizen id -> birth stamp, game.cityAge seconds
let FOREIGN = null;                   // unknown keys from a newer build's save slice
let CTX = null;                       // { now, tileBorn, cycleMin } — the host hand-over
let CLK = null;                       // memoised clock; ECON does not change at runtime

export function bind(ctx) { CTX = ctx || null; CLK = null; return !!CTX; }
export function bound() { return !!CTX; }

export function clock() {
  if (CLK) return CLK;
  let hostDay = null;
  try { hostDay = CTX && CTX.cycleMin ? CTX.cycleMin() : null; } catch (e) { hostDay = null; }
  CLK = clockOf(hostDay);
  return CLK;
}

function now() {
  try { const t = CTX && CTX.now ? +CTX.now() : NaN; return isFinite(t) ? t : NaN; }
  catch (e) { return NaN; }
}

/* The bands that are IN the sample frame — derived, never listed. A band whose
   whole year range sits below working age is a band the named roster (which is
   sized by job slots) does not draw from. See the header. */
function frameBands(clk) {
  const out = [];
  for (const g in clk.bands) if (clk.bands[g][1] > clk.workAge) out.push(g);
  return out;
}

/* ── the city's own age pyramid, LIVE ─────────────────────────────────────
   MythicDemographics.report().ages and nothing else. Deliberately the shipped
   read rather than a local sum over the cohort map: a figure the consumer
   recomputes its own way is a figure that eventually disagrees with the panel
   that prints it, which is the rule /src/city/terroir.js states and this
   codebase has paid for more than once. */
export function pyramid() {
  const D = DEMOG();
  if (!D) return { ok: false, why: 'the demographics layer is not mounted, so the city has no age distribution to sample from' };
  let rep = null;
  try { rep = D.report(); } catch (e) { return { ok: false, why: 'the demographics report threw' }; }
  if (!rep || !rep.ok || !Array.isArray(rep.ages)) {
    return { ok: false, why: (rep && rep.why) || 'the demographics layer has not counted anybody yet' };
  }
  const city = Object.create(null);
  let total = 0;
  for (const a of rep.ages) {
    const v = Math.max(0, +a.v || 0);
    city[a.k] = v; total += v;
  }
  return { ok: true, city, total };
}

/* …restricted to the frame and normalised. This is the distribution the roster
   is dealt against. */
function targetShares(clk) {
  const p = pyramid();
  if (!p.ok) return p;
  const bands = frameBands(clk);
  const shares = Object.create(null);
  let sum = 0;
  for (const g of bands) { const v = p.city[g] || 0; shares[g] = v; sum += v; }
  if (!(sum > 0)) {
    return { ok: false, why: 'the city has no working-age residents yet — every resident it counts is a child, so there is no frame to sample a named citizen from' };
  }
  for (const g of bands) shares[g] /= sum;
  return { ok: true, shares, bands, city: p.city, cityTotal: p.total, frameTotal: sum };
}

/* ── ages ─────────────────────────────────────────────────────────────────── */
export function yearsOf(id, t, clk) {
  const b = STAMPS[id];
  if (b == null) return NaN;
  return (t - b) / clk.secPerYear;
}

/* 🎲 THE ONE SAMPLE IN THE MODULE. A hash of the citizen id picks the position
   inside the band, so it is stable in every session and on every machine and no
   state is carried between two citizens. UNIFORM inside the band on purpose:
   the archetype table gives band SHARES and says nothing whatever about the
   shape inside a band, so anything other than uniform would be structure this
   game does not model. */
function yearInBand(clk, band, id) {
  const r = clk.bands[band];
  const u = rnd(seedOf('lifepath:' + String(id)));
  return r[0] + u * (r[1] - r[0]);
}

/* ── 🎯 THE DEAL ──────────────────────────────────────────────────────────
   Hamilton apportionment, run incrementally: each unstamped citizen takes the
   band with the largest deficit against the target, measured on the roster AS
   IT STANDS — which means it corrects for drift as people age out of one band
   into the next, not just at intake. Deterministic: the roster is walked in id
   order, bands are tested in ECON's own order, and ties go to the first.

   ⚠ IT IS IDEMPOTENT AND IT NEVER RE-DEALS. A citizen who already has a stamp
     keeps it forever. That is what makes an age stable across a read, a repaint,
     a save and a reload — and it is why the deal has to be stored: it depends on
     the pyramid at the moment it was made, and the pyramid moves. */
export function seed() {
  const M = CITS();
  const clk = clock();
  if (!M || !clk.ok) return { ok: false, stamped: 0, why: clk.ok ? 'no citizens layer' : clk.why };
  const t = now();
  if (!isFinite(t)) return { ok: false, stamped: 0, why: 'no city clock — /src/lifepath is not mounted' };

  let roster = null;
  try { roster = M.list(); } catch (e) { roster = null; }
  if (!Array.isArray(roster)) return { ok: false, stamped: 0, why: 'the citizens layer did not answer' };

  /* 🧹 Stamps for people who are no longer on the roster are dropped. node-city
     trims from the end and mints a fresh sequence number on regrowth, so an id
     never comes back — keeping them would grow the save forever for nobody. */
  if (roster.length) {
    const live = new Set(roster.map((c) => c.id));
    for (const k in STAMPS) if (!live.has(k)) delete STAMPS[k];
  }

  const todo = [];
  for (const c of roster) if (c && c.id && STAMPS[c.id] == null) todo.push(c.id);
  if (!todo.length) return { ok: true, stamped: 0, why: null };

  const tgt = targetShares(clk);
  if (!tgt.ok) return { ok: false, stamped: 0, why: tgt.why };

  /* Where the roster stands right now, by the band each member's CURRENT age
     falls in — not by the band they were dealt into, so ageing is accounted for. */
  const have = Object.create(null);
  for (const g of tgt.bands) have[g] = 0;
  let n = 0;
  for (const c of roster) {
    if (STAMPS[c.id] == null) continue;
    const g = bandOfYears(clk, yearsOf(c.id, t, clk));
    if (g in have) { have[g]++; n++; }
  }

  todo.sort((a, b) => (seqOf(a) - seqOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
  let stamped = 0;
  for (const id of todo) {
    let best = null, bv = -Infinity;
    for (const g of tgt.bands) {
      const d = tgt.shares[g] * (n + 1) - have[g];
      if (d > bv) { bv = d; best = g; }
    }
    if (!best) break;
    const years = yearInBand(clk, best, id);
    STAMPS[id] = Math.round(t - years * clk.secPerYear);
    have[best]++; n++; stamped++;
  }
  return { ok: true, stamped, why: null };
}

/* Citizen ids are "c<seq>" (node-city citAdd). Sorting on the number rather than
   the string keeps c9 before c10, so the deal order is the mint order. */
function seqOf(id) { const m = /^c(\d+)$/.exec(String(id || '')); return m ? +m[1] : 0; }

/* ── THE AGE READ ─────────────────────────────────────────────────────────── */
export function ageOf(id) {
  const clk = clock();
  if (!clk.ok) return { ok: false, why: clk.why };
  const t = now();
  if (!isFinite(t)) return { ok: false, why: 'no city clock — /src/lifepath is not mounted' };
  const key = String(id);
  if (STAMPS[key] == null) {
    const s = seed();
    if (STAMPS[key] == null) {
      return { ok: false, why: s.why || 'this person is not on the roster the age deal is made from' };
    }
  }
  const years = yearsOf(key, t, clk);
  if (!isFinite(years)) return { ok: false, why: 'the birth stamp is not a number' };
  const band = bandOfYears(clk, years);
  const lab = bandLabel(band);
  return {
    ok: true, sampled: true,
    years, whole: Math.floor(years),
    band, bandLabel: lab.label, bandIco: lab.ico,
    born: STAMPS[key], now: t,
    /* Past the derived life expectancy is a real state, not an error — the top
       of the senior band is a MEAN residence time, not a wall. */
    pastExpectancy: years > clk.lifeExpectancy,
  };
}

/* ── THE CAREER READ ──────────────────────────────────────────────────────── */
export function careerOf(id) {
  const clk = clock();
  if (!clk.ok) return { ok: false, why: clk.why };
  const t = now();
  if (!isFinite(t)) return { ok: false, why: 'no city clock — /src/lifepath is not mounted' };

  const M = CITS();
  if (!M || typeof M.employer !== 'function') return { ok: false, why: 'the citizens layer does not report an employer' };
  let emp = null;
  try { emp = M.employer(String(id)); } catch (e) { emp = null; }
  if (!emp) return { ok: false, why: 'nofirm' };

  const E = ECONOMY();
  let f = null;
  if (E && typeof E.firm === 'function') { try { f = E.firm(emp.id); } catch (e) { f = null; } }
  if (!f) return { ok: false, why: 'nofirm' };

  const levels = (ECON.firm && ECON.firm.levels) || [];
  if (!levels.length) return { ok: false, why: 'ECON.firm.levels is empty, so there is no ladder to stand on' };
  const cap = Math.max(1, Math.min(levels.length, (f.level | 0) || 1));
  const capDef = levels[cap - 1] || levels[0];

  const a = ageOf(id);
  if (!a.ok) return { ok: false, why: a.why };

  /* The two halves of the tenure CEILING. See the header: this is the longest
     they COULD have been there, out of two stamps the game already saves. */
  const workedYears = Math.max(0, a.years - clk.workAge);
  let born = null, siteKey = emp.tile || null;
  if (siteKey && CTX && typeof CTX.tileBorn === 'function') {
    try { born = CTX.tileBorn(siteKey); } catch (e) { born = null; }
  }
  const siteSec = born == null ? Math.max(0, t) : Math.max(0, t - born);
  const siteYears = siteSec / clk.secPerYear;
  const siteFrom = born == null
    ? (siteKey ? 'tile' : 'city')     // firm has no tile of its own, or the tile is gone
    : 'tile';
  const tenure = Math.min(workedYears, siteYears);

  const rungs = 1 + Math.floor(Math.max(0, tenure) / clk.gradeYears);
  const grade = Math.max(1, Math.min(cap, rungs));

  return {
    ok: true,
    grade, cap, rungs, capped: rungs > cap,
    ladder: levels.length,
    tenureYears: tenure,
    tenureFrom: tenure === workedYears && workedYears <= siteYears ? 'worklife' : 'site',
    workedYears, siteYears, siteFrom, siteKey,
    gradeYears: clk.gradeYears,
    firm: { id: f.id, name: f.name || emp.name, level: cap, levelName: capDef.name, levelIco: capDef.ico,
            rung: f.rung || null },
    /* A citizen past the model's own retirement age who is still on a firm's
       books. Reported, never hidden — it is a true statement about the roster. */
    pastRetirement: a.years >= clk.retireAge,
    age: a.years,
  };
}

/* ── 📊 THE PROOF SEAM ────────────────────────────────────────────────────
   Both distributions, side by side, so "these ages match the city's pyramid"
   is falsifiable rather than asserted. `dev` is the largest share deviation
   between the roster and the frame it was dealt from; with Hamilton
   apportionment it is bounded by one person, i.e. by 1/n. */
export function distribution() {
  const clk = clock();
  if (!clk.ok) return { ok: false, why: clk.why };
  const M = CITS();
  if (!M) return { ok: false, why: 'no citizens layer' };
  seed();
  const t = now();
  let roster = [];
  try { roster = M.list() || []; } catch (e) { roster = []; }

  const tgt = targetShares(clk);
  const bands = tgt.ok ? tgt.bands : frameBands(clk);
  const count = Object.create(null);
  for (const g in clk.bands) count[g] = 0;
  let n = 0, unstamped = 0;
  const ages = [];
  for (const c of roster) {
    if (STAMPS[c.id] == null) { unstamped++; continue; }
    const y = yearsOf(c.id, t, clk);
    const g = bandOfYears(clk, y);
    count[g] = (count[g] || 0) + 1; n++;
    ages.push(+y.toFixed(2));
  }
  const rosterShare = Object.create(null);
  for (const g in count) rosterShare[g] = n > 0 ? count[g] / n : 0;

  let dev = 0;
  if (tgt.ok && n > 0) for (const g of bands) dev = Math.max(dev, Math.abs(rosterShare[g] - tgt.shares[g]));

  return {
    ok: true, n, unstamped, bands,
    city: tgt.ok ? tgt.city : null,
    cityTotal: tgt.ok ? tgt.cityTotal : null,
    frameShare: tgt.ok ? tgt.shares : null,
    frameTotal: tgt.ok ? tgt.frameTotal : null,
    rosterCount: count, rosterShare, maxShareDev: dev,
    bound: n > 0 ? 1 / n : null,
    ages: ages.sort((a, b) => a - b),
    why: tgt.ok ? null : tgt.why,
  };
}

/* Everything about one person in one object — the read a driver wants, because
   asserting on a rendered string is asserting on a screenshot. */
export function explain(id) {
  return { id: String(id), clock: clock(), age: ageOf(id), career: careerOf(id), stamp: STAMPS[String(id)] };
}

/* ── 💾 PERSISTENCE ───────────────────────────────────────────────────────
   The slice is one map of integers. `FOREIGN` carries any key a NEWER build
   wrote that this one does not understand, straight back out on the next save —
   the same instinct SaveShelf itself applies one level up, where a module that
   never mounted keeps its slice rather than having it erased. */
export function save() {
  const out = {};
  if (FOREIGN) for (const k in FOREIGN) out[k] = FOREIGN[k];
  out.v = 1;
  const b = {};
  for (const k in STAMPS) b[k] = STAMPS[k] | 0;
  out.b = b;
  return out;
}

export function load(p) {
  STAMPS = Object.create(null);
  FOREIGN = null;
  if (!p || typeof p !== 'object') return 0;
  const keep = {};
  for (const k in p) if (k !== 'v' && k !== 'b') keep[k] = p[k];
  if (Object.keys(keep).length) FOREIGN = keep;
  const src = (p.b && typeof p.b === 'object') ? p.b : {};
  let n = 0;
  for (const k in src) {
    /* Hostile input is a real case — a hand-edited save, a truncated sync. An
       id that is not "c<n>" or a stamp that is not finite is DROPPED rather
       than carried in: a bad stamp becomes an age of NaN years, and one NaN on
       a panel reads as a broken feature rather than as a bad byte. */
    if (!/^c\d+$/.test(k)) continue;
    const v = Number(src[k]);
    if (!isFinite(v)) continue;
    STAMPS[k] = Math.round(v); n++;
  }
  return n;
}

export function reset() { STAMPS = Object.create(null); FOREIGN = null; CLK = null; }
export function stamps() { const o = {}; for (const k in STAMPS) o[k] = STAMPS[k]; return o; }
export function count() { let n = 0; for (const k in STAMPS) n++; return n; }
