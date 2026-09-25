/* ══════════════════════════════════════════════════════════════════════════
   🦠 DRIVE-CITY-OUTBREAK — the outbreak engine, headless, against the REAL
   module and the REAL world-event clock.
   ----------------------------------------------------------------------------
   Run:  node .gauntlet/drive-city-outbreak.mjs
   Exit 0 = every check passed. Exit 1 = at least one failed, and it says which.

   THIS DRIVES /src/city/plague.city.js ITSELF, not a copy of the model. Each
   scenario re-imports it with a cache-busting query so Node hands back a FRESH
   module instance with its own state. The ctx is a stub of exactly the shape
   node-city's boot() hands over (every accessor the module reads, no more), so
   anything this proves is a property of the shipped code path.

   🔴 THE WORLD EVENT IS NOT STUBBED WITH A FAKE. worldstrains.js derives the
      event from the clock, so "no event" and "a live event" are both real
      answers from the real activeWorldEvent() at a PINNED `now` — the ctx's
      optional `now()` is the only seam, and it exists for this file. A stub
      that returned a hand-written event would prove the engine handles the
      stub's shape, not the module's.

   THE FIVE CLAUSES, one section each:
     (1) pressure is exactly 0.000 on all six viruses on a healthy city in a
         calm window — the handoff rule ("a city NEVER catches a virus at
         random") as a measurement;
     (2) in a live window the mapped virus seeds, under the event's strainId,
         for every one of the five world viruses;
     (3) 3,000 city-minutes on the worst constructible city: no NaN, every
         fraction inside [0,1], outputMul() never under 0.40;
     (4) save()/load() round-trips, and load(null)/load({}) are healthy;
     (5) the Ship gate: no Medical Corp. ⇒ shipDoses() is {ok:false,'no-clinic'}.
   ══════════════════════════════════════════════════════════════════════════ */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => 'file:///' + join(ROOT, p).replace(/\\/g, '/');

const DATA = await import(url('public/src/city/plague.data.js'));
const WS = await import(url('public/src/plague/worldstrains.js'));
const { PLAGUE_IDS, PLAGUE_VIRUSES, PLAGUE_CURES, PLAGUE_GRACE_CITY_MIN } = DATA;
const { activeWorldEvent, WORLD_STRAINS, WINDOW_MS } = WS;

let FAILS = 0;
const ok = (name, cond, note) => {
  if (!cond) FAILS++;
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (note != null ? ' — ' + note : ''));
};
const hr = (t) => console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74));

/* A [plague] warning is a swallowed throw inside tick() — the module keeps
   the city alive by design, but this harness must not mistake "kept alive"
   for "worked". */
let WARNS = [];
const _warn = console.warn;
console.warn = (...a) => { WARNS.push(a.map(String).join(' ')); };

/* ── the world clock, pinned ─────────────────────────────────────────────
   Scan window indices from a fixed epoch for one calm window and one live
   window per world virus. Deterministic: the pick is a hash of the index. */
const EPOCH = 1_800_000_000_000;   // a fixed ms timestamp; any would do
const windows = { calm: null, live: {} };
for (let w = 0; w < 4000 && (!windows.calm || Object.keys(windows.live).length < WORLD_STRAINS.length); w++) {
  const t = EPOCH + w * WINDOW_MS + 60_000;
  const ev = activeWorldEvent(t);
  if (!ev) { if (!windows.calm) windows.calm = t; continue; }
  if (!windows.live[ev.def.id]) windows.live[ev.def.id] = t;
}

/* ── a city, as boot() hands one over ────────────────────────────────────
   `opt.worst` builds the worst constructible city: every vector red at once. */
