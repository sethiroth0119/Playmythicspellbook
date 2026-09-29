/* EXECUTE the treasury math, do not merely parse it (trap 4).
   Every function under test is LIFTED FROM THE SHIPPED FILE by source
   extraction — none of it is retyped here. A hand-copied reimplementation
   would be asserting about a fiction: it would stay green after someone
   changed index.html. If an extraction anchor stops matching, this file
   FAILS LOUD rather than silently testing nothing. */
/* Run:  node .gauntlet/exec-treasury.mjs      (from the repo root) */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd()) + '/';
const HTML  = readFileSync(ROOT + 'public/index.html', 'utf8');
const SHELL = readFileSync(ROOT + 'public/corp/shell.jsx', 'utf8');
const SCR   = readFileSync(ROOT + 'public/corp/screens.jsx', 'utf8');

let fails = 0, passes = 0;
const ok  = (m) => { passes++; console.log('  PASS  ' + m); };
const bad = (m) => { fails++;  console.log('  FAIL  ' + m); };
const eq  = (m, a, b) => (a === b ? ok(m + '  → ' + a) : bad(m + '  → got ' + a + ', want ' + b));

/* Pull a whole function body by brace-matching from its declaration line. */
function grab(src, decl, label) {
  const i = src.indexOf(decl);
  if (i < 0) { console.log('  FAIL  EXTRACTION: no anchor for ' + label); fails++; return null; }
  let j = src.indexOf('{', i), d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  console.log('  FAIL  EXTRACTION: unbalanced braces for ' + label); fails++; return null;
}
function grabLine(src, re, label) {
  const m = src.match(re);
  if (!m) { console.log('  FAIL  EXTRACTION: no anchor for ' + label); fails++; return null; }
  return m[0];
}

console.log('\n── extracting the SHIPPED implementations ──────────────────────');
const SRC_jbNum = grab(HTML,  'function _jbNum(n)', '_jbNum (index.html)');
const SRC_numC  = grabLine(SHELL, /const numC = \(n\) => \{[^\n]*\};/, 'numC (shell.jsx)');
const SRC_fmtC  = grab(SHELL, 'const fmtC = (n) =>', 'fmtC (shell.jsx)');
const SRC_fetch = grab(HTML,  'async function corpTreasuryFetch()', 'corpTreasuryFetch (index.html)');
if (fails) { console.log('\nEXTRACTION FAILED — nothing was tested.'); process.exit(1); }
console.log('  ok    _jbNum, numC, fmtC, corpTreasuryFetch lifted from source');

const numC   = new Function(SRC_numC  + ' return numC;')();
// grab() stops at the closing brace, so an arrow-const needs its ';' back.
const fmtC   = new Function(SRC_fmtC  + '; return fmtC;')();
const _jbNum = new Function(SRC_jbNum + ' return _jbNum;')();

/* ── 1. numC / _jbNum are the SAME rule on both sides of the bridge ───────── */
console.log('\n── 1. the bridge must not change a number by crossing it ───────');
{
  const probes = [0, 1, -1, 2438120, 2147483647, 2147483648, 5000000000, 1e12,
                  -3000000000, 12.4, 12.5, NaN, undefined, null, 'x', Infinity];
  let same = true, diffs = [];
  probes.forEach(p => { if (_jbNum(p) !== numC(p)) { same = false; diffs.push(String(p)); } });
  same ? ok('_jbNum(x) === numC(x) for all ' + probes.length + ' probes (game side === app side)')
       : bad('bridge and app disagree on: ' + diffs.join(', '));
  eq('non-finite collapses to 0, never NaN   numC(NaN)',       numC(NaN), 0);
  eq('undefined field can never print NaN    numC(undefined)', numC(undefined), 0);
  eq('a null balance is 0, not a dash        fmtC(0)',         fmtC(0), '0');
}

