/* 🚚 LOGISTICS BRIDGE — EXECUTED, not parsed.
   _synckcheck.mjs only proves index.html parses. The two things this round
   changed in the bridge are behavioural and a parse gate cannot see either:

     1. _jbConvoys() minted convoy ids out of a 900-wide hash space, so two
        owned nodes could render as two rows with the SAME React key. This
        harness FINDS a real colliding pair with the shipped hash and asserts
        the shipped function now returns two distinct ids for it.
     2. _jbCorpShipmentsFetch() reads two Supabase sources with independent
        guards. Every interesting case is a failure case — missing table,
        missing RPC, query error, signed out — and none of them can be
        exercised by parsing.

   Both functions are lifted VERBATIM out of public/index.html (brace-matched
   from their declaration) and run against stubs. Nothing here is a copy of the
   logic under test; if the source changes, this runs the changed source.

   node .gauntlet/exec-logistics-bridge.mjs                                  */
import fs from 'node:fs';
import path from 'node:path';

const IDX = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf8');

let bad = 0;
const chk = (name, ok, extra) => {
  console.log((ok ? '✅ ' : '❌ ') + name + (extra ? '  ↳ ' + extra : ''));
  if (!ok) bad++;
};

/* Brace-matched extraction. A regex that stops at the first '}' would take a
   fragment that still parses, which is the failure mode this codebase records
   for scrape-based tests: a green run over the wrong text. */
