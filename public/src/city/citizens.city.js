/* ══════════════════════════════════════════════════════════════════════════
   👤 NAMED CITIZENS — the city's population stops being a counter.
   ──────────────────────────────────────────────────────────────────────────
   The city already had 166,909 "NPC POPULATION" and a crowd of anonymous
   pedestrians that despawn every time the sun goes down. This module promotes
   a WORKING SET of that population (≤ CZ_MAX) into persisted records with a
   stable id, a name, a real job at a REAL BUILDING TILE, a home, one or two
   bonds to other citizens, and a mood computed from the vitals the city
   already runs on.

   🔴 THE ONE RULE, INHERITED FROM THE DOSSIER (index.html:16343):
   EVERY FIELD TRACES TO GAME STATE. There are no biographies here, no ages,
   no families, no invented skills, no wages — this game tracks none of those,
   so those fields do not exist. The single synthesised value in the whole
   module is the NAME (see nameFor): identity needs a label and the game has
   none to give. It is generated once, persisted, and never re-rolled — and it
   is the only thing in a citizen record that is not read out of `game`.

   🔴 NEVER DELETE A PLAYER'S PLACED THING. reconcile() reads tiles; it never
   writes to `game.tiles` and never demolishes. A citizen whose workplace was
   demolished or damaged is set IDLE and re-employed on a later pass — the
   building is never touched, and neither is any other player property.

   👥 POPULATION ACCOUNTING. Named citizens are a SUBSET of the existing
   population, never an addition:
     · the roster is capped at floor(cityPop()) — it can never name more
       people than the city has;
     · the number holding a JOB is capped at game.army.workers, the workers
       the player actually hired and is paying staffing for;
     · nothing here writes game.pop.npc, popCap(), popUsed() or army.workers.
   So the HUD's population, the staffing ratio and this roster cannot drift.

   ⚠ WHERE THE LIVE ROSTER ACTUALLY IS, AS OF THE bindRoster WIRING.
   Nothing imports this module. `public/node-city/index.html` grew its own
   roster (`citizens` / `CITIZENS_API`, seeded by citEnsure) and that is the one
   mounted on `window.MythicCitizens`, the one the talk dialog and the walking
   agents read, and the one `households.js bindRoster()` is now called with.
   Mounting this file as well would put two rosters on the same global and give
   the player two different answers about the same person, so it was left where
   it is rather than wired up a second time.
   The contract below is unchanged and still correct: `sync()` is the function
   bindRoster requires and calls. On the live side that verb means "re-point the
   named roster at the jobs the economy says exist" (node-city's citEmpSync);
   here it still means the full city reconcile. If this module is ever mounted,
   those two meanings have to be reconciled BEFORE it is — bindRoster calls
   whatever `sync` is, and a reconcile pass firing on the economy's 4 s beat is
   not what that beat is for.

   🔌 THE SEAM FOR `offline-life` (the other builder this round):
     window.MythicCitizens = {
       list(), byId(id), count(),
       setJob(id, tileKey) -> ok:boolean   // validates the tile is real+crewed
       clearJob(id, why)                   // idles, never deletes
       addBond(aId, bId, kind) -> ok       // kind is 'coworker' | 'neighbour'
       moodOf(id) -> { v, band, label, terms:[{d,why}] }
       jobOf(id)  -> { key, def, out } | null
       homeOf(id) -> key | null
       sync(), serialize(), load(raw), reset(),
       open(id), openRoster(), close(),
       staffHtml(tileKey), bubbleFor(id), claimAgent(), releaseAgent(id),
       V, CZ_MAX, _ctx()
     }
   Life events belong in THAT module. This one owns identity, employment,
   homes, bonds, mood and the two UIs (talk dialog + dossier staff list).
   ══════════════════════════════════════════════════════════════════════════ */

export const V = 1;                 // save-blob version
export const CZ_MAX = 72;           // the working set. See "POPULATION ACCOUNTING".

let CTX = null;
let ROSTER = [];                    // [{ id, name, job, home, since, idleAt, bonds:[] }]
let NEXT_ID = 1;
let OPEN_ID = null;                 // citizen shown in the talk dialog
let OPEN_ROSTER = false;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ── names ────────────────────────────────────────────────────────────────
   ⚠ THE ONLY SYNTHESISED FIELD IN THE MODULE. A deterministic hash of the
   citizen's id picks one given name and one surname, so the same id always
   produces the same person and a save that somehow lost the string comes back
   identical. Nothing else about the name means anything — it is not a family,
   not a lineage, not a faction. The game tracks none of those. */
const GIVEN = ['Mira', 'Toma', 'Vess', 'Rill', 'Anda', 'Kel', 'Sura', 'Bram', 'Nyla', 'Odo',
  'Peta', 'Juno', 'Halla', 'Ives', 'Cass', 'Dorn', 'Elke', 'Faro', 'Gita', 'Hux',
  'Ione', 'Jory', 'Kira', 'Lem', 'Maren', 'Nils', 'Orsa', 'Pell', 'Quill', 'Rasa',
  'Sten', 'Tove', 'Ulla', 'Vero', 'Wenna', 'Xan', 'Yara', 'Zeb', 'Aris', 'Bede',
  'Coral', 'Dag', 'Esa', 'Finn', 'Greta', 'Hale', 'Isla', 'Joss'];
