#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// catalog.mjs — browse the game's data catalogs without grepping 11 MB of HTML.
//
//   node tools/gamedev/catalog.mjs                      # overview counts
//   node tools/gamedev/catalog.mjs moves                # table of every move
//   node tools/gamedev/catalog.mjs moves fireball       # one entry, full JSON
//   node tools/gamedev/catalog.mjs moves --grep burn    # filter (id/name/desc/any field)
//   node tools/gamedev/catalog.mjs moves --schema       # field frequency = the REAL schema
//   node tools/gamedev/catalog.mjs moves --stats        # distribution by element / kind / cost
//   node tools/gamedev/catalog.mjs effects              # ONPLAY_TYPES with groups + `needs`
//   node tools/gamedev/catalog.mjs statuses|passives|elements|triggers|units|spells|traps|
//                                  locations|walls|events|weather|heroes|factions|items
//   --json on anything for machine-readable output.
//
// The catalogs are read LIVE from public/index.html via headless.mjs, so this
// never goes stale the way a hand-kept list would (that drift is exactly what
// tools/extract-engine-data.mjs --check exists to catch for the server).
// ─────────────────────────────────────────────────────────────────────────────
import { loadEngine, argFlag, argValue } from './headless.mjs';

// positionals = args that are neither flags nor the value of a value-taking flag
const VALUE_FLAGS = new Set(['--grep']);
const rawArgs = process.argv.slice(2);
const args = rawArgs.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.has(rawArgs[i - 1])));
const grepArg = argValue('grep');
const wantJson = argFlag('json');
const eng = loadEngine();

