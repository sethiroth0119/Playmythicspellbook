/* EXECUTE the real _jbActivityFetch() out of index.html against REAL rows
   pulled from the production database (project ktsiasyjusesawtrwrjc).
   Gates only parse; this runs the thing. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
// Repo-relative so a critic can run this from anywhere.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') + '/';

const HTML = readFileSync(REPO + 'public/index.html', 'utf8');

// Brace-match a named function out of the document. No regex over the body —
// the body is full of prose and braces in comments would break a naive scan,
// so we start at the first '{' AFTER the signature and count from there while
// skipping strings, template literals, regex-ish slashes and both comment forms.
function grab(sig) {
  const i = HTML.indexOf(sig);
  if (i < 0) throw new Error('not found: ' + sig);
  let j = HTML.indexOf('{', i + sig.length - 1);
  let depth = 0, k = j;
  let s = null; // ' " ` /* //
  for (; k < HTML.length; k++) {
    const c = HTML[k], n = HTML[k + 1], p = HTML[k - 1];
    if (s === 'line') { if (c === '\n') s = null; continue; }
    if (s === 'blk') { if (c === '*' && n === '/') { s = null; k++; } continue; }
    if (s) { if (c === '\\') { k++; continue; } if (c === s) s = null; continue; }
    if (c === '/' && n === '/') { s = 'line'; k++; continue; }
    if (c === '/' && n === '*') { s = 'blk'; k++; continue; }
    if (c === "'" || c === '"' || c === '`') { s = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return HTML.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + sig);
}

const SRC_ACTOR = grab('function _jbActorName(uid, stored)');
const SRC_FETCH = grab('async function _jbActivityFetch()');
console.log('lifted _jbActorName    ' + SRC_ACTOR.length + ' chars');
console.log('lifted _jbActivityFetch ' + SRC_FETCH.length + ' chars');

// ── REAL ROWS (copied verbatim out of the production tables) ───────────────
const CORP_ID = '5e997df8-644a-4bcb-9868-b8814beb2b60';
const ME = 'b35a8809-d5cf-4356-8af1-44646550e11b';

const TREASURY = [
  { id: '454cf5c7-a0ae-4c63-9c57-1dff9613449c', user_id: ME, amount: 225, kind: 'op_revenue', note: 'construction production', created_at: '2026-08-19T07:54:44.966626+00:00' },
  { id: '16321023-de73-42f6-88a5-afc2cc1b7ff0', user_id: ME, amount: -1852, kind: 'op_salary', note: 'construction wages', created_at: '2026-08-19T07:54:44.739098+00:00' },
  { id: '8ec49567-15ca-4cc7-8782-b1cc5a3c98b5', user_id: ME, amount: 50847, kind: 'op_revenue', note: 'research production', created_at: '2026-08-19T07:54:40.06115+00:00' },
  { id: 'c244062c-c77c-4a95-83e0-3c5727e565b1', user_id: ME, amount: -31869, kind: 'op_salary', note: 'research wages', created_at: '2026-08-19T07:54:39.81002+00:00' },
  // a real-shaped deposit and an unknown kind (kinds added later must print raw)
  { id: 'dep-1', user_id: '41c880ac-828b-4ed9-9dbb-cac15984e355', amount: 2000000, kind: 'deposit', note: 'war chest', created_at: '2026-08-20T10:00:00+00:00' },
  { id: 'odd-1', user_id: null, amount: 40, kind: 'some_future_kind', note: '', created_at: '2026-08-20T09:00:00+00:00' },
  // hostile rows: the NaN/undefined paths the bar names explicitly
  { id: 'bad-1', user_id: ME, amount: null, kind: 'deposit', note: null, created_at: null },
  { id: 'bad-2', user_id: ME, amount: 'not-a-number', kind: 'refund', note: 'x', created_at: 'garbage' },
  // 🔢 A DATED row with no amount. This one SURVIVES the date filter, so it is
  // the row that proves absent stays absent: printing 0 beside "Treasury
  // refund" would be a claim that the row moved nothing, which is a different
  // fact from the row carrying no amount at all.
  { id: 'noamt-1', user_id: ME, amount: null, kind: 'refund', note: 'reversal pending', created_at: '2026-08-20T08:00:00+00:00' },
  { id: 'noamt-2', user_id: ME, amount: '', kind: 'refund', note: 'blank column', created_at: '2026-08-20T07:00:00+00:00' },
];
const REQUESTS = [
  { id: 'e9c70b95-c847-4bdb-8234-90a2b6de37f0', user_id: '41c880ac-828b-4ed9-9dbb-cac15984e355', user_name: 'Mavric', role: 'member', status: 'joined', created_at: '2026-08-18T03:00:08.080481+00:00' },
  { id: 'c231032b-c367-4f88-b6f0-efecdfb73cc8', user_id: '571da091-9723-492f-bac3-bdb18c37f8d8', user_name: 'Keevan M', role: 'member', status: 'joined', created_at: '2026-08-17T22:59:35.872071+00:00' },
  { id: 'pend-1', user_id: '19d23c9c-de8e-4aa7-9939-85b4eee109b2', user_name: 'Cory B', role: 'member', status: 'pending', created_at: '2026-08-17T22:59:18.16228+00:00' },
];
const OPS = [
  { id: '4349d1fe-714f-4a10-812b-ce8fbb20e2f3', op_type: 'salvage', level: 1, workers: 0, status: 'active', created_at: '2026-08-07T22:34:48.125235+00:00' },
  { id: 'f72ca33c-1b5f-4c2d-82a4-34afaeba3224', op_type: 'construction', level: 1, workers: 1, status: 'active', created_at: '2026-08-07T22:34:40.379772+00:00' },
];
// corp_vault_log is EMPTY in production (piece 1 writes it). These rows use the
// live schema exactly: action, actor_id, actor_name, kind, item_id, name, icon,
// qty, counterparty_id, counterparty_name, created_at.
const VAULT = [
  { id: 'v1', corp_id: CORP_ID, actor_id: ME, actor_name: 'Sethiroth', action: 'deposit', kind: 'card', item_id: 'c_emberwyrm', name: 'Emberwyrm', icon: '🃏', qty: 3, counterparty_id: null, counterparty_name: null, created_at: '2026-08-21T12:00:00+00:00' },
  { id: 'v2', corp_id: CORP_ID, actor_id: '41c880ac-828b-4ed9-9dbb-cac15984e355', actor_name: 'Mavric', action: 'withdraw', kind: 'resource', item_id: 'iron', name: 'Iron', icon: '⛏', qty: 40, counterparty_id: null, counterparty_name: null, created_at: '2026-08-21T11:00:00+00:00' },
  { id: 'v3', corp_id: CORP_ID, actor_id: ME, actor_name: 'Sethiroth', action: 'send', kind: 'equipment', item_id: 'blade', name: 'Serrated Blade', icon: '🗡', qty: 1, counterparty_id: '571da091-9723-492f-bac3-bdb18c37f8d8', counterparty_name: 'Keevan M', created_at: '2026-08-21T10:00:00+00:00' },
  { id: 'v4', corp_id: CORP_ID, actor_id: '571da091-9723-492f-bac3-bdb18c37f8d8', actor_name: 'Keevan M', action: 'claim', kind: 'equipment', item_id: 'blade', name: 'Serrated Blade', icon: '🗡', qty: 1, counterparty_id: ME, counterparty_name: 'Sethiroth', created_at: '2026-08-21T10:05:00+00:00' },
  // an orphan: actor left the corp, no stored name — must NOT print "Member"
  { id: 'v5', corp_id: CORP_ID, actor_id: 'deadbeef-0000-0000-0000-000000000000', actor_name: null, action: 'deposit', kind: 'resource', item_id: 'wood', name: 'Wood', icon: '🪵', qty: 12, counterparty_id: null, counterparty_name: null, created_at: '2026-08-21T09:00:00+00:00' },
];
const TRANSFERS = [
  { id: 't1', from_id: ME, from_name: 'Sethiroth', to_id: '41c880ac-828b-4ed9-9dbb-cac15984e355', to_name: 'Mavric', kind: 'resource', item_id: 'coal', name: 'Coal', icon: '🪨', qty: 25, note: '', status: 'sent', created_at: '2026-08-21T08:00:00+00:00' },
];

// ── A stub Cloud.client that answers .from(table) like PostgREST does ──────
function mkClient(tables) {
  return {
    from(t) {
      const q = {
        select() { return q; }, eq() { return q; }, order() { return q; },
        limit() {
          const v = tables[t];
          // a MISSING table is PostgREST's 42P01 error object, not a throw and
          // not an empty list — the exact case the per-source guards exist for
          if (v === undefined) return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "' + t + '" does not exist' } });
          if (v === 'throw') return Promise.reject(new Error('network down'));
          return Promise.resolve({ data: v, error: null });
        },
        then(res, rej) { return this.limit().then(res, rej); },
      };
      return q;
    },
  };
}

const ALL = { corp_vault_log: VAULT, corp_treasury: TREASURY, corp_transfers: TRANSFERS, corp_requests: REQUESTS, corp_operations: OPS };

async function run(tables, opts) {
  opts = opts || {};
  const App = {};
  const Corp = { mine: opts.noCorp ? null : { id: CORP_ID, name: 'Ashfall Holdings' },
                 roster: [{ userId: '41c880ac-828b-4ed9-9dbb-cac15984e355', name: 'Mavric' },
                          { userId: '571da091-9723-492f-bac3-bdb18c37f8d8', name: 'Keevan M' }] };
  const Profile = { cloud: { userId: ME, displayName: 'Sethiroth' }, account: {} };
  const Cloud = opts.offline ? null : { client: mkClient(tables) };
  const OP_LABELS = { salvage: 'Salvage Yard', construction: 'Construction Firm', medical: 'Medical Clinic', mining: 'Mining Outfit' };
  const f = new Function('App', 'Corp', 'Profile', 'Cloud', 'OP_LABELS',
    SRC_ACTOR + '\n' + SRC_FETCH + '\nreturn _jbActivityFetch();')
    (App, Corp, Profile, Cloud, OP_LABELS);
  await f;
  return App;
}

let fails = 0, checks = 0;
const ok = (name, cond, extra) => {
  checks++;
  if (!cond) { fails++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
  else console.log('  ok    ' + name + (extra ? '   ' + extra : ''));
};

// Nothing anywhere on a row may render as NaN/undefined/null text.
const POISON = /\bNaN\b|\bundefined\b|\[object Object\]/;
function scan(rows, label) {
  let bad = [];
  rows.forEach(r => {
    ['actor', 'verb', 'object', 'note', 'unit', 'status', 'icon', 'at', 'id'].forEach(k => {
      if (r[k] != null && POISON.test(String(r[k]))) bad.push(r.id + '.' + k + '=' + r[k]);
    });
    if (r.amount != null && !isFinite(r.amount)) bad.push(r.id + '.amount=' + r.amount);
    if (r.qty != null && !isFinite(r.qty)) bad.push(r.id + '.qty=' + r.qty);
  });
  ok(label, bad.length === 0, bad.length ? bad.join(' | ') : '(' + rows.length + ' rows clean)');
}

(async () => {
  console.log('\n=== 1. ALL FIVE SOURCES PRESENT (real rows) ===');
  let A = await run(ALL);
  const F = A._jbActivity;
  console.log('  ' + F.length + ' entries; loaded=' + !!A._jbActivityAt);
  F.slice(0, 8).forEach(r => console.log('   ' + String(r.at).slice(0, 19) + '  [' + r.src + ']  dir=' +
    (r.dir > 0 ? '+' : r.dir < 0 ? '-' : '0') + '  ' + r.actor + ' | ' + r.verb + ' | ' + (r.object || '') +
    '  amount=' + r.amount + ' qty=' + r.qty));

  const byId = id => F.filter(r => r.id === id)[0];

  ok('every source contributed', ['vault', 'treasury', 'transfer', 'request', 'operation']
      .every(s => F.some(r => r.src === s)),
      JSON.stringify(['vault','treasury','transfer','request','operation'].map(s => s + ':' + F.filter(r => r.src === s).length)));
  ok('newest-first order', F.every((r, i) => i === 0 || (F[i - 1].at || '') >= (r.at || '')));
  ok('vault DEPOSIT is dir +1 qty +3', byId('vault:v1') && byId('vault:v1').dir === 1 && byId('vault:v1').qty === 3);
  ok('vault WITHDRAW is dir -1 qty -40 (sign taken from `action`, not stored)',
     byId('vault:v2') && byId('vault:v2').dir === -1 && byId('vault:v2').qty === -40);
  ok('vault send/claim reclassified as src=transfer, dir 0',
     byId('vault:v3') && byId('vault:v3').src === 'transfer' && byId('vault:v3').dir === 0 &&
     byId('vault:v4') && byId('vault:v4').src === 'transfer');
  ok('counterparty resolved by name in the verb', byId('vault:v3') && /Keevan M/.test(byId('vault:v3').verb),
     byId('vault:v3') && byId('vault:v3').verb);
  ok('orphan actor renders a short id, never "Member"',
     byId('vault:v5') && byId('vault:v5').actor === '#deadbeef', byId('vault:v5') && byId('vault:v5').actor);
  ok('corp_transfers SUPPRESSED while the vault log carries transfers (no double-render)',
     !F.some(r => r.id === 'transfer:t1'));
  ok('op_salary is negative and reads back its real amount',
     byId('treasury:16321023-de73-42f6-88a5-afc2cc1b7ff0') &&
     byId('treasury:16321023-de73-42f6-88a5-afc2cc1b7ff0').amount === -1852 &&
     byId('treasury:16321023-de73-42f6-88a5-afc2cc1b7ff0').dir === -1);
  ok('op_revenue positive 50847', byId('treasury:8ec49567-15ca-4cc7-8782-b1cc5a3c98b5') &&
     byId('treasury:8ec49567-15ca-4cc7-8782-b1cc5a3c98b5').amount === 50847);
  ok('deposit 2,000,000 keeps its exact value (no rounding, no truncation)',
     byId('treasury:dep-1') && byId('treasury:dep-1').amount === 2000000);
  ok('actor name resolved from the roster, not the frozen row',
     byId('treasury:dep-1') && byId('treasury:dep-1').actor === 'Mavric', byId('treasury:dep-1') && byId('treasury:dep-1').actor);
  // Your own rows carry YOUR display name (the guild feed is shared — every
  // member reads the same row, so a name is right and "You" is the fallback
  // only when the profile has no display name at all).
  ok('own rows carry the live profile display name',
     byId('treasury:8ec49567-15ca-4cc7-8782-b1cc5a3c98b5').actor === 'Sethiroth',
     byId('treasury:8ec49567-15ca-4cc7-8782-b1cc5a3c98b5').actor);
  ok('unknown treasury kind prints the RAW kind, not a guess',
     byId('treasury:odd-1') && byId('treasury:odd-1').verb === 'some_future_kind');
  ok('row with a null note prints NO object (no boilerplate body)',
     byId('treasury:odd-1') && byId('treasury:odd-1').object === '');
  ok('undated row is DROPPED, not dated "now"', !byId('treasury:bad-1'));
  ok('unparseable date is DROPPED', !byId('treasury:bad-2'));
  ok('a dated row with a NULL amount keeps null — it must NOT print a 0',
     byId('treasury:noamt-1') && byId('treasury:noamt-1').amount === null &&
     byId('treasury:noamt-1').dir === 0,
     byId('treasury:noamt-1') && String(byId('treasury:noamt-1').amount));
  ok('an empty-string amount is null too, never NaN and never 0',
     byId('treasury:noamt-2') && byId('treasury:noamt-2').amount === null,
     byId('treasury:noamt-2') && String(byId('treasury:noamt-2').amount));
  /* The VERB is built from the status, so shipping the status as a chip as
     well printed the same word twice — "was hired [hired]", "sent — claimed
     by X [claimed]". The chip now survives only on operations, where it says
     something the verb does not. */
  ok('pending application: the verb carries the status',
     byId('request:pend-1') && byId('request:pend-1').verb === 'applied to the corporation');
  ok('…and does NOT also ship it as a duplicate chip',
     byId('request:pend-1') && !byId('request:pend-1').status);
  ok('no transfer row ships a duplicate status chip either',
     !F.some(a => a.src === 'transfer' && a.status));
  ok('operations DO keep a status — it is not in their verb',
     F.some(a => a.src === 'operation' && a.status));
  ok('operation names its real label from OP_LABELS',
     byId('operation:4349d1fe-714f-4a10-812b-ce8fbb20e2f3') &&
     byId('operation:4349d1fe-714f-4a10-812b-ce8fbb20e2f3').object === 'Salvage Yard');
  ok('no row carries both amount and qty (one value per entry)',
     F.every(r => !(r.amount != null && r.qty != null)));
  scan(F, 'no NaN / undefined / [object Object] anywhere in the feed');

  console.log('\n=== 2. DEGRADATION — each source missing in turn (other four survive) ===');
  for (const miss of Object.keys(ALL)) {
    const sub = Object.assign({}, ALL); delete sub[miss];
    const B = await run(sub);
    const n = B._jbActivity.length;
    const srcs = Array.from(new Set(B._jbActivity.map(r => r.src))).sort().join(',');
    // dropping the vault log promotes corp_transfers out of fallback, so the
    // 'transfer' source must still be present in that run — that is the point
    ok('without ' + miss + ': still renders', n > 0 && B._jbActivityAt > 0, n + ' rows, sources=' + srcs);
    if (miss === 'corp_vault_log') ok('  …and corp_transfers takes over as the transfer source',
      B._jbActivity.some(r => r.id === 'transfer:t1'));
  }

  console.log('\n=== 3. DEGRADATION — a source that THROWS, not just 404s ===');
  const T = await run(Object.assign({}, ALL, { corp_treasury: 'throw' }));
  ok('a rejected read cannot take the other four down',
     T._jbActivity.length > 0 && !T._jbActivity.some(r => r.src === 'treasury'),
     T._jbActivity.length + ' rows');

  console.log('\n=== 4. DEGRADATION — every table missing / offline / no corp ===');
  const E = await run({});
  ok('all five missing: [] and LOADED (one honest empty state, not a spinner)',
     Array.isArray(E._jbActivity) && E._jbActivity.length === 0 && !!E._jbActivityAt);
  const O = await run(ALL, { offline: true });
  ok('offline (no Cloud): [] and loaded, no throw', O._jbActivity.length === 0 && !!O._jbActivityAt);
  const N = await run(ALL, { noCorp: true });
  ok('no corporation: [] and loaded, no throw', N._jbActivity.length === 0 && !!N._jbActivityAt);

  console.log('\n=== 5. BADGE ARITHMETIC (the shell.jsx rule, run against this feed) ===');
  const shell = readFileSync(REPO + 'public/corp/shell.jsx', 'utf8');
  const m = /const mailNewCount = ([\s\S]*?\n};)/.exec(shell);
  if (!m) { fails++; console.log('  FAIL  could not lift mailNewCount from shell.jsx'); }
  else {
    const mailNewCount = new Function('return ' + m[1].replace(/;$/, ''))();
    ok('empty feed -> 0 (the old badge was a hardcoded 2)', mailNewCount([], '') === 0);
    ok('no mark -> everything is new', mailNewCount(F, '') === F.length, String(F.length));
    const mark = F[2].at;
    const expect = F.filter(r => r.at > mark).length;
    ok('mark at row 3 -> exactly the rows above it', mailNewCount(F, mark) === expect, expect + ' of ' + F.length);
    ok('mark at newest -> 0 (badge disappears after opening)', mailNewCount(F, F[0].at) === 0);
    ok('badge never counts an undated row', mailNewCount([{ at: '' }, { at: null }], '2000-01-01') === 0);
  }

  console.log('\n=== 6. ONE REFRESH — a vault deposit, a vault withdrawal and a treasury deposit ===');
  /* The bar's end-to-end case. NOT run against the live database on purpose:
     corp_treasury is append-only and balance = sum(amount), so inserting a
     test deposit would permanently move a real corporation's balance, and
     "delete it afterwards" is exactly the UPDATE-the-ledger move the house
     rules forbid. The three rows below are the rows the real write paths
     insert (same columns, same CHECK-legal `action` values), handed to the
     REAL _jbActivityFetch through a client that answers like PostgREST.
     Pass 1 is the feed before; the rows are appended; pass 2 is the single
     refresh the Refresh button fires (activityRefresh → _jbActivityFetch →
     _jbSendData → 'jbdata'). */
  const live = { corp_vault_log: VAULT.slice(), corp_treasury: TREASURY.slice(),
                 corp_transfers: TRANSFERS.slice(), corp_requests: REQUESTS.slice(), corp_operations: OPS.slice() };
  const before = (await run(live))._jbActivity;
  const T0 = Date.now();
  const iso = (ms) => new Date(T0 + ms).toISOString();
  // newest LAST here, so "right order" is something the sort has to earn
  live.corp_treasury.unshift({ id: 'live-dep', user_id: '41c880ac-828b-4ed9-9dbb-cac15984e355', amount: 5000, kind: 'deposit', note: 'toward the warehouse', created_at: iso(1000) });
  live.corp_vault_log.unshift({ id: 'live-wd', corp_id: CORP_ID, actor_id: '571da091-9723-492f-bac3-bdb18c37f8d8', actor_name: 'Keevan M', action: 'withdraw', kind: 'resource', item_id: 'iron', name: 'Iron', icon: '⛏', qty: 10, counterparty_id: null, counterparty_name: null, created_at: iso(2000) });
  live.corp_vault_log.unshift({ id: 'live-dp', corp_id: CORP_ID, actor_id: ME, actor_name: 'Sethiroth', action: 'deposit', kind: 'resource', item_id: 'iron', name: 'Iron', icon: '⛏', qty: 25, counterparty_id: null, counterparty_name: null, created_at: iso(3000) });
  const after = (await run(live))._jbActivity;

  ok('one refresh picks up exactly the three new movements',
     after.length === before.length + 3, before.length + ' → ' + after.length);
  const top3 = after.slice(0, 3);
  console.log('   top of the refreshed feed:');
  top3.forEach(r => console.log('    ' + r.at.slice(11, 19) + '  [' + r.src + '] ' + r.actor + ' ' + r.verb +
    ' · ' + r.object + '  ' + (r.amount != null ? r.amount + ' Cinder' : r.qty)));
  ok('order is newest-first: deposit, withdrawal, treasury deposit',
     top3.map(r => r.id).join(',') === 'vault:live-dp,vault:live-wd,treasury:live-dep', top3.map(r => r.id).join(','));
  ok('the vault deposit is +25 Iron by the right member',
     top3[0].qty === 25 && top3[0].dir === 1 && top3[0].object === 'Iron' && top3[0].actor === 'Sethiroth');
  ok('the vault withdrawal is -10 Iron by the right member',
     top3[1].qty === -10 && top3[1].dir === -1 && top3[1].object === 'Iron' && top3[1].actor === 'Keevan M');
  ok('the treasury deposit is +5,000 Cinder by the right member',
     top3[2].amount === 5000 && top3[2].dir === 1 && top3[2].unit === 'Cinder' && top3[2].actor === 'Mavric');
  ok('nothing already in the feed was disturbed by the refresh',
     JSON.stringify(after.slice(3)) === JSON.stringify(before));
  // The badge is the count above the mark taken BEFORE the three movements.
  const shellSrc = readFileSync(REPO + 'public/corp/shell.jsx', 'utf8');
  const mm = /const mailNewCount = ([\s\S]*?\n};)/.exec(shellSrc);
  const mnc = new Function('return ' + mm[1].replace(/;$/, ''))();
  ok('the badge reads exactly 3 against a mark set before them', mnc(after, before[0].at) === 3,
     String(mnc(after, before[0].at)));

  // Hand the REAL bridge output to the browser leg, so the DOM test renders
  // what the bridge actually produced rather than a hand-written fixture.
  const outFile = process.env.ACT_OUT || '';
  if (outFile) { (await import('fs')).writeFileSync(outFile, JSON.stringify(after, null, 1)); console.log('  wrote ' + after.length + ' real bridge entries → ' + outFile); }

  console.log('\n' + (fails ? 'FAILED ' + fails + ' of ' + checks : 'ALL ' + checks + ' CHECKS PASS'));
  process.exit(fails ? 1 : 0);
})();
