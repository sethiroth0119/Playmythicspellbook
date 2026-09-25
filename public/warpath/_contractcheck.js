/* warpath/_contractcheck.js — every client call site vs the LIVE catalog.
   -----------------------------------------------------------------------------
   ⚠ THIS FILE EXISTS BECAUSE NINE REVIEW ROUNDS MISSED A DEAD MODE.

   Every mutating RPC took `p_exp uuid` as its first argument with no default and
   nothing in public/ ever sent it. PostgREST resolves by argument NAME, so all
   eleven client call sites failed with PGRST202 before touching the database —
   and the bridge rewrote that into "The Warpath is not installed on this server
   yet", which reads like a deployment note rather than a bug. End turn and
   Abandon were both dead, and because a run can only close inside
   warpath_end_turn, warpath_enter then answered already_in_a_warpath forever: a
   player paid a ticket or 3 AZA and was locked out of the mode for good.

   It survived that long because warpath-net.js's offline mock REIMPLEMENTS the
   RPCs in JavaScript with its own signatures. Every screenshot, playthrough and
   critic round ran against the mock, so the client's real call shapes were never
   once tested against real Postgres. The mock is not an optimistic server; it is
   a DIFFERENT API, and nothing was comparing the two.

   So this does the comparison. It scrapes every `rpc('warpath_*', {...})` and
   `act('warpath_*', {...})` call site out of the shipped client, reads the real
   signatures out of pg_proc, and asserts that each call would resolve — same
   rule PostgREST uses: every named argument must exist, and every argument the
   function does not default must be supplied.

   Usage (needs the migration applied):
     PGHOST=/var/tmp/wpsim PGPORT=55432 PGDATABASE=warpath \
       node public/warpath/_contractcheck.js

   Exits non-zero listing any call site that would fail.                       */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const SOURCES = [
  'public/warpath/warpath-app.js',
  'public/index.html',
];


/* ⚠ EXTRACT KEYS PROPERLY, NOT WITH A LOOSE REGEX.
   The first version matched /(\w+)\s*:/ anywhere inside the argument object,
   which happily picked `expedition_id` out of
   `p_winner: d.won ? S.state.me.expedition_id : null` — a ternary colon, not a
   key — and reported three failures that were entirely its own fault. A
   contract test that cries wolf gets switched off, so this walks balanced
   brackets and only accepts an identifier that begins a top-level member. */
function balanced(src, open) {
  if (src[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    }
  }
  return null;
}
function topLevelKeys(body) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; }
    } else if (c === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  const keys = [];
  for (const part of parts) {
    const k = part.match(/^\s*(?:\/\/[^\n]*\n)?\s*([A-Za-z_$][\w$]*)\s*:/);
    if (k) keys.push(k[1]);
  }
  return keys;
}

function psql(sql) {
  const args = ['-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  if (process.env.PGUSER_OS) {
    return execFileSync('su', [process.env.PGUSER_OS, '-s', '/bin/bash', '-c',
      `/usr/lib/postgresql/16/bin/psql -h ${process.env.PGHOST} -p ${process.env.PGPORT} ` +
      `-d ${process.env.PGDATABASE} ` + args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')],
      { encoding: 'utf8' }).trim();
  }
  return execFileSync('psql', args, { encoding: 'utf8' }).trim();
}

// ── the live catalog: name -> {args:[...], defaulted:Set} ─────────────────
const catalog = {};
for (const line of psql(`
  select p.proname || '|' ||
         coalesce(array_to_string(p.proargnames, ','), '') || '|' ||
         (p.pronargs - p.pronargdefaults)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'warpath\\_%'
   order by 1`).split('\n').filter(Boolean)) {
  const [name, names, required] = line.split('|');
  const args = names ? names.split(',') : [];
  const req = parseInt(required, 10);
  catalog[name] = { args, required: args.slice(0, req) };
}

// ── every call site in the shipped client ────────────────────────────────
const calls = [];
for (const rel of SOURCES) {
  const file = path.join(REPO, rel);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const re = /(?:\bact|\brpc|NET\.rpc|_warpathRpc)\(\s*'(warpath_[a-z_]+)'\s*,\s*\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const body = balanced(src, open);
    if (body === null) continue;
    calls.push({ fn: m[1], keys: topLevelKeys(body), where: rel + ':' + line });
  }
  // zero-argument forms: rpc('warpath_x', {}) already caught; also bare rpc('warpath_x')
  const re2 = /(?:\bact|\brpc|NET\.rpc|_warpathRpc)\(\s*'(warpath_[a-z_]+)'\s*\)/g;
  while ((m = re2.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    calls.push({ fn: m[1], keys: [], where: rel + ':' + line });
  }
}

let fails = 0;
const seen = new Set();
console.log('checking ' + calls.length + ' client call sites against ' +
            Object.keys(catalog).length + ' live functions\n');
for (const c of calls) {
  const sig = catalog[c.fn];
  if (!sig) {
    console.log('FAIL ' + c.where + '  ' + c.fn + '() does not exist in the database');
    fails++; continue;
  }
  const unknown = c.keys.filter(k => !sig.args.includes(k));
  const missing = sig.required.filter(a => !c.keys.includes(a));
  if (unknown.length || missing.length) {
    console.log('FAIL ' + c.where + '  ' + c.fn + '(' + c.keys.join(', ') + ')');
    if (unknown.length) console.log('       unknown argument(s): ' + unknown.join(', '));
    if (missing.length) console.log('       missing required argument(s): ' + missing.join(', ')
      + '  — PostgREST would answer PGRST202');
    fails++; continue;
  }
  const key = c.fn + '(' + c.keys.join(',') + ')';
  if (!seen.has(key)) { seen.add(key); console.log('  ok  ' + key); }
}

// Anything the bridge is willing to proxy but that does not exist is also a bug.
const idx = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
const wl = new Set();
for (const m of idx.matchAll(/\b(warpath_[a-z_]+)\s*:\s*1/g)) wl.add(m[1]);
for (const m of idx.matchAll(/WARPATH_RPCS\.(warpath_[a-z_]+)\s*=\s*1/g)) wl.add(m[1]);
for (const name of wl) {
  if (!catalog[name]) { console.log('FAIL whitelist allows ' + name + '() which does not exist'); fails++; }
}
console.log('\nbridge whitelist: ' + wl.size + ' names, all present in the catalog'.replace(
  'all present in the catalog', fails ? 'see failures above' : 'all present in the catalog'));

console.log(fails ? '\n' + fails + ' CALL SITES WOULD FAIL' : '\nEVERY CLIENT CALL SITE RESOLVES');
process.exit(fails ? 1 : 0);
