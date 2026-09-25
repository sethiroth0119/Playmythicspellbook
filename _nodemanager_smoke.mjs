#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   NODE MANAGER RENAME — the ES modules under public/src say "Node Manager".

   Owner, 2026-09-17: "Change the mayor name to Node Manager". The word is a
   PLAYER-FACING title. It is not an identifier: the phone app id 'mayor', the
   kitchen customer id 'mayor', the drive-thru voice key `mayor:`, the
   window.MythicMayorDash seam and the mayor_* RPCs all stay, because every one
   of those is matched by saved state, a server function or another file, and
   renaming them would be a migration dressed up as a wording change.

   So the check has to tell the two apart. It parses each module with acorn
   and looks only at STRING LITERALS and TEMPLATE text (comments are prose for
   developers and are allowed to say mayor). A literal that mentions mayor is
   an identifier when it is a bare lower-case token ('mayor',
   'mayor_dashboard'); anything with a capital, a space or an apostrophe is
   text a player can read, and fails.

   A grep would not do: a grep either flags `id: 'mayor'` (and someone
   "fixes" it by renaming the id) or skips comments by line and misses a
   string on a commented line. The negative controls below prove the
   classifier catches a visible string and does NOT catch an id.

   public/src/economy/* is deliberately NOT scanned here: sim.js is
   byte-matched to prod and the economy is off limits for this change. Its
   remaining visible strings are reported (not failed) at the end so the
   follow-up is on record.
   ══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as acorn from 'acorn';

let passes = 0, fails = 0;
function ok(c, msg, detail) {
  if (c) { passes++; console.log('  PASS ' + msg); }
  else { fails++; console.log('  FAIL ' + msg + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
}

const LANE = [
  'public/src/phone/handset.js',
  'public/src/kitchen/drivethru.js',
  'public/src/kitchen/kitchen.data.js',
  'public/src/kitchen/kitchen.render.js',
  'public/src/broadcast/feed.js',
  'public/src/broadcast/phone.js',
  'public/src/broadcast/sources.js',
  'public/src/broadcast/voices.js',
  'public/src/broadcast/likes.js',
  'public/src/broadcast/index.js',
  'public/src/plague/state.js',
  'public/src/power/grid.js',
  'public/src/power/plants.js',
  'public/src/water/network.js',
  'public/src/zoning/index.js',
];

const IDENT = /^[a-z0-9_.:\-]*$/;           // 'mayor', 'mayor_dashboard', 'mgp-md'
function literals(src) {
  const out = [];
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  (function walk(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'Literal' && typeof n.value === 'string') out.push({ v: n.value, at: n.start });
    if (n.type === 'TemplateElement') out.push({ v: n.value.cooked ?? n.value.raw, at: n.start });
    for (const k in n) {
      if (k === 'parent') continue;
      const c = n[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c.type === 'string') walk(c);
    }
  })(ast);
  return out;
}
export function visibleMayor(src) {
  return literals(src).filter((l) => /mayor/i.test(l.v) && !IDENT.test(l.v)).map((l) => l.v);
}

/* ── negative controls: the classifier must bite, and must not over-bite ── */
{
  const HS = readFileSync('public/src/phone/handset.js', 'utf8');
  const cap = visibleMayor(HS + "\nexport const __nc1 = 'Ask the Mayor';\n");
  ok(cap.includes('Ask the Mayor'), 'control: a capitalised visible string is caught', cap);
  const low = visibleMayor(HS + "\nexport const __nc2 = `somebody tell the mayor`;\n");
  ok(low.includes('somebody tell the mayor'), 'control: a lower-case sentence in a template is caught', low);
  const aide = visibleMayor("export const C = [{ id:'mayor', name:'Mayor’s Aide' }];");
  ok(aide.length === 1 && aide[0] === 'Mayor’s Aide', 'control: the id is ignored, the name beside it is caught', aide);
  const ids = visibleMayor("const a = 'mayor'; rpc('mayor_dashboard'); /* the Mayor */ // Mayor\n");
  ok(ids.length === 0, 'control: bare ids and comments are not flagged', ids);
}