// name → { data, kind: 'dict'|'list', columns }
const SECTIONS = {
  moves:     { data: eng.MOVES,          kind: 'dict', cols: ['id', 'name', 'kind', 'type', 'element', 'power', 'range', 'cost', 'accuracy', 'applyStatus.id'] },
  statuses:  { data: eng.STATUS_EFFECTS, kind: 'dict', cols: ['id', 'name', 'icon', 'when', 'dmgMin', 'dmgMax', 'skipTurn', 'atkMod', 'defMod', 'spdMod', 'desc'] },
  passives:  { data: eng.PASSIVES,       kind: 'dict', cols: ['id', 'name', 'cat', 'faction', 'wardElement', 'wardFaction', 'desc'] },
  elements:  { data: eng.ELEMENTS,       kind: 'list', cols: null },
  effects:   { data: eng.ONPLAY_TYPES,   kind: 'list', cols: ['id', 'group', 'needs', 'label'] },
  triggers:  { data: { events: eng.TRIGGER_EVENTS, effects: eng.TRIGGER_EFFECTS, negateModes: eng.TRIGGER_NEGATE_MODES, inGrave: eng.IN_GRAVE_TRIGGERS }, kind: 'nested' },
  units:     { data: eng.UNIT_CARDS,     kind: 'list', cols: ['id', 'name', 'cost', 'elements', 'factions', 'stats.hp', 'stats.atk', 'stats.def', 'stats.mag', 'stats.res', 'stats.spd', 'passive', 'learnset'] },
  spells:    { data: eng.SPELL_CARDS,    kind: 'list', cols: ['id', 'name', 'cost', 'target', 'effect.type', 'effect.amount', 'desc'] },
  traps:     { data: eng.TRAP_CARDS,     kind: 'list', cols: ['id', 'name', 'cost', 'desc'] },
  locations: { data: eng.LOCATION_CARDS, kind: 'list', cols: ['id', 'name', 'cost', 'desc'] },
  walls:     { data: eng.WALL_CARDS,     kind: 'list', cols: ['id', 'name', 'cost', 'hp', 'desc'] },
  events:    { data: eng.EVENT_CARDS,    kind: 'list', cols: ['id', 'name', 'cost', 'desc'] },
  weather:   { data: eng.WEATHER_CARDS,  kind: 'list', cols: ['id', 'name', 'cost', 'desc'] },
  heroes:    { data: eng.STARTER_HEROES, kind: 'list', cols: ['id', 'name', 'elements', 'class', 'desc'] },
  factions:  { data: eng.FACTIONS,       kind: 'list', cols: ['id', 'name', 'icon', 'desc'] },
  items:     { data: eng.HELD_ITEMS,     kind: 'dict', cols: ['id', 'name', 'desc'] },
  rarities:  { data: eng.RARITIES,       kind: 'list', cols: ['id', 'name', 'color'] },
  // ── economy / city / businesses ─────────────────────────────────────────
  resources: { data: eng.RESOURCES,      kind: 'list', cols: ['id', 'name', 'icon', 'color'] },
  ops:       { data: eng.OPS_ECON,       kind: 'dict', cols: ['id', 'startup', 'ratePerWorkerHr', 'salaryPerWorkerHr', 'maxWorkers', 'yields', 'inputs', 'illicit'] },
  laws:      { data: eng.CORP_LAWS,      kind: Array.isArray(eng.CORP_LAWS) ? 'list' : 'dict', cols: ['id', 'name', 'desc'] },
  licenses:  { data: eng.CITY_LICENSES,  kind: Array.isArray(eng.CITY_LICENSES) ? 'list' : 'dict', cols: ['id', 'name', 'cost', 'desc'] },
  packs:     { data: eng.PACK_DEFINITIONS, kind: Array.isArray(eng.PACK_DEFINITIONS) ? 'list' : 'dict', cols: ['id', 'name', 'cost', 'price', 'cards', 'desc'] },
  missions:  { data: eng.MISSION_CATALOG, kind: Array.isArray(eng.MISSION_CATALOG) ? 'list' : 'dict', cols: ['id', 'name', 'reward', 'desc'] },
  achievements: { data: eng.ACHIEVEMENTS, kind: Array.isArray(eng.ACHIEVEMENTS) ? 'list' : 'dict', cols: ['id', 'name', 'desc'] },
  zones:     { data: eng.DEFAULT_ZONES,  kind: 'list', cols: ['id', 'name', 'desc'] },
  houses:    { data: eng.DEFAULT_HOUSE_LISTINGS, kind: 'list', cols: ['id', 'name', 'zone', 'price', 'rent'] },
  furniture: { data: eng.FURNITURE_CATALOG, kind: Array.isArray(eng.FURNITURE_CATALOG) ? 'list' : 'dict', cols: ['id', 'name', 'cat', 'price'] },
  twnodes:   { data: eng.TW_NODE_TYPES,  kind: Array.isArray(eng.TW_NODE_TYPES) ? 'list' : 'dict', cols: ['id', 'name', 'desc'] },
  aicorps:   { data: eng.AI_CORPS,       kind: Array.isArray(eng.AI_CORPS) ? 'list' : 'dict', cols: ['id', 'name', 'desc'] },
};
// Any exported UPPER_CASE const can be dumped raw: `catalog.mjs CAMP_TRAITS`.
if (args[0] && /^[A-Z][A-Z0-9_]+$/.test(args[0]) && !SECTIONS[args[0]]) {
  const v = eng[args[0]];
  if (v === undefined) { console.error(args[0] + ' is not exported by headless.mjs — add it to EXPORTS there.'); process.exit(1); }
  console.log(JSON.stringify(v, null, wantJson ? 1 : 2)); process.exit(0);
}

const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
const fmt = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? (x.m || x.id || JSON.stringify(x)) : x)).join(',');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const rowsOf = (sec) => {
  if (sec.kind === 'dict') return Object.entries(sec.data || {}).map(([k, v]) => ({ _key: k, ...(v || {}) }));
  if (sec.kind === 'list') return (sec.data || []).map((v) => (typeof v === 'object' ? v : { id: v }));
  return [];
};
const matches = (row, q) => JSON.stringify(row).toLowerCase().includes(q.toLowerCase());

function table(rows, cols) {
  if (!rows.length) return '(none)';
  const widths = cols.map((c) => Math.min(48, Math.max(c.length, ...rows.map((r) => fmt(get(r, c)).length))));
  const line = (vals) => vals.map((v, i) => String(v).slice(0, widths[i]).padEnd(widths[i])).join('  ');
  return [line(cols), line(widths.map((w) => '─'.repeat(w))), ...rows.map((r) => line(cols.map((c) => fmt(get(r, c)))))].join('\n');
}

function schema(rows) {
  const f = {}; const ex = {};
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (k === '_key') return; f[k] = (f[k] || 0) + 1; if (!(k in ex)) ex[k] = r[k]; }));
  return Object.entries(f).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ field: k, count: n, pct: Math.round((100 * n) / rows.length), example: fmt(ex[k]).slice(0, 60) }));
}

