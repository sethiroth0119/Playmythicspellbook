/* ════════════════════════════════════════════════════════════════════════════
   🗄 THE TENANCY STORE — who holds which lot, which lots are empty, and every
   business that has failed in this city.
   ----------------------------------------------------------------------------
   Three maps and one list, keyed "x,z", plus the per-city salt the candidate
   pool is drawn from.

   🔑 IT RIDES THE SAVE SHELF (`window.MythicCitySave`), so node-city's
      `serialize()` literal needs NO edit — the same contract /src/naming,
      /src/zoning, /src/progression and /src/districts all ship under.

   🔴 THE FAILURE LEDGER IS APPEND-ONLY AND IT IS THE POINT OF THE FEATURE.
      "If I put 200 card stores into a city that only needs 30: businesses fail,
       vacancies increase…" — a failure that is not written down is a shop that
       quietly became a different shop, which is what this city did before this
       module existed (a bankrupt tile-owned firm is RE-FOUNDED by
       `syncBuildings` at the next 4-second sync; ECON's charter-fund header
       calls that "a pump, not a one-off"). The economy is right to re-found it.
       What was missing was anybody recording that the FIRST business died.

   ⚠ THE LEDGER IS CAPPED. A save is a save, not a log file. `FAIL_MAX` is the
     newest N; the running COUNTS are kept separately and are never trimmed, so
     "43 businesses have failed here" stays true after the 44th pushes the first
     one out of the list.
   ══════════════════════════════════════════════════════════════════════════ */

const KEY_RE = /^-?\d+,-?\d+$/;
const FAIL_MAX = 60;
/* The save version. v1 carried neither the `evicted` counter nor the wake-up
   queue; `load` treats a missing `evicted` as 0 and says in `repairs()` what
   that costs an old city. */
const SAVE_V = 2;

