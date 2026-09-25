/* ══════════════════════════════════════════════════════════════════════════
   🗑 DRIVE-VAULT-DROP — a button whose whole feature is an absence.

   THE ASK, verbatim: "Add a Drop button where players can drop resources from
   their base vault, their corp vault and the resource will remove from their
   vault."

   WHAT WAS THERE: nothing. Both vaults could only be emptied by WITHDRAWING,
   which needs somewhere for the goods to land. A player whose stash is also
   full cannot free a single unit that way, and neither can the five
   corporations sitting over the 10,000 cap — ANOMALY is 1.3 MILLION units
   over, and until it comes down nobody in it can deposit anything at all.
   Dropping needs no room anywhere, because nothing arrives.

   🔴 THE FEATURE IS THE MISSING CREDIT. Everything else here — the confirm, the
      amount picker, the pool arithmetic — already existed on the withdraw path
      and is reused. What makes this a DROP rather than a withdrawal is that no
      line anywhere adds the amount back to a player. So that is what this
      driver measures: not that a credit is small or goes somewhere harmless,
      but that the crediting calls are NOT PRESENT IN THE FUNCTION AT ALL.

   ⚠ WHY THIS READS SOURCE RATHER THAN DRIVING A DROP. Both paths write through
     the network on purpose — boeDropRes goes through _boeResTx, which refuses
     to touch local state without also updating the row, and the corp path is an
     RPC. Exercising either for real needs a signed-in account and a live
     Supabase, which this harness has not got. Faking one would prove only that
     the fake does not credit. Reading the shipped text proves the absence
     directly, and EVERY absence assertion below is paired with a CONTROL that
     finds the same crediting call in the withdraw twin — so a marker that has
     rotted into matching nothing fails loudly instead of passing silently.

   Pinned, with controls:
     · boeDropRes exists, confirms, and mutates inside _boeResTx
     · it re-reads the balance INSIDE the section     (the documented mint hazard)
     · 🔴 it credits nothing               + CONTROL: boeWithdrawRes credits
     · the bank bridge routes 'drop'       + CONTROL: 'withdraw' still routes
     · the corp vaultDrop branch removes through corp_vault_withdraw
     · 🔴 …and credits nothing             + CONTROL: vaultWithdraw credits 3 ways
     · the bank card's Drop is bounded by what is BANKED, not the wallet
     · the corp Drop is gated on the same permission as Withdraw
     · CONTROL: withdraw mode still dispatches vaultWithdraw
     · every touched file still parses, and the client boots with no page errors

   Run:  node .gauntlet/drive-vault-drop.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/* Slice a top-level `async function NAME(` down to the closing brace in column
   zero. Both bank functions are written that way; if either is ever nested or
   reformatted this returns '' and every assertion about it fails rather than
   quietly matching the whole file. */
function fnBody(src, decl) {
  const i = src.indexOf(decl);
  if (i < 0) return '';
  const end = src.indexOf('\r\n}', i);
  return end < 0 ? '' : src.slice(i, end + 3);
}
/* Slice one `} else if (a.kind === 'X') {` arm out of _jbHandleAction, up to
   whichever arm follows it. */
function armBody(src, kind) {
  const i = src.indexOf("} else if (a.kind === '" + kind + "') {");
  if (i < 0) return '';
  const j = src.indexOf("    } else if (a.kind === '", i + 40);
  return j < 0 ? src.slice(i, i + 6000) : src.slice(i, j);
}

const idx = rd('index.html');
const jsx = rd('ethos', 'app.jsx');
const corp = rd('corp', 'screens.jsx');

const drop = fnBody(idx, 'async function boeDropRes(id, qty) {');
const wdraw = fnBody(idx, 'async function boeWithdrawRes(id, qty) {');
const armDrop = armBody(idx, 'vaultDrop');
const armWdraw = armBody(idx, 'vaultWithdraw');

/* Every way this codebase hands resources, cards or items back to a player.
   The drop paths must contain NONE of these; their withdraw twins must contain
   some, which is what makes a zero score on the drop side meaningful. */