/* ── the lane ── */
for (const f of LANE) {
  const src = readFileSync(f, 'utf8');
  let hits;
  try { hits = visibleMayor(src); } catch (e) { ok(false, f + ' parses', String(e)); continue; }
  ok(hits.length === 0, f + ': no player-visible "mayor"', hits);
}

/* ── identifiers that must NOT have moved ── */
{
  const HS = readFileSync('public/src/phone/handset.js', 'utf8');
  ok(/\{ id: 'mayor',\s+name: 'Node Manager',/.test(HS), 'phone app: id still mayor, title is Node Manager');
  ok(/window\.MythicMayorDash/.test(HS), 'phone still reads the MythicMayorDash seam');
  ok(/Earned as Node Manager/.test(HS) && /Node Manager since/.test(HS) && /not a Node Manager anywhere yet/.test(HS),
    'phone dashboard text says Node Manager');
  const DT = readFileSync('public/src/kitchen/drivethru.js', 'utf8');
  ok(/\n  mayor: \{\n    speaker:/.test(DT), 'drive-thru voice key is still `mayor`');
  ok(/ban:\['raider','courier','suit','mayor'\]/.test(DT) && /custId: r\(\) < 0\.6 \? 'suit' : 'mayor'/.test(DT),
    'drive-thru still spawns the customer by id mayor');
}

/* ── the data, imported for real (what the lane and the ticker actually show) ── */
{
  const Data = await import(pathToFileURL('public/src/kitchen/kitchen.data.js').href);
  const aide = Data.CUSTOMERS.find((c) => c.id === 'mayor');
  ok(aide && aide.name === 'Node Manager’s Aide', 'the customer with id mayor is shown as the Node Manager’s Aide', aide && aide.name);
  const allCust = JSON.stringify(Data.CUSTOMERS.map((c) => [c.name, c.line]));
  ok(!/mayor/i.test(allCust), 'no customer name or line mentions mayor');

  const V = await import(pathToFileURL('public/src/broadcast/voices.js').href);
  const text = JSON.stringify([V.VOICES, V.INSTITUTIONAL, V.COMMERCIAL]);
  ok(!/mayor/i.test(text), 'no broadcast voice fragment mentions mayor');
  ok(V.VOICES.wry.tails.includes('somebody tell the Node Manager'), 'the wry tail reads naturally: "somebody tell the Node Manager"');
  /* Sample the generator path a post takes: pick a voice for many citizens
     and assemble opener + tail. Every sampled line must be clean. */
  let bad = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const vo = V.voiceFor({ id: 'c' + i, name: 'Citizen ' + i, age: 20 + (i % 50) });
    const voice = typeof vo === 'string' ? V.VOICES[vo] : vo;
    if (!voice) continue;
    for (const t of voice.tails || []) { n++; if (/mayor/i.test((voice.openers || [''])[0] + ' ' + t)) bad++; }
  }
  ok(n > 0 && bad === 0, 'sampled ' + n + ' voice lines, none says mayor', { n, bad });
}

/* ── follow-up, not a failure: economy/ is off limits for this change ── */
{
  const walk = (d, o = []) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p, o) : (e.endsWith('.js') && o.push(p)); } return o; };
  for (const f of walk('public/src/economy')) {
    let hits = [];
    try { hits = visibleMayor(readFileSync(f, 'utf8')); } catch (e) { hits = ['(did not parse: ' + e.message + ')']; }
    if (hits.length) console.log('  FOLLOW-UP ' + f.replace(/\\/g, '/') + ': ' + JSON.stringify(hits));
  }
}

console.log('\n' + passes + ' passes' + (fails ? ', ' + fails + ' FAILED' : '') );
console.log(fails ? (fails + ' FAILED') : 'ALL PASS');
process.exit(fails ? 1 : 0);