export function makeStore() {
  let LET = Object.create(null);      // "x,z" -> { c, n, want, size, day, lvl, rung }
  /* "x,z" -> { n, rung, why, never }. TWO KINDS OF EMPTY LOT LIVE HERE and the
     `never` flag is what tells them apart:
       · a CLOSURE — a business traded here and died. `n` is its name.
       · a REFUSAL — a building stands and NO company would take the pitch at
         any price. `never:true`, and there is no name because there was never a
         business. Before this existed `award()` simply returned null on that
         path, so a board with 81 shops and no tenant recorded NOTHING: no
         tenancy, no vacancy, `verify(): ok`, and a panel reading "Nobody has
         taken a zoned lot yet" — which is what the module looks like when it is
         switched off. An unrecorded refusal is indistinguishable from no market
         at all, and that is the one thing this feature cannot afford to be. */
  let VAC = Object.create(null);
  let FAIL = [];                      // newest last
  /* "x,z" -> 1. Lots that DEVELOPED WHILE THE MARKET WAS DORMANT and were
     therefore never auctioned. Not a vacancy (nobody refused them) and not a
     tenancy (nobody took them) — a queue, drained by `observe()` the moment a
     catchment exists. It rides the save because the alternative is a city that
     built itself out before anybody moved in and can never have a company in
     it again: the queue would be lost on the reload and `award()` is only ever
     called once per building. */
  let PEND = Object.create(null);
  /* 🔢 A CLOSED BOOK, NOT FOUR FREE-RUNNING NUMBERS. Every `open()` increments
     `let`, and every tenancy that leaves LET does so through exactly one of
     `close()` (failed++) or `evict()` (evicted++). So at every instant:

         let === failed + evicted + (tenancies standing)

     which `check()` re-adds and `load()` uses to re-derive a hostile or
     truncated payload instead of believing it. `evicted` exists only because
     that identity needs it; nothing in the UI reads it on its own. */
  let COUNT = { failed: 0, let: 0, grown: 0, evicted: 0 };
  let repairs = [];                   // what load() had to fix, for the panel
  let salt = '';
  let shelved = false, dirty = null;

  const touch = () => { if (dirty) { try { dirty(); } catch (e) {} } };

  function ensureSalt() {
    if (!salt) {
      /* Once per city, then it rides the save forever — the same rule
         /src/naming states for its own salt: changing it would rename every
         company in the city at once. */
      salt = String(Math.floor(Math.random() * 0xFFFFFFFF)) + '.' + Date.now().toString(36);
      touch();
    }
    return salt;
  }

  const tenancy = (k) => (k && LET[k]) || null;
  const vacancy = (k) => (k && VAC[k]) || null;

  function housed() {
    const s = new Set();
    for (const k in LET) s.add(LET[k].c);
    return s;
  }

  function open(k, cand, want, day) {
    if (!k || !cand) return null;
    /* `f` is the /src/economy firm id this tenancy is bound to, and it RIDES
       THE SAVE. Without it a reload cannot tell "the same business is still
       here" from "this is the third company to try this pitch" — the economy
       re-founds a firm on a standing building at the next sync, so the id is
       the only thing that distinguishes them. Null until the observer first
       sees a firm on the tile. */
    const rec = { c: cand.id, n: cand.name, want, size: cand.size.id, day: day | 0,
                  lvl: 1, rung: 'HEALTHY', f: null, bid: null };
    LET[k] = rec; delete VAC[k]; delete PEND[k];
    COUNT.let++;
    touch();
    return rec;
  }

  /* A tenancy ENDS. The lot goes on the market again (there is no cooldown —
     tuning.js says why) and the business goes in the ledger. Returns the ledger
     row so the caller can log it: the module that noticed the failure owns the
     sentence. */
  function close(k, day, rung, why) {
    const t = LET[k];
    if (!t) return null;
    delete LET[k];
    VAC[k] = { n: t.n, rung: rung || t.rung || 'BANKRUPT', why: why || '' };
    const row = { k, n: t.n, want: t.want, size: t.size, opened: t.day | 0,
                  closed: day | 0, days: Math.max(0, (day | 0) - (t.day | 0)),
                  rung: rung || t.rung || 'BANKRUPT', why: why || '', lvl: t.lvl | 0 };
    FAIL.push(row);
    while (FAIL.length > FAIL_MAX) FAIL.shift();
    COUNT.failed++;
    touch();
    return row;
  }

  /* 🚫 NOBODY WILL TAKE THIS PITCH — recorded as a lot, not as a shrug.
     Called by `award()` when the market RAN (it is not dormant, the lot is in a
     market category) and every bid came in under the reserve. It is deliberately
     NOT a failure: nothing died here, so the ledger and `COUNT.failed` do not
     move and the panel counts it under its own heading. */
  function refuse(k, why) {
    if (!k || LET[k]) return false;
    if (VAC[k]) {                       // already empty — do not overwrite a closure
      if (why && VAC[k].never && VAC[k].why !== why) { VAC[k].why = why; touch(); }
      return false;
    }
    VAC[k] = { n: '', rung: '', why: why || '', never: true };
    delete PEND[k];
    touch();
    return true;
  }

  /* The wake-up queue (see PEND). */
  function pendAdd(k) { if (!k || PEND[k] || LET[k] || VAC[k]) return false; PEND[k] = 1; touch(); return true; }
  function pendDrop(k) { if (!PEND[k]) return false; delete PEND[k]; touch(); return true; }

  function clearVacancy(k) { if (VAC[k]) { delete VAC[k]; touch(); return true; } return false; }

  /* The live readings a tenancy carries from its FIRM. Written by the observer,
     never computed here — firms.js owns the ladder and the levels. */
  function observe(k, lvl, rung) {
    const t = LET[k]; if (!t) return false;
    let ch = false;
    if (lvl != null && (lvl | 0) !== (t.lvl | 0)) {
      if ((lvl | 0) > (t.lvl | 0)) COUNT.grown++;
      t.lvl = lvl | 0; ch = true;
    }
    if (rung && rung !== t.rung) { t.rung = rung; ch = true; }
    if (ch) touch();
    return ch;
  }

  /* Drop a tenancy whose LOT no longer exists (demolished, rebuilt as something
     else). Not a failure — nothing died, the premises went. */
  function evict(k) {
    if (!LET[k]) return false;
    /* COUNTED, because the book has to close: a tenancy that leaves LET without
       being closed would otherwise make `let` permanently larger than
       `failed + standing` and the identity in `check()` unfalsifiable. */
    delete LET[k]; COUNT.evicted++; touch(); return true;
  }

  function reconcile(typeAt) {
    let dropped = 0;
    for (const k of Object.keys(LET)) {
      const ty = typeAt(k);
      /* Through evict(), not `delete`: a dropped tenancy is an eviction — the
         premises are not what the record says — and it has to be counted as one
         or the load path's own re-add would fail on the next save. */
      if (ty !== LET[k].want) { evict(k); dropped++; }
    }
    for (const k of Object.keys(VAC)) if (!KEY_RE.test(k)) { delete VAC[k]; dropped++; }
    if (dropped) touch();
    return dropped;
  }

  function shelfRegister(saveSoon) {
    dirty = saveSoon || dirty;
    if (shelved) return true;
    try {
      const shelf = (typeof window !== 'undefined') && window.MythicCitySave;
      if (!shelf || typeof shelf.register !== 'function') return false;
      shelved = shelf.register('tenants', {
        save: () => ({ v: SAVE_V, salt, let: { ...LET }, vac: { ...VAC }, fail: FAIL.slice(),
                       pend: Object.keys(PEND), count: { ...COUNT } }),
        load: (p) => {
          LET = Object.create(null); VAC = Object.create(null); FAIL = []; PEND = Object.create(null);
          COUNT = { failed: 0, let: 0, grown: 0, evicted: 0 }; repairs = [];
          if (!p || typeof p !== 'object') return;
          salt = typeof p.salt === 'string' ? p.salt : '';
          /* Hostile input is a real case — a hand-edited save, a truncated
             sync, a key that is not "x,z". Anything malformed is DROPPED rather
             than carried into the tile map, where it would become a lookup that
             never matches and a tenancy the player can see in a count and never
             on the map. Same rule /src/districts' store states. */
          const l = (p.let && typeof p.let === 'object') ? p.let : {};
          for (const k in l) {
            const v = l[k];
            if (typeof k !== 'string' || !KEY_RE.test(k) || !v || typeof v !== 'object') continue;
            if (typeof v.c !== 'string' || typeof v.want !== 'string') continue;
            LET[k] = { c: v.c, n: typeof v.n === 'string' ? v.n : '', want: v.want,
                       size: typeof v.size === 'string' ? v.size : 'indep',
                       day: v.day | 0, lvl: Math.max(1, v.lvl | 0 || 1),
                       rung: typeof v.rung === 'string' ? v.rung : 'HEALTHY',
                       f: (typeof v.f === 'number' && isFinite(v.f)) ? v.f : null,
                       bid: (typeof v.bid === 'number' && isFinite(v.bid)) ? v.bid : null };
          }
          const vv = (p.vac && typeof p.vac === 'object') ? p.vac : {};
          for (const k in vv) {
            const v = vv[k];
            if (typeof k !== 'string' || !KEY_RE.test(k) || !v || typeof v !== 'object') continue;
            /* `never` distinguishes a lot nobody would take from a lot whose
               business died. An old save has neither the flag nor any such
               entry, so the default is the closure it always was. */
            VAC[k] = { n: typeof v.n === 'string' ? v.n : '',
                       rung: typeof v.rung === 'string' ? v.rung : (v.never ? '' : 'BANKRUPT'),
                       why: typeof v.why === 'string' ? v.why : '',
                       never: !!v.never };
          }
          for (const k of (Array.isArray(p.pend) ? p.pend : [])) {
            if (typeof k === 'string' && KEY_RE.test(k) && !LET[k] && !VAC[k]) PEND[k] = 1;
          }
          if (Array.isArray(p.fail)) {
            for (const r of p.fail) {
              if (!r || typeof r !== 'object' || typeof r.k !== 'string') continue;
              FAIL.push({ k: r.k, n: String(r.n || ''), want: String(r.want || ''),
                          size: String(r.size || 'indep'), opened: r.opened | 0,
                          closed: r.closed | 0, days: r.days | 0,
                          rung: String(r.rung || 'BANKRUPT'), why: String(r.why || ''), lvl: r.lvl | 0 });
            }
            while (FAIL.length > FAIL_MAX) FAIL.shift();
          }
          /* ── 🔢 THE COUNTERS ARE RE-ADDED, NOT BELIEVED ────────────────────
             🔴 THIS WAS A MEASURED HOLE AND IT IS THE SAME DOOR AS THE ONE
                `award()` LEFT OPEN. A hostile save injected through the shelf
                came back with `lifetime {failed:999999, let:999999,
                grown:999999}` and `verify(): {ok:true, failures:999999}` — the
                bogus TENANCIES were correctly dropped one screen above, and
                then the numbers this file's own header calls "the durable
                record" were taken verbatim. One end of the load path validated
                every field; the other end validated none.

             What the save can PROVE about itself:
               · the ledger is trimmed to the newest FAIL_MAX. So a `failed`
                 larger than the rows on disk is only possible when the ledger
                 is AT that cap. Below the cap, nothing has ever been trimmed
                 and the row count IS the failure count.
               · the book closes: let === failed + evicted + standing (see
                 COUNT's note), so `let` is RE-ADDED from the other three rather
                 than believed. A hostile 999999 becomes the number the save can
                 actually account for.
               · `grown` has no evidence in a save at all — a level that went up
                 and came back down leaves nothing behind — so it is sanitised
                 (finite, non-negative) and nothing more is claimed for it.
             ⚠ WHAT THE RE-ADD COSTS, SAID OUT LOUD: a v1 payload (this module's
               first shipped save) carried no `evicted`, so a city that had
               demolished a tenanted building loses those from its lifetime
               "opened" count on the next load. It is a one-time correction of a
               number that could not close, it is REPORTED like every other
               repair, and the alternative — a counter that no rule can ever
               check because one term of it was never written down — is the
               defect this is here to close.
             Everything repaired is REPORTED (`repairs()`), printed in the panel
             and listed by `verify()` — a silent repair is a silent claim. */
          const c = (p.count && typeof p.count === 'object') ? p.count : {};
          const int = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : 0);
          let failed = int(c.failed), lets = int(c.let), grown = int(c.grown), evicted = int(c.evicted);
          const standing = Object.keys(LET).length;
          if (failed < FAIL.length) {
            repairs.push('failed ' + failed + ' → ' + FAIL.length + ': the ledger on disk holds more closures than the counter admitted.');
            failed = FAIL.length;
          } else if (failed > FAIL.length && FAIL.length < FAIL_MAX) {
            repairs.push('failed ' + failed + ' → ' + FAIL.length + ': the ledger holds ' + FAIL.length +
                         ' closure' + (FAIL.length === 1 ? '' : 's') + ' and is not at its ' + FAIL_MAX +
                         '-row cap, so no closure can ever have been trimmed out of it.');
            failed = FAIL.length;
          }
          const book = failed + evicted + standing;
          if (lets !== book) {
            repairs.push('opened ' + lets + ' → ' + book + ': re-added from the save\u2019s own evidence — ' +
                         failed + ' closed + ' + evicted + ' evicted + ' + standing + ' standing.');
            lets = book;
          }
          COUNT = { failed, let: lets, grown, evicted };
        },
      });
    } catch (e) { console.warn('[Tenants] save shelf unavailable (non-fatal):', e); }
    return shelved;
  }

  /* 🔍 THE IDENTITY, RE-ADDED ON DEMAND. `verify()` calls it, so the rule the
     load path enforces is also checked while the city runs — a load-time-only
     rule would be one nobody enforces after the first second. */
  function check() {
    const standing = Object.keys(LET).length;
    const book = COUNT.failed + COUNT.evicted + standing;
    const problems = [];
    if (COUNT.let !== book) {
      problems.push('the tenancy book does not close: opened ' + COUNT.let + ' but ' + COUNT.failed +
                    ' closed + ' + COUNT.evicted + ' evicted + ' + standing + ' standing = ' + book);
    }
    if (COUNT.failed < FAIL.length) {
      problems.push('the ledger holds ' + FAIL.length + ' closures and the counter says ' + COUNT.failed);
    }
    return problems;
  }

  return {
    ensureSalt, salt: () => salt, setSalt: (s) => { salt = String(s || ''); touch(); },
    tenancy, vacancy, housed, open, close, refuse, clearVacancy, observe, evict, reconcile,
    pendAdd, pendDrop, pends: () => PEND, pendCount: () => Object.keys(PEND).length,
    shelfRegister, shelved: () => shelved, check, repairs: () => repairs.slice(),
    lets: () => LET, vacs: () => VAC, failures: () => FAIL.slice(),
    counts: () => ({ ...COUNT }),
    size: () => Object.keys(LET).length,
    vacantCount: () => Object.keys(VAC).length,
    /* The two kinds of empty lot, counted apart — the panel prints both and a
       driver can assert on either. */
    neverCount: () => { let n = 0; for (const k in VAC) if (VAC[k].never) n++; return n; },
    closedCount: () => { let n = 0; for (const k in VAC) if (!VAC[k].never) n++; return n; },
    /* How many DISTINCT pitches the retained ledger's closures fell on. 345
       failures on 34 lots is a treadmill; 345 failures on 345 lots would be a
       massacre, and the panel must not print a number that cannot tell them
       apart. Derived from the rows on disk, so it needs no new state. */
    failedLots: () => { const s = new Set(); for (const r of FAIL) s.add(r.k); return s.size; },
  };
}

export default { makeStore };