const FAMILY = ['Ashford', 'Brack', 'Corvin', 'Dunmore', 'Ellis', 'Farrow', 'Gault', 'Hollis',
  'Iversen', 'Jarn', 'Kestrel', 'Lowe', 'Merrow', 'Nast', 'Ojeda', 'Pike',
  'Quint', 'Rooke', 'Selk', 'Thane', 'Ustin', 'Vance', 'Weald', 'Yarrow',
  'Bellhaven', 'Crane', 'Drayce', 'Emberly', 'Fenn', 'Grisk', 'Harrow', 'Ilm'];
function nameFor(id) {
  let h = 2166136261 >>> 0;                      // FNV-1a over the id string
  const s = 'cz' + id;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const g = GIVEN[h % GIVEN.length];
  const f = FAMILY[Math.floor(h / GIVEN.length) % FAMILY.length];
  return g + ' ' + f;
}

/* ── the city, read-only ──────────────────────────────────────────────── */
function G() { return (CTX && CTX.game) || { tiles: {}, army: { workers: 0 }, pop: {}, cov: {}, power: {} }; }
function defOf(type) { return (CTX && CTX.BUILDINGS && CTX.BUILDINGS[type]) || null; }
function tileOf(k) { return k ? G().tiles[k] || null : null; }
function ratio() { try { return CTX.staffingRatio(); } catch (e) { return 1; } }
function crewJobs() { try { return CTX.crewNeeded(); } catch (e) { return 0; } }
function pop() { try { return CTX.cityPop(); } catch (e) { return 0; } }
function morale() { return (CTX && CTX.wellbeing && Number.isFinite(CTX.wellbeing.morale)) ? CTX.wellbeing.morale : 50; }
function covPct() { return (G().cov && G().cov.pct) || {}; }
function age() { return +G().cityAge || 0; }
function daySec() { return (CTX && CTX.daySec) || 1200; }

/* Is this tile a real, undamaged crew job? A DAMAGED building keeps its
   staff on the books in the city's own arithmetic (crewNeeded skips it), so
   its crew is idled here too — and re-employed the moment it is repaired. */
function isJobTile(k) {
  const t = tileOf(k); if (!t) return false;
  const d = defOf(t.type);
  return !!(d && d.crew && !t.damaged);
}
/* Every crew seat in the city, one entry per seat, in a stable order so the
   same citizen keeps the same workplace across reconciles. */
function jobSeats() {
  const out = [];
  for (const k of Object.keys(G().tiles).sort()) {
    const t = G().tiles[k], d = defOf(t.type);
    if (!d || !d.crew || t.damaged) continue;
    for (let i = 0; i < d.crew; i++) out.push(k);
  }
  return out;
}
/* Housing capacity, in NAMED residents. `popCap` is 6 beds per level and is
   the city's own number; the roster is far smaller than the bed count, so
   beds are never the binding constraint — the CZ_MAX / cityPop() caps are. */
function homeSeats() {
  const out = [];
  for (const k of Object.keys(G().tiles).sort()) {
    const t = G().tiles[k], d = defOf(t.type);
    if (!d || !d.popCap || t.damaged) continue;
    for (let i = 0; i < d.popCap * (t.lvl || 1); i++) out.push(k);
  }
  return out;
}
// One NAMED resident per housing level — the residents who hold no crew job.
function residentTarget() {
  let n = 0;
  for (const t of Object.values(G().tiles)) {
    const d = defOf(t.type);
    if (d && d.popCap && !t.damaged) n += (t.lvl || 1);
  }
  return n;
}

/* ── roles, derived from the building definition ───────────────────────────
   NOT invented job titles. The three flags below are the only distinctions
   the game itself draws between crewed buildings. */
function roleFor(type) {
  const d = defOf(type); if (!d) return 'Crew';
  if (d.svc) return 'Service crew';
  if (d.gen) return 'Operator';
  if (d.defense || d.garrison) return 'Guard';
  return 'Crew';
}

/* ── mood ──────────────────────────────────────────────────────────────────
   Starts at the city's own morale (wellbeing.morale, the number the People
   panel prints) and is moved by the things that are true of THIS citizen:
   their workplace's condition, the city staffing ratio they work under, the
   coverage of the needs they consume, whether they have a home, and the grid.
   Every term carries the sentence that names its source, and the talk dialog
   prints those sentences verbatim — so the mood can always be audited against
   the panels. Nothing is stored: mood is recomputed on read and therefore can
   never drift from the vitals. */