function makeCtx(opt = {}) {
  const worst = !!opt.worst;
  const ctx = {
    game: {
      cityAge: (opt.ageMin == null ? PLAGUE_GRACE_CITY_MIN + 200 : opt.ageMin) * 60,   // ticked SECONDS
      cov: { pct: worst ? { food: 0, water: 0, health: 0 } : { food: 1, water: 1, health: 1 } },
      stock: worst ? { remedies: 0, reagents: 0 } : { remedies: 40, reagents: 40, goods: 40, components: 40, rations: 40 },
      pop: { npc: opt.pop == null ? 200 : opt.pop },
      res: { memoryShards: worst ? 5 : 0 },
    },
    vitals: { food: 100, water: 100, health: 100, security: 60, hope: worst ? 0 : 80, civilization: 50, trade: 50 },
    wellbeing: { morale: 50 },
    now: () => opt.now == null ? windows.calm : opt.now,
    pop: () => ctx.game.pop.npc,
    popCap: () => (worst ? ctx.game.pop.npc : ctx.game.pop.npc * 2),
    stockOf: (r) => ctx.game.stock[r] || 0,
    canAfford: (c) => Object.keys(c).every((r) => ctx.stockOf(r) >= c[r]),
    spendStock: (c) => {
      if (!Object.keys(c).every((r) => ctx.stockOf(r) >= c[r])) return false;
      for (const r in c) ctx.game.stock[r] = ctx.stockOf(r) - c[r];
      return true;
    },
    addStock: (c) => { for (const r in c) ctx.game.stock[r] = ctx.stockOf(r) + c[r]; },
    shardsOf: () => ctx.game.res.memoryShards | 0,
    spendShards: async (n) => { if (ctx.game.res.memoryShards < n) return false; ctx.game.res.memoryShards -= n; return true; },
    countOp: (type) => (opt.ops && opt.ops[type]) | 0,
    heavyOps: () => (worst ? 10 : 0),
    shardsHandled: () => worst,
    lab: () => (worst ? { sited: true, containment: 0, tier: 5 } : { sited: false, containment: 100, tier: 1 }),
    killPop: (n) => { ctx.game.pop.npc = Math.max(4, ctx.game.pop.npc - n); ctx.killed += n; },
    nudgeVital: (k, d) => { ctx.vitals[k] = Math.max(0, Math.min(100, ctx.vitals[k] + d)); },
    nudgeMorale: (d) => { ctx.wellbeing.morale = Math.max(0, Math.min(100, ctx.wellbeing.morale + d)); },
    logEvent: (kind, m) => ctx.log.push({ kind, m }),
    toast: (m, cls) => ctx.toasts.push({ m, cls }),
    saveSoon: () => { ctx.saves++; },
    confirm: async () => true,
    log: [], toasts: [], saves: 0, killed: 0,
  };
  return ctx;
}

let instance = 0;
async function fresh(opt) {
  const M = await import(url('public/src/city/plague.city.js') + '?i=' + (instance++));
  const ctx = makeCtx(opt);
  const api = M.mount(ctx);
  return { M, api, ctx };
}

/* Drive `mins` city-minutes in `step`-minute economy ticks, checking every
   invariant after every tick. Returns the first violation, or null. */
function drive(api, mins, step, check) {
  let t = 0;
  while (t < mins - 1e-9) {
    const dt = Math.min(step, mins - t);
    api.tick(dt); t += dt;
    const bad = check ? check(t) : null;
    if (bad) return bad;
  }
  return null;
}

/* The invariants clause (3) is about, as one function so every scenario can
   ask the same question. */
function invariants(api) {
  const S = api._state();
  const frac01 = (x) => Number.isFinite(x) && x >= 0 && x <= 1;
  for (const id in S.active) {
    const a = S.active[id];
    if (!frac01(a.inf)) return id + '.inf=' + a.inf;
    if (!frac01(a.imm)) return id + '.imm=' + a.imm;
    if (a.inf + a.imm > 1 + 1e-9) return id + ' inf+imm=' + (a.inf + a.imm);
    if (!Number.isFinite(a.deaths) || a.deaths < 0) return id + '.deaths=' + a.deaths;
    if (!Number.isFinite(a.since)) return id + '.since=' + a.since;
  }
  if (!Number.isFinite(S.toll) || S.toll < 0) return 'toll=' + S.toll;
  if (!Number.isFinite(S._pend) || S._pend < 0) return 'pend=' + S._pend;
  for (const k in S.vault) if (!Number.isFinite(S.vault[k]) || S.vault[k] < 0) return 'vault.' + k + '=' + S.vault[k];
  for (const k in S.clinic) if (!Number.isFinite(S.clinic[k]) || S.clinic[k] < 0) return 'clinic.' + k + '=' + S.clinic[k];
  if (S.research && !(Number.isFinite(S.research.left))) return 'research.left=' + S.research.left;
  const om = api.outputMul();
  if (!Number.isFinite(om) || om < 0.40 || om > 1) return 'outputMul=' + om;
  for (const need of ['food', 'water']) { const d = api.demandMul(need); if (!Number.isFinite(d) || d <= 0) return 'demandMul(' + need + ')=' + d; }
  const P = api.pressures();
  for (const id of PLAGUE_IDS) if (!frac01(P[id])) return 'pressure.' + id + '=' + P[id];
  return null;
}