function stats(name, rows) {
  const dist = (key) => { const d = {}; rows.forEach((r) => { const v = fmt(get(r, key)) || '(none)'; d[v] = (d[v] || 0) + 1; }); return Object.entries(d).sort((a, b) => b[1] - a[1]); };
  const keys = name === 'moves' ? ['element', 'kind', 'type', 'cost', 'range', 'power'] : name === 'units' ? ['cost', 'elements', 'factions', 'passive'] : name === 'passives' ? ['cat', 'faction'] : name === 'statuses' ? ['when', 'skipTurn'] : name === 'ops' ? ['maxWorkers', 'illicit'] : ['type'];
  return keys.map((k) => '• by ' + k + ':\n' + dist(k).map(([v, n]) => '    ' + String(v).padEnd(18) + n).join('\n')).join('\n');
}

// ── overview ────────────────────────────────────────────────────────────────
if (!args.length) {
  const counts = Object.fromEntries(Object.entries(SECTIONS).map(([k, s]) => [k, s.kind === 'nested' ? Object.fromEntries(Object.entries(s.data).map(([a, b]) => [a, (b || []).length])) : rowsOf(s).length]));
  if (wantJson) { console.log(JSON.stringify(counts, null, 1)); process.exit(0); }
  console.log('Mythic Spellbook catalogs (live from public/index.html, loaded in ' + eng.loadMs + ' ms)\n');
  Object.entries(counts).forEach(([k, v]) => console.log('  ' + k.padEnd(11) + (typeof v === 'object' ? Object.entries(v).map(([a, b]) => a + '=' + b).join(' ') : v)));
  console.log('\nTry: node tools/gamedev/catalog.mjs moves --stats   |   effects --grep grave   |   moves fireball');
  process.exit(0);
}

const name = args[0];
const sec = SECTIONS[name];
if (!sec) { console.error('Unknown section "' + name + '". Sections: ' + Object.keys(SECTIONS).join(', ')); process.exit(1); }

if (sec.kind === 'nested') {
  if (wantJson) { console.log(JSON.stringify(sec.data, null, 1)); process.exit(0); }
  Object.entries(sec.data).forEach(([k, list]) => {
    console.log('\n■ ' + k + ' (' + (list || []).length + ')');
    (list || []).forEach((t) => console.log('  ' + String(t.id).padEnd(16) + (t.label || t.name || '') + (t.amount ? '  [amount]' : '') + (t.status ? '  [status]' : '') + (t.summon ? '  [summon]' : '')));
  });
  process.exit(0);
}

let rows = rowsOf(sec);
if (name === 'effects') {
  const groupOf = {}; (eng.ONPLAY_TYPE_GROUPS || []).forEach((g) => g.ids.forEach((id) => { groupOf[id] = g.label; }));
  rows = rows.map((r) => ({ ...r, group: groupOf[r.id] || '(ungrouped)' }));
}
if (grepArg) rows = rows.filter((r) => matches(r, grepArg));
if (args[1]) {
  const hit = rows.filter((r) => r.id === args[1] || r._key === args[1] || (r.name && String(r.name).toLowerCase() === args[1].toLowerCase()));
  if (!hit.length) { console.error('No ' + name + ' entry with id/name "' + args[1] + '"'); process.exit(1); }
  console.log(JSON.stringify(hit.length === 1 ? hit[0] : hit, (k, v) => (k === '_key' ? undefined : v), 2));
  process.exit(0);
}
if (argFlag('schema')) {
  const s = schema(rows);
  if (wantJson) { console.log(JSON.stringify(s, null, 1)); process.exit(0); }
  console.log('Field frequency across ' + rows.length + ' ' + name + ' (100% = required in practice):\n');
  console.log(table(s, ['field', 'count', 'pct', 'example']));
  process.exit(0);
}
if (argFlag('stats')) { console.log(rows.length + ' ' + name + '\n' + stats(name, rows)); process.exit(0); }
if (wantJson) { console.log(JSON.stringify(rows, (k, v) => (k === '_key' ? undefined : v), 1)); process.exit(0); }
if (!sec.cols) { console.log(rows.map((r) => r.id).join('\n')); process.exit(0); }
console.log(rows.length + ' ' + name + (grepArg ? ' matching "' + grepArg + '"' : '') + '\n');
console.log(table(rows, sec.cols));
