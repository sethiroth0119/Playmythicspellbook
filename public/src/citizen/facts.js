/* ══════════════════════════════════════════════════════════════════════════
   👤 THE CITIZEN DOSSIER — THE DERIVATION LAYER.
   ──────────────────────────────────────────────────────────────────────────
   Every row this module can print is BUILT HERE and RENDERED elsewhere.
   render.js is markup only, exactly as /src/economy/render.js is — the split
   exists so that "where did that number come from" has one answer and one
   file, and so a driver can assert on the FACTS without parsing HTML.

   🔴 EVERY ROW CARRIES ITS OWN SOURCE. A row is
       { label, value, un, src, link }
   where `src` is the live call the value came from, in words, and `un` marks
   a row the game does not model. A row is LIVE (read off another layer), DERIVED
   (arithmetic over live readings with no free parameters), SAMPLED (a
   deterministic draw — there is exactly one, the age, and it is printed with a
   "≈" so the panel cannot pass a draw off as a reading) or UNAVAILABLE.
   This is not decoration: this project has
   already had to rip content out of two panels for inventing numbers (a demand
   cause with no model behind it, and a water alarm that contradicted the panel
   above it). A row with no model behind it is UNAVAILABLE with the real
   reason — never a plausible number.

   🔴 NOBODY IS INVENTED HERE, AND THERE IS NO SECOND CITIZEN STORE. Every
      person is the record `window.MythicCitizens` already holds. This file
      adds no field to a person and writes nothing anywhere. Where the roster
      is silent (age, schooling, rank) the answer is "unavailable", not a
      draw — two truths about a person is worse than one incomplete one.

   WHERE EACH ROW COMES FROM — the whole contract, in one table:

     Mood         LIVE      MythicCitizens.get(id).mood, banded by the
                            dialogue's own ctBand (handed over in ctx).
     Activity     LIVE      the walking agent bound to them: a.state / a.phase.
                            UNAVAILABLE when they are not on the street.
     Age          SAMPLED   the roster STILL has no age. /src/lifepath deals each
                            named citizen into the city's own age pyramid
                            (MythicDemographics.report().ages) and draws a year
                            inside their band off a hash of their id. It is a
                            SAMPLE, it is printed with a "≈", and it says so.
                            UNAVAILABLE, word for word as before, with no
                            /src/lifepath.
     Education    DERIVED   a FLOOR, not a value: the wage band of their
                            employer's industry, through
                            ECON.demographics.education.requires.
                            UNAVAILABLE with no economy job.
     Household    LIVE      /src/dossier householdOf() — the same deal, out of
                            the same cache, the building panel prints.
     Wealth       LIVE      /src/dossier wealthOf() on their residence — the
                            SAME call the building panel makes, so the two
                            panels cannot disagree.
     Residence    DERIVED   /src/dossier homesIndex() reversed. The dossier
                            derives residence rather than storing it; this
                            reads that deal, it does not re-deal it.
     Occupation   LIVE      their crewed tile, else the economy's firm.
     Job level    DERIVED   their employer's level on ECON.firm.levels is how
                            many grades it has; tenure — bounded by the age of
                            the building it stands in and by the years since
                            they turned 18 — is how far up they are. Both
                            stamps are the game's own. UNAVAILABLE with no
                            /src/lifepath, and with no firm to stand in.
     Work band    DERIVED   the firm's industry band (ECON.labor.bands).
     Employer     LIVE      MythicCitizens.employer(id).
     Destination  LIVE      the last tile of the agent's path.
                            UNAVAILABLE when they are not on the street.

   ⚠ ONE THING THE DESTINATION ROW MUST KEEP SAYING. The crowd's commute is a
     LOOP — agentEndpoints() sends a civilian to a road beside ANY housing when
     phase is "home" and to a road beside ANY workplace when it is "work", and
     the door itself is picked on arrival (agentTick, `pick(doors)`). So the
     destination is a STREET, and it is emphatically NOT their own address.
     Printing "Destination: 24 Woodland Street" because that is where they live
     would be the plausible lie this codebase keeps refusing.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── the optional sibling layers, every one duck-typed and absence-tolerant ──
   These ARE on window (module → window is the direction that works), unlike
   the host's own bindings — see CLAUDE.md's globals trap. */