const MOOD_NEEDS = [
  ['food', 22], ['water', 20], ['health', 14], ['safety', 12], ['light', 6], ['leisure', 8], ['power', 6],
];
export function moodOf(id) {
  const c = typeof id === 'object' ? id : byId(id);
  const terms = [];
  if (!c) return { v: 50, band: 'fair', label: 'Unknown', terms };
  let v = morale();
  terms.push({ d: 0, why: 'City morale is ' + Math.round(morale()) + ' — that is where everyone starts.' });
  const t = tileOf(c.job);
  const meta = CTX && CTX.NEED_META || {};
  if (!c.job) {
    const w = G().army.workers | 0, need = crewJobs();
    terms.push({ d: -14, why: 'No crew job. The city has ' + need + ' crew seat' + (need === 1 ? '' : 's') +
      ' and ' + w + ' hired worker' + (w === 1 ? '' : 's') + '.' });
    v -= 14;
  } else if (t && t.damaged) {
    terms.push({ d: -16, why: 'Their workplace (' + (defOf(t.type) || {}).name + ') is damaged.' });
    v -= 16;
  }
  const s = ratio();
  if (c.job && s < 1) {
    const d = -(1 - s) * 16;
    terms.push({ d, why: 'Understaffed — ' + (G().army.workers | 0) + ' workers for ' + crewJobs() + ' crew seats (' + Math.round(s * 100) + '%).' });
    v += d;
  }
  const pct = covPct();
  for (const [n, w] of MOOD_NEEDS) {
    const p = pct[n];
    if (!Number.isFinite(p)) continue;              // not computed yet ⇒ no term
    const d = clamp((p - 1) * w, -w, w * 0.5);
    if (Math.abs(d) < 0.5) continue;
    const nm = (meta[n] && meta[n].ico + ' ' + meta[n].name) || n;
    terms.push({ d, why: nm + ' coverage is ' + Math.round(p * 100) + '%.' });
    v += d;
  }
  if (!c.home) { terms.push({ d: -10, why: 'No home — every named bed in the city is taken.' }); v -= 10; }
  const pf = (G().power && Number.isFinite(G().power.factor)) ? G().power.factor : 1;
  if (pf < 1) { const d = -(1 - pf) * 8; terms.push({ d, why: 'Brownout — the grid is at ' + Math.round(pf * 100) + '%.' }); v += d; }
  v = clamp(v, 0, 100);
  const band = v >= 75 ? 'good' : v >= 50 ? 'fair' : v >= 30 ? 'low' : 'bad';
  const label = v >= 75 ? 'Content' : v >= 50 ? 'Getting by' : v >= 30 ? 'Worn down' : 'Desperate';
  terms.sort((a, b) => a.d - b.d);
  return { v: Math.round(v), band, label, terms };
}
const MOOD_COL = { good: 'var(--valid,#5ac47a)', fair: 'var(--gold,#d4af37)', low: 'var(--ember,#e0873f)', bad: 'var(--invalid,#e0574f)' };

/* ── job / home accessors ─────────────────────────────────────────────── */
export function jobOf(id) {
  const c = typeof id === 'object' ? id : byId(id);
  if (!c || !c.job) return null;
  const t = tileOf(c.job); if (!t) return null;
  const d = defOf(t.type); if (!d) return null;
  let out = null;
  try { out = CTX.tileOut ? CTX.tileOut(c.job) : null; } catch (e) { out = null; }
  return { key: c.job, type: t.type, name: d.name, ico: d.ico || '🏗', lvl: t.lvl || 1,
           damaged: !!t.damaged, crew: d.crew | 0, role: roleFor(t.type), out };
}
export function homeOf(id) {
  const c = typeof id === 'object' ? id : byId(id);
  return c ? c.home || null : null;
}
export function byId(id) { for (const c of ROSTER) if (c.id === id) return c; return null; }
export function list() { return ROSTER.slice(); }
export function count() { return ROSTER.length; }
export function atBuilding(k) { return ROSTER.filter(c => c.job === k); }

/* ── employment, all of it non-destructive ────────────────────────────── */
export function setJob(id, k) {
  const c = byId(id); if (!c) return false;
  if (!isJobTile(k)) return false;
  const taken = ROSTER.filter(x => x !== c && x.job === k).length;
  const need = (defOf(tileOf(k).type) || {}).crew | 0;
  if (taken >= need) return false;
  c.job = k; c.since = age(); c.idleAt = 0;
  return true;
}
export function clearJob(id) {
  const c = byId(id); if (!c || !c.job) return false;
  c.job = null; c.idleAt = age();
  return true;
}
export function addBond(aId, bId, kind) {
  const a = byId(aId), b = byId(bId);
  if (!a || !b || a === b) return false;
  if (a.bonds.some(x => x.to === b.id)) return false;
  const k = kind === 'neighbour' ? 'neighbour' : 'coworker';
  a.bonds.push({ to: b.id, kind: k, since: age() });
  b.bonds.push({ to: a.id, kind: k, since: age() });
  return true;
}
export function bondsOf(id) {
  const c = byId(id); if (!c) return [];
  return c.bonds.map(bd => ({ ...bd, name: (byId(bd.to) || {}).name || null })).filter(b => b.name);
}

/* ── the reconcile pass ────────────────────────────────────────────────────
   🔴 READS the city, WRITES only the roster. It cannot demolish, damage,
   move, downgrade or otherwise touch a single tile — every branch below
   either assigns a citizen to something that already exists or idles them.
   That is the whole answer to the sweep that deleted paid-for buildings four
   rounds running: this pass has no code path that writes game.tiles. */