const CREDIT_BANK = [
  ['_refundRes(', /_refundRes\(/],
  ['addRes(', /(?<![\w.])addRes\(/],
  ['_persistResourcesSoon(', /_persistResourcesSoon\(/],
];
const CREDIT_CORP = [
  ['Profile.cardCollection', /Profile\.cardCollection\[/],
  ['Profile.itemInventory', /Profile\.itemInventory\[/],
  ['_ensureResources', /_ensureResources\(/],
];
const hits = (body, set) => set.filter(([, re]) => re.test(body)).map(([n]) => n);

const out = {
  bank: {
    exists: !!drop,
    aboveWithdraw: idx.indexOf('async function boeDropRes') > 0
      && idx.indexOf('async function boeDropRes') < idx.indexOf('async function boeWithdrawRes'),
    confirms: /showGameConfirm\(\{/.test(drop) && /DROP IT/.test(drop),
    insideTx: /await _boeResTx\(\(live, ctx\) =>/.test(drop),
    rereadsInside: /const have = live\[id\] \| 0;/.test(drop),
    deletesAtZero: /if \(!next\[id\]\) delete next\[id\];/.test(drop),
    creditsFound: hits(drop, CREDIT_BANK),
    controlWithdrawCredits: hits(wdraw, CREDIT_BANK),
  },
  bridge: {
    routesDrop: /op === 'drop' \? boeDropRes\(d\.resId, amt\)/.test(idx),
    controlRoutesWithdraw: /op === 'withdraw' \? boeWithdrawRes\(d\.resId, amt\)/.test(idx),
  },
  corpHost: {
    exists: !!armDrop,
    confirms: /showGameConfirm\(\{/.test(armDrop) && /DROP IT/.test(armDrop),
    /* Preferred, because corp_vault_withdraw logs action='withdraw' and would
       make a destruction indistinguishable from someone taking the goods. */
    prefersDropRpc: /let r = await Cloud\.client\.rpc\('corp_vault_drop', args\);/.test(armDrop),
    /* …and the fallback, without which the button ships DEAD on every account
       until sql/087 is applied — the exact failure the warehouse allowlist
       caused three separate times. */
    fallsBack: /_jbRpcMissing\(r\.error\)\) \{[\s\S]{0,200}rpc\('corp_vault_withdraw', args\);/.test(armDrop),
    /* ⚠ RETRIED ONLY ON A MISSING FUNCTION. Any other error means the call may
       have removed rows, and a second attempt would remove them twice. */
    retryOnlyIfMissing: /if \(r && r\.error && _jbRpcMissing\(r\.error\)\) \{/.test(armDrop),
    saysWhenMislogged: /Logged as a withdrawal/.test(armDrop),
    removesServerSide: /rpc\('corp_vault_withdraw', args\)/.test(armDrop),
    usesServerFigure: /const gone = Math\.max\(0, Math\.floor\(Number\(r && r\.data\) \|\| 0\)\);/.test(armDrop),
    creditsFound: hits(armDrop, CREDIT_CORP),
    controlWithdrawCredits: hits(armWdraw, CREDIT_CORP),
  },
  bankUi: {
    button: /onClick=\{\(\) => act\("drop"\)\}/.test(jsx),
    /* "deposit" is the ONLY op measured against the wallet, so drop inherits
       the banked bound without naming itself — assert the shape that makes
       that true rather than the word. */
    boundedByBanked: /const max = op === "deposit" \? inWallet : banked;/.test(jsx),
    disabledWhenEmpty: /disabled=\{!canBank \|\| banked <= 0\} onClick=\{\(\) => act\("drop"\)\}/.test(jsx),
  },
  corpUi: {
    button: /setWdMode\('drop'\); setWd\(v\);/.test(corp),
    sameGate: /disabled=\{!canWithdraw\}[\s\S]{0,400}setWdMode\('drop'\)/.test(corp),
    dispatches: /kind: wdMode === 'drop' \? 'vaultDrop' : 'vaultWithdraw'/.test(corp),
    modalWarns: /This destroys it\./.test(corp),
    controlWithdrawUnchanged: /setWdMode\('withdraw'\); setWd\(v\);/.test(corp),
  },
};

/* The migration is half of the corp claim — the client can prefer an RPC that
   does not exist, and the fallback would hide it forever. Read the file. */
const sql = fs.existsSync('sql/087_corp_vault_drop.sql') ? fs.readFileSync('sql/087_corp_vault_drop.sql', 'utf8') : '';
out.sql = {
  exists: !!sql,
  createsFn: /create function public\.corp_vault_drop\(/.test(sql),
  logsDrop: /'drop', p_kind, p_item_id,/.test(sql),
  // CONTROL: it must not have been copied with the withdraw label left in
  noWithdrawLabel: !/'withdraw', p_kind, p_item_id,/.test(sql),
  // …and no wider than withdrawing: same membership gate, same lock-first order
  sameMembershipGate: /if not public\.is_corp_member\(p_corp_id, v_uid\) then/.test(sql),
  locksBeforeMeasuring: sql.indexOf('for update;') > 0
    && sql.indexOf('for update;') < sql.indexOf('if v_avail < v_want then'),
  notGrantedToAnon: /revoke all on function public\.corp_vault_drop[\s\S]{0,120}from public, anon;/.test(sql),
};

/* ── live: the client still boots, and boots clean ───────────────────────── */
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jsx': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const P = 9110 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errs = [];
{
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
    return r.abort();
  });
  await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  /* A stray quote inside boeDropRes took the WHOLE script block down once
     already during this change. _boeResName is declared long after it, so if
     the block failed to parse this waits out and the probe below reads false —
     which is exactly the signal that catches it. */
  await pg.waitForFunction('typeof _boeResName === "function"', null, { timeout: 180000 }).catch(() => {});
  await pg.waitForTimeout(2000);
  out.live = await pg.evaluate(() => ({
    scriptRan: typeof _boeResName === 'function',
    txPresent: typeof _boeResTx === 'function',
  }));
  await pg.close();
}

const bad = [];
const need = (k, ok, d) => { if (!ok) bad.push(k + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const B = out.bank, R = out.bridge, C = out.corpHost, BU = out.bankUi, CU = out.corpUi, L = out.live || {};

need('boeDropRes ships', B.exists, B.exists);
need('…above its withdraw twin', B.aboveWithdraw, B.aboveWithdraw);
need('…and asks before destroying anything', B.confirms, B.confirms);
need('it mutates inside _boeResTx', B.insideTx, B.insideTx);
need('…re-reading the balance INSIDE the section', B.rereadsInside, B.rereadsInside);
need('…and drops the key rather than storing a zero', B.deletesAtZero, B.deletesAtZero);
need('🔴 THE ASK: the bank drop credits NOTHING', B.creditsFound.length === 0, B.creditsFound);
need('CONTROL: the same markers DO find the withdraw credit',
     B.controlWithdrawCredits.length >= 2, B.controlWithdrawCredits);

need('the bank bridge routes drop', R.routesDrop, R.routesDrop);
need('CONTROL: withdraw still routes to withdraw', R.controlRoutesWithdraw, R.controlRoutesWithdraw);

need('the corp vaultDrop arm ships', C.exists, C.exists);
need('…and asks first', C.confirms, C.confirms);
need('it prefers corp_vault_drop, which logs the truth', C.prefersDropRpc, C.prefersDropRpc);
need('…and falls back so the button is never dead before sql/087', C.fallsBack, C.fallsBack);
need('…retrying ONLY when the function is missing, never after a real error',
     C.retryOnlyIfMissing, C.retryOnlyIfMissing);
need('…and saying so when the ledger will misname it', C.saysWhenMislogged, C.saysWhenMislogged);
need('it removes SERVER-SIDE, not by editing local state', C.removesServerSide, C.removesServerSide);
need('…and trusts the server figure, not the request', C.usesServerFigure, C.usesServerFigure);
need('🔴 THE ASK: the corp drop credits NOTHING', C.creditsFound.length === 0, C.creditsFound);
need('CONTROL: the same markers DO find all three withdraw credits',
     C.controlWithdrawCredits.length === 3, C.controlWithdrawCredits);

need('THE ASK: the bank vault card has a Drop button', BU.button, BU.button);
need('…bounded by what is BANKED, not the wallet', BU.boundedByBanked, BU.boundedByBanked);
need('…and dead on an empty shelf', BU.disabledWhenEmpty, BU.disabledWhenEmpty);

need('THE ASK: the corp vault row has a Drop button', CU.button, CU.button);
need('…gated on the same permission as Withdraw', CU.sameGate, CU.sameGate);
need('…dispatching vaultDrop only in drop mode', CU.dispatches, CU.dispatches);
need('…and the modal says plainly that it destroys', CU.modalWarns, CU.modalWarns);
need('CONTROL: Withdraw still opens in withdraw mode', CU.controlWithdrawUnchanged, CU.controlWithdrawUnchanged);

const Q = out.sql || {};
need('sql/087 ships', Q.exists && Q.createsFn, Q);
need('…and logs the drop AS a drop', Q.logsDrop, Q.logsDrop);
need('CONTROL: the withdraw label was not copied along with the body', Q.noWithdrawLabel, Q.noWithdrawLabel);
need('…gated on the same membership check as withdrawing', Q.sameMembershipGate, Q.sameMembershipGate);
need('…locking before it measures, as 045 does', Q.locksBeforeMeasuring, Q.locksBeforeMeasuring);
need('…and unreachable by anon', Q.notGrantedToAnon, Q.notGrantedToAnon);
need('the client script block still parses and runs', L.scriptRan === true, L);
need('…with _boeResTx reachable', L.txPresent === true, L);
need('no page errors', errs.length === 0, errs.slice(0, 3));

console.log(JSON.stringify(out, null, 2));
console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — both vaults can be emptied, and nothing comes back.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