/* ══ (0) the clock scan itself ═══════════════════════════════════════════ */
hr('(0) the world clock — real windows, pinned');
ok('a calm window exists', windows.calm != null, windows.calm && new Date(windows.calm).toISOString());
for (const d of WORLD_STRAINS) ok('a live window exists for ' + d.id, !!windows.live[d.id]);
ok('the calm window really is calm', activeWorldEvent(windows.calm) === null);

/* ══ (1) the handoff rule ════════════════════════════════════════════════ */
hr('(1) pressure is exactly 0.000 on a healthy city in a calm window');
{
  const { api, ctx } = await fresh({ now: windows.calm });
  const P = api.pressures();
  for (const id of PLAGUE_IDS) ok(id + ' pressure', P[id] === 0, P[id].toFixed(3));
  ok('activeWorldEvent(now) is null through the module', api.worldEventNow() === null);
  ok('outputMul() is 1 on a healthy city', api.outputMul() === 1, api.outputMul());
  /* and it stays that way: 1,000 city-minutes of checks roll nothing. */
  const _r = Math.random; Math.random = () => 0;   // the roll would succeed at ANY pressure > 0
  const bad = drive(api, 1000, 0.5, () => (Object.keys(api._state().active).length ? 'caught ' + Object.keys(api._state().active) : null));
  Math.random = _r;
  ok('1,000 city-minutes with a rigged roll catch nothing', bad === null, bad);
  ok('no toasts, no log lines', ctx.toasts.length === 0 && ctx.log.length === 0);
  ok('no [plague] warnings', WARNS.length === 0, WARNS[0]);
}

/* ══ (2) the world event seeds the mapped virus under its strainId ═══════ */
hr('(2) a live world event seeds the mapped virus, filed under ev.strainId');
for (const d of WORLD_STRAINS) {
  const now = windows.live[d.id];
  const { M, api, ctx } = await fresh({ now });
  const ev = activeWorldEvent(now);
  const mapped = M.cityVirusForWorldEvent(d.id);
  const P = api.pressures();
  ok(d.id + ' → ' + mapped + ' carries pressure', P[mapped] > 0, P[mapped].toFixed(3));
  ok(d.id + ': every OTHER virus still measures 0.000', PLAGUE_IDS.filter((id) => id !== mapped).every((id) => P[id] === 0));
  ok(d.id + ': the module sees the same event', api.worldEventNow() && api.worldEventNow().strainId === ev.strainId, ev.strainId);
  const _r = Math.random; Math.random = () => 0;
  drive(api, 10, 1);   // two vector checks
  Math.random = _r;
  const S = api._state();
  ok(d.id + ': ' + mapped + ' is active', !!S.active[mapped]);
  ok(d.id + ': the outbreak carries the strainId', S.active[mapped] && S.active[mapped].strain === ev.strainId, S.active[mapped] && S.active[mapped].strain);
  ok(d.id + ': only one outbreak', Object.keys(S.active).length === 1, Object.keys(S.active).join(','));
  ok(d.id + ': the strain is filed as seen', S.seen[ev.strainId] != null);
  ok(d.id + ': the log names the event', ctx.log.some((l) => l.m.includes('🌐') && l.m.includes(PLAGUE_VIRUSES[mapped].name)));
  ok(d.id + ': cityFx labour applies through outputMul()', Math.abs(api.outputMul() - Math.max(0.4, DATA.labourMul([S.active[mapped]]) * (d.cityFx.labour || 1))) < 1e-9, api.outputMul().toFixed(4));
  /* One outing per city: cured, the same window does not re-seed. */
  S.active[mapped].inf = 0.001;
  Math.random = () => 0;
  drive(api, 1, 1);
  ok(d.id + ': pushed under the floor ⇒ contained', !S.active[mapped]);
  drive(api, 20, 1);
  Math.random = _r;
  ok(d.id + ': the same window does not seed the city twice', !S.active[mapped], Object.keys(S.active).join(','));
}
{
  const { M } = await fresh({});
  ok('an unmapped event id lands as the declared default', M.cityVirusForWorldEvent('not-a-virus') === M.WORLD_EVENT_DEFAULT && PLAGUE_VIRUSES[M.WORLD_EVENT_DEFAULT] != null, M.WORLD_EVENT_DEFAULT);
  ok('the map never names Grey Marrow (the opportunist cannot start a crisis)', !Object.values(M.WORLD_EVENT_MAP).includes('greymarrow'));
  ok('every mapped id is in the catalog', Object.values(M.WORLD_EVENT_MAP).every((id) => PLAGUE_VIRUSES[id]));
}
ok('no [plague] warnings so far', WARNS.length === 0, WARNS[0]);