export function sync() {
  if (!CTX) return null;
  const before = { n: ROSTER.length, employed: ROSTER.filter(c => c.job).length };

  // 1. release jobs that stopped being real (demolished, damaged, over-crewed)
  const perTile = {};
  for (const c of ROSTER) {
    if (!c.job) continue;
    if (!isJobTile(c.job)) { c.job = null; c.idleAt = age(); continue; }
    const need = (defOf(tileOf(c.job).type) || {}).crew | 0;
    perTile[c.job] = (perTile[c.job] || 0) + 1;
    if (perTile[c.job] > need) { c.job = null; c.idleAt = age(); }
  }
  // 2. release homes that stopped being real
  const homeCap = {};
  for (const k of homeSeats()) homeCap[k] = (homeCap[k] || 0) + 1;
  const homeUse = {};
  for (const c of ROSTER) {
    if (!c.home) continue;
    if (!homeCap[c.home]) { c.home = null; continue; }
    homeUse[c.home] = (homeUse[c.home] || 0) + 1;
    if (homeUse[c.home] > homeCap[c.home]) { homeUse[c.home]--; c.home = null; }
  }

  // 3. the targets. Named citizens are a SUBSET of the population (header).
  const seats = jobSeats();
  const workers = G().army.workers | 0;
  const employedTarget = Math.min(seats.length, workers, CZ_MAX);
  const total = Math.max(0, Math.min(CZ_MAX, Math.floor(pop()), employedTarget + residentTarget()));

  // 4. grow / trim the roster
  while (ROSTER.length < total) {
    const id = NEXT_ID++;
    ROSTER.push({ id, name: nameFor(id), job: null, home: null, since: age(), idleAt: age(), bonds: [] });
  }
  let left = 0;
  if (ROSTER.length > total) {
    /* Trim from the END and only citizens who hold no job, so an established
       worker with bonds is never the one dropped. Their leaving is LOGGED —
       a population that shrinks silently is exactly the kind of quiet
       data-loss this project has shipped before. */
    for (let i = ROSTER.length - 1; i >= 0 && ROSTER.length > total; i--) {
      if (ROSTER[i].job) continue;
      const gone = ROSTER.splice(i, 1)[0];
      for (const c of ROSTER) c.bonds = c.bonds.filter(b => b.to !== gone.id);
      if (OPEN_ID === gone.id) OPEN_ID = null;
      left++;
      try {
        if (CTX.logEvent) CTX.logEvent('city', '👤 ' + gone.name + ' left the city — the population no longer supports them.');
      } catch (e) {}
    }
  }

  // 5. fill free crew seats, oldest citizen first (they have waited longest)
  const used = {};
  for (const c of ROSTER) if (c.job) used[c.job] = (used[c.job] || 0) + 1;
  const free = [];
  for (const k of seats) {
    const need = (defOf(tileOf(k).type) || {}).crew | 0;
    if ((used[k] || 0) < need) { used[k] = (used[k] || 0) + 1; free.push(k); }
  }
  let employed = ROSTER.filter(c => c.job).length;
  for (const c of ROSTER) {
    if (employed >= employedTarget || !free.length) break;
    if (c.job) continue;
    c.job = free.shift(); c.since = age(); c.idleAt = 0; employed++;
  }
  // 6. lay off past the hired-worker count — newest hire first, and never
  //    below zero. This is what a dismissed worker looks like on the roster.
  if (employed > employedTarget) {
    for (let i = ROSTER.length - 1; i >= 0 && employed > employedTarget; i--) {
      if (!ROSTER[i].job) continue;
      ROSTER[i].job = null; ROSTER[i].idleAt = age(); employed--;
    }
  }
  // 7. homes
  const freeHomes = [];
  for (const k in homeCap) for (let i = (homeUse[k] || 0); i < homeCap[k]; i++) freeHomes.push(k);
  for (const c of ROSTER) {
    if (!freeHomes.length) break;
    if (c.home) continue;
    c.home = freeHomes.shift();
  }
  // 8. bonds — coworkers first, then neighbours. Capped at 2 per citizen.
  for (const c of ROSTER) {
    if (c.bonds.length >= 2) continue;
    const mates = c.job ? ROSTER.filter(x => x !== c && x.job === c.job) : [];
    const nbrs = c.home ? ROSTER.filter(x => x !== c && x.home === c.home) : [];
    for (const [set, kind] of [[mates, 'coworker'], [nbrs, 'neighbour']]) {
      for (const o of set) {
        if (c.bonds.length >= 2) break;
        if (o.bonds.length >= 2) continue;
        addBond(c.id, o.id, kind);
      }
    }
  }
  const rep = { n: ROSTER.length, employed: ROSTER.filter(c => c.job).length,
                idle: ROSTER.filter(c => !c.job).length, left,
                target: total, employedTarget, seats: seats.length, workers };
  if (rep.n !== before.n || rep.employed !== before.employed) refresh();
  return rep;
}

/* ── walking-agent identity ───────────────────────────────────────────────
   The city already spawns pedestrians and already gives them chat bubbles;
   they were anonymous and died anonymous. spawnAgent() now claims a citizen
   for each civilian and despawnAgent() releases them, so the person crossing
   the street IS somebody on the roster and their bubble is their own.
   `_agent` is runtime only and is deliberately NOT serialised — an agent does
   not survive a reload, and a saved binding would be a lie on the next boot. */
export function claimAgent() {
  let pickC = null;
  for (const c of ROSTER) { if (!c._agent && c.job) { pickC = c; break; } }
  if (!pickC) for (const c of ROSTER) { if (!c._agent) { pickC = c; break; } }
  if (!pickC) return null;
  pickC._agent = true;
  return pickC.id;
}
export function releaseAgent(id) {
  const c = byId(id); if (c) c._agent = false;
  return !!c;
}