function block(decl) {
  const i = IDX.indexOf(decl);
  if (i < 0) throw new Error('declaration not found: ' + decl);
  let j = IDX.indexOf('{', i), d = 0;
  for (let k = j; k < IDX.length; k++) {
    const c = IDX[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return IDX.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + decl);
}

// ══ 1. CONVOY IDS ══════════════════════════════════════════════════════════
{
  const src = block('function _jbConvoyHash(s)') + '\n'
            + 'const _JB_TRIP_MS = ' + (90 * 60 * 1000) + ';\n'
            + block('function _jbConvoys()') + '\n'
            + 'return { _jbConvoys, _jbConvoyHash };';
  // Two owned nodes, both producing. Everything else is stubbed to the shape
  // _jbConvoys actually reads.
  let NODES = [];
  const api = new Function('_twForge', '_twState', 'Profile', '_twNodeRecon', '_garageRig', src)(
    () => ({ nodes: NODES }),
    () => ({ ownedNodes: Object.fromEntries(NODES.map(n => [n.id, { guards: [], stability: 90 }])) }),
    { campNodeId: null },
    () => ({ corruption: 0 }),
    () => ({ owned: false, name: 'Hand-hauled', icon: '🧺', load: 1, risk: 0, speed: 1 }),
  );

  // Find a real colliding pair under the OLD id rule: hash % 900 + 100.
  const seen = new Map();
  let a = null, b = null;
  for (let i = 0; i < 200000 && !b; i++) {
    const id = 'node_' + i;
    const k = api._jbConvoyHash(id) % 900;
    if (seen.has(k)) { a = seen.get(k); b = id; } else seen.set(k, id);
  }
  chk('found a real colliding pair under the OLD 900-wide id rule', !!(a && b), a + ' / ' + b);

  NODES = [
    { id: a, name: 'Node A', resourceYield: { metal: 10 } },
    { id: b, name: 'Node B', resourceYield: { food: 25 } },
  ];
  const out = api._jbConvoys();
  chk('both owned producing nodes still produce a convoy row', out.length === 2, out.length + ' rows');
  chk('…and their ids are DISTINCT (no duplicate React key)',
      out.length === 2 && out[0].id !== out[1].id, out.map(c => c.id).join(' / '));
  chk('the old rule would have collided on this exact pair — the test is real',
      ('CV-' + String(api._jbConvoyHash(a) % 900 + 100)) === ('CV-' + String(api._jbConvoyHash(b) % 900 + 100)),
      'CV-' + String(api._jbConvoyHash(a) % 900 + 100));

  // ── the numeric cargo the headline now sums ──────────────────────────────
  const qtys = out.map(c => c.qtyUnits);
  chk('every convoy carries a NUMERIC qtyUnits (no string scraping upstream)',
      qtys.every(q => typeof q === 'number' && isFinite(q) && q > 0), JSON.stringify(qtys));
  chk('…and qtyUnits agrees with the display string it sits next to',
      out.every(c => Number(String(c.cargo).split(' ')[0].replace(/,/g, '')) === c.qtyUnits),
      out.map(c => c.cargo + ' vs ' + c.qtyUnits).join(' | '));
  chk('resource id rides along, so the label is not parsed back out of prose',
      out.every(c => typeof c.resource === 'string' && c.resource.length > 0),
      out.map(c => c.resource).join(','));

  // Stability: the same owned set must produce the same ids twice running.
  const again = api._jbConvoys();
  chk('ids are stable across two calls with the same owned set',
      JSON.stringify(out.map(c => c.id)) === JSON.stringify(again.map(c => c.id)));
}

// ══ 2. THE GUILD-FREIGHT FETCH ═════════════════════════════════════════════
const FETCH_SRC = block('function _jbShipMissing(err)') + '\n'
                + block('function _jbShipEmpty()') + '\n'
                + block('async function _jbCorpShipmentsFetch()') + '\n'
                + 'return { _jbCorpShipmentsFetch, _jbShipMissing };';

const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const H = 3600000;
// starts_at 30h ago at a 12h cycle → cycles 0 and 1 are due, 2 is not.
const START = new Date(NOW - 30 * H).toISOString();

const AGREEMENT = {
  id: 'ag-1', proposer_id: 'u-me', partner_id: 'u-mate',
  proposer_city: 'city-me', partner_city: 'city-mate',
  gives_resource: 'metal', gives_units: 200,
  wants_resource: 'water', wants_units: 0,          // one-way deal → ONE lane
  cycle_hours: 12, days: 3, status: 'active',
  starts_at: START, created_at: START,
};
const AGREEMENT2 = {
  id: 'ag-2', proposer_id: 'u-mate', partner_id: 'u-other',
  proposer_city: 'city-mate', partner_city: 'city-other',
  gives_resource: 'fuel', gives_units: 50,
  wants_resource: 'food', wants_units: 75,          // two-way → TWO lanes
  cycle_hours: 24, days: 4, status: 'active',
  starts_at: START, created_at: START,
};
const SHIPMENT = {
  agreement_id: 'ag-1', cycle_index: 1, proposer_sent: 140, partner_sent: 0,
  outcome: 'short_proposer', due_at: new Date(NOW - 6 * H).toISOString(),
  settled_at: new Date(NOW - 5 * H).toISOString(),
};
const CITIES = [
  { id: 'city-me', city_name: 'Ashfall Commons', owner_id: 'u-me' },
  { id: 'city-mate', city_name: 'Ironrow', owner_id: 'u-mate' },
  { id: 'city-other', city_name: 'Saltmarch', owner_id: 'u-other' },
];
const WH_ROW = {
  id: 'sh-1', warehouse_id: 'w1', owner_name: 'Corvin', sender_id: 'u-mate',
  sender_name: 'Marrow', unit_id: 'u1', bay_no: 3,
  origin_kind: 'city', origin_label: 'Ironrow', node_level: 8, free_city: false,
  eta_hours: 20, eta_at: new Date(NOW + 4 * H).toISOString(), sent_at: new Date(NOW - 16 * H).toISOString(),
  weight_kg: 412.5, payload: { fuel: 30, medicine: 40, metal: 5 },
  status: 'transit', crates_total: 4, crates_stored: 1,
};

const MISSING_TABLE = { code: '42P01', message: 'relation "public.city_trade_agreements" does not exist' };
const MISSING_FN    = { code: 'PGRST202', message: 'Could not find the function public.wh_corp_shipments' };

/* A Supabase stub with the shape the fetch actually uses. `plan` names what
   each source should answer, so every case below reads as a scenario rather
   than as a pile of mocks. */
function makeCloud(plan) {
  const q = (rows, error) => {
    const t = {
      select: () => t, or: () => t, in: () => t, eq: () => t, order: () => t,
      limit: () => Promise.resolve({ data: rows, error: error || null }),
      then: (f) => Promise.resolve({ data: rows, error: error || null }).then(f),
    };
    return t;
  };
  return {
    client: {
      from(table) {
        if (table === 'city_trade_agreements') return q(plan.agreements, plan.agreementsError);
        if (table === 'city_trade_shipments')  return q(plan.shipments, plan.shipmentsError);
        if (table === 'city_profiles')         return q(plan.cities, plan.citiesError);
        return q([], null);
      },
      rpc(fn) {
        if (fn === 'corp_logistics_scope') return Promise.resolve(plan.scope
          ? { data: 'corp', error: null } : { data: null, error: MISSING_FN });
        if (fn === 'wh_corp_shipments') return Promise.resolve(plan.whCorp
          ? { data: plan.whCorp, error: null } : { data: null, error: MISSING_FN });
        if (fn === 'wh_my_shipments') return Promise.resolve(plan.whMine
          ? { data: plan.whMine, error: plan.whMineError || null }
          : { data: null, error: plan.whMineError || MISSING_FN });
        return Promise.resolve({ data: null, error: MISSING_FN });
      },
    },
  };
}

async function run(plan, opts) {
  const App = {};
  const Profile = {
    cloud: (opts && opts.signedOut) ? { signedIn: false } : { signedIn: true, userId: 'u-me', displayName: 'Sethiroth' },
    account: {},
  };
  const Corp = {
    mine: (opts && opts.noCorp) ? null : { id: 'corp-1' },
    roster: [{ userId: 'u-me', name: 'Sethiroth' }, { userId: 'u-mate', name: 'Marrow' }],
  };
  const MythicCityTrade = {
    cycleDueAt: (start, ch, i) => Number(start) + (Number(i) + 1) * Number(ch) * 3600 * 1000,
  };
  const api = new Function('Cloud', 'Profile', 'Corp', 'App', 'window', FETCH_SRC)(
    makeCloud(plan), Profile, Corp, App, { MythicCityTrade });
  await api._jbCorpShipmentsFetch();
  return App._jbShip;
}

// ── 2a. the happy path, with sql/049 applied ───────────────────────────────
{
  const s = await run({ scope: true, agreements: [AGREEMENT, AGREEMENT2], shipments: [SHIPMENT],
                        cities: CITIES, whCorp: [WH_ROW] });
  chk('fetch reports ready', s.ready === true);
  chk('scope reads corp when corp_logistics_scope() answers', s.scope === 'corp', s.scope);
  chk('a ONE-WAY deal makes ONE lane and a TWO-WAY deal makes TWO — three total',
      s.city.lanes.length === 3, s.city.lanes.length + ' lanes');
  const l1 = s.city.lanes.find(l => l.id === 'ag-1:p');
  chk('the lane quantity is the agreement quantity, unmodified',
      l1 && l1.units === 200, l1 && String(l1.units));
  chk('…and its resource is the agreement resource', l1 && l1.resource === 'metal', l1 && l1.resource);
  chk('origin and destination are the two real city names',
      l1 && l1.fromCity === 'Ashfall Commons' && l1.toCity === 'Ironrow',
      l1 && (l1.fromCity + ' → ' + l1.toCity));
  chk('the shipper is named from the roster', l1 && l1.fromName === 'Sethiroth', l1 && l1.fromName);
  chk('a zero leg produces NO lane (no invented return cargo)',
      !s.city.lanes.some(l => l.units === 0 || l.resource === 'water'));
  chk('cycles settled counts the real shipment rows', l1 && l1.cyclesSettled === 1, l1 && String(l1.cyclesSettled));
  chk('cycles total = whole cycle_hours periods inside the term (3d @ 12h = 6)',
      l1 && l1.cyclesTotal === 6, l1 && String(l1.cyclesTotal));
  // cycle 0 is unsettled and is therefore next; due at start + 1×12h.
  chk('next due is the FIRST unsettled cycle, not "settled + 1"',
      l1 && l1.nextDueAt === Date.parse(START) + 12 * H,
      l1 && new Date(l1.nextDueAt).toISOString());
  chk('the last cycle reports what really shipped on THIS leg, not the agreed figure',
      l1 && l1.lastSent === 140 && l1.lastOutcome === 'short_proposer',
      l1 && (l1.lastSent + ' / ' + l1.lastOutcome));
  const l2 = s.city.lanes.find(l => l.id === 'ag-2:w');
  chk('the reverse leg of a two-way deal runs the other way',
      l2 && l2.fromCity === 'Saltmarch' && l2.toCity === 'Ironrow' && l2.units === 75,
      l2 && (l2.fromCity + ' → ' + l2.toCity + ' ' + l2.units));
  chk('a lane on an agreement with no shipments says so rather than showing 0',
      l2 && l2.lastOutcome === null && l2.lastSent === null);

  // warehouse
  chk('warehouse scope reads corp when wh_corp_shipments() answers', s.warehouse.scope === 'corp', s.warehouse.scope);
  const w = s.warehouse.rows[0];
  chk('the warehouse unit total is the sum of the payload, not a weight',
      w && w.units === 75, w && String(w.units));
  chk('…and the weight is carried separately and unrounded', w && w.weightKg === 412.5, w && String(w.weightKg));
  chk('cargo is broken out largest-first', w && w.cargo[0].id === 'medicine' && w.cargo[0].qty === 40,
      w && JSON.stringify(w.cargo));
  chk('route names the real origin label and the real bay',
      w && w.originLabel === 'Ironrow' && w.bayNo === 3 && w.ownerName === 'Corvin');
  chk('a corp-mate\'s load is not marked as mine', w && w.mine === false);
  chk('no NaN anywhere in the payload',
      JSON.stringify(s).indexOf('null') >= 0 && !/NaN|undefined/.test(JSON.stringify(s)));
}

// ── 2b. sql/038-039 absent: the city source says so, warehouse still works ──
{
  const s = await run({ scope: false, agreements: null, agreementsError: MISSING_TABLE,
                        cities: CITIES, whMine: [WH_ROW] });
  chk('city source reports MISSING when the table is not there', s.city.missing === true);
  chk('…and does NOT report an error (a missing table is not a failure to say sorry for)',
      s.city.error === null);
  chk('…and produces no lanes rather than a fabricated one', s.city.lanes.length === 0);
  chk('the warehouse source is unaffected and still returns its row', s.warehouse.rows.length === 1);
  chk('warehouse falls back to SELF scope when sql/049 is absent', s.warehouse.scope === 'self', s.warehouse.scope);
  chk('overall scope reads self when corp_logistics_scope() is missing', s.scope === 'self');
}

// ── 2c. the warehouse migration absent: city still works ────────────────────
{
  const s = await run({ scope: true, agreements: [AGREEMENT], shipments: [], cities: CITIES });
  chk('warehouse reports MISSING when neither RPC exists', s.warehouse.missing === true);
  chk('…and the city lanes still render', s.city.lanes.length === 1);
  chk('a lane with no settled cycles still has a next due time',
      s.city.lanes[0].nextDueAt === Date.parse(START) + 12 * H);
}

// ── 2d. a real query error is NOT reported as a missing table ───────────────
{
  const s = await run({ scope: true, agreements: null,
                        agreementsError: { code: '57014', message: 'canceling statement due to statement timeout' },
                        cities: CITIES, whMine: [] });
  chk('a timeout is an ERROR, not a missing migration', s.city.missing === false && !!s.city.error,
      String(s.city.error));
}

// ── 2e. signed out ─────────────────────────────────────────────────────────
{
  const s = await run({ scope: true, agreements: [AGREEMENT], cities: CITIES, whCorp: [WH_ROW] }, { signedOut: true });
  chk('signed out returns ready:false so the panel says "loading", never "empty"', s.ready === false);
  chk('…and nothing is fetched', s.city.lanes.length === 0 && s.warehouse.rows.length === 0);
}

// ── 2f. no corporation: the caller still sees their OWN loads ──────────────
/* 🪤 THE FIXTURE WAS WRONG AND THE TEST WAS GREEN ON IT.
   This used to hand wh_my_shipments a row carrying `sender_id: 'u-me'`. The
   REAL wh_my_shipments() (the warehouse migration) builds its jsonb with no
   sender_id and no sender_name at all — it does not need them, every row it
   returns is already the caller's. So the assertion below passed against a
   shape the database never produces, while against the real one the bridge
   read `s.sender_id` as undefined and labelled the player's OWN freight
   'Member' with mine:false. The fixture now mirrors the shipped SQL exactly
   — sender fields DELETED, not blanked — and the bridge resolves the sender
   from the scope flag instead of from a column that is not there. */
{
  const MY_ROW = Object.assign({}, WH_ROW);
  delete MY_ROW.sender_id; delete MY_ROW.sender_name;   // exactly what wh_my_shipments() selects
  const s = await run({ scope: false, agreements: [AGREEMENT], shipments: [], cities: CITIES,
                        whMine: [MY_ROW] }, { noCorp: true });
  chk('with no corp row the warehouse read falls straight to wh_my_shipments',
      s.warehouse.rows.length === 1 && s.warehouse.scope === 'self');
  chk('…and that load is marked as mine even though the RPC returns no sender_id',
      s.warehouse.rows[0].mine === true, JSON.stringify(s.warehouse.rows[0].senderId));
  chk('…and it is named as the player, not the generic "Member"',
      s.warehouse.rows[0].senderName === 'Sethiroth', s.warehouse.rows[0].senderName);
}

// ── 2g. the cycle rule is not re-implemented ───────────────────────────────
{
  // Same data, but the citytrade module has not evaluated yet.
  const App = {};
  const api = new Function('Cloud', 'Profile', 'Corp', 'App', 'window',
    FETCH_SRC)(makeCloud({ scope: true, agreements: [AGREEMENT], shipments: [], cities: CITIES, whMine: [] }),
    { cloud: { signedIn: true, userId: 'u-me', displayName: 'S' }, account: {} },
    { mine: { id: 'c' }, roster: [] }, App, {});
  await api._jbCorpShipmentsFetch();
  const l = App._jbShip.city.lanes[0];
  chk('without the citytrade module the due time is null, not a second copy of the rule',
      l && l.nextDueAt === null, l && String(l.nextDueAt));
  chk('…and every other figure on the lane is still correct',
      l && l.units === 200 && l.cyclesTotal === 6);
}

// ── 2h. the shipment read came back CAPPED ─────────────────────────────────
// The chunk cap is 2000. Hand it exactly that many rows and the fetch must
// admit it could not see the whole history rather than counting what it got:
// a capped, globally-sorted page can drop a young agreement entirely, and the
// count it would produce is not "approximate", it is wrong.
{
  const many = [];
  for (let i = 0; i < 2000; i++) many.push({ agreement_id: 'ag-1', cycle_index: i,
    proposer_sent: 200, partner_sent: 0, outcome: 'settled',
    due_at: new Date(NOW - H).toISOString(), settled_at: new Date(NOW - H).toISOString() });
  const s = await run({ scope: true, agreements: [AGREEMENT], shipments: many, cities: CITIES, whMine: [] });
  const l = s.city.lanes[0];
  chk('a capped shipment page marks the lane as unread', l && l.cyclesUnknown === true, l && String(l.cyclesUnknown));
  chk('…and reports NO settled count rather than the count it happened to get',
      l && l.cyclesSettled === null, l && String(l.cyclesSettled));
  chk('…and no next-due, because "first unsettled" cannot be known',
      l && l.nextDueAt === null, l && String(l.nextDueAt));
  chk('…and no last-cycle figure', l && l.lastSent === null && l.lastOutcome === null);
  chk('…while the quantity, resource and term are untouched',
      l && l.units === 200 && l.resource === 'metal' && l.cyclesTotal === 6);
}

// ── 2i. an UNCAPPED read still counts, so 2h is not just "always unknown" ──
{
  const s = await run({ scope: true, agreements: [AGREEMENT], shipments: [SHIPMENT], cities: CITIES, whMine: [] });
  const l = s.city.lanes[0];
  chk('a normal read is NOT marked unread', l && !l.cyclesUnknown, l && String(l.cyclesUnknown));
  chk('…and still counts its one settled cycle', l && l.cyclesSettled === 1, l && String(l.cyclesSettled));
}
console.log('\n' + (bad ? '❌ ' + bad + ' FAILED' : '✅ all logistics-bridge checks passed'));
process.exit(bad ? 1 : 0);