/* ══ (3) 3,000 city-minutes on the worst constructible city ══════════════ */
hr('(3) 3,000 city-minutes on the worst constructible city');
{
  /* Every vector red, a tier-5 lab at 0% containment, the hardest world
     event live, a rigged roll so everything that CAN catch does, no buildings
     to answer any of it, and a quarantine on every outbreak for the extra
     labour hit. Mixed tick sizes: the 1/60-minute frame tick, a half-minute
     step, and a 600-minute offline catch-up slice. */
  const now = windows.live.hollowtide || Object.values(windows.live)[0];
  const { api, ctx } = await fresh({ worst: true, now, pop: 500 });
  const _r = Math.random; Math.random = () => 0;
  let bad = null;
  const check = () => {
    const S = api._state();
    for (const id in S.active) S.active[id].quarantine = true;
    return invariants(api);
  };
  bad = bad || drive(api, 60, 1 / 60, check);
  bad = bad || drive(api, 2340, 0.5, check);
  bad = bad || drive(api, 600, 600, check);
  Math.random = _r;
  const S = api._state();
  ok('no invariant broke across 3,000 minutes', bad === null, bad);
  ok('the city is in real trouble (≥2 outbreaks landed)', Object.keys(S.active).length + Object.keys(S.cured).length >= 2, Object.keys(S.active).join(',') || '(none)');
  ok('Grey Marrow, the opportunist, got in on top', !!S.active.greymarrow || S.cured.greymarrow != null);
  ok('outputMul() ended ≥ 0.40', api.outputMul() >= 0.4, api.outputMul().toFixed(3));
  ok('people died, and the toll is whole people', ctx.killed > 0 && Number.isInteger(S.toll) && S.toll === ctx.killed, S.toll);
  ok('the soft citizenry never went below the floor', ctx.game.pop.npc >= 4, ctx.game.pop.npc);
  ok('no [plague] warnings', WARNS.length === 0, WARNS[0]);
  /* And a research batch mid-epidemic actually completes with a lab present,
     lands in the VAULT, and cures nobody while it sits there. */
  const { api: api2, ctx: ctx2 } = await fresh({ worst: false, now: windows.calm, ops: { research: 1 } });
  api2._seed('ashlung');
  const r = await api2.startResearch('antiserum');
  ok('a batch starts with a Research Facility standing', r.ok === true, JSON.stringify(r));
  ok('stock was charged on start', ctx2.game.stock.reagents === 40 - PLAGUE_CURES.antiserum.cost.reagents);
  drive(api2, PLAGUE_CURES.antiserum.minutes + 1, 1);
  ok('the batch lands in the lab vault', (api2._state().vault.antiserum | 0) === PLAGUE_CURES.antiserum.doses, api2._state().vault.antiserum);
  ok('…and cures nobody there: imm is still 0', api2._state().active.ashlung.imm === 0);
}