/* ── what a citizen says, from what is true of them ───────────────────── */
export function bubbleFor(id) {
  const c = byId(id); if (!c) return null;
  const m = moodOf(c), j = jobOf(c);
  let text, tone = '';
  if (!j) {
    text = c.job ? 'My shift is off today.' : 'No work going. I ask every morning.';
    tone = 'bad';
  } else if (j.damaged) {
    text = 'The ' + j.name + ' is wrecked. No shift until it is fixed.'; tone = 'bad';
  } else if (j.out && j.out.out && j.out.out.perMin > 0) {
    text = 'On the ' + j.name + '. We are running ' + j.out.out.perMin.toFixed(2) + ' ' + (j.out.out.ico || '') + ' a minute.';
    tone = m.v >= 60 ? 'good' : '';
  } else if (j.out && j.out.svc) {
    text = j.name + ' shift. We cover ' + j.out.svc.perMin.toFixed(2) + ' ' + (j.out.svc.ico || '') + ' a minute for this block.';
    tone = m.v >= 60 ? 'good' : '';
  } else if (j.out && j.out.halted) {
    text = 'The ' + j.name + ' has nothing to work with. Halted.'; tone = 'bad';
  } else {
    text = 'On the ' + j.name + ' crew.'; tone = '';
  }
  /* A citizen in a bad way talks about that instead of about their shift —
     and the sentence is the WORST-scoring mood term, verbatim, so the bubble
     and the dialog can never disagree. */
  if (m.v < 40 && m.terms.length && m.terms[0].d < -3) { text = m.terms[0].why; tone = 'bad'; }
  return { id: c.id, name: c.name, text, tone, mood: m.v };
}