function CITS() {
  try {
    if (typeof window === 'undefined') return null;
    const M = window.MythicCitizens;
    return (M && typeof M.get === 'function') ? M : null;
  } catch (e) { return null; }
}
function DOSSIER() {
  try { return (typeof window !== 'undefined' && window.MythicDossier) || null; } catch (e) { return null; }
}
function ECONOMY() {
  try { return (typeof window !== 'undefined' && window.MythicEconomy) || null; } catch (e) { return null; }
}
/* 🧬 /src/lifepath — the model behind the Age and Job level rows. Probed for
   `ready()` and not merely for existence, because the module needs a clock
   handed to it by the host (game.cityAge is a top-level const and invisible to
   a module) and an unmounted one would answer with a technical reason where the
   panel wants the original sentence. Absent ⇒ both rows print exactly what they
   printed before this existed. */
function LIFEPATH() {
  try {
    if (typeof window === 'undefined') return null;
    const L = window.MythicLifepath;
    if (!L || typeof L.age !== 'function' || typeof L.career !== 'function') return null;
    if (typeof L.ready === 'function' && !L.ready()) return null;
    return L;
  } catch (e) { return null; }
}

/* /src/dossier/household.js, handed in by index.js after a GUARDED dynamic
   import. Imported for real rather than reimplemented, because homesIndex()
   caches its deal on a signature of (roster, housing stock): calling the
   shipped function means this panel and the building panel read the SAME deal
   out of the SAME cache and cannot drift into two answers about who lives
   where. A 404 on the dossier costs the residence, household and wealth rows
   and nothing else. */
let HH = null;
export function bindHousehold(mod) { HH = mod || null; return !!HH; }
export function householdBound() { return !!HH; }

const row = (label, value, src, link) => ({ label, value, un: false, src, link: link || null });
const unav = (label, src) => ({ label, value: 'unavailable', un: true, src, link: null });

/* ── residence ────────────────────────────────────────────────────────────
   The dossier deals people INTO houses; this reverses that deal. It is a scan
   rather than an index because the deal is rebuilt whenever the housing stock
   moves and a second index would be a second thing to invalidate — and the
   whole map is a few hundred entries. */
export function residenceOf(C, id) {
  if (!HH) return { ok: false, why: 'nodossier' };
  let idx = null;
  try { idx = HH.homesIndex(C); } catch (e) { return { ok: false, why: 'threw' }; }
  if (!idx || !idx.ok) return { ok: false, why: 'roster' };
  for (const [k, members] of idx.byHome) {
    for (const m of members) if (m && m.id === id) return { ok: true, key: k, members };
  }
  return { ok: false, why: 'homeless', homes: idx.homes };
}

/* ── the tile-side helpers ───────────────────────────────────────────────── */
function titleOf(C, k) {
  try { const s = C.buildingTitle(k); if (s) return String(s); } catch (e) {}
  try {
    const t = C.game.tiles[k], d = t && C.BUILDINGS[t.type];
    return (d && d.name) || (t && t.type) || 'a building';
  } catch (e) { return 'a building'; }
}
/* The street a road tile belongs to, or a plain address, straight off
   /src/dossier — the ONE address layer in the game. Null when it cannot say,
   and the caller then prints the tile key, which is always true. */
function addrOf(k) {
  const D = DOSSIER();
  if (!D || typeof D.addressOf !== 'function') return null;
  try {
    const a = D.addressOf(k);
    if (!a) return null;
    if (a.ok) return { text: a.text, kind: 'address' };
    if (a.why === 'isroad') return { text: a.street, kind: 'street' };
    return null;
  } catch (e) { return null; }
}
function placeName(C, k) {
  const a = addrOf(k);
  if (a && a.kind === 'address') return a.text;
  if (a && a.kind === 'street') return a.text;
  return 'tile ' + k;
}

/* ── the economy side ─────────────────────────────────────────────────────
   `employer` is MythicCitizens' own reading of the firm, taken live every time
   (citEmpInfo never caches, for the same reason mood does not). The industry
   BAND is the only thing this file adds, and it is a lookup, not a model. */
function bandInfo(emp) {
  const E = ECONOMY();
  if (!E || !emp) return null;
  let band = null;
  try {
    const meta = E.industries && E.industries[emp.ind];
    band = meta && meta.band ? String(meta.band) : null;
  } catch (e) { band = null; }
  if (!band) return null;
  let def = null, requires = null, rung = null;
  try { def = (E.ECON.labor.bands || {})[band] || null; } catch (e) { def = null; }
  try {
    const ed = E.ECON.demographics.education;
    requires = ed.requires[band] || null;
    rung = requires ? (ed.levels[requires] || null) : null;
  } catch (e) { requires = null; rung = null; }
  return { band, label: (def && def.label) || band, ico: (def && def.ico) || '👷',
           wage: def ? def.wage : null, requires, rung };
}