/* ── 2. THE 32-BIT CAST THE FIX REMOVES — show the old code was wrong ─────── */
console.log('\n── 2. the defect `| 0` caused, and that numC does not ──────────');
{
  const big = 3000000000;                       // 3.0e9 Cinder in one treasury
  eq('OLD  (big | 0)      wraps NEGATIVE', big | 0, -1294967296);
  eq('NEW  numC(big)      is exact',       numC(big), 3000000000);
  // A gate written `treasury < cost` therefore REFUSED a spend it could afford.
  const cost = 400000;                          // a real OPS_ECON startup
  eq('OLD  gate refuses an affordable buy', (big | 0) < cost, true);
  eq('NEW  gate allows it',                 numC(big) < cost, false);
  eq('printed balance was wrong too', fmtC(big | 0), '-1,294,967,296');
  eq('printed balance is now right',  fmtC(numC(big)), '3,000,000,000');
}

/* ── 3. RUN THE REAL corpTreasuryFetch OVER FAKE ROWS ─────────────────────── */
console.log('\n── 3. headline === select sum(amount) from corp_treasury ───────');
async function runFetch(rows, { fail = false, signedIn = true, haveCorp = true } = {}) {
  const Corp = { mine: haveCorp ? { id: 'c1', name: 'Test' } : null, roster: [{ userId: 'u1', name: 'Ada' }] };
  const Profile = { cloud: { signedIn, userId: 'u1', displayName: 'Ada' } };
  const Cloud = { client: { from: () => { const q = {
    select: () => q, eq: () => q, order: () => q,
    limit: () => Promise.resolve(fail ? { error: { message: 'boom' }, data: null } : { error: null, data: rows }),
  }; return q; } } };
  const fn = new Function('Corp', 'Profile', 'Cloud', 'initCloud',
    SRC_fetch + ' return corpTreasuryFetch;')(Corp, Profile, Cloud, () => true);
  await fn();
  return Corp;
}
const iso = (hAgo) => new Date(Date.now() - hAgo * 3600000).toISOString();
{
  // Deliberately includes a fractional row and a debit — the balance is
  // sum(amount) to the unit and must not be clamped at 0 or truncated per-row.
  const rows = [
    { id: 'a', amount: 1500.5, kind: 'deposit',    note: 'member deposit', user_id: 'u1', created_at: iso(1) },
    { id: 'b', amount: -400000, kind: 'op_startup', note: 'mining startup', user_id: null, created_at: iso(2) },
    { id: 'c', amount: 3000000000, kind: 'op_revenue', note: 'mining production', user_id: 'u1', created_at: iso(40) },
  ];
  const sqlSum = Math.round(rows.reduce((s, r) => s + r.amount, 0));   // what Postgres returns
  const C = await runFetch(rows);
  eq('balance === sum(amount) TO THE UNIT', C.treasury, sqlSum);
  eq('...and survives the bridge unchanged', _jbNum(C.treasury), sqlSum);
  eq('...and the headline prints that exact figure', fmtC(numC(_jbNum(C.treasury))), sqlSum.toLocaleString('en-US'));
  eq('treasuryKnown true on a good read', C.treasuryKnown, true);
  // The delta is summed over the SAME rows — row c is 40h old and must be out.
  eq('24h delta uses the same row set', C.treasury24h, Math.round(1500.5 - 400000));
  eq('every rendered line traces to a corp_treasury row', C.treasuryLog.length, rows.length);
  eq('a row with no user_id renders as System, not a blank', C.treasuryLog[1].who, 'System');
  eq('a row with a user_id resolves a real name', C.treasuryLog[0].who, 'Ada');
  // The screen renders sum of the log when the log is complete; they must agree.
  eq('sum(rendered lines) === headline',
     C.treasuryLog.reduce((s, r) => s + r.amount, 0), sqlSum);
}

console.log('\n── 4. empty vs unread vs signed-out are DIFFERENT answers ──────');
{
  const empty = await runFetch([]);
  eq('empty treasury: balance is a real 0', empty.treasury, 0);
  eq('empty treasury: read SUCCEEDED (screen shows 0 + "no movements yet")', empty.treasuryKnown, true);
  eq('empty treasury: prints "0", not a dash', fmtC(numC(empty.treasury)), '0');

  const broken = await runFetch([], { fail: true });
  eq('failed read: treasuryKnown false (screen shows "unread", NOT 0)', broken.treasuryKnown, false);

  const out = await runFetch([], { signedIn: false });
  eq('signed out: treasuryKnown false', out.treasuryKnown, false);

  const nocorp = await runFetch([], { haveCorp: false });
  eq('no corporation: treasuryKnown false', nocorp.treasuryKnown, false);
}