/* ══ (4) save / load ═════════════════════════════════════════════════════ */
hr('(4) save()/load() round-trips; load(null) and load({}) are healthy');
{
  const now = windows.live.ashlung;
  const { api } = await fresh({ worst: true, now, ops: { research: 1, medical: 1 } });
  const _r = Math.random; Math.random = () => 0;
  drive(api, 40, 1);
  Math.random = _r;
  const S = api._state();
  S.vault.antiserum = 12; S.clinic.poxwash = 3; S.research = { cureId: 'chelate', left: 4.5, doses: 45 };
  const s1 = api.save();
  const j = JSON.parse(JSON.stringify(s1));
  api.load(j);
  const s2 = api.save();
  ok('save → JSON → load → save is byte-identical', JSON.stringify(s1) === JSON.stringify(s2));
  ok('the strainId survives the round trip', Object.values(s2.active).some((a) => a.strain === activeWorldEvent(now).strainId));
  ok('seen survives the round trip', JSON.stringify(s2.seen) === JSON.stringify(s1.seen) && Object.keys(s2.seen).length >= 1);
  ok('vault, clinic and research survive', s2.vault.antiserum === 12 && s2.clinic.poxwash === 3 && s2.research.cureId === 'chelate' && s2.research.left === 4.5);
  const healthy = (S) => Object.keys(S.active).length === 0 && Object.keys(S.cured).length === 0 && Object.keys(S.seen).length === 0 &&
    S.research === null && Object.keys(S.vault).length === 0 && Object.keys(S.clinic).length === 0 && S.toll === 0 && S._pend === 0;
  api.load(null);
  ok('load(null) ⇒ a healthy city', healthy(api._state()) && api.outputMul() >= 0.9);
  api.load({});
  ok('load({}) ⇒ a healthy city', healthy(api._state()));
  api.load({ active: { notavirus: { inf: 0.5 }, ashlung: { inf: 'NaN', imm: 7, strain: 42 } }, vault: { nope: 3 }, research: { cureId: 'nope', left: 3 }, toll: -4 });
  const G = api._state();
  ok('garbage loads as the nearest sane city', !G.active.notavirus && G.active.ashlung && G.active.ashlung.inf === 0 && G.active.ashlung.imm === 1 &&
     G.active.ashlung.strain === null && !G.vault.nope && G.research === null && G.toll === 0, JSON.stringify(api.save()));
  ok('no [plague] warnings', WARNS.length === 0, WARNS[0]);
}

/* ══ (5) the Ship gate ═══════════════════════════════════════════════════ */
hr('(5) the Ship gate: no Medical Corp. ⇒ shipDoses() is {ok:false,error:"no-clinic"}');
{
  const { api, ctx } = await fresh({ now: windows.calm, ops: { research: 1, medical: 0 } });
  api._seed('ashlung');
  api._state().vault.antiserum = 40;
  const r = api.shipDoses('antiserum');
  ok('shipDoses() refuses', r && r.ok === false && r.error === 'no-clinic', JSON.stringify(r));
  ok('the vault is untouched', api._state().vault.antiserum === 40);
  ok('nothing reached the clinic', !api._state().clinic.antiserum);
  ok('the player is told why', ctx.toasts.some((t) => /No Medical Corp/.test(t.m)));
  drive(api, 30, 1);
  ok('30 minutes later the doses have still cured nobody', api._state().active.ashlung.imm === 0 && api._state().vault.antiserum === 40);
  /* and the same city with a clinic: the doses move and people recover. */
  const { api: api2 } = await fresh({ now: windows.calm, ops: { research: 1, medical: 1 } });
  api2._seed('ashlung');
  api2._state().vault.antiserum = 40;
  const r2 = api2.shipDoses('antiserum');
  ok('with a Medical Corp. the shipment goes', r2.ok === true && r2.sent === 40, JSON.stringify(r2));
  drive(api2, 5, 1);
  const A = api2._state().active.ashlung;
  ok('…and citizens move into the immune pool', !A || A.imm > 0, A ? A.imm.toFixed(3) : 'contained');
  ok('an empty vault is a different refusal', api2.shipDoses('poxwash').error === 'empty');
  ok('no [plague] warnings', WARNS.length === 0, WARNS[0]);
}

console.warn = _warn;
console.log('\n' + (FAILS === 0 ? '✅ drive-city-outbreak: every check passed' : '❌ drive-city-outbreak: ' + FAILS + ' check(s) failed'));
process.exit(FAILS === 0 ? 0 : 1);