/* ── activity, and the one place the walking crowd is readable ─────────────
   C.agentOf(id) is a SNAPSHOT — kind/state/phase/path ends — built on the
   host side so no mesh and no live agent object crosses the seam. Null means
   "this person is not one of the pedestrians currently spawned", which is a
   FACT about a capped crowd, not a fault. Told apart from a fault by
   C.crowd(), which reports how many civilians are on the street at all. */
export function activityOf(C, id) {
  let a = null;
  try { a = C.agentOf ? C.agentOf(id) : null; } catch (e) { a = null; }
  let crowd = null;
  try { crowd = C.crowd ? C.crowd() : null; } catch (e) { crowd = null; }
  if (!a) {
    return { ok: false, crowd,
      why: crowd && crowd.civilians > 0
        ? 'not on the street — the city walks ' + crowd.civilians + ' of its ' +
          (crowd.roster || '?') + ' named citizens at a time, and this one is not among them'
        : 'nobody is walking — the crowd is culled at night, in severe weather, ' +
          'below 25 morale and when the roads change' };
  }
  const dest = a.dest && C.game.tiles[a.dest] ? a.dest : null;
  let label, note;
  if (a.state === 'inside') {
    label = 'Indoors';
    note = 'agent.state = inside at ' + placeName(C, a.inside || a.at || '');
  } else if (a.state === 'enter') {
    label = 'Going in';
    note = 'agent.state = enter — stepping through the door of ' + placeName(C, a.inside || '');
  } else if (a.state === 'exit') {
    label = 'Coming out';
    note = 'agent.state = exit — leaving ' + placeName(C, a.inside || '');
  } else if (a.dwell) {
    label = a.phase === 'home' ? 'Stopped, then home' : 'Stopped, then to work';
    note = 'agent.dwell > 0 — paused on the road before it repaths';
  } else {
    label = a.phase === 'home' ? 'Going home' : 'Going to work';
    note = 'agent.phase = ' + a.phase + ', agent.state = travel';
  }
  return { ok: true, label, note, state: a.state, phase: a.phase,
           at: a.at || null, inside: a.inside || null, dest,
           step: a.i, steps: a.steps, crowd };
}