/* ── the talk dialog ──────────────────────────────────────────────────── */
const CSS = `
#czmod{position:absolute;inset:0;background:rgba(8,6,12,.78);z-index:47;display:flex;
  align-items:center;justify-content:center;backdrop-filter:blur(3px);}
#czmod .czbox{width:min(540px,94vw);max-height:86vh;overflow-y:auto;background:var(--panel-solid,#15121f);
  border:1px solid var(--edge,#2c2740);border-radius:12px;padding:16px 18px;}
#czmod h3{font-size:15px;color:var(--gold,#d4af37);margin:0 0 2px;letter-spacing:.04em;}
#czmod .czsub{font-size:10.5px;color:var(--mist,#948da8);margin-bottom:11px;letter-spacing:.05em;}
#czmod .czq{border:1px solid var(--edge,#2c2740);border-radius:9px;padding:9px 11px;margin-bottom:9px;background:#12101f;}
#czmod .czq .qt{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}
#czmod .czq .qlab{font-size:10px;letter-spacing:.09em;color:var(--mist,#948da8);text-transform:uppercase;}
#czmod .czq .qval{font-size:18px;font-variant-numeric:tabular-nums;}
#czmod .czbar{height:6px;border-radius:3px;background:#221c33;margin:7px 0 6px;overflow:hidden;}
#czmod .czbar i{display:block;height:100%;}
#czmod .czline{font-size:11.5px;color:var(--bone,#e8e3f2);line-height:1.45;padding:3px 0;}
#czmod .czline .src{color:var(--mist,#948da8);}
#czmod .czsay{font-size:12.5px;color:#e8e3f2;line-height:1.5;border-left:2px solid var(--gold,#d4af37);
  padding:2px 0 2px 10px;margin:5px 0 9px;}
#czmod .czterm{display:flex;justify-content:space-between;gap:10px;font-size:11px;padding:2px 0;color:var(--bone,#e8e3f2);}
#czmod .czterm .g{font-variant-numeric:tabular-nums;}
#czmod .czterm .g.dn{color:#e0574f;} #czmod .czterm .g.up{color:#5ac47a;}
#czmod .czfoot{display:flex;gap:8px;margin-top:12px;}
#czmod .czbtn{flex:1;background:#1a1530;border:1px solid var(--edge,#2c2740);border-radius:7px;color:var(--bone,#e8e3f2);
  font-size:12px;padding:7px 10px;cursor:pointer;}
#czmod .czbtn:hover{border-color:var(--gold,#d4af37);}
#czmod .cznote{font-size:10.5px;color:var(--mist,#948da8);margin-top:9px;line-height:1.45;}
#czmod .czrow{display:flex;justify-content:space-between;align-items:center;gap:8px;
  border-top:1px solid rgba(255,255,255,.06);padding:5px 0;font-size:11.5px;}
#czmod .czrow:first-child{border-top:0;}
#czmod .czrow .nm{color:var(--bone,#e8e3f2);}
#czmod .czrow .jb{color:var(--mist,#948da8);font-size:10.5px;}
#czmod .czmini{width:52px;height:5px;border-radius:3px;background:#221c33;overflow:hidden;}
#czmod .czmini i{display:block;height:100%;}
.czstaff{border-top:1px solid rgba(255,255,255,.06);padding:5px 0;display:flex;align-items:center;gap:8px;}
.czstaff:first-child{border-top:0;}
.czstaff .nm{flex:1;font-size:11.5px;color:var(--bone,#e8e3f2);}
.czstaff .nm small{display:block;color:var(--mist,#948da8);font-size:10px;}
.czstaff .bar{width:64px;height:5px;border-radius:3px;background:#221c33;overflow:hidden;}
.czstaff .bar i{display:block;height:100%;}
.czstaff .mv{font-size:10.5px;color:var(--mist,#948da8);font-variant-numeric:tabular-nums;width:26px;text-align:right;}
.czstaff button{background:#1a1530;border:1px solid var(--edge,#2c2740);border-radius:6px;
  color:var(--bone,#e8e3f2);font-size:10.5px;padding:3px 8px;cursor:pointer;}
.czstaff button:hover{border-color:var(--gold,#d4af37);}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone) return; cssDone = true;
  try { const s = document.createElement('style'); s.id = 'citizens-css'; s.textContent = CSS; document.head.appendChild(s); } catch (e) {}
}

function daysSince(stamp) {
  const d = (age() - (+stamp || 0)) / daySec();
  if (!Number.isFinite(d) || d < 0) return 'today';
  if (d < 1) return 'today';
  const n = Math.floor(d);
  return n + ' city day' + (n === 1 ? '' : 's');
}

/* The dialogue. Six lines, every one of them a sentence built around a value
   read out of the city this frame. No line exists that does not have a source
   — if the game cannot answer, the line is absent (the dossier's rule). */
export function dialogue(id) {
  const c = byId(id); if (!c) return null;
  const j = jobOf(c), m = moodOf(c), bonds = bondsOf(c.id);
  const out = [];
  if (j) {
    let s = 'I am ' + (j.role === 'Operator' ? 'an operator' : j.role === 'Guard' ? 'a guard' : j.role === 'Service crew' ? 'on the service crew' : 'crew') +
      ' at the ' + j.ico + ' ' + j.name + ' on tile ' + j.key + ', level ' + j.lvl + '. ' +
      (j.crew ? 'It takes ' + j.crew + ' of us.' : '');
    out.push({ q: 'What do you do?', a: s, src: 'game.tiles["' + j.key + '"] · BUILDINGS.' + j.type + '.crew' });
    if (j.damaged) out.push({ q: 'How is the work?', a: 'It is damaged. Nothing is coming out of it until it is repaired.', src: 'tile.damaged' });
    else if (j.out && j.out.halted) out.push({ q: 'How is the work?', a: 'We are halted — no ' + j.out.halted + ' to work with.', src: 'economyTick input gate' });
    else if (j.out && j.out.out) out.push({ q: 'How is the work?',
      a: 'We are putting out ' + j.out.out.perMin.toFixed(2) + ' ' + (j.out.out.ico || '') + ' ' + j.out.out.name + ' a minute at the moment.',
      src: 'the same tileMult() the economy ticks with' });
    else if (j.out && j.out.svc) out.push({ q: 'How is the work?',
      a: 'We cover ' + j.out.svc.perMin.toFixed(2) + ' ' + (j.out.svc.ico || '') + ' a minute of this city\'s need.',
      src: 'BUILDINGS.' + j.type + '.svc · tileMult()' });
    out.push({ q: 'How long have you been there?', a: 'Since ' + daysSince(c.since) + ' ago.', src: 'game.cityAge at hire' });
  } else {
    out.push({ q: 'What do you do?',
      a: 'Nothing. There are ' + crewJobs() + ' crew seats in this city and ' + (G().army.workers | 0) + ' of us hired to fill them. I am not one of them.',
      src: 'crewNeeded() · game.army.workers' });
    if (c.idleAt) out.push({ q: 'How long?', a: 'Idle since ' + daysSince(c.idleAt) + ' ago.', src: 'game.cityAge when the seat went' });
  }
  out.push({ q: 'Where do you sleep?',
    a: c.home ? 'A bed in the housing on tile ' + c.home + '.' : 'Nowhere of my own. Every named bed is taken.',
    src: c.home ? 'game.tiles["' + c.home + '"].popCap' : 'popCap() — no free bed' });
  if (bonds.length) {
    out.push({ q: 'Who do you know?',
      a: bonds.map(b => b.name + ' (' + (b.kind === 'coworker' ? 'same crew' : 'same building') + ', ' + daysSince(b.since) + ')').join('; ') + '.',
      src: 'shared job / home tile' });
  }
  out.push({ q: 'How are you?', a: m.label + '. ' + (m.terms[0] && m.terms[0].d < -1 ? m.terms[0].why : m.terms[m.terms.length - 1] ? m.terms[m.terms.length - 1].why : ''),
    src: 'wellbeing.morale + game.cov.pct' });
  return { citizen: c, job: j, mood: m, bonds, lines: out };
}

function moodBar(m, w) {
  return '<div class="' + (w || 'czbar') + '"><i style="width:' + m.v + '%;background:' + MOOD_COL[m.band] + '"></i></div>';
}

function talkHtml(id) {
  const D = dialogue(id); if (!D) return '';
  const c = D.citizen, m = D.mood, j = D.job;
  return '<div class="czbox">' +
    '<h3>👤 ' + esc(c.name) + '</h3>' +
    '<div class="czsub">' + (j ? esc(j.role) + ' · ' + esc(j.ico + ' ' + j.name) + ' · tile ' + esc(j.key) : 'No job — idle') +
      ' · citizen #' + c.id + '</div>' +
    '<div class="czq"><div class="qt"><span class="qlab">Mood — ' + esc(m.label) + '</span>' +
      '<span class="qval" style="color:' + MOOD_COL[m.band] + '">' + m.v + '</span></div>' +
      moodBar(m) +
      m.terms.map(t => '<div class="czterm"><span>' + esc(t.why) + '</span><span class="g ' + (t.d < 0 ? 'dn' : t.d > 0 ? 'up' : '') + '">' +
        (t.d === 0 ? 'base' : (t.d > 0 ? '+' : '') + t.d.toFixed(1)) + '</span></div>').join('') +
    '</div>' +
    D.lines.map(l => '<div class="czline"><span class="src">' + esc(l.q) + '</span></div>' +
      '<div class="czsay">' + esc(l.a) + '</div>').join('') +
    (D.bonds.length ? '<div class="czq">' + D.bonds.map(b => {
      const o = byId(b.to), om = moodOf(o);
      return '<div class="czrow"><span class="nm">🤝 ' + esc(b.name) + '<span class="jb"> — ' +
        (b.kind === 'coworker' ? 'same crew' : 'same building') + ', met ' + daysSince(b.since) + ' ago</span></span>' +
        '<span style="display:flex;align-items:center;gap:6px"><span class="czmini"><i style="width:' + om.v + '%;background:' + MOOD_COL[om.band] + '"></i></span>' +
        '<button class="czbtn" style="flex:0;padding:3px 8px;font-size:10.5px" data-cz="open" data-id="' + b.to + '">Talk</button></span></div>';
    }).join('') + '</div>' : '') +
    '<div class="czfoot">' +
      '<button class="czbtn" data-cz="roster">👥 Everyone (' + ROSTER.length + ')</button>' +
      '<button class="czbtn" data-cz="close">Close</button>' +
    '</div>' +
    '<div class="cznote">Every line above is read from this city\'s own state — the job is a real tile, the rate is the one the economy ticks with, ' +
      'and the mood terms are morale and coverage. There is no biography here because the game does not track one.</div>' +
  '</div>';
}

function rosterHtml() {
  const rows = ROSTER.map(c => {
    const m = moodOf(c), j = jobOf(c);
    return '<div class="czrow"><span class="nm">' + esc(c.name) +
      '<span class="jb"> — ' + (j ? esc(j.ico + ' ' + j.name + ' · ' + j.role) : 'idle, no crew seat') + '</span></span>' +
      '<span style="display:flex;align-items:center;gap:6px"><span class="czmini"><i style="width:' + m.v + '%;background:' + MOOD_COL[m.band] + '"></i></span>' +
      '<button class="czbtn" style="flex:0;padding:3px 8px;font-size:10.5px" data-cz="open" data-id="' + c.id + '">Talk</button></span></div>';
  }).join('') || '<div class="czline">Nobody yet. Citizens appear as the city gains population, housing and crew seats.</div>';
  const employed = ROSTER.filter(c => c.job).length;
  return '<div class="czbox">' +
    '<h3>👥 The citizens you can name</h3>' +
    '<div class="czsub">' + ROSTER.length + ' named · ' + employed + ' holding a crew seat · out of a population of ' +
      Math.round(pop()).toLocaleString() + '</div>' +
    '<div class="czq">' + rows + '</div>' +
    '<div class="czfoot"><button class="czbtn" data-cz="close">Close</button></div>' +
    '<div class="cznote">A working set, not the whole population — these are the ' + ROSTER.length +
      ' people the city tracks by name. They are counted INSIDE the population figure, never on top of it.</div>' +
  '</div>';
}

function render() {
  ensureCss();
  const html = OPEN_ROSTER ? rosterHtml() : OPEN_ID != null ? talkHtml(OPEN_ID) : '';
  let box = document.getElementById('czmod');
  if (!html) { if (box) box.remove(); return; }
  if (box) { box.innerHTML = html; return; }
  box = document.createElement('div');
  box.id = 'czmod'; box.innerHTML = html;
  (document.getElementById('wrap') || document.body).appendChild(box);
  box.addEventListener('click', onClick);
}
function onClick(ev) {
  const box = document.getElementById('czmod');
  if (ev.target === box) { close(); return; }
  const b = ev.target.closest && ev.target.closest('[data-cz]');
  if (!b) return;
  const act = b.dataset.cz;
  if (act === 'close') close();
  else if (act === 'roster') { OPEN_ID = null; OPEN_ROSTER = true; render(); }
  else if (act === 'open') { OPEN_ROSTER = false; OPEN_ID = +b.dataset.id; render(); }
}
export function open(id) {
  if (!byId(id)) return false;
  OPEN_ID = id; OPEN_ROSTER = false; render();
  return true;
}
export function openRoster() { OPEN_ID = null; OPEN_ROSTER = true; render(); }
export function close() { OPEN_ID = null; OPEN_ROSTER = false; render(); }
export function refresh() { if (OPEN_ID != null || OPEN_ROSTER) render(); }

/* ── the dossier's staff list ─────────────────────────────────────────────
   index.html's Workforce tab has rendered a staffing POOL since r7 with an
   honest note saying there was nobody to name. There is now. Absent roster ⇒
   empty string ⇒ index.html keeps printing the old note, which stays true. */
export function staffHtml(k) {
  const crew = atBuilding(k);
  if (!crew.length) return '';
  return crew.map(c => {
    const m = moodOf(c);
    return '<div class="czstaff"><span class="nm">' + esc(c.name) +
      '<small>' + esc(roleFor((tileOf(k) || {}).type)) + ' · here ' + daysSince(c.since) + ' · ' +
      (c.home ? 'lives at ' + esc(c.home) : 'no home') + '</small></span>' +
      '<span class="bar"><i style="width:' + m.v + '%;background:' + MOOD_COL[m.band] + '"></i></span>' +
      '<span class="mv">' + m.v + '</span>' +
      '<button data-cz="open" data-id="' + c.id + '">Talk</button></div>';
  }).join('');
}
// How many of the tile's crew seats have a named person in them.
export function staffCount(k) {
  const t = tileOf(k); if (!t) return { named: 0, crew: 0 };
  return { named: atBuilding(k).length, crew: (defOf(t.type) || {}).crew | 0 };
}

/* ── persistence ──────────────────────────────────────────────────────────
   🔴 ABSENT-TOLERANT, BOTH WAYS. `load(null)` means "no citizens yet" and must
   never throw — three silent save bugs have shipped in this file's
   neighbourhood. Every field is re-validated on the way in: a job key that no
   longer names a crewed tile is dropped (the citizen idles), a bond to an id
   that is not in the payload is dropped, and NEXT_ID is pushed past every id
   seen so a reload can never mint a duplicate.
   ⚠ index.html keeps the RAW blob it read and writes that back if this module
     failed to mount — so a boot error cannot silently erase a roster. */
export function serialize() {
  return {
    v: V, next: NEXT_ID,
    list: ROSTER.map(c => ({
      i: c.id, n: c.name, j: c.job || null, h: c.home || null,
      s: Math.round(c.since || 0), d: Math.round(c.idleAt || 0),
      b: c.bonds.map(b => [b.to, b.kind === 'neighbour' ? 'n' : 'c', Math.round(b.since || 0)]),
    })),
  };
}
export function load(raw) {
  ROSTER = []; NEXT_ID = 1;
  if (!raw || typeof raw !== 'object') return { loaded: 0, reason: 'absent' };
  let src = raw;
  if (typeof raw === 'string') { try { src = JSON.parse(raw); } catch (e) { return { loaded: 0, reason: 'unparseable' }; } }
  const arr = Array.isArray(src.list) ? src.list : [];
  const seen = new Set();
  for (const r of arr) {
    const id = +(r && r.i);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ROSTER.push({
      id,
      name: (typeof r.n === 'string' && r.n.trim()) ? r.n.slice(0, 40) : nameFor(id),
      // A job/home is only restored if it is STILL a real tile of the right
      // kind. Otherwise the citizen loads idle and sync() re-employs them.
      job: (typeof r.j === 'string' && isJobTile(r.j)) ? r.j : null,
      home: (typeof r.h === 'string' && tileOf(r.h) && (defOf(tileOf(r.h).type) || {}).popCap) ? r.h : null,
      since: Number.isFinite(+r.s) ? Math.max(0, +r.s) : 0,
      idleAt: Number.isFinite(+r.d) ? Math.max(0, +r.d) : 0,
      bonds: [],
    });
    if (id >= NEXT_ID) NEXT_ID = id + 1;
  }
  // bonds, second pass — both ends must exist
  for (const r of arr) {
    const c = byId(+(r && r.i)); if (!c || !Array.isArray(r.b)) continue;
    for (const b of r.b.slice(0, 2)) {
      if (!Array.isArray(b)) continue;
      const to = +b[0]; if (!byId(to) || to === c.id) continue;
      if (c.bonds.some(x => x.to === to)) continue;
      c.bonds.push({ to, kind: b[1] === 'n' ? 'neighbour' : 'coworker', since: Number.isFinite(+b[2]) ? +b[2] : 0 });
    }
  }
  if (Number.isFinite(+src.next) && +src.next > NEXT_ID) NEXT_ID = +src.next;
  if (ROSTER.length > CZ_MAX) ROSTER = ROSTER.slice(0, CZ_MAX);
  return { loaded: ROSTER.length, reason: null };
}
export function reset() { ROSTER = []; NEXT_ID = 1; OPEN_ID = null; OPEN_ROSTER = false; }

/* ── mount ─────────────────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS`, `wellbeing`,
   `cityPop`, `crewNeeded`, `staffingRatio` are top-level `const` inside
   node-city's module script and are invisible from here. ctx IS the handover;
   nothing below reaches for a bare global, and every ctx field is used behind
   a guard so a missing one degrades instead of throwing. */
