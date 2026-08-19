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

export function makeStore() {
  let LET = Object.create(null);      // "x,z" -> { c, n, want, size, day, lvl, rung }
  let VAC = Object.create(null);      // "x,z" -> { until, n, rung, why }
  let FAIL = [];                      // newest last
  let COUNT = { failed: 0, let: 0, grown: 0 };
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
    LET[k] = rec; delete VAC[k];
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
    delete LET[k]; touch(); return true;
  }

  function reconcile(typeAt) {
    let dropped = 0;
    for (const k of Object.keys(LET)) {
      const ty = typeAt(k);
      if (ty !== LET[k].want) { delete LET[k]; dropped++; }
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
        save: () => ({ v: 1, salt, let: { ...LET }, vac: { ...VAC }, fail: FAIL.slice(), count: { ...COUNT } }),
        load: (p) => {
          LET = Object.create(null); VAC = Object.create(null); FAIL = []; COUNT = { failed: 0, let: 0, grown: 0 };
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
            VAC[k] = { n: typeof v.n === 'string' ? v.n : '',
                       rung: typeof v.rung === 'string' ? v.rung : 'BANKRUPT',
                       why: typeof v.why === 'string' ? v.why : '' };
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
          if (p.count && typeof p.count === 'object') {
            COUNT = { failed: p.count.failed | 0, let: p.count.let | 0, grown: p.count.grown | 0 };
          }
        },
      });
    } catch (e) { console.warn('[Tenants] save shelf unavailable (non-fatal):', e); }
    return shelved;
  }

  return {
    ensureSalt, salt: () => salt, setSalt: (s) => { salt = String(s || ''); touch(); },
    tenancy, vacancy, housed, open, close, clearVacancy, observe, evict, reconcile,
    shelfRegister, shelved: () => shelved,
    lets: () => LET, vacs: () => VAC, failures: () => FAIL.slice(),
    counts: () => ({ ...COUNT }),
    size: () => Object.keys(LET).length,
    vacantCount: () => Object.keys(VAC).length,
  };
}

export default { makeStore };