/* ══ THE WHOLE PANEL, AS FACTS ═══════════════════════════════════════════ */
export function factsOf(C, id) {
  const M = CITS();
  if (!M) return { ok: false, why: 'seam' };
  let c = null;
  try { c = M.get(String(id)); } catch (e) { c = null; }
  if (!c) return { ok: false, why: 'gone' };

  const D = DOSSIER();
  const out = { ok: true, id: c.id, name: c.name, sections: [] };

  /* ── mood. The band is the DIALOGUE'S OWN (ctBand, handed over in ctx) so a
     person cannot read one word here and a different one in the panel their
     own bubble uses. No second threshold table exists in this module. ── */
  const mood = Number.isFinite(c.mood) ? c.mood : null;
  let bandWord = null;
  if (mood != null) {
    try { bandWord = C.band ? String(C.band(mood)) : null; } catch (e) { bandWord = null; }
    if (!bandWord && HH && HH.moodBand) { try { bandWord = HH.moodBand(mood).label; } catch (e) {} }
  }
  out.mood = { v: mood, label: bandWord,
    src: mood == null
      ? 'their mood has not been computed yet — a citizen minted this frame carries no number until the next refresh'
      : 'MythicCitizens.get().mood, banded by the dialogue’s own ctBand' };

  /* ── activity ── */
  const act = activityOf(C, c.id);
  out.activity = act;

  /* ── residence, and everything hanging off it ── */
  const res = residenceOf(C, c.id);

  /* ══ CITIZEN ══ */
  const emp = (() => { try { return M.employer ? M.employer(c.id) : null; } catch (e) { return null; } })();
  const jobTile = c.job && C.game.tiles[c.job] ? c.job : null;
  const bi = bandInfo(emp);

  const citizenRows = [];

  /* ── 🎂 AGE — THE ONE SAMPLED ROW ON THE PANEL, AND IT IS MARKED ─────────
     The original reason this said UNAVAILABLE is still exactly right and is
     still printed below when /src/lifepath is absent: the roster has no age,
     and hanging a city-wide ARCHETYPE age split on a named person would be a
     second, different truth about them.
     What changed is that /src/lifepath makes it the SAME truth rather than a
     second one — it deals every named citizen into the city's live pyramid
     (MythicDemographics.report().ages) so the roster REPRODUCES that
     distribution, then draws the year inside the band off a hash of the id.
     🔴 So it is a sample, and the panel must never let it read as a reading:
        the value carries a "≈", the source line leads with the word SAMPLED,
        and the module reports `sampled: true` on every answer. */
  const LP = LIFEPATH();
  const la = LP ? (() => { try { return LP.age(c.id); } catch (e) { return null; } })() : null;
  const clk = LP ? (() => { try { return LP.clock(); } catch (e) { return null; } })() : null;
  if (la && la.ok && clk && clk.ok) {
    citizenRows.push(row('Age', '≈ ' + la.whole + ' years · ' + la.bandIco + ' ' + la.bandLabel,
      'SAMPLED, not recorded — the roster still carries no age. /src/lifepath deals every named ' +
      'citizen into the city’s OWN age pyramid (MythicDemographics.report().ages, children ' +
      'left out of the frame because the roster is sized by job slots), taking whichever band the ' +
      'roster is most short of, and then draws the year inside that band off a hash of their id — ' +
      'so it is the same age in every session and on every machine. It ADVANCES on game.cityAge at ' +
      clk.daysPerYear.toFixed(1) + ' economic days to the year, which is ECON’s own figure read ' +
      'back out of demographics.lifecycle.agePerDay (' + clk.src.agePerDay + '/day over a ' +
      clk.workingLifeYears + '-year working life) — about ' + clk.hoursPerYear.toFixed(1) +
      ' hours of play per year of their life. Born at cityAge ' + la.born + ' s' +
      (la.pastExpectancy ? '; they are past the ' + clk.lifeExpectancy.toFixed(0) +
        '-year life expectancy the same table derives, which is a real state and not a fault' : '')));
  } else {
    citizenRows.push(unav('Age',
      'the roster carries id, name, job, mood and employer — no age. /src/demographics models an ' +
      'age split per household ARCHETYPE, city-wide; hanging one of those on a named person would ' +
      'be a second, different truth about them' +
      (la && la.why ? '. /src/lifepath is loaded but cannot answer: ' + la.why : '') +
      (LP && clk && !clk.ok ? '. /src/lifepath cannot work out how long a year is: ' + clk.why : '')));
  }
  if (bi && bi.rung) {
    citizenRows.push(row('Education', bi.rung.ico + ' ' + bi.rung.label + ' or better',
      'DERIVED as a floor, not a value: nothing records what this person studied. They hold ' +
      bi.label.toLowerCase() + '-band work, and ECON.demographics.education.requires.' + bi.band +
      ' = "' + bi.requires + '", so that rung is the minimum the job demands'));
  } else {
    citizenRows.push(unav('Education',
      'nothing records what a named person studied, and ' +
      (emp ? 'the economy names no wage band for this employer'
           : 'they hold no economy job, so there is no band to read a floor off')));
  }
  out.sections.push({ id: 'citizen', title: 'Citizen', rows: citizenRows });

  /* ══ HOUSEHOLD ══ */
  const hhRows = [];
  let members = [];
  let houseName = null;
  let hhNote = null;
  if (!HH) {
    hhRows.push(unav('Household', 'the building dossier (/src/dossier) is not loaded, and it owns the ' +
      'residence deal this panel reads. Nothing here re-deals it'));
    hhRows.push(unav('Residence', 'same — residence is /src/dossier’s derivation and it did not load'));
  } else if (!res.ok) {
    const why = res.why === 'homeless'
      ? 'the roster is dealt into the ' + (res.homes || 0) + ' housing tiles the city has, and it ran out ' +
        'of beds before it reached this person'
      : res.why === 'roster' ? 'the citizens layer did not answer for the deal'
      : 'the residence deal could not be read';
    hhRows.push(unav('Household', why));
    hhRows.push(unav('Residence', why));
  } else {
    members = res.members || [];
    let house = null;
    try { house = HH.householdOf(C, res.key); } catch (e) { house = null; }
    houseName = (house && house.ok && house.name) || null;
    /* ⚠ THE HOUSEHOLD IS THE HEADING, NOT A ROW. It was both for one round and
       the name sat twice, one line apart, which reads as two households. The
       heading carries the name and the 🔍; its source line goes with it. */
    hhNote = 'MythicDossier.householdOf(' + res.key + ') — ' + members.length +
      (members.length === 1 ? ' resident' : ' residents') +
      (house && house.family ? ', all sharing a surname, so it is a family'
                             : ', sharing an address rather than a name');

    /* 💰 THE SAME CALL THE BUILDING PANEL MAKES. Not a second wealth model:
       MythicDossier.wealthOf is what prints "Household Wealth" on the address
       card, so this row and that one are the same sentence or neither is. */
    let w = null;
    if (D && typeof D.wealthOf === 'function') { try { w = D.wealthOf(res.key); } catch (e) { w = null; } }
    if (w && w.label) {
      hhRows.push(row('Household wealth', w.label,
        'MythicDossier.wealthOf(' + res.key + ') — the same call the building panel prints. ' +
        (w.note || '')));
    } else {
      hhRows.push(unav('Household wealth',
        'no wealth layer answered for this address — the building panel says the same of it'));
    }

    hhRows.push(row('Residence', placeName(C, res.key),
      'DERIVED: /src/dossier deals the roster into the housing stock by surname and stores no home, ' +
      'so building or clearing housing re-deals it. The same deal the building panel prints',
      { kind: 'tile', key: res.key, label: titleOf(C, res.key) }));
  }
  out.sections.push({ id: 'household', title: 'Household', rows: hhRows, members, note: hhNote,
                      houseKey: res.ok ? res.key : null, houseName });

  /* ══ OCCUPATION ══ */
  const occRows = [];
  if (jobTile) {
    occRows.push(row('Occupation', titleOf(C, jobTile),
      'MythicCitizens.get().job = ' + jobTile + ' — they hold one of that building’s crew seats',
      { kind: 'tile', key: jobTile, label: titleOf(C, jobTile) }));
  } else if (emp) {
    occRows.push(row('Occupation', (emp.indIco || '🏭') + ' ' + emp.indName,
      'no crewed tile in the city, so this is the INDUSTRY of the firm the economy has them on ' +
      '(MythicEconomy.firm(' + emp.id + ').ind)'));
  } else {
    occRows.push(row('Occupation', 'Not working',
      'job = null and the economy has no seat for them either. This is a real state, not a gap: ' +
      'the city has raised nothing they can hold a seat in'));
  }

  /* ── 🪜 JOB LEVEL ────────────────────────────────────────────────────────
     The footer's old claim — "this city keeps no rank for a person" — was true
     of the ROSTER and is still true of it. What /src/lifepath adds is not a
     rank field on a person; it is the observation that the game already has
     exactly one rank ladder, ECON.firm.levels, and that a person's place on
     their employer's own ladder is computable from two stamps the game already
     saves: when the building their firm occupies was raised, and how long they
     have been of working age.
     🔴 IT IS NOT A SECOND OPINION ABOUT EMPLOYMENT. Who they work for is
        MythicCitizens.employer(id) and the firm behind it, read here and never
        written; if that changes, this changes with it, because nothing about
        the career is stored.
     ⚠ AND THE TENURE IS A CEILING, NOT A HIRE DATE. The roster keeps no hire
       date; stamping one the first time a panel opened would make the number
       depend on when the player looked. The row says the word. */
  const lc = LP ? (() => { try { return LP.career(c.id); } catch (e) { return null; } })() : null;
  if (lc && lc.ok && clk && clk.ok) {
    occRows.push(row('Job level',
      'Grade ' + lc.grade + ' of ' + lc.cap + ' · ' + lc.firm.levelIco + ' ' + lc.firm.levelName,
      'DERIVED from two live readings and one bound. Their employer stands at level ' + lc.cap +
      ' of ' + lc.ladder + ' on ECON.firm.levels (MythicEconomy.firm(' + lc.firm.id + ').level), and a ' +
      'firm has as many grades as it has levels — so a ' + lc.firm.levelName + ' has ' + lc.cap +
      '. They can have worked there at most ' + lc.tenureYears.toFixed(1) + ' years: ' +
      (lc.siteFrom === 'tile'
        ? 'the building it occupies (' + lc.siteKey + ') has stood ' + lc.siteYears.toFixed(1) + ' years'
        : 'the firm holds no tile of its own, so the ceiling is the age of the city itself, ' +
          lc.siteYears.toFixed(1) + ' years') +
      ', capped by the ' + lc.workedYears.toFixed(1) + ' years since they turned ' + clk.workAge +
      '. One grade per ' + clk.gradeYears.toFixed(1) + ' years — that is ' +
      'ECON.demographics.education.graduatePerDay, the only rate this game has for a person moving ' +
      'up a rung, reused rather than copied. ⚠ A CEILING ON TENURE, NOT A HIRE DATE: the roster ' +
      'keeps none, and inventing one would make this number depend on when you opened the panel' +
      (lc.capped ? '. Their tenure alone would carry them to grade ' + lc.rungs + '; their ' +
        'employer’s level is what holds them at ' + lc.grade + ' — nobody is a regional ' +
        'director of a corner shop' : '') +
      (lc.pastRetirement ? '. They are past the model’s own retirement age of ' + clk.retireAge +
        ' and still on a firm’s books' : '')));
  } else {
    occRows.push(unav('Job level',
      'this city keeps no wage, no skill and no rank for a PERSON — the citizen dialogue’s own ' +
      'footer has said so since it shipped. What is modelled is the band of the WORK, below' +
      (lc && lc.why === 'nofirm'
        ? '. The one ladder the game does have is ECON.firm.levels, and it belongs to a BUSINESS — ' +
          'this person stands in none, so there is no ladder to be part-way up'
        : lc && lc.why ? '. /src/lifepath is loaded but cannot answer: ' + lc.why : '')));
  }

  if (bi) {
    occRows.push(row('Work band', bi.ico + ' ' + bi.label,
      'DERIVED: MythicEconomy.industries.' + emp.ind + '.band = "' + bi.band + '" — the band this ' +
      'firm draws its workforce from' + (bi.wage != null ? ', paid ' + bi.wage + ' 🔥 an economic day at level 1' : '')));
  } else if (jobTile) {
    occRows.push(unav('Work band',
      'no firm stands on tile ' + jobTile + ', so this is a civic seat and the economy prices no ' +
      'wage band for it (citEmpSync: "a real job, not a business")'));
  } else {
    occRows.push(unav('Work band', 'they hold no job the economy prices'));
  }

  if (emp) {
    occRows.push(row('Employer', emp.name,
      'MythicCitizens.employer(' + c.id + ') — firm #' + emp.id + ', read off the live model every ' +
      'time so it cannot go stale' + (emp.tile ? '' : '. It has no tile of its own to open'),
      emp.tile && C.game.tiles[emp.tile] ? { kind: 'tile', key: emp.tile, label: emp.name } : null));
  } else if (jobTile) {
    /* No link: the Occupation row above is the same building, and a second
       door to it here would read as a second place. */
    occRows.push(row('Employer', '🏛 A city seat, no business',
      'citEmpSync() found no firm on tile ' + jobTile + ', so the economy names no business. They crew ' +
      'a building the city runs — "a real job, not a business" — and the Occupation row above opens it'));
  } else {
    occRows.push(unav('Employer', 'nobody employs them — neither a crewed tile nor a firm'));
  }
  out.sections.push({ id: 'occupation', title: 'Occupation', rows: occRows });

  /* ══ DESTINATION ══ */
  const dRows = [];
  if (!act.ok) {
    dRows.push(unav('Destination', act.why + '. The city only moves the pedestrians it has spawned; ' +
      'everybody else is a record, not a body, and a record is not walking anywhere'));
  } else if (act.state === 'inside' || act.state === 'enter' || act.state === 'exit') {
    const k = act.inside;
    dRows.push(k && C.game.tiles[k]
      ? row('Destination', placeName(C, k),
          'the building their agent is at — agent.bldgK = ' + k,
          { kind: 'tile', key: k, label: titleOf(C, k) })
      : unav('Destination', 'their agent is at a door the city no longer has'));
  } else if (act.dest) {
    const a = addrOf(act.dest);
    dRows.push(row('Destination', a ? a.text : 'tile ' + act.dest,
      'the LAST tile of their agent’s path (' + act.dest + '), ' + (act.steps - 1 - act.step) +
      ' tiles ahead of them. ⚠ It is a STREET, not their own address: the commute loop sends them to ' +
      'a road beside any housing when they are heading home and beside any workplace when they are ' +
      'not, and the door itself is picked when they get there',
      { kind: 'tile', key: act.dest, label: a ? a.text : act.dest }));
  } else {
    dRows.push(unav('Destination', 'their agent has no onward path this instant — it is dwelling and ' +
      'will pick one on the next tick'));
  }
  out.sections.push({ id: 'destination', title: 'Destination', rows: dRows });

  return out;
}