/* ── 5. THE DEPOSIT PATH — the headline may not outrun its own ledger ─────── */
console.log('\n── 5. after a deposit, balance still === sum(rendered lines) ───');
{
  const before = [{ id: 'a', amount: 1000, kind: 'deposit', note: '', user_id: 'u1', created_at: iso(3) }];
  const after  = before.concat([{ id: 'b', amount: 250, kind: 'deposit', note: 'member deposit', user_id: 'u1', created_at: iso(0) }]);
  const C = await runFetch(after);                 // what the re-read now does
  eq('balance after re-read', C.treasury, 1250);
  eq('ledger the screen renders under it', C.treasuryLog.reduce((s, r) => s + r.amount, 0), 1250);
  eq('24h delta moved with it', C.treasury24h, 1250);
  eq('treasuryKnown true, so no false "Ledger not read"', C.treasuryKnown, true);
  // The OLD code only did `Corp.treasury += amount` and returned. Reproduce it:
  const stale = { treasury: 1000, treasuryLog: before, treasury24h: 1000, treasuryKnown: true };
  stale.treasury = (stale.treasury | 0) + 250;
  const staleSum = stale.treasuryLog.reduce((s, r) => s + r.amount, 0);
  (stale.treasury !== staleSum)
    ? ok('OLD hand-patch: headline ' + stale.treasury + ' vs ledger ' + staleSum + ' — the drift this round removes')
    : bad('expected the old hand-patch to drift, it did not');
  // And the deposit-before-first-read case the re-read also fixes:
  const cold = { treasury: 0, treasuryKnown: false };
  cold.treasury = (cold.treasury | 0) + 250;
  (cold.treasuryKnown === false)
    ? ok('OLD hand-patch: a deposit before the first read left treasuryKnown=false → "Ledger not read" over a balance that had just moved')
    : bad('expected treasuryKnown to stay false');
}

/* ── 6. NO FABRICATED CONTENT SURVIVES ────────────────────────────────────── */
console.log('\n── 6. the fabricated-content grep, as an assertion ─────────────');
{
  const banned = ['2,438,120', 'BLACK SUN', '34 / 50', 'RANK 04', 'TREASURY 2.4M',
                  'WAR 14d', 'Sister Tiamat', 'WHISPER', 'Quartermaster',
                  'Crimson Pact War', 'Foundry Belt Expansion'];
  const blob = SCR + SHELL + readFileSync(ROOT + 'public/corp/app.jsx', 'utf8');
  const hit = banned.filter(s => blob.includes(s));
  hit.length === 0 ? ok('none of the ' + banned.length + ' fabricated strings survive in public/corp/')
                   : bad('still present: ' + hit.join(', '));
  /* The dead nav badge, gone from the DATA and not merely hidden at render.
     ⚠ Must NOT be a bare /badge: 3/ over the file — the comment that explains
       the removal quotes the old expression, so that regex fails on its own
       documentation. Assert on the NAV ENTRY, which is the thing that renders. */
  const navLogi = grabLine(SHELL, /^ *\{ id: 'logistics',.*$/m, 'NAV logistics entry');
  navLogi && /badge/.test(navLogi)
    ? bad('the Logistics NAV entry still carries a badge: ' + navLogi.trim())
    : ok('Logistics NAV entry carries no badge field:  ' + String(navLogi).trim());
  // The three numbers the bar requires to be one number.
  const three = [/const bal = numC\(E\.corpTreasury\)/,            // treasury headline
                 /fmtC\(numC\(econ && econ\.corpTreasury\)\)/,      // operations header
                 /const treasury = numC\(E\.corpTreasury\)/];       // fund-button gate
  three.every(r => r.test(SCR))
    ? ok('headline, Operations header and Fund gate all read numC(econ.corpTreasury) — one field, one rule')
    : bad('the three call sites do not all read the same field the same way');
}

console.log('\n' + '─'.repeat(64));
console.log(fails === 0 ? `ALL ${passes} TREASURY ASSERTIONS PASS` : `${fails} FAILED / ${passes} passed`);
process.exit(fails ? 1 : 0);