export function mount(ctx) {
  CTX = ctx || {};
  ensureCss();
  try { load(CTX.saved || null); } catch (e) { try { console.warn('[Citizens] load failed', e); } catch (e2) {} }
  try { sync(); } catch (e) { try { console.warn('[Citizens] first sync failed', e); } catch (e2) {} }
  /* One delegated listener for every Talk button anywhere — the dossier's
     staff rows live in index.html's DOM, the roster rows in this module's. */
  try {
    document.addEventListener('click', (ev) => {
      const b = ev.target && ev.target.closest && ev.target.closest('[data-cz]');
      if (!b || document.getElementById('czmod')) return;   // the modal has its own handler
      if (b.dataset.cz === 'open') { ev.preventDefault(); ev.stopPropagation(); open(+b.dataset.id); }
      else if (b.dataset.cz === 'roster') { ev.preventDefault(); ev.stopPropagation(); openRoster(); }
    }, true);
  } catch (e) {}
  const api = {
    V, CZ_MAX,
    list, byId, count, atBuilding, sync,
    setJob, clearJob, addBond, bondsOf, moodOf, jobOf, homeOf,
    dialogue, bubbleFor, claimAgent, releaseAgent,
    staffHtml, staffCount, open, openRoster, close, refresh,
    serialize, load, reset,
    _ctx: () => CTX,
  };
  try { window.MythicCitizens = api; } catch (e) {}
  return api;
}
